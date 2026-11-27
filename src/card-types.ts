/**
 * Character-card wire and domain vocabulary shared by the Host and the browser
 * half. This module is dependency-free so the client bundle can import it
 * without pulling the Host-only schema or storage layer.
 *
 * A character card is Subagent Director's portable unit of delegation intent:
 * it packages the delegation guidance the main agent reads, a fixed system
 * prompt and persona for the child, an optional model route, and presentation
 * metadata. The card is stored as its own JSON document, never inside the
 * plugin's public configuration.
 */

/** Portable single-card envelope kind. */
export const CARD_KIND = 'subagent-director/character-card' as const;

/** Portable multi-card envelope kind. */
export const CARD_BUNDLE_KIND = 'subagent-director/character-card-collection' as const;

/** Current portable format version; version 1 remains importable. */
export const CARD_FORMAT_VERSION = 2;

/** Card ids are kebab-case so they are safe as storage record keys and role ids. */
export const CARD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Hard bounds protect the bridge and the rendered prompt from oversized input. */
export const CARD_LIMITS = {
  idLength: 64,
  nameLength: 80,
  guidanceLength: 8000,
  promptLength: 30000,
  notesLength: 8000,
  tags: 12,
  tagLength: 32,
  emojiLength: 16,
  importCards: 500,
  importBytes: 8 * 1024 * 1024,
} as const;

/** Accent palette for card avatars in the settings surface. */
export const CARD_ACCENTS = ['blue', 'violet', 'green', 'amber', 'rose', 'slate'] as const;

/** One accent token name. */
export type CardAccent = (typeof CARD_ACCENTS)[number];

/** A card's model binding; an absent binding inherits the plugin default route. */
export interface CardModelBinding {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

/** One complete character card as persisted and exported. */
export interface CharacterCard {
  /** Stable kebab-case identity, also the delegation `role` id. */
  id: string;
  /** Display name shown to the user and (in guidance) to the main agent. */
  name: string;
  /** Delegation guidance shown to the main agent: when to use this card. */
  delegationGuidance: string;
  /** Delegation guidance shown to the main agent: when not to use this card. */
  avoidGuidance?: string;
  /** Fixed system prompt injected into the child session. */
  systemPrompt?: string;
  /** Persona text injected into the child session after the system prompt. */
  persona?: string;
  /** Optional exact LLM route; provider and model are selected together in the UI. */
  model?: CardModelBinding;
  /** Optional DSH Agent Preset id for tool composition. */
  agentPreset?: string;
  /** Free-form search tags. */
  tags?: string[];
  /** Single emoji or short glyph used as the card avatar. */
  emoji?: string;
  /** Avatar accent token; omitted derives one from the id. */
  accent?: CardAccent;
  /** Human-only author notes, never sent to a model. */
  notes?: string;
  /** Disabled cards stay stored but are not offered for delegation. Default true. */
  enabled?: boolean;
  /** Provenance of this card; `builtin` is reserved for code-defined cards. */
  source?: 'local' | 'import' | 'legacy' | 'builtin';
  /** ISO-8601 creation time, managed by the Host. */
  createdAt?: string;
  /** ISO-8601 last-write time, managed by the Host. */
  updatedAt?: string;
}

/** A new or edited card before the Host assigns timestamps and defaults. */
export type CharacterCardDraft = Omit<CharacterCard, 'createdAt' | 'updatedAt'>;

/** Portable collection produced by export and accepted by import. */
export interface CharacterCardBundle {
  kind: typeof CARD_BUNDLE_KIND;
  version: number;
  exportedAt: string;
  cards: CharacterCard[];
}

/** Conflict policy applied when an imported card id already exists. */
export type CardImportStrategy = 'skip' | 'overwrite' | 'duplicate';

/** One rejected input during import. */
export interface CardImportIssue {
  index: number;
  id?: string;
  message: string;
}

/** Outcome of one import batch. */
export interface CardImportResult {
  imported: number;
  overwritten: number;
  skipped: number;
  duplicated: number;
  issues: CardImportIssue[];
  cards: CharacterCard[];
}

/** Outcome of migrating the legacy settings role templates. */
export interface CardMigrationResult {
  migrated: string[];
  skipped: string[];
  failed: Array<{ id: string; message: string }>;
  remainingLegacy: string[];
  defaultCardId?: string;
}

/** Storage availability exposed to the settings page. */
export interface CardStorageStatus {
  state: 'ready' | 'unavailable' | 'error';
  message?: string;
}

/** Card library payload returned by the Host. */
export interface CardLibrarySnapshot {
  storage: CardStorageStatus;
  cards: CharacterCard[];
  defaultCardId?: string;
  /** Legacy settings role ids still present in the plugin config. */
  legacyRoles: string[];
  legacyDefaultRole?: string;
}

/** The active card prompt bound to one child session. */
export interface CardPromptBinding {
  sessionId: string;
  cardId: string;
  cardName: string;
  systemPrompt?: string;
  persona?: string;
  parentSessionId?: string;
  /** Continuable children keep their prompt across later turns and cold resumes. */
  continuable?: boolean;
  createdAt: number;
}

/** Whether a string is a valid card id. */
export function isCardId(value: string): boolean {
  return value.length > 0 && value.length <= CARD_LIMITS.idLength && CARD_ID_PATTERN.test(value);
}

/** Derive a unique kebab-case id from a display name. */
export function cardIdFromName(name: string, existing: ReadonlySet<string>, prefix = 'card'): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CARD_LIMITS.idLength);
  const candidate = base.length > 0 ? base : prefix;
  if (!existing.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i += 1) {
    const suffix = '-' + i;
    const next = candidate.slice(0, CARD_LIMITS.idLength - suffix.length) + suffix;
    if (!existing.has(next)) return next;
  }
  return candidate.slice(0, CARD_LIMITS.idLength - 8) + '-' + Date.now().toString(36).slice(-6);
}

/** Split a comma/whitespace separated tag input into bounded unique tags. */
export function parseTagInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(/[,，\n]/)) {
    const tag = raw.trim().slice(0, CARD_LIMITS.tagLength);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= CARD_LIMITS.tags) break;
  }
  return tags;
}

/** Render tags for the editor input. */
export function formatTagInput(tags: readonly string[] | undefined): string {
  return (tags ?? []).join(', ');
}

/** First visible glyph of a card name for an avatar fallback. */
export function cardInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? '?' : first.toUpperCase();
}

/** Deterministic accent for a card that has none. */
export function cardAccentOf(card: Pick<CharacterCard, 'id' | 'accent'>): CardAccent {
  if (card.accent !== undefined) return card.accent;
  let hash = 0;
  for (let i = 0; i < card.id.length; i += 1) hash = (hash * 31 + card.id.charCodeAt(i)) >>> 0;
  return CARD_ACCENTS[hash % CARD_ACCENTS.length]!;
}

/** Whether a card can be offered for delegation. */
export function isCardEnabled(card: Pick<CharacterCard, 'enabled'>): boolean {
  return card.enabled !== false;
}

/** Whether the card carries any child-only prompt text. */
export function hasCardPrompt(card: Pick<CharacterCard, 'systemPrompt' | 'persona'>): boolean {
  return (card.systemPrompt ?? '').trim().length > 0 || (card.persona ?? '').trim().length > 0;
}

/** Render the fixed child prompt for one card. */
export function renderCardPrompt(card: Pick<CharacterCard, 'name' | 'systemPrompt' | 'persona'>): string {
  const system = (card.systemPrompt ?? '').trim();
  const persona = (card.persona ?? '').trim();
  if (system.length === 0 && persona.length === 0) return '';
  const parts: string[] = ['Character card: ' + card.name];
  if (system.length > 0) parts.push(system);
  if (persona.length > 0) parts.push('Persona:\n' + persona);
  return parts.join('\n\n');
}

/**
 * Host-side character-card schema, normalization, import parsing, and legacy
 * role migration. Zod is the durable validation boundary: every card accepted
 * from the bridge, an imported document, or the legacy settings section passes
 * through this module before it reaches storage or a delegation.
 */
import { z } from 'zod';

import {
  CARD_ACCENTS,
  CARD_BUNDLE_KIND,
  CARD_FORMAT_VERSION,
  CARD_ID_PATTERN,
  CARD_KIND,
  CARD_LIMITS,
  cardIdFromName,
  isCardId,
  parseTagInput,
  type CardImportIssue,
  type CardImportResult,
  type CharacterCard,
  type CharacterCardBundle,
  type CharacterCardDraft,
} from './card-types.js';
import type { RoleTemplate } from './route-resolver.js';

/** Non-blank string helper (zod v4 `.trim()` runs before the check). */
const nonBlank = (max: number) => z.string().trim().min(1).max(max);

/** Optional non-blank string helper. Blank values are compacted away later. */
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Optional model route fields. */
export const CardModelSchema = z.object({
  provider: optionalText(160),
  model: optionalText(240),
  reasoningEffort: optionalText(80),
});

/** One persisted card. Unknown fields are stripped at the boundary. */
export const CharacterCardSchema = z.object({
  id: z.string().trim().max(CARD_LIMITS.idLength).regex(CARD_ID_PATTERN),
  name: nonBlank(CARD_LIMITS.nameLength),
  delegationGuidance: nonBlank(CARD_LIMITS.guidanceLength),
  systemPrompt: optionalText(CARD_LIMITS.promptLength),
  persona: optionalText(CARD_LIMITS.promptLength),
  model: CardModelSchema.optional(),
  agentPreset: optionalText(160),
  tags: z.array(nonBlank(CARD_LIMITS.tagLength)).max(CARD_LIMITS.tags).optional(),
  emoji: optionalText(CARD_LIMITS.emojiLength),
  accent: z.enum(CARD_ACCENTS).optional(),
  notes: optionalText(CARD_LIMITS.notesLength),
  enabled: z.boolean().optional(),
  source: z.enum(['local', 'import', 'legacy']).optional(),
  createdAt: z.string().trim().max(80).optional(),
  updatedAt: z.string().trim().max(80).optional(),
});

/** One imported card may omit its id; the Host derives one from the name. */
export const CharacterCardInputSchema = CharacterCardSchema.partial({ id: true });

/** One editable draft accepted from the settings page. */
export type CardDraftInput = z.input<typeof CharacterCardInputSchema>;

/** Parsed import payload before per-card validation. */
export interface CardImportPayload {
  cards: unknown[];
  issues: CardImportIssue[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Accept the portable collection envelope, a single-card envelope, a bare card,
 * or an array of any of those. Structural collection detection is deliberately
 * forgiving: a user pasting `{ "cards": [...] }` without the `kind` marker is
 * still understood.
 */
export function parseCardImportPayload(payload: unknown): CardImportPayload {
  const issues: CardImportIssue[] = [];
  const cards: unknown[] = [];

  const push = (value: unknown, index: number): void => {
    const record = asRecord(value);
    if (record === undefined) {
      issues.push({ index, message: 'Expected a JSON object for one character card.' });
      return;
    }
    if (record.kind === CARD_BUNDLE_KIND || Array.isArray(record.cards)) {
      if (typeof record.version === 'number' && record.version > CARD_FORMAT_VERSION) {
        issues.push({ index, message: 'Unsupported card format version ' + String(record.version) + '.' });
        return;
      }
      const nested = record.cards;
      if (!Array.isArray(nested)) {
        issues.push({ index, message: 'The collection envelope has no `cards` array.' });
        return;
      }
      nested.forEach((entry, nestedIndex) => push(entry, index + nestedIndex));
      return;
    }
    if (record.kind === CARD_KIND) {
      if (typeof record.version === 'number' && record.version > CARD_FORMAT_VERSION) {
        issues.push({ index, message: 'Unsupported card format version ' + String(record.version) + '.' });
        return;
      }
      if (record.card === undefined) {
        issues.push({ index, message: 'The card envelope has no `card` object.' });
        return;
      }
      push(record.card, index);
      return;
    }
    cards.push(record);
  };

  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => push(entry, index));
  } else {
    push(payload, 0);
  }

  if (cards.length > CARD_LIMITS.importCards) {
    issues.push({
      index: cards.length,
      message:
        'Too many cards in one import: ' +
        String(cards.length) +
        ' present, at most ' +
        String(CARD_LIMITS.importCards) +
        ' accepted.',
    });
    cards.length = 0;
  }
  return { cards, issues };
}

/** Remove empty optional strings and duplicate tags from a parsed card. */
function compactCard(card: CharacterCard): CharacterCard {
  const clean = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
  };
  const systemPrompt = clean(card.systemPrompt);
  const persona = clean(card.persona);
  const agentPreset = clean(card.agentPreset);
  const emoji = clean(card.emoji);
  const notes = clean(card.notes);
  const model = card.model;
  const provider = clean(model?.provider);
  const modelId = clean(model?.model);
  const reasoningEffort = clean(model?.reasoningEffort);
  const nextModel =
    provider !== undefined || modelId !== undefined || reasoningEffort !== undefined
      ? {
          ...(provider !== undefined ? { provider } : {}),
          ...(modelId !== undefined ? { model: modelId } : {}),
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        }
      : undefined;
  const tags = card.tags === undefined ? undefined : [...new Set(card.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
  // Drop every optional field first: spreading the parsed record would retain
  // blank strings that the schema accepted before trimming.
  const {
    systemPrompt: _systemPrompt,
    persona: _persona,
    agentPreset: _agentPreset,
    emoji: _emoji,
    notes: _notes,
    model: _model,
    tags: _tags,
    ...rest
  } = card;
  return {
    ...rest,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(persona !== undefined ? { persona } : {}),
    ...(agentPreset !== undefined ? { agentPreset } : {}),
    ...(emoji !== undefined ? { emoji } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(nextModel !== undefined ? { model: nextModel } : {}),
    ...(tags !== undefined && tags.length > 0 ? { tags } : {}),
    enabled: card.enabled !== false,
  };
}

/**
 * Validate and normalize one imported card. The id is required when the caller
 * provides a fallback resolver; otherwise it is derived from the name against
 * `existingIds` so a batch cannot silently collide.
 */
export function parseImportedCard(
  value: unknown,
  existingIds: ReadonlySet<string>,
): { card?: CharacterCard; issue?: string } {
  const parsed = CharacterCardInputSchema.safeParse(value);
  if (!parsed.success) {
    return { issue: parsed.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ') };
  }
  const input = parsed.data;
  const id = input.id ?? cardIdFromName(input.name, existingIds);
  const card = compactCard({ ...input, id, source: input.source ?? 'import' });
  if (!isCardId(card.id)) return { issue: 'Invalid card id "' + card.id + '".' };
  return { card };
}

/** Validate one draft from the settings page. */
export function parseCardDraft(value: unknown, existingIds: ReadonlySet<string>): { card?: CharacterCard; issue?: string } {
  const record = asRecord(value);
  if (record === undefined) return { issue: 'Expected a card object.' };
  const normalized: Record<string, unknown> = {
    ...record,
    // The editor sends a tag string; storage wants the bounded array.
    ...(typeof record.tags === 'string' ? { tags: parseTagInput(record.tags) } : {}),
    delegationGuidance:
      typeof record.delegationGuidance === 'string' && record.delegationGuidance.trim().length > 0
        ? record.delegationGuidance
        : record.description,
  };
  if (normalized.id === undefined || normalized.id === '') {
    const name = typeof normalized.name === 'string' ? normalized.name : '';
    normalized.id = cardIdFromName(name, existingIds);
  }
  return parseImportedCard(normalized, existingIds);
}

/** Convert one stored card to the role shape the pure route resolver consumes. */
export function cardToRoleTemplate(card: CharacterCard): RoleTemplate {
  return {
    displayName: card.name,
    description: card.delegationGuidance,
    ...(card.agentPreset !== undefined ? { agentPreset: card.agentPreset } : {}),
    ...(card.model?.provider !== undefined ? { provider: card.model.provider } : {}),
    ...(card.model?.model !== undefined ? { model: card.model.model } : {}),
    ...(card.model?.reasoningEffort !== undefined ? { reasoningEffort: card.model.reasoningEffort } : {}),
  };
}

/** Minimal legacy role shape read from the plugin settings. */
export interface LegacyRole {
  displayName: string;
  description: string;
  agentPreset?: string;
  persona?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  toolFilter?: { allow?: string[]; deny?: string[] };
}

/**
 * Convert one legacy settings role into a card. Persona survives because cards
 * now own child prompt text; the legacy tool filter has no card equivalent on
 * DSH 0.2.1+ (tool composition lives in an Agent Preset), so it is preserved as
 * a note instead of being silently discarded.
 */
export function legacyRoleToCard(roleId: string, role: LegacyRole, existingIds: ReadonlySet<string>): CharacterCard {
  const name = (role.displayName ?? '').trim() || roleId;
  const guidance = (role.description ?? '').trim() || 'Delegated role ' + name + '.';
  const id = isCardId(roleId) ? roleId : cardIdFromName(name, existingIds);
  const filter = role.toolFilter;
  const filterNote =
    filter !== undefined && ((filter.allow?.length ?? 0) > 0 || (filter.deny?.length ?? 0) > 0)
      ? 'Legacy tool filter (not applied on DSH 0.2.1+): ' + JSON.stringify(filter)
      : undefined;
  const notes = ['Migrated from the legacy `roles` settings field on ' + new Date().toISOString().slice(0, 10) + '.'];
  if (filterNote !== undefined) notes.push(filterNote);
  return compactCard({
    id,
    name,
    delegationGuidance: guidance,
    ...(role.persona !== undefined && role.persona.trim().length > 0 ? { persona: role.persona.trim() } : {}),
    ...(role.agentPreset !== undefined && role.agentPreset.trim().length > 0 ? { agentPreset: role.agentPreset.trim() } : {}),
    ...(role.provider !== undefined || role.model !== undefined || role.reasoningEffort !== undefined
      ? {
          model: {
            ...(role.provider !== undefined && role.provider.trim().length > 0 ? { provider: role.provider.trim() } : {}),
            ...(role.model !== undefined && role.model.trim().length > 0 ? { model: role.model.trim() } : {}),
            ...(role.reasoningEffort !== undefined && role.reasoningEffort.trim().length > 0
              ? { reasoningEffort: role.reasoningEffort.trim() }
              : {}),
          },
        }
      : {}),
    tags: ['legacy'],
    notes: notes.join('\n'),
    enabled: true,
    source: 'legacy',
  });
}

/** Build the portable collection envelope. */
export function buildCardBundle(cards: readonly CharacterCard[], exportedAt = new Date().toISOString()): CharacterCardBundle {
  return {
    kind: CARD_BUNDLE_KIND,
    version: CARD_FORMAT_VERSION,
    exportedAt,
    cards: cards.map((card) => ({ ...card })),
  };
}

/** Merge an import outcome into the counters the bridge returns. */
export function emptyImportResult(): CardImportResult {
  return { imported: 0, overwritten: 0, skipped: 0, duplicated: 0, issues: [], cards: [] };
}


/** The card shape stored by the domain (id is the record key). */
export type StoredCard = CharacterCard;

/** One card draft with the id optional (creation). */
export type CardDraft = CharacterCardDraft;

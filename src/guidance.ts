/**
 * Main-agent guidance for character cards.
 *
 * Registers a system-prompt section listing the cards so the main agent knows
 * which role-bound subagents it can delegate to, when each is recommended, and
 * when it is not. Card system prompts and personas stay child-only; this
 * section never exposes them. In Director Mode the code-defined director card
 * is included and the header states the card-first rule.
 *
 * The section is budgeted: only the highest-weight active cards are rendered,
 * per-card guidance is clipped, and the whole section has a hard character
 * cap. Closed-pool cards are omitted by default but stay reachable through the
 * search and detail tools the header names. The section order (117) sits after
 * the deployment persona prefix and before plan/tool policy, so the card list
 * is available early without replacing the harness identity or tool guidance.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CharacterCard } from './card-types.js';
import { isCardEnabled } from './card-types.js';
import { rankCards, type RankedCard } from './card-weight.js';
import { DIRECTOR_CARD_ID } from './director.js';
import { danglingDefaultRoleWarning, type SubagentDirectorSettings } from './settings.js';

/** Prompt order: after the deployment persona prefix, before plan/tool policy. */
export const GUIDANCE_SECTION_ORDER = 117;

/** Stable, unique section name (configuration changes only affect new assemblies). */
export const GUIDANCE_SECTION_NAME = 'subagent-director:cards';

/** Most active cards rendered in the prompt; the rest stay behind search. */
export const GUIDANCE_MAX_CARDS = 12;

/** Per-field guidance cap; fuller text stays behind `subagent_card_get`. */
export const GUIDANCE_CARD_TEXT_LIMIT = 720;

/** Hard cap on the whole rendered section, headers and warnings included. */
export const GUIDANCE_MAX_CHARS = 12000;

/** Model-facing detail tool named by the truncated-guidance note. */
export const GUIDANCE_GET_TOOL = 'subagent_card_get';

/** The card list face guidance needs (kept structural to avoid a host import cycle). */
export interface GuidanceCardSource {
  list(options?: { includeBuiltIn?: boolean }): CharacterCard[];
  rankedCards?(options?: { includeBuiltIn?: boolean; now?: number | Date }): RankedCard[];
}

/** Director-only rendering switches. */
export interface GuidanceOptions {
  director?: boolean;
  /** Instant used to score cards when the source only exposes `list`. */
  now?: number | Date;
}

export type GuidanceSettingsSource = (agent?: Agent) => SubagentDirectorSettings;

function modelLabel(card: CharacterCard): string {
  const provider = card.model?.provider;
  const model = card.model?.model;
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') return `model: ${provider}/${model}`;
  if (provider !== undefined && provider !== '') return `provider: ${provider}`;
  return '';
}

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, limit), truncated: true };
}

function truncationNote(cardId: string): string {
  return ` … [truncated; call ${GUIDANCE_GET_TOOL}({ id: "${cardId}" }) for the full text]`;
}

function cardLines(entry: RankedCard, toolName: string): string[] {
  const card = entry.card;
  const tags = (card.tags ?? []).filter((tag) => tag.length > 0);
  const meta = [
    modelLabel(card),
    card.source === 'builtin' ? 'built-in' : '',
    tags.length > 0 ? `tags: ${tags.join(', ')}` : '',
  ].filter((part) => part.length > 0);
  const suffix = meta.length > 0 ? ` (${meta.join('; ')})` : '';
  const lines = [`- ${card.name} [${card.id}]${suffix}:`];
  const use = clip(card.delegationGuidance, GUIDANCE_CARD_TEXT_LIMIT);
  lines.push(`    Use when: ${use.text}${use.truncated ? truncationNote(card.id) : ''}`);
  const avoidText = (card.avoidGuidance ?? '').trim();
  if (avoidText.length > 0) {
    const avoid = clip(avoidText, GUIDANCE_CARD_TEXT_LIMIT);
    lines.push(`    Do not use when: ${avoid.text}${avoid.truncated ? truncationNote(card.id) : ''}`);
  }
  lines.push(`    Delegate with: ${toolName}({ role: "${card.id}", prompt: "..." })`);
  return lines;
}

interface GuidanceStats {
  total: number;
  listed: number;
  closed: number;
}

function headerLines(director: boolean, stats: GuidanceStats): string[] {
  const lines: string[] = director
    ? [
        'Director Mode card policy — every subagent must be started through one of these character cards. Respect each card\'s recommended and not-recommended conditions. Before creating a card, search the library with subagent_card_search and read a candidate with subagent_card_get; reuse or unpin an existing card when it fits, and call subagent_card_create only when nothing matches.',
        'Reference cards by their bracketed id, never by display name; when the user names a card by its display name, map it to that id.',
      ]
    : [
        'Subagent Director character cards — delegate one of these role-bound subagents when the task matches its delegation guidance. A card may bind a model route and carry a fixed role prompt for the child.',
        'Reference cards by their bracketed id, never by display name; when the user names a card by its display name, map it to that id.',
      ];
  if (stats.total > 0) {
    lines.push(
      'Card library: ' +
        String(stats.total) +
        ' card(s) total, ' +
        String(stats.listed) +
        ' listed here, ' +
        String(stats.closed) +
        ' in the closed pool.',
    );
  }
  if (director) {
    lines.push(
      'Use subagent_card_search({ query, tags, includeClosed, limit }) to find cards outside this list, and subagent_card_get({ id }) to read one card\'s full guidance and child prompt. Closed-pool cards remain delegatable by explicit id; a successful delegation moves one back to active.',
    );
  } else if (stats.closed > 0) {
    lines.push('Closed-pool cards are not listed here; delegate to one by its id to bring it back to active.');
  }
  return lines;
}

function legacyLines(role: { displayName?: string; description?: string; provider?: string; model?: string }, id: string, toolName: string): string[] {
  const bound =
    role.provider !== undefined && role.provider !== ''
      ? role.model !== undefined && role.model !== ''
        ? ` (model: ${role.provider}/${role.model})`
        : ` (provider: ${role.provider})`
      : '';
  const description = clip(role.description ?? '', GUIDANCE_CARD_TEXT_LIMIT);
  return [
    `- ${role.displayName || id}${bound}:`,
    `    Use when: ${description.text}${description.truncated ? ' … [truncated]' : ''}`,
    `    Delegate with: ${toolName}({ role: "${id}", prompt: "..." })`,
  ];
}

/**
 * Pure projection of cards and legacy roles onto the guidance prose the main
 * agent reads. Returns '' when there is nothing to delegate to, so the
 * assembled section is dropped entirely (no empty prompt section).
 *
 * Cards are scored with the caller's `now`; the top active cards are rendered,
 * closed-pool cards are excluded, and the section is capped at
 * {@link GUIDANCE_MAX_CHARS} characters. Every clip names the detail tool so
 * the model is never left with silently missing guidance.
 */
export function renderRolesGuidance(
  settings: SubagentDirectorSettings,
  toolName: string,
  cards?: GuidanceCardSource,
  options: GuidanceOptions = {},
): string {
  const director = options.director === true;
  const now = options.now ?? Date.now();
  const enabledCards = (cards?.list({ includeBuiltIn: director }) ?? []).filter((card) => isCardEnabled(card));
  const cardIds = new Set(enabledCards.map((card) => card.id));
  const legacy = director
    ? []
    : Object.entries(settings.roles ?? {}).filter(([id, role]) => role !== undefined && !cardIds.has(id));
  const ranked =
    cards === undefined
      ? []
      : cards.rankedCards !== undefined
        ? cards.rankedCards({ includeBuiltIn: director, now })
        : rankCards(enabledCards, { now });
  const enabledRanked = ranked.filter((entry) => isCardEnabled(entry.card));
  if (enabledCards.length === 0 && legacy.length === 0) return '';

  const visible = enabledRanked.filter((entry) => entry.state !== 'closed');
  const selected = visible.slice(0, GUIDANCE_MAX_CARDS);
  const directorEntry = visible.find((entry) => entry.card.id === DIRECTOR_CARD_ID);
  if (directorEntry !== undefined && selected.length > 0) {
    const index = selected.indexOf(directorEntry);
    if (index < 0) selected[selected.length - 1] = directorEntry;
    else if (index > 0) selected.unshift(...selected.splice(index, 1));
  }
  const cardBlocks = selected.map((entry) => cardLines(entry, toolName));
  const legacyBlocks = legacy.map(([id, role]) => legacyLines(role ?? {}, id, toolName));
  const closedCount = enabledRanked.filter((entry) => entry.state === 'closed').length;
  const total = enabledRanked.length;
  const warning = danglingDefaultRoleWarning(settings);
  const builtinOnly =
    director && selected.length === 1 && selected[0]?.card.source === 'builtin'
      ? ['', 'Only the built-in Director card exists so far. Search the library before creating a specialist card with subagent_card_create.']
      : [];

  const build = (cardCount: number, legacyCount: number): string => {
    const lines = headerLines(director, { total, listed: cardCount, closed: closedCount });
    for (let i = 0; i < cardCount; i += 1) lines.push(...cardBlocks[i]!);
    const omittedCards = visible.length - cardCount;
    if (omittedCards > 0) {
      lines.push(
        '- ' +
          String(omittedCards) +
          ' more active card(s) not listed here' +
          (director ? '; use subagent_card_search to find them.' : '.'),
      );
    }
    if (legacyBlocks.length > 0) {
      lines.push('', 'Legacy role templates (still usable; migrate them to character cards in the plugin page):');
    }
    for (let i = 0; i < legacyCount; i += 1) lines.push(...legacyBlocks[i]!);
    const omittedLegacy = legacyBlocks.length - legacyCount;
    if (omittedLegacy > 0) {
      lines.push('- ' + String(omittedLegacy) + ' legacy role template(s) omitted for the prompt budget.');
    }
    lines.push(...builtinOnly);
    if (warning !== undefined) lines.push('', warning);
    return lines.join('\n');
  };

  let cardCount = cardBlocks.length;
  let legacyCount = legacyBlocks.length;
  let text = build(cardCount, legacyCount);
  while (text.length > GUIDANCE_MAX_CHARS && cardCount > 0) {
    cardCount -= 1;
    text = build(cardCount, legacyCount);
  }
  while (text.length > GUIDANCE_MAX_CHARS && legacyCount > 0) {
    legacyCount -= 1;
    text = build(cardCount, legacyCount);
  }
  if (text.length > GUIDANCE_MAX_CHARS) text = text.slice(0, GUIDANCE_MAX_CHARS);
  return text;
}

/**
 * Register the card guidance section, or no-op when the systemPrompt service is
 * absent. Evaluates cards and legacy roles from the live snapshot per assembly.
 */
export function applyGuidance(
  ctx: Context,
  getSettings: GuidanceSettingsSource,
  toolName: string,
  cards?: GuidanceCardSource,
  isDirector?: (agent?: Agent) => boolean,
): (() => void) | undefined {
  const register = (systemPrompt: {
    section(section: {
      name: string;
      order: number;
      text: (context: { agent?: Agent } | undefined) => string;
      interpolate?: boolean;
    }): () => void;
  }) =>
    systemPrompt.section({
      name: GUIDANCE_SECTION_NAME,
      order: GUIDANCE_SECTION_ORDER,
      // Card guidance is literal model-facing prose, not a prompt template.
      interpolate: false,
      text: (context) =>
        renderRolesGuidance(getSettings(context?.agent), toolName, cards, {
          director: isDirector?.(context?.agent) === true,
        }),
    });

  const systemPrompt = ctx.get('systemPrompt') as
    | {
        section(section: {
          name: string;
          order: number;
          text: (context: { agent?: Agent } | undefined) => string;
          interpolate?: boolean;
        }): () => void;
      }
    | undefined;
  if (systemPrompt !== undefined) return register(systemPrompt);
  ctx.inject(['systemPrompt'], (child) => {
    const late = child.get('systemPrompt') as
      | {
          section(section: {
            name: string;
            order: number;
            text: (context: { agent?: Agent } | undefined) => string;
            interpolate?: boolean;
          }): () => void;
        }
      | undefined;
    if (late !== undefined) register(late);
  });
  return undefined;
}

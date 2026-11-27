/**
 * Main-agent guidance for character cards.
 *
 * Registers a system-prompt section listing the cards so the main agent knows
 * which role-bound subagents it can delegate to, when each is recommended, and
 * when it is not. Card system prompts and personas stay child-only; this
 * section never exposes them. In Director Mode the code-defined director card
 * is included and the header states the card-first rule.
 *
 * The section order (117) sits after the deployment persona prefix and before
 * plan/tool policy, so the card list is available early without replacing the
 * harness identity or tool guidance.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CharacterCard } from './card-types.js';
import { isCardEnabled } from './card-types.js';
import { danglingDefaultRoleWarning, type SubagentDirectorSettings } from './settings.js';

/** Prompt order: after the deployment persona prefix, before plan/tool policy. */
export const GUIDANCE_SECTION_ORDER = 117;

/** Stable, unique section name (configuration changes only affect new assemblies). */
export const GUIDANCE_SECTION_NAME = 'subagent-director:cards';

/** The card list face guidance needs (kept structural to avoid a host import cycle). */
export interface GuidanceCardSource {
  list(options?: { includeBuiltIn?: boolean }): CharacterCard[];
}

/** Director-only rendering switches. */
export interface GuidanceOptions {
  director?: boolean;
}

export type GuidanceSettingsSource = (agent?: Agent) => SubagentDirectorSettings;

function modelLabel(card: CharacterCard): string {
  const provider = card.model?.provider;
  const model = card.model?.model;
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') return `model: ${provider}/${model}`;
  if (provider !== undefined && provider !== '') return `provider: ${provider}`;
  return '';
}

function cardLine(card: CharacterCard, toolName: string): string[] {
  const tags = (card.tags ?? []).filter((tag) => tag.length > 0);
  const meta = [
    modelLabel(card),
    card.source === 'builtin' ? 'built-in' : '',
    tags.length > 0 ? `tags: ${tags.join(', ')}` : '',
  ].filter((part) => part.length > 0);
  const suffix = meta.length > 0 ? ` (${meta.join('; ')})` : '';
  const lines = [
    `- ${card.name} [${card.id}]${suffix}:`,
    `    Use when: ${card.delegationGuidance}`,
  ];
  const avoid = card.avoidGuidance?.trim();
  if (avoid !== undefined && avoid.length > 0) lines.push(`    Do not use when: ${avoid}`);
  lines.push(`    Delegate with: ${toolName}({ role: "${card.id}", prompt: "..." })`);
  return lines;
}

/**
 * Pure projection of cards and legacy roles onto the guidance prose the main
 * agent reads. Returns '' when there is nothing to delegate to, so the
 * assembled section is dropped entirely (no empty prompt section).
 */
export function renderRolesGuidance(
  settings: SubagentDirectorSettings,
  toolName: string,
  cards?: GuidanceCardSource,
  options: GuidanceOptions = {},
): string {
  const director = options.director === true;
  const cardList = (cards?.list({ includeBuiltIn: director }) ?? []).filter((card) => isCardEnabled(card));
  const cardIds = new Set(cardList.map((card) => card.id));
  const legacy = director
    ? []
    : Object.entries(settings.roles ?? {}).filter(([id, role]) => role !== undefined && !cardIds.has(id));
  if (cardList.length === 0 && legacy.length === 0) return '';

  const lines: string[] = director
    ? [
        'Director Mode card policy — every subagent must be started through one of these character cards. Respect each card\'s recommended and not-recommended conditions. When no card matches the task, create one with subagent_card_create first, then delegate to its id.',
        'Reference cards by their bracketed id, never by display name; when the user names a card by its display name, map it to that id.',
      ]
    : [
        'Subagent Director character cards — delegate one of these role-bound subagents when the task matches its delegation guidance. A card may bind a model route and carry a fixed role prompt for the child.',
        'Reference cards by their bracketed id, never by display name; when the user names a card by its display name, map it to that id.',
      ];
  for (const card of cardList) lines.push(...cardLine(card, toolName));

  if (legacy.length > 0) {
    lines.push('', 'Legacy role templates (still usable; migrate them to character cards in the plugin page):');
    for (const [id, role] of legacy) {
      const bound =
        role.provider !== undefined && role.provider !== ''
          ? role.model !== undefined && role.model !== ''
            ? ` (model: ${role.provider}/${role.model})`
            : ` (provider: ${role.provider})`
          : '';
      lines.push(`- ${role.displayName || id}${bound}:`);
      lines.push(`    Use when: ${role.description}`);
      lines.push(`    Delegate with: ${toolName}({ role: "${id}", prompt: "..." })`);
    }
  }

  if (director && cardList.length === 1 && cardList[0]?.source === 'builtin') {
    lines.push('', 'Only the built-in Director card exists so far. Create a specialist card with subagent_card_create before delegating work that needs a specific role.');
  }

  const warning = danglingDefaultRoleWarning(settings);
  if (warning !== undefined) lines.push('', warning);
  return lines.join('\n');
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

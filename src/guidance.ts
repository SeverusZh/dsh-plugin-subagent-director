/**
 * Main-agent guidance for character cards.
 *
 * Registers a system-prompt section listing the cards (and any still-unmigrated
 * legacy role templates) so the main agent knows which role-bound subagents it
 * can delegate to, what each is for, and which model route each binds. Card
 * system prompts and personas stay child-only; this section never exposes them.
 *
 * The section order (117) sits after the deployment persona prefix and before
 * plan/tool policy, so the card list is available early without replacing the
 * harness identity or tool guidance.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CharacterCard } from './card-types.js';
import { isCardEnabled } from './card-types.js';
import { danglingDefaultRoleWarning, type SubagentDirectorSettings } from './settings.js';

/** Prompt order: after the deployment persona prefix, before plan/tool policy. */
export const GUIDANCE_SECTION_ORDER = 117;

/** Stable, unique section name (configuration changes only affect new assemblies). */
export const GUIDANCE_SECTION_NAME = 'subagent-director:cards';

/** The card list face guidance needs (kept structural to avoid a host import cycle). */
export interface GuidanceCardSource {
  list(): CharacterCard[];
}

function modelLabel(card: CharacterCard): string {
  const provider = card.model?.provider;
  const model = card.model?.model;
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') return `model: ${provider}/${model}`;
  if (provider !== undefined && provider !== '') return `provider: ${provider}`;
  return '';
}

function cardLine(card: CharacterCard, toolName: string): string[] {
  const tags = (card.tags ?? []).filter((tag) => tag.length > 0);
  const meta = [modelLabel(card), tags.length > 0 ? `tags: ${tags.join(', ')}` : ''].filter((part) => part.length > 0);
  const suffix = meta.length > 0 ? ` (${meta.join('; ')})` : '';
  return [
    `- ${card.name} [${card.id}]${suffix}: ${card.delegationGuidance}`,
    `    Delegate with: ${toolName}({ role: "${card.id}", prompt: "..." })`,
  ];
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
): string {
  const cardList = (cards?.list() ?? []).filter((card) => isCardEnabled(card));
  const cardIds = new Set(cardList.map((card) => card.id));
  const legacy = Object.entries(settings.roles ?? {}).filter(
    ([id, role]) => role !== undefined && !cardIds.has(id),
  );
  if (cardList.length === 0 && legacy.length === 0) return '';

  const lines: string[] = [
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
      lines.push(`- ${role.displayName || id}${bound}: ${role.description}`);
      lines.push(`    Delegate with: ${toolName}({ role: "${id}", prompt: "..." })`);
    }
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
  getSettings: () => SubagentDirectorSettings,
  toolName: string,
  cards?: GuidanceCardSource,
): (() => void) | undefined {
  const render = () => renderRolesGuidance(getSettings(), toolName, cards);
  const register = (systemPrompt: {
    section(section: { name: string; order: number; text: () => string; interpolate?: boolean }): () => void;
  }) =>
    systemPrompt.section({
      name: GUIDANCE_SECTION_NAME,
      order: GUIDANCE_SECTION_ORDER,
      // Card guidance is literal model-facing prose, not a prompt template.
      interpolate: false,
      text: render,
    });

  const systemPrompt = ctx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: () => string; interpolate?: boolean }): () => void }
    | undefined;
  if (systemPrompt !== undefined) return register(systemPrompt);
  ctx.inject(['systemPrompt'], (child) => {
    const late = child.get('systemPrompt') as
      | { section(section: { name: string; order: number; text: () => string; interpolate?: boolean }): () => void }
      | undefined;
    if (late !== undefined) register(late);
  });
  return undefined;
}

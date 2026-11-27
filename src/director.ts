/**
 * Director Mode identity and session classification.
 *
 * Director Mode is an Agent Preset, not a command or a tool. Only a session
 * composed from that preset may see the built-in director card, require a card
 * for every delegation, or enable Agent Teams by default.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';

/** Agent Preset id carrying Director Mode. */
export const DIRECTOR_PRESET_ID = 'director';

/** Reserved id of the code-defined director card. */
export const DIRECTOR_CARD_ID = 'director';


/** The minimal part of the preset registry needed to classify a live agent. */
interface AgentPresetRegistryLike {
  composedPreset?(ctx: Context): string | undefined;
  presetForSession?(session: object): string | null;
}

/**
 * Whether a live agent runs the Director preset. Reads the registry's live
 * composition first (a child may join the exact parent revision) and falls
 * back to the preset recorded in the session log.
 * @param ctx - any host context that can resolve the preset registry.
 * @param agent - the live agent to classify, when available.
 */
export function isDirectorAgent(ctx: Context, agent: Agent | undefined): boolean {
  if (agent === undefined) return false;
  const registry = ctx.get('agentPresets') as AgentPresetRegistryLike | undefined;
  if (registry === undefined) return false;
  try {
    const live = registry.composedPreset?.(agent.ctx);
    if (live !== undefined) return live === DIRECTOR_PRESET_ID;
    const recorded = registry.presetForSession?.(agent.session as object);
    return recorded === DIRECTOR_PRESET_ID;
  } catch {
    return false;
  }
}

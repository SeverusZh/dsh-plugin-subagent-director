/**
 * Per-child system-prompt contribution for character cards.
 *
 * DSH 0.2.1 removed per-request persona from the subagent seam, so a card's
 * fixed prompt cannot ride the start request. This section stays registered on
 * the Host prompt registry and renders only for the exact child session id the
 * delegation tool reserved before starting the child. The binding snapshot is
 * taken at delegation time, so editing a card never rewrites the prompt of an
 * already-running child.
 */
import type { Context } from '@deepseek-ai/cordis';

/** Stable section name; one section owns every card prompt. */
export const CARD_PROMPT_SECTION_NAME = 'subagent-director:character-card';

/**
 * Section placement: after the deployment persona prefix and before tool
 * guidance, so the card's identity and instructions are present in the first
 * request without replacing the harness's own safety and tool sections.
 */
export const CARD_PROMPT_SECTION_ORDER = 150;

/** Minimal prompt service face used here (structural for testability). */
export interface CardPromptRegistryLike {
  section(section: {
    name: string;
    order: number;
    text: string | ((context: { session?: { id: string } }) => string);
    interpolate?: boolean;
  }): () => void;
}

/**
 * Register the card prompt section. A Host without the systemPrompt service
 * keeps the rest of the plugin working; only card prompt injection is absent.
 *
 * @param ctx - plugin context that owns the registration.
 * @param textForSession - returns the fixed prompt for one child session id.
 * @returns the disposer, or undefined when the prompt service is absent.
 */
export function applyCardPromptSection(
  ctx: Context,
  textForSession: (sessionId: string) => string,
): (() => void) | undefined {
  const register = (systemPrompt: CardPromptRegistryLike): (() => void) =>
    systemPrompt.section({
      name: CARD_PROMPT_SECTION_NAME,
      order: CARD_PROMPT_SECTION_ORDER,
      // Card prompts are user-authored literal text: never interpret {{...}}
      // as prompt variables (a template snippet must not fail assembly).
      interpolate: false,
      text: (context) => {
        const session = context.session;
        if (session === undefined) return '';
        return textForSession(String(session.id));
      },
    });

  const systemPrompt = ctx.get('systemPrompt') as CardPromptRegistryLike | undefined;
  if (systemPrompt !== undefined) return register(systemPrompt);
  // The Host loader normally mounts the prompt registry before this plugin. If
  // it appears later, acquire it reactively instead of silently losing the
  // character-card prompt support for the rest of the process lifetime.
  ctx.inject(['systemPrompt'], (child) => {
    const late = child.get('systemPrompt') as CardPromptRegistryLike | undefined;
    if (late !== undefined) register(late);
  });
  return undefined;
}

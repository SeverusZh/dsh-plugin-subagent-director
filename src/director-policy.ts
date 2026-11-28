/**
 * Director Mode contract section.
 *
 * Registered by the host entry as an ordinary prompt section; its text is
 * empty for every non-Director agent, so the contract reaches only sessions
 * composed from the Director preset.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope';

import { directorAllowedNames } from './director-guard.js';

/** Stable prompt section name. */
export const DIRECTOR_POLICY_SECTION = 'subagent-director:director-policy';

/** Prompt order: near the top, above the card list. */
export const DIRECTOR_POLICY_ORDER = 55;

/**
 * Narrow the inherited global tools for one Director agent to the orchestration
 * allowlist. The preset already omits work tools; this covers host compositions
 * that mount their own tools and hides dynamically registered MCP tools.
 * @param agent - live Director agent whose inherited tool set is narrowed.
 * @param delegationTool - configured model-facing delegation tool name.
 * @returns the restriction disposer, or undefined when the allowlist is empty.
 */
export function restrictDirectorWorkTools(
  agent: Agent,
  delegationTool: string,
): (() => void) | undefined {
  const tools = agent.ctx.tools as unknown as {
    definitions(scope?: unknown): readonly { name: string }[];
    restrict(filter: { allow?: string[]; deny?: string[] }): () => void;
  };
  let scope: ReturnType<typeof scopeOf> = undefined;
  try {
    scope = scopeOf(agent.ctx);
  } catch {
    scope = undefined;
  }
  let chain: readonly unknown[] = [];
  if (scope !== undefined) {
    try {
      chain = scopeChainOf(scope);
    } catch {
      chain = [];
    }
  }
  const inherited = new Set<string>();
  for (const key of [undefined, ...chain]) {
    if (scope !== undefined && key === scope) continue;
    for (const definition of tools.definitions(key as never)) inherited.add(definition.name);
  }
  const visible = new Set(tools.definitions(scope).map((definition) => definition.name));
  const allow = directorAllowedNames(delegationTool).filter(
    (name) => visible.has(name) && inherited.has(name),
  );
  if (allow.length === 0) {
    const allowed = new Set(directorAllowedNames(delegationTool));
    const deny = [...visible].filter((name) => inherited.has(name) && !allowed.has(name));
    return deny.length === 0 ? undefined : tools.restrict({ deny });
  }
  return tools.restrict({ allow });
}

/**
 * Build the Director contract prose.
 * @param toolName - configured model-facing delegation tool name.
 */
export function renderDirectorPolicy(toolName: string): string {
  return `Director Mode contract:
- You are an orchestration-only agent. You have no file, shell, search, skill, workflow, or built-in subagent tools. Never claim to have inspected or changed anything yourself.
- Every subagent must be started through a character card. The card guidance below states when each card is recommended and when it is not.
- Search before creating: call subagent_card_search to look for an existing match (pass includeClosed: true to include the closed pool), and subagent_card_get to read a candidate's full guidance. Reuse a card that fits; a closed-pool card returns to active after one successful delegation to its id. Call subagent_card_create only when nothing matches, then call ${toolName} with the returned id. Never call ${toolName} with an invented id.
- Do not take over a failed subagent's task. Retry with a clearer card or prompt, reassign through Agent Teams, or report the blocker with the evidence gathered so far.
- Agent Teams is available in this session and is enabled by default for new Director sessions. When it is enabled, use the shared task board for multi-worker work: create tasks, record write scopes, assign owners, and wait for required workers before the final answer.
- Every delegation prompt must be self-contained: goal, context, constraints, expected output, and acceptance criteria. Children do not see this conversation.
- Answer the user only after the delegated work settles. Integrate the results and state remaining gaps.`;
}

/**
 * Register the Director contract section. The text function is scoped by the
 * calling agent's preset, so one host registration serves every session.
 * @param ctx - host plugin context.
 * @param isDirector - classifies a live agent.
 * @param toolName - configured delegation tool name.
 */
export function applyDirectorPolicy(
  ctx: Context,
  isDirector: (agent?: Agent) => boolean,
  toolName: string,
): void {
  const register = (owner: Context): void => {
    const systemPrompt = owner.get('systemPrompt') as
      | {
          section(section: {
            name: string;
            order: number;
            interpolate: boolean;
            text: (context: { agent?: Agent } | undefined) => string;
          }): () => void;
        }
      | undefined;
    if (systemPrompt === undefined) return;
    owner.effect(
      () =>
        systemPrompt.section({
          name: DIRECTOR_POLICY_SECTION,
          order: DIRECTOR_POLICY_ORDER,
          interpolate: false,
          text: (context: { agent?: Agent } | undefined) => (isDirector(context?.agent) ? renderDirectorPolicy(toolName) : ''),
        }),
      'subagent-director: director policy section',
    );
  };

  if (ctx.get('systemPrompt') !== undefined) {
    register(ctx);
    return;
  }
  ctx.inject(['systemPrompt'], (child) => register(child));
}

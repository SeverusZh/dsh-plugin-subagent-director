/**
 * Execution guard that keeps the Director main agent on the orchestration
 * surface. The preset composition controls most visibility; this allowlist
 * rejects every other tool, including dynamically mounted MCP tools whose names
 * a deny list cannot enumerate.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';

/** Global tools the Director main agent may call in addition to configured ones. */
export const DIRECTOR_ALLOWED_TOOLS = [
  'subagent_card_create',
  'subagent_card_search',
  'subagent_card_get',
  'close_subagent',
  'list_agents',
  'wait_agent',
  'send_message',
  'ask_user_question',
  'session_send_message',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
] as const;

/** Names the Director tool catalog may keep for one configured delegation tool. */
export function directorAllowedNames(delegationTool: string): string[] {
  return [delegationTool, ...DIRECTOR_ALLOWED_TOOLS];
}

/**
 * Whether a tool name stays available to the Director main agent.
 * @param name - model-facing tool name.
 * @param delegationTool - configured delegation tool name.
 */
export function isDirectorAllowedTool(name: string, delegationTool: string): boolean {
  if (name === delegationTool) return true;
  if (name.startsWith('team_task_')) return true;
  return (DIRECTOR_ALLOWED_TOOLS as readonly string[]).includes(name);
}

/**
 * Register the global guard. It evaluates the caller's live preset on every
 * call, so preset switches apply immediately in both directions.
 * @param ctx - host plugin context carrying the tools service.
 * @param isDirector - classifies a live agent.
 * @param delegationTool - configured delegation tool name.
 */
export function applyDirectorToolGuard(
  ctx: Context,
  isDirector: (agent?: Agent) => boolean,
  delegationTool: string,
): void {
  const tools = ctx.tools as unknown as {
    guard?: (guard: (execution: { name: string; agent?: Agent }) => unknown) => () => void;
  };
  if (typeof tools.guard !== 'function') return;
  ctx.effect(
    () =>
      tools.guard!((execution) => {
        if (!isDirector(execution.agent)) return undefined;
        if (isDirectorAllowedTool(execution.name, delegationTool)) return undefined;
        return {
          reason:
            'Director Mode cannot call work tool "' +
            execution.name +
            '" directly. Delegate the work to a character-card subagent with ' +
            delegationTool +
            '.',
        };
      }),
    'subagent-director: director tool guard',
  );
}

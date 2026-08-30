/** Host-owned Director mutations consumed by the Blue frontend. */

import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';

import { applyDirectorActivityEvent } from './activity.js';
import type { DirectorConfig } from './config.js';
import type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';
import { SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE } from './settings.js';
import type { DirectorActivityProjection, SubagentDirectorHost } from './blue-contract.js';
import { ORCHESTRATE_PROJECTION_KEY } from './orchestrate.js';

const ROLE_ID = /^[a-z][a-z0-9-]*$/;

function copySettings(value: SubagentDirectorSettings): SubagentDirectorSettings {
  return structuredClone(value);
}

/** Publish the small renderer-neutral action surface beside the main plugin. */
export function applyDirectorHostApi(
  ctx: Context,
  config: DirectorConfig,
  getSettings: () => SubagentDirectorSettings,
): { notify(): void; setOrchestrate(session: Session, mode: 'on' | 'off'): void } {
  const toolName = config.toolName ?? 'subagent_role';
  const activityCells = new WeakMap<Agent['session'], { observed: number; state: DirectorActivityProjection }>();
  const listeners = new Set<() => void>();
  const liveOrchestrate = new WeakMap<Session, 'on' | 'off'>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const resolveAgent = (sessionId?: string): Agent | undefined => {
    const agents = ctx.get('agents');
    const preferred = sessionId === undefined ? undefined : agents?.get(sessionId as Agent['id']);
    if (preferred !== undefined) return preferred;
    const roots = agents?.list().filter((agent) => agent.session.header.origin !== 'subagent') ?? [];
    return roots.length === 1 ? roots[0] : undefined;
  };

  const activity = (session: Agent['session']): DirectorActivityProjection => {
    let cell = activityCells.get(session);
    if (cell === undefined) {
      cell = { observed: 0, state: { version: 1, entries: [] } };
      activityCells.set(session, cell);
    }
    const events = session.events;
    for (let index = cell.observed; index < events.length; index += 1) {
      cell.state = applyDirectorActivityEvent(cell.state, events[index]!, toolName);
    }
    cell.observed = events.length;
    return structuredClone(cell.state);
  };

  const api: SubagentDirectorHost = {
    snapshot: () => ({
      settings: copySettings(getSettings()),
      toolName,
      transport: config.subagentProvider ?? 'spawn',
      backgroundMode: config.backgroundMode ?? 'one-shot',
    }),
    activity(sessionId) {
      const agent = resolveAgent(sessionId);
      return agent === undefined
        ? { version: 1, entries: [] }
        : { ...activity(agent.session), sessionId: String(agent.id) };
    },
    orchestrate(sessionId) {
      const agent = resolveAgent(sessionId);
      if (agent === undefined) return { mode: 'off' };
      const liveMode = liveOrchestrate.get(agent.session);
      if (liveMode !== undefined) return { mode: liveMode, sessionId: String(agent.id) };
      try {
        const projections = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined;
        const value = projections?.snapshot(agent.session).values[ORCHESTRATE_PROJECTION_KEY] as { mode?: unknown } | undefined;
        return {
          mode: value?.mode === 'on' ? 'on' : 'off',
          sessionId: String(agent.id),
        };
      } catch {
        return { mode: 'off', sessionId: String(agent.id) };
      }
    },
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async saveRole(id: string, role: RoleTemplate): Promise<void> {
      if (!ROLE_ID.test(id)) throw new Error('角色 ID 必须以字母开头，且只能包含小写字母、数字和连字符。');
      const roles = { ...(getSettings().roles ?? {}), [id]: role };
      await ctx.settings.update(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE, { roles });
    },
    async deleteRole(id: string): Promise<void> {
      const roles = { ...(getSettings().roles ?? {}) };
      delete roles[id];
      await ctx.settings.update(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE, { roles });
    },
  };

  ctx.provide('subagentDirectorHost', api);
  ctx.on('settings/updated', (ns) => {
    if (String(ns) === String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE)) notify();
  });
  ctx.on('session/event', notify);
  ctx.on('agent/created', notify);
  ctx.on('agent/disposed', notify);
  return {
    notify,
    setOrchestrate(session, mode) {
      liveOrchestrate.set(session, mode);
      notify();
    },
  };
}

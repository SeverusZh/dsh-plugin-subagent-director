/**
 * Agent Teams defaults for Director sessions.
 *
 * Director Mode enables the shared task board for a new root session unless the
 * session already carries an explicit `team/mode` selection. Root sessions are
 * distinguished by session origin, not by a possible historical fork lineage.
 */
import type { Agent } from '@deepseek-ai/dsh-agent';

/** Count explicit Team selections recorded in one session log. */
export function teamEventCount(agent: Agent): number {
  const session = agent.session as unknown as {
    snapshotEvents?: () => readonly { type: string }[];
  };
  const events = session.snapshotEvents?.() ?? [];
  return events.filter((event) => event.type === 'team/mode').length;
}

/** Whether this session already has an explicit Team selection. */
export function hasTeamSelection(agent: Agent): boolean {
  return teamEventCount(agent) > 0;
}

/** Whether a root Director session should get the default Team selection. */
export function shouldEnableDirectorTeam(agent: Agent, enabled: boolean): boolean {
  if (!enabled) return false;
  if (agent.session.header.origin === 'subagent') return false;
  return !hasTeamSelection(agent);
}

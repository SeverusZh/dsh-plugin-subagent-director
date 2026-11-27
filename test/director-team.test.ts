import { describe, it, expect } from 'vitest';
import { hasTeamSelection, shouldEnableDirectorTeam, teamEventCount } from '../src/director-team.js';

function agent(origin: 'subagent' | undefined, events: Array<{ type: string }>) {
  return {
    session: {
      header: origin === undefined ? {} : { origin },
      snapshotEvents: () => events,
    },
  } as never;
}

describe('Director Agent Teams defaults', () => {
  it('counts explicit team/mode selections', () => {
    expect(teamEventCount(agent(undefined, []))).toBe(0);
    expect(hasTeamSelection(agent(undefined, [{ type: 'team/mode' }]))).toBe(true);
    expect(hasTeamSelection(agent(undefined, [{ type: 'user/message' }]))).toBe(false);
  });

  it('enables new root sessions and respects explicit or child selections', () => {
    expect(shouldEnableDirectorTeam(agent(undefined, []), true)).toBe(true);
    expect(shouldEnableDirectorTeam(agent(undefined, [{ type: 'team/mode' }]), true)).toBe(false);
    expect(shouldEnableDirectorTeam(agent('subagent', []), true)).toBe(false);
    expect(shouldEnableDirectorTeam(agent(undefined, []), false)).toBe(false);
  });
});

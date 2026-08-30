/** Pure fold coverage for the renderer-neutral Director activity projection. */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

import { applyDirectorActivityEvent } from '../src/activity.js';
import type { DirectorActivityProjection, SubagentDirectorHost } from '../src/blue-contract.js';
import { applyDirectorHostApi } from '../src/host-api.js';

const empty = (): DirectorActivityProjection => ({ version: 1, entries: [] });

function call(seq: number, callId: string, name = 'subagent_role', args = '{"description":"Review patch","role":"code-reviewer"}'): SessionEvent {
  return {
    seq,
    time: 1_000 + seq,
    type: 'tool/call',
    data: { turn: 1, step: 1, callId, name, arguments: args },
  } as SessionEvent;
}

function result(seq: number, callId: string, meta: unknown, isError = false): SessionEvent {
  return {
    seq,
    time: 1_000 + seq,
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `message-${String(seq)}`,
        role: 'user',
        source: { kind: 'tool', toolCallId: callId },
        content: [{ type: 'tool-result', toolCallId: callId, content: [], ...(isError ? { isError: true } : {}) }],
      },
      meta,
    },
  } as SessionEvent;
}

describe('Director activity projection', () => {
  it('tracks only the configured delegation tool and correlates a continuable child id', () => {
    let state = applyDirectorActivityEvent(empty(), call(0, 'ignored', 'subagent'), 'subagent_role');
    expect(state.entries).toEqual([]);

    state = applyDirectorActivityEvent(state, call(1, 'call-1'), 'subagent_role');
    expect(state.entries[0]).toMatchObject({
      callId: 'call-1',
      description: 'Review patch',
      roleId: 'code-reviewer',
      status: 'pending',
    });

    state = applyDirectorActivityEvent(state, result(2, 'call-1', { kind: 'continuable', subagentId: 'child-7' }), 'subagent_role');
    expect(state.entries[0]).toMatchObject({
      mode: 'continuable',
      status: 'delegated',
      targetId: 'child-7',
    });
  });

  it('marks foreground completion and tool failure without parsing display text', () => {
    let state = applyDirectorActivityEvent(empty(), call(0, 'call-ok'), 'subagent_role');
    state = applyDirectorActivityEvent(state, result(1, 'call-ok', { kind: 'foreground', runId: 'run-1' }), 'subagent_role');
    expect(state.entries[0]).toMatchObject({ status: 'completed', mode: 'foreground', targetId: 'run-1' });

    state = applyDirectorActivityEvent(state, call(2, 'call-bad'), 'subagent_role');
    state = applyDirectorActivityEvent(state, result(3, 'call-bad', undefined, true), 'subagent_role');
    expect(state.entries[1]).toMatchObject({ status: 'failed', mode: 'unknown' });
  });

  it('tolerates malformed arguments and keeps a bounded history', () => {
    let state = applyDirectorActivityEvent(empty(), call(0, 'bad', 'subagent_role', '{'), 'subagent_role');
    expect(state.entries[0]?.description).toBe('Delegated task');
    for (let index = 1; index <= 40; index += 1) {
      state = applyDirectorActivityEvent(state, call(index, `call-${String(index)}`), 'subagent_role');
    }
    expect(state.entries).toHaveLength(32);
    expect(state.entries[0]?.callId).toBe('call-9');
  });

  it('rebuilds activity from a live or resumed agent session and advances incrementally', () => {
    const ctx = new Context();
    const events: SessionEvent[] = [call(1, 'call-1')];
    const session = { events };
    ctx.provide('agents', {
      get: (id: string) => id === 'session-1' ? { id, session } : undefined,
      list: () => [],
    });
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { orchestrate: { mode: 'on' } } }),
    });
    const control = applyDirectorHostApi(ctx, {}, () => ({ roles: {} }));
    const host = ctx.get('subagentDirectorHost') as SubagentDirectorHost;
    let notifications = 0;
    host.watch(() => { notifications += 1; });

    expect(host.activity('session-1').entries[0]).toMatchObject({ callId: 'call-1', status: 'pending' });
    expect(host.orchestrate('session-1')).toEqual({ mode: 'on', sessionId: 'session-1' });
    events.push(result(2, 'call-1', { kind: 'foreground', runId: 'run-1' }));
    expect(host.activity('session-1').entries[0]).toMatchObject({ status: 'completed', targetId: 'run-1' });
    expect(host.activity('missing')).toEqual({ version: 1, entries: [] });
    control.notify();
    expect(notifications).toBe(1);
    control.setOrchestrate(session as never, 'off');
    expect(host.orchestrate('session-1')).toEqual({ mode: 'off', sessionId: 'session-1' });
    expect(notifications).toBe(2);
  });
});

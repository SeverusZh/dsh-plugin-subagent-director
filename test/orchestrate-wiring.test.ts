/**
 * Integration tests for the /orchestrate wiring in applyOrchestrate.
 *
 * Pins the real host contracts discovered in @deepseek-ai/dsh-session-projection
 * and @deepseek-ai/dsh-system-prompt:
 *  - the projection `register` definition MUST carry a `schema` (the framework
 *    calls `schema.parse(view(state))` on every snapshot; without it the
 *    section silently fails to inject — the D1 root cause);
 *  - the system-prompt section `text(context)` receives an AssembleContext that
 *    carries `agent` at runtime (dsh-agent assembleContextFor), and must also
 *    accept a bare `context.session` (D2 fallback);
 *  - the command handler defaults to "on" with no args, accepts on/off, rejects
 *    invalid input, and appends the orchestrate/change event;
 *  - the orchestrate/change event type registers idempotently.
 *
 * Uses fake host services so no real Cordis/Session is required.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  applyOrchestrate,
  ORCHESTRATE_PROJECTION_KEY,
  ORCHESTRATE_EVENT_TYPE,
} from '../src/orchestrate.js';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';

const settings = {
  roles: { dev: { displayName: 'Dev', description: 'd', provider: 'p', model: 'm' } },
};
const getSettings = () => settings;
const toolName = 'subagent_role';

function makeFakeCtx(opts: { withoutProjections?: boolean } = {}) {
  const state = { mode: 'off' as string, throws: false };
  const registeredSections: any[] = [];
  const registeredCommands: any[] = [];
  let projectionDef: any = undefined;

  const sessionProjections = {
    register(def: any) {
      projectionDef = def;
      return () => {};
    },
    snapshot(_session: any) {
      if (state.throws) throw new Error('forced snapshot failure');
      return { asOfSeq: -1, values: { [ORCHESTRATE_PROJECTION_KEY]: { mode: state.mode } } };
    },
  };
  const systemPrompt = {
    section(def: any) {
      registeredSections.push(def);
      return () => {};
    },
  };
  const commands = {
    register(def: any) {
      registeredCommands.push(def);
      return () => {};
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const ctx: any = {
    logger,
    get(name: string) {
      if (opts.withoutProjections) {
        // Simulate a host that does not provide the sessionProjections
        // service (P0 silent-degradation path): commands/systemPrompt may
        // still exist, but sessionProjections is absent.
        if (name === 'sessionProjections') return undefined;
        if (name === 'systemPrompt') return systemPrompt;
        if (name === 'commands') return commands;
        return undefined;
      }
      if (name === 'sessionProjections') return sessionProjections;
      if (name === 'systemPrompt') return systemPrompt;
      if (name === 'commands') return commands;
      return undefined;
    },
  };
  return {
    ctx,
    registeredSections,
    registeredCommands,
    getProjectionDef: () => projectionDef,
    sessionProjections,
    state,
    logger,
  };
}

describe('applyOrchestrate — projection register', () => {
  it('registers a definition that includes a schema (snapshot contract)', () => {
    const { ctx, getProjectionDef } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    const def = getProjectionDef();
    expect(def).toBeDefined();
    expect(def.key).toBe(ORCHESTRATE_PROJECTION_KEY);
    expect(typeof def.schema?.parse).toBe('function');
    // the schema validates the view output the framework re-parses on snapshot
    expect(def.schema.parse({ mode: 'on' })).toEqual({ mode: 'on' });
    expect(() => def.schema.parse({ mode: 'bad' })).toThrow();
  });

  it('apply folds the orchestrate/change event into the mode state', () => {
    const { ctx, getProjectionDef } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    const def = getProjectionDef();
    expect(def.apply({ mode: 'off' }, { type: ORCHESTRATE_EVENT_TYPE, data: { mode: 'on' } })).toEqual({ mode: 'on' });
    // unrelated events leave state untouched
    expect(def.apply({ mode: 'on' }, { type: 'other', data: {} })).toEqual({ mode: 'on' });
    // invalid mode leaves state untouched
    expect(def.apply({ mode: 'off' }, { type: ORCHESTRATE_EVENT_TYPE, data: { mode: 'nope' } })).toEqual({ mode: 'off' });
  });
});

describe('applyOrchestrate — system-prompt section', () => {
  it('injects the orchestrator prompt when mode is on (context.agent.session)', () => {
    const { ctx, state, registeredSections } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    state.mode = 'on';
    const text = registeredSections[0].text({ agent: { session: { id: 's1' } } });
    expect(text).toContain('PURE ORCHESTRATOR');
    expect(text).toContain('subagent_role');
  });

  it('does not inject when mode is off', () => {
    const { ctx, state, registeredSections } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    state.mode = 'off';
    expect(registeredSections[0].text({ agent: { session: { id: 's1' } } })).toBe('');
  });

  it('falls back to context.session when context.agent is absent (D2)', () => {
    const { ctx, state, registeredSections } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    state.mode = 'on';
    const text = registeredSections[0].text({ session: { id: 's2' } });
    expect(text).toContain('PURE ORCHESTRATOR');
  });

  it('returns empty when neither context.session nor context.agent.session exists', () => {
    const { ctx, state, registeredSections } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    state.mode = 'on';
    expect(registeredSections[0].text({})).toBe('');
    expect(registeredSections[0].text(undefined)).toBe('');
  });

  it('logs a warning instead of silently dropping the prompt when snapshot throws (D1)', () => {
    const { ctx, state, registeredSections, logger } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    state.mode = 'on';
    state.throws = true;
    const text = registeredSections[0].text({ agent: { session: { id: 's1' } } });
    expect(text).toBe(''); // safe fallback to off
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain('[orchestrate]');
  });
});

describe('applyOrchestrate — command handler', () => {
  it('defaults to on with no args and appends the event', () => {
    const { ctx, registeredCommands } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    const handler = registeredCommands[0].handler;
    const appended: any[] = [];
    const res = handler({
      rawInput: '',
      agent: { session: { append: (t: string, d: any) => appended.push([t, d]) } },
    });
    expect(res.kind).toBe('success');
    expect(res.text).toContain('on');
    expect(appended).toEqual([[ORCHESTRATE_EVENT_TYPE, { mode: 'on' }]]);
  });

  it('accepts off and rejects invalid input', () => {
    const { ctx, registeredCommands } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    const handler = registeredCommands[0].handler;
    const off = handler({ rawInput: 'off', agent: { session: { append: () => {} } } });
    expect(off.kind).toBe('success');
    expect(off.text).toContain('off');
    const bad = handler({ rawInput: 'maybe', agent: { session: { append: () => {} } } });
    expect(bad.kind).toBe('error');
    expect(bad.text).toContain('Valid: on|off');
  });
});

describe('applyOrchestrate — missing sessionProjections service (P0)', () => {
  it('logs a loud warning when sessionProjections is missing', () => {
    const { ctx, logger } = makeFakeCtx({ withoutProjections: true });
    applyOrchestrate(ctx, getSettings, toolName);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = String(logger.warn.mock.calls[0][0]);
    expect(msg).toContain('sessionProjections');
    expect(msg).toMatch(/orchestrate|will NOT take effect|not take effect/i);
  });

  it('does NOT falsely report success for /orchestrate on when the service is missing', () => {
    const { ctx, registeredCommands } = makeFakeCtx({ withoutProjections: true });
    applyOrchestrate(ctx, getSettings, toolName);
    const handler = registeredCommands[0].handler;
    const res = handler({ rawInput: 'on', agent: { session: { append: () => {} } } });
    expect(res.text).not.toContain('Orchestrator mode: on');
    expect(res.text).toMatch(/NOT applied|will NOT take effect|missing|not take effect/i);
  });

  it('warns for the off path too when the service is missing', () => {
    const { ctx, registeredCommands } = makeFakeCtx({ withoutProjections: true });
    applyOrchestrate(ctx, getSettings, toolName);
    const handler = registeredCommands[0].handler;
    const res = handler({ rawInput: 'off', agent: { session: { append: () => {} } } });
    expect(res.text).not.toContain('Orchestrator mode: off');
    expect(res.text).toMatch(/NOT applied|will NOT take effect|missing|not take effect/i);
  });
});

describe('applyOrchestrate — event registration', () => {
  it('registers orchestrate/change idempotently across multiple applies', () => {
    const { ctx } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    applyOrchestrate(ctx, getSettings, toolName);
    expect(KNOWN_SESSION_EVENT_TYPES.has(ORCHESTRATE_EVENT_TYPE)).toBe(true);
  });
});

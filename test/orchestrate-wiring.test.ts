/**
 * Integration tests for the /orchestrate wiring in applyOrchestrate.
 *
 * Pins the real host contracts discovered in @deepseek-ai/dsh-session-projection
 * and @deepseek-ai/dsh-system-prompt:
 *  - the projection `register` definition MUST carry `stateSchema` (host-state
 *    validation) AND `wire: { viewSchema, view }`; without `wire` the unit is
 *    host-only and `snapshot()` skips it, so the section silently fails to
 *    inject (the actual root cause — the prior `schema`+bare-`view` mock hid it);
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

function makeFakeCtx(opts: { withoutProjections?: boolean; identityKeyed?: boolean } = {}) {
  const state = { mode: 'off' as string, throws: false };
  const registeredSections: any[] = [];
  const registeredCommands: any[] = [];
  let projectionDef: any = undefined;
  // Mirrors @deepseek-ai/dsh-session-projection's real WeakMap keyed by the
  // session OBJECT (cellFor reads registration.cells.get(session) and folds
  // session.events). When identityKeyed, snapshot() resolves the mode from the
  // candidate session's own event log, so a DIFFERENT session object yields the
  // init default 'off' — reproducing the render-time silent no-op exactly.
  const cells = new WeakMap<any, { mode: string }>();

  const sessionProjections = {
    register(def: any) {
      projectionDef = def;
      return () => {};
    },
    // Simulate the command appending an event into a (render- or command-time)
    // session's log, exactly as invocation.agent.session.append does at runtime.
    appendEvent(sessionArg: any, type: string, data: any) {
      sessionArg.events = sessionArg.events || [];
      sessionArg.events.push({ type, data });
    },
    snapshot(sessionArg: any) {
      if (state.throws) throw new Error('forced snapshot failure');
      // Faithful mirror of SessionProjectionRegistry.snapshot: client-visible
      // units (with `wire`) appear in values; host-only units (no `wire`) are
      // skipped — the real root-cause skip that hid the bug.
      if (!projectionDef || projectionDef.wire === undefined) {
        return { asOfSeq: -1, values: {} };
      }
      if (!opts.identityKeyed) {
        return { asOfSeq: -1, values: { [ORCHESTRATE_PROJECTION_KEY]: projectionDef.wire.viewSchema.parse(projectionDef.wire.view({ mode: state.mode })) } };
      }
      let cell = cells.get(sessionArg);
      if (!cell) {
        cell = { mode: projectionDef.init().mode };
        if (sessionArg && Array.isArray(sessionArg.events)) {
          for (const ev of sessionArg.events) cell.mode = projectionDef.apply({ mode: cell.mode }, ev).mode;
        }
        cells.set(sessionArg, cell);
      }
      const value = projectionDef.wire.viewSchema.parse(projectionDef.wire.view({ mode: cell.mode }));
      return { asOfSeq: -1, values: { [ORCHESTRATE_PROJECTION_KEY]: value } };
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

describe('applyOrchestrate — render path (session-identity resolution)', () => {
  // These cases use an identity-keyed fake whose snapshot() folds the candidate
  // session's own event log, mirroring the real WeakMap-backed registry. They
  // pin the P0 render-time fix: the section must resolve the mode from a stable
  // session reference (on wins across candidate references) and must NEVER
  // silently return '' when the mode cannot be resolved.
  function buildOnSessions() {
    const fake = makeFakeCtx({ identityKeyed: true });
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const cmdSession = { id: 'cmd-session', events: [] };
    // Simulate /orchestrate on: command appends the event to cmdSession's log.
    fake.sessionProjections.appendEvent(cmdSession, ORCHESTRATE_EVENT_TYPE, { mode: 'on' });
    return { fake, cmdSession };
  }

  it('injects when the render agent.session is the same object that received the event', () => {
    const { fake, cmdSession } = buildOnSessions();
    const text = fake.registeredSections[0].text({ agent: { session: cmdSession } });
    expect(text).toContain('PURE ORCHESTRATOR');
  });

  it('injects even when a stray wrong context.session reference co-exists (on wins across candidates)', () => {
    const { fake, cmdSession } = buildOnSessions();
    const wrongSession = { id: 'wrong-session', events: [] };
    const text = fake.registeredSections[0].text({ agent: { session: cmdSession }, session: wrongSession });
    expect(text).toContain('PURE ORCHESTRATOR');
  });

  it('injects regardless of candidate order when the correct session is the bare context.session', () => {
    const { fake, cmdSession } = buildOnSessions();
    const wrongSession = { id: 'wrong-session', events: [] };
    const text = fake.registeredSections[0].text({ session: wrongSession, agent: { session: cmdSession } });
    expect(text).toContain('PURE ORCHESTRATOR');
  });

  it('does NOT inject and does NOT warn when mode is legitimately off (resolved from the event log)', () => {
    const fake = makeFakeCtx({ identityKeyed: true });
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const offSession = { id: 'off-session', events: [] };
    fake.sessionProjections.appendEvent(offSession, ORCHESTRATE_EVENT_TYPE, { mode: 'off' });
    const text = fake.registeredSections[0].text({ agent: { session: offSession } });
    expect(text).toBe('');
    expect(fake.logger.warn).not.toHaveBeenCalled();
  });

  it('warns (no silent drop) when no session is resolvable from the context', () => {
    const { fake } = buildOnSessions();
    const text = fake.registeredSections[0].text({});
    expect(text).toBe('');
    expect(fake.logger.warn).toHaveBeenCalled();
    const msg = String(fake.logger.warn.mock.calls.at(-1)?.[0]);
    expect(msg).toContain('[orchestrate]');
    expect(msg).toMatch(/session|context|skipped/i);
  });

  it('warns (no silent drop) when the render session identity never received the event', () => {
    const { fake, cmdSession } = buildOnSessions();
    // Render with a DIFFERENT session object that has no orchestrate/change log.
    const stranger = { id: 'stranger', events: [] };
    const text = fake.registeredSections[0].text({ agent: { session: stranger } });
    expect(text).toBe('');
    // cmdSession still holds 'on'; the section should NOT silently pretend off.
    const cmdText = fake.registeredSections[0].text({ agent: { session: cmdSession } });
    expect(cmdText).toContain('PURE ORCHESTRATOR');
  });
});

describe('applyOrchestrate — projection register', () => {
  it('registers a definition that includes a schema (snapshot contract)', () => {
    const { ctx, getProjectionDef } = makeFakeCtx();
    applyOrchestrate(ctx, getSettings, toolName);
    const def = getProjectionDef();
    expect(def).toBeDefined();
    expect(def.key).toBe(ORCHESTRATE_PROJECTION_KEY);
    // Real contract: host-state validation lives in `stateSchema`; the
    // client-visible unit MUST also declare `wire: { viewSchema, view }`.
    expect(typeof def.stateSchema?.parse).toBe('function');
    expect(def.stateSchema.parse({ mode: 'on' })).toEqual({ mode: 'on' });
    expect(() => def.stateSchema.parse({ mode: 'bad' })).toThrow();
    expect(typeof def.wire?.viewSchema?.parse).toBe('function');
    expect(def.wire.viewSchema.parse({ mode: 'on' })).toEqual({ mode: 'on' });
    expect(() => def.wire.viewSchema.parse({ mode: 'bad' })).toThrow();
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

describe('applyOrchestrate — reactive (deferred) sessionProjections (P0 timing fix)', () => {
  // Simulates a host where sessionProjections is absent at apply time but the
  // ctx.inject callback fires once the host mounts the service *later*. Mirrors
  // the cordis ctx.inject contract: callback runs with an injected ctx once the
  // dependency is present, and returns a disposable fiber.
  function makeFakeCtxDeferred() {
    const state = { mode: 'off' as string, throws: false };
    const registeredSections: any[] = [];
    const registeredCommands: any[] = [];
    let projectionDef: any = undefined;
    let mounted = false;
    let injectCb: ((ctx: any) => void) | undefined;

    const sessionProjections = {
      register(def: any) {
        projectionDef = def;
        return () => {};
      },
      snapshot(_session: any) {
        if (state.throws) throw new Error('forced snapshot failure');
        if (!projectionDef || projectionDef.wire === undefined) {
          return { asOfSeq: -1, values: {} };
        }
        return { asOfSeq: -1, values: { [ORCHESTRATE_PROJECTION_KEY]: projectionDef.wire.viewSchema.parse(projectionDef.wire.view({ mode: state.mode })) } };
      },
    };
    const systemPrompt = { section(def: any) { registeredSections.push(def); return () => {}; } };
    const commands = { register(def: any) { registeredCommands.push(def); return () => {}; } };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const ctx: any = {
      logger,
      get(name: string) {
        if (name === 'sessionProjections') return mounted ? sessionProjections : undefined;
        if (name === 'systemPrompt') return systemPrompt;
        if (name === 'commands') return commands;
        return undefined;
      },
      inject(_deps: string[], cb: (ctx: any) => void) {
        injectCb = cb;
        return { dispose: () => { injectCb = undefined; } };
      },
      effect: () => () => {},
    };
    return {
      ctx,
      registeredSections,
      registeredCommands,
      getProjectionDef: () => projectionDef,
      state,
      logger,
      // Simulate the host mounting the service after apply time.
      mountSessionProjections: () => {
        mounted = true;
        injectCb?.(ctx);
      },
    };
  }

  it('does not register the projection until the service becomes available', () => {
    const fake = makeFakeCtxDeferred();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    // Service absent at apply time → no projection yet, no false warning.
    expect(fake.getProjectionDef()).toBeUndefined();
    expect(fake.logger.warn).not.toHaveBeenCalled();
    // Host mounts the service later → inject callback registers it.
    fake.mountSessionProjections();
    expect(fake.getProjectionDef()).toBeDefined();
    expect(fake.getProjectionDef().key).toBe(ORCHESTRATE_PROJECTION_KEY);
    expect(typeof fake.getProjectionDef().wire?.viewSchema?.parse).toBe('function');
  });

  it('returns an honest error before the service is ready, success after', () => {
    const fake = makeFakeCtxDeferred();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const handler = fake.registeredCommands[0].handler;
    const before = handler({ rawInput: 'on', agent: { session: { append: () => {} } } });
    expect(before.kind).toBe('error');
    expect(before.text).toMatch(/NOT applied|missing|will NOT take effect/i);
    fake.mountSessionProjections();
    const appended: any[] = [];
    const after = handler({
      rawInput: 'on',
      agent: { session: { append: (t: string, d: any) => appended.push([t, d]) } },
    });
    expect(after.kind).toBe('success');
    expect(after.text).toContain('on');
    expect(appended).toEqual([[ORCHESTRATE_EVENT_TYPE, { mode: 'on' }]]);
  });

  it('injects the orchestrator prompt only after the projection is registered', () => {
    const fake = makeFakeCtxDeferred();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    fake.state.mode = 'on';
    // Before the service mounts, the section cannot read the projection.
    expect(fake.registeredSections[0].text({ agent: { session: { id: 's1' } } })).toBe('');
    fake.mountSessionProjections();
    expect(fake.registeredSections[0].text({ agent: { session: { id: 's1' } } })).toContain('PURE ORCHESTRATOR');
  });
});


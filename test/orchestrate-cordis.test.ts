/**
 * Real-cordis integration probes for the /orchestrate wiring (issue #5).
 *
 * Unlike orchestrate-wiring.test.ts — whose hand-rolled fakes mirror our
 * understanding of the host — these tests boot a GENUINE cordis Context and,
 * for the projection seam, the REAL `SessionProjectionRegistry` from the
 * 0.1.1 host line. Three contracts the fakes cannot prove:
 *
 *  1. activation: the plugin entry loads and applies with exactly its four
 *     required services and NO `commands` service — if 'commands' were still
 *     a required entry-inject, this probe's apply() would never run;
 *  2. reactivity: the real `ctx.inject` child fiber fires when a `commands`
 *     service is provided AFTER the plugin has loaded;
 *  3. projection contract: the typed registration satisfies the REAL
 *     registry (stateSchema + wire on the 0.1.1 line) and `snapshot()` folds
 *     appended events into the client-visible value — the contract the
 *     0.1.1 host actually enforces (wire-less units are skipped).
 */
import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import { name as pluginName, inject as pluginInject, apply } from '../src/index.js';
import { ORCHESTRATE_PROJECTION_KEY } from '../src/orchestrate.js';

/** Let cordis fiber loads / reactivations settle (they resolve in microtasks). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** Minimal core-service stubs satisfying the plugin entry's required inject. */
function provideCoreStubs(ctx: Context, toolsRegister: (def: unknown) => () => void): void {
  ctx.provide('tools', { register: toolsRegister });
  ctx.provide('subagents', {
    getProvider: () => undefined,
    start: async () => ({}) as never,
    startContinuable: async () => ({}) as never,
  });
  ctx.provide('llm', { listProviders: () => [] });
  // installSettingsSection (dsh-settings) only needs register() to return a
  // scope with get()/watch(); there is no settings.yaml behind this probe.
  ctx.provide('settings', {
    register: (_ns: unknown, _schema: unknown, opts: { base: unknown }) => ({
      get: () => opts.base,
      watch: () => () => {},
    }),
  });
}

function loadEntry(ctx: Context, toolsRegister: (def: unknown) => () => void): void {
  provideCoreStubs(ctx, toolsRegister);
  void ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
}

describe('real cordis probe — entry activation', () => {
  it('activates the entry WITHOUT a commands service (commands is not a required inject)', async () => {
    const ctx = new Context();
    const registered: string[] = [];
    loadEntry(ctx, (def) => {
      registered.push((def as { name?: string }).name ?? 'unnamed');
      return () => {};
    });
    await settle();
    // apply() ran: the close_subagent tool was registered through the stub
    // tools service, so the fiber really activated with no commands service.
    expect(registered).toContain('close_subagent');
    expect(ctx.get('commands')).toBeUndefined();
  });

  it('stays PENDING when a core service is missing (required inject semantics)', async () => {
    const ctx = new Context();
    const registered: string[] = [];
    const toolsRegister = (def: unknown): (() => void) => {
      registered.push((def as { name?: string }).name ?? 'unnamed');
      return () => {};
    };
    // llm intentionally NOT provided: the entry's required inject must keep
    // the fiber pending, so apply() (and close_subagent registration) never
    // runs. This pins that the four core services remain the only hard deps.
    ctx.provide('tools', { register: toolsRegister });
    ctx.provide('subagents', {
      getProvider: () => undefined,
      start: async () => ({}) as never,
      startContinuable: async () => ({}) as never,
    });
    ctx.provide('settings', {
      register: (_ns: unknown, _schema: unknown, opts: { base: unknown }) => ({
        get: () => opts.base,
        watch: () => () => {},
      }),
    });
    void ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
    await settle();
    await settle();
    expect(registered).toEqual([]);
  });
});

describe('real cordis probe — orchestrate reactivity + real projection registry', () => {
  it('registers /orchestrate once commands arrives late; the projection folds through the REAL registry', async () => {
    const ctx = new Context();
    // The REAL registry, mounted before the plugin (the live-host shape).
    const registry = new SessionProjectionRegistry(ctx);
    const commands: Array<{ name: string; handler: (invocation: any) => any }> = [];
    loadEntry(ctx, () => () => {});
    await settle();

    // No commands service at apply time → /orchestrate not registered yet.
    expect(commands).toEqual([]);
    // Now the host provides commands; the real ctx.inject child fiber fires.
    ctx.provide('commands', {
      register: (def: { name: string; handler: (invocation: any) => any }) => {
        commands.push(def);
        return () => {};
      },
    });
    await settle();
    await settle();
    const orchestrate = commands.find((c) => c.name === 'orchestrate');
    expect(orchestrate).toBeDefined();

    // Drive the command against a minimal session log and read the mode back
    // through the REAL registry snapshot (0.1.1 wire contract: our unit is
    // client-visible, so it must appear in snapshot().values). The fake
    // session mirrors the real Session's append contract: it appends to the
    // log AND publishes `session/event` — the registry's eager drive keys off
    // that event (its constructor subscribes with
    // ctx.on('session/event', (session, event) => this.drive(session, event))).
    const session: any = {
      seq: 0,
      events: [] as Array<{ type: string; data: any; seq: number; time: number }>,
      append(type: string, data: any) {
        const event = { type, data, seq: this.events.length, time: Date.now() };
        this.events.push(event);
        this.seq = this.events.length;
        ctx.emit('session/event', this, event);
      },
    };
    expect(orchestrate!.handler({ rawInput: 'on', agent: { session } }).kind).toBe('success');
    expect(registry.snapshot(session).values[ORCHESTRATE_PROJECTION_KEY]).toEqual({ mode: 'on' });
    expect(orchestrate!.handler({ rawInput: 'off', agent: { session } }).kind).toBe('success');
    expect(registry.snapshot(session).values[ORCHESTRATE_PROJECTION_KEY]).toEqual({ mode: 'off' });
  });
});
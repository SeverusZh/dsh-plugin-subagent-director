/**
 * Real-cordis alpha.4 probes for the host-half redesign (double-write removal
 * + authorized-model constraint). Unlike the hand-rolled fakes in other unit
 * tests, these boot a GENUINE cordis Context and mount the real entry:
 *
 *   a) seam removal: applying the plugin registers `subagent_role` on the
 *      real `tools` seam while leaving the ORIGINAL `ctx.subagents.start`
 *      function untouched — the former default-route seam must never wrap it
 *      again (double-write avoidance with the official dsh-tool-subagent);
 *   b) settings: the `subagent-director` namespace registers through the
 *      alpha.4 `installSection` pattern, and delegation resolution consults
 *      the official `subagent-model-selection` section through `settings.get`;
 *   c) delegation execute: an unlisted explicit provider/model rejects with a
 *      'subagent-director:' hard error; a listed pair (plus an explicit
 *      reasoningEffort) flows through to `subagents.start` agentOptions; an
 *      unlisted plugin default is dropped (inherit); a disabled official
 *      selection leaves plugin behavior unconstrained.
 */
import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { name as pluginName, inject as pluginInject, apply } from '../src/index.js';

/** Let cordis fiber loads / reactivations settle (they resolve in microtasks). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** Fake foreground run the fake subagents provider resolves. */
function fakeRun() {
  return {
    id: 'run-1',
    result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
    dispose: async () => {},
  };
}

/** Minimal alpha.4-shaped settings provider stub (installSection/register/get). */
function settingsStub(options: {
  directorSettings?: Record<string, unknown>;
  selection?:
    | { enabled: boolean; allowedModels: Array<{ provider: string; model: string }> }
    | undefined;
} = {}) {
  const store = new Map<string, unknown>();
  store.set('subagent-director', options.directorSettings ?? {});
  if (options.selection !== undefined) store.set('subagent-model-selection', options.selection);
  const registered: string[] = [];
  const consulted: string[] = [];
  const scope = (ns: string) => ({
    get: () => store.get(ns),
    watch: () => () => {},
    update: async () => {},
    replace: async () => {},
  });
  return {
    store,
    registered,
    consulted,
    writable: true,
    register(ns: string, _schema: unknown, _opts: unknown) {
      registered.push(ns);
      return scope(ns);
    },
    installSection(_owner: unknown, ns: string, _schema: unknown, entry: unknown, hooks: { setSource: (fn: () => unknown) => void; onChange: () => void }) {
      registered.push(ns);
      if (!store.has(ns)) store.set(ns, entry);
      hooks.setSource(() => store.get(ns));
      hooks.onChange();
    },
    get(ns: string) {
      consulted.push(ns);
      return store.get(ns);
    },
    describe: () => [],
    mutate: async () => {},
    update: async () => {},
    replace: async () => {},
  };
}

/** Fake subagents service whose start records calls and keeps a marker. */
function subagentsStub() {
  const calls: Array<{ name: string; request: Record<string, unknown> }> = [];
  const provider = { name: 'spawn', capabilities: { persona: true, toolFilter: true, depthLimit: true } };
  const start = Object.assign(
    async (name: string, request: Record<string, unknown>) => {
      calls.push({ name, request });
      return fakeRun();
    },
    { seamMarker: 'original-start' },
  );
  return {
    calls,
    provider,
    start,
    startContinuable: async () => ({ childId: 'child-1' }),
    getProvider: () => provider,
    drainContinuableChildren: async () => {},
  };
}

/** Capture tool definitions registered through the real tools seam. */
function captureTools() {
  const defs: Array<{ name?: string; execute?: (args: unknown, exec: unknown) => unknown }> = [];
  return {
    defs,
    register: (def: unknown) => {
      defs.push(def as { name?: string; execute?: (args: unknown, exec: unknown) => unknown });
      return () => {};
    },
  };
}

/** Mount the plugin entry on a real Context with the stub services. */
function loadPlugin(ctx: Context, settings: ReturnType<typeof settingsStub>, tools: ReturnType<typeof captureTools>, subagents: ReturnType<typeof subagentsStub>): void {
  ctx.provide('tools', { register: tools.register });
  ctx.provide('subagents', subagents);
  ctx.provide('llm', { listProviders: () => [{ id: 'cli' }, { id: 'rogue' }] });
  ctx.provide('settings', settings);
  void ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
}

/** The bare ToolRunContext-shaped execution object for direct execute calls. */
function execContext() {
  return {
    agent: { name: 'parent', options: {} },
    signal: new AbortController().signal,
  };
}

describe('real cordis probe — seam removal (no default-route double write)', () => {
  it('mounts subagent_role and leaves the ORIGINAL ctx.subagents.start untouched', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub();
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);

    await settle();
    expect(tools.defs.map((d) => d.name)).toContain('subagent_role');
    expect(tools.defs.map((d) => d.name)).toContain('close_subagent');
    // The plugin must never have replaced/wrapped the service method: identity
    // and the marker survive apply().
    const live = ctx.get('subagents') as { start: typeof subagents.start };
    expect(live.start).toBe(subagents.start);
    expect((live.start as unknown as { seamMarker: string }).seamMarker).toBe('original-start');
  });
});

describe('real cordis probe — settings registration + selection consultation', () => {
  it('registers the subagent-director namespace via installSection and consults subagent-model-selection', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub({
      selection: { enabled: true, allowedModels: [{ provider: 'cli', model: 'claude' }] },
    });
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);
    await settle();

    expect(settings.registered).toContain('subagent-director');

    // Drive one bare delegation: the execute path must read the official
    // selection section through settings.get('subagent-model-selection').
    const tool = tools.defs.find((d) => d.name === 'subagent_role');
    expect(tool).toBeDefined();
    await tool!.execute!(
      { description: 'probe', prompt: 'no route fields' },
      execContext(),
    );
    expect(settings.consulted).toContain('subagent-model-selection');
  });
});

describe('real cordis probe — delegation constraints wired to the authorized list', () => {
  const SELECTION = { enabled: true, allowedModels: [{ provider: 'cli', model: 'claude' }] };

  it('rejects an unlisted explicit provider/model without starting a subagent', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub({ selection: SELECTION });
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);
    await settle();

    const tool = tools.defs.find((d) => d.name === 'subagent_role')!;
    await expect(
      tool.execute!({ description: 'x', prompt: 'y', provider: 'rogue', model: 'x' }, execContext()),
    ).rejects.toThrow(/subagent-director:.*not in the authorized model list/);
    expect(subagents.calls).toHaveLength(0);
  });

  it('passes a listed pair (and explicit effort) through to subagents.start agentOptions', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub({ selection: SELECTION });
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);
    await settle();

    const tool = tools.defs.find((d) => d.name === 'subagent_role')!;
    const result = await tool.execute!(
      { description: 'x', prompt: 'y', provider: 'cli', model: 'claude', reasoningEffort: 'high' },
      execContext(),
    );
    expect(subagents.calls).toHaveLength(1);
    expect(subagents.calls[0].name).toBe('spawn');
    expect(subagents.calls[0].request.agentOptions).toEqual({
      provider: 'cli',
      model: 'claude',
      reasoningEffort: 'high',
    });
    expect(result).toEqual({ kind: 'foreground', runId: 'run-1', output: [] });
  });

  it('drops an unlisted plugin default (inherit) under an enabled official list', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub({
      selection: SELECTION,
      directorSettings: { defaultProvider: 'rogue', defaultModel: 'x' },
    });
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);
    await settle();

    const tool = tools.defs.find((d) => d.name === 'subagent_role')!;
    await tool.execute!({ description: 'x', prompt: 'y' }, execContext());
    expect(subagents.calls).toHaveLength(1);
    expect(subagents.calls[0].request.agentOptions).toBeUndefined();
  });

  it('keeps plugin behavior unconstrained when the official selection is disabled', async () => {
    const ctx = new Context();
    const tools = captureTools();
    const settings = settingsStub({
      selection: { enabled: false, allowedModels: [{ provider: 'cli', model: 'claude' }] },
      directorSettings: { defaultProvider: 'rogue', defaultModel: 'x' },
    });
    const subagents = subagentsStub();
    loadPlugin(ctx, settings, tools, subagents);
    await settle();

    const tool = tools.defs.find((d) => d.name === 'subagent_role')!;
    await tool.execute!({ description: 'x', prompt: 'y' }, execContext());
    expect(subagents.calls).toHaveLength(1);
    expect(subagents.calls[0].request.agentOptions).toEqual({ provider: 'rogue', model: 'x' });
  });
});

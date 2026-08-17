/**
 * Unit tests for the default route seam (design: 默认模型兜底).
 *
 * resolveSeamAgentOptions is the pure rule deciding whether a subagent start
 * that did NOT carry explicit agentOptions should get the plugin's configured
 * default provider/model injected:
 *   - explicit (even partial) agentOptions is never overridden;
 *   - defaults are injected only when both provider and model are configured;
 *   - an un-routable default provider falls back to inheritance (never throws);
 *   - without an llm service routability is assumed (cannot validate).
 */
import { describe, it, expect } from 'vitest';
import { applyDefaultRouteSeam, resolveSeamAgentOptions } from '../src/default-route.js';
import { Config } from '../src/config.js';

const defaults = { defaultProvider: 'opencode-go', defaultModel: 'mimo-v2.5' };

describe('resolveSeamAgentOptions', () => {
  it('不注入：请求已带显式 provider 和 model', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { provider: 'x', model: 'y' }, settings: defaults })).toBeUndefined();
  });

  it('不注入：请求带部分 agentOptions（只有 provider）', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { provider: 'x' }, settings: defaults })).toBeUndefined();
  });

  it('不注入：请求带部分 agentOptions（只有 model）', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { model: 'y' }, settings: defaults })).toBeUndefined();
  });

  it('注入：无 agentOptions 且默认 provider/model 齐全', () => {
    expect(resolveSeamAgentOptions({ settings: defaults })).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('不注入：默认 provider 缺失', () => {
    expect(resolveSeamAgentOptions({ settings: { defaultModel: 'mimo-v2.5' } })).toBeUndefined();
  });

  it('不注入：默认 model 缺失', () => {
    expect(resolveSeamAgentOptions({ settings: { defaultProvider: 'opencode-go' } })).toBeUndefined();
  });

  it('不注入：默认 provider 不可路由', () => {
    expect(resolveSeamAgentOptions({ settings: defaults, isRoutable: () => false })).toBeUndefined();
  });

  it('注入：无 llm 服务（无法判断可路由性）时视为可路由', () => {
    expect(resolveSeamAgentOptions({ settings: defaults })).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });
});

function makeHarness() {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const subagents = {
    start: async (name: string, request: unknown) => {
      calls.push({ kind: 'start', payload: { name, request } });
      return { id: 'run-1' };
    },
    startContinuable: async (spec: unknown) => {
      calls.push({ kind: 'startContinuable', payload: spec });
      return { childId: 'child-1' };
    },
  };
  const ctx = {
    subagents,
    get: (name: string) =>
      name === 'llm' ? { listProviders: () => [{ id: 'opencode-go' }] } : undefined,
    logger: { info: () => {}, warn: () => {} },
  };
  return { calls, subagents, ctx };
}

function baseRequest() {
  return { prompt: [], parent: {} as never, signal: new AbortController().signal };
}

describe('applyDefaultRouteSeam', () => {
  it('start：注入默认模型并透传', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.start('spawn', baseRequest());
    const call = h.calls[0].payload as { name: string; request: { agentOptions?: unknown } };
    expect(call.name).toBe('spawn');
    expect(call.request.agentOptions).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('start：显式 agentOptions 不被覆盖', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.start('spawn', { ...baseRequest(), agentOptions: { provider: 'x', model: 'y' } });
    const call = h.calls[0].payload as { request: { agentOptions?: unknown } };
    expect(call.request.agentOptions).toEqual({ provider: 'x', model: 'y' });
  });

  it('startContinuable：注入默认模型并透传', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.startContinuable({
      provider: 'fork',
      label: 'job',
      request: baseRequest(),
      signal: new AbortController().signal,
    });
    const spec = h.calls[0].payload as { request: { agentOptions?: unknown } };
    expect(spec.request.agentOptions).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('dispose 恢复原始方法', async () => {
    const h = makeHarness();
    const originalStart = h.subagents.start;
    const originalContinuable = h.subagents.startContinuable;
    const dispose = applyDefaultRouteSeam(h.ctx as never, () => defaults);
    expect(h.subagents.start).not.toBe(originalStart);
    dispose();
    expect(h.subagents.start).toBe(originalStart);
    expect(h.subagents.startContinuable).toBe(originalContinuable);
  });
});

describe('Config', () => {
  it('applyDefaultRoute 默认开启', () => {
    expect(Config({}).applyDefaultRoute).toBe(true);
  });
});

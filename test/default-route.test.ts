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
import { resolveSeamAgentOptions } from '../src/default-route.js';

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

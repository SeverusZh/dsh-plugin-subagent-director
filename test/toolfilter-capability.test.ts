/**
 * Unit tests for the Agent Preset capability path (design section 7.3 / FR-8.1).
 *
 * DSH 0.2.1 removed per-request persona/toolFilter from the subagent seam and
 * moved that composition into an independent Agent Preset. The two pure helpers
 * extracted from delegation-tool.execute cover the parts that were previously
 * untestable without a live DSH context:
 *   - buildSubagentRequest: asserts that a role-resolved agentPreset (and
 *     agentOptions / maxDepth) propagate into the assembled request body only
 *     when present — the "透传到请求组装" contract;
 *   - assertDelegationCapabilities: asserts the hard error path when a resolved
 *     feature demands a transport capability the provider lacks — the
 *     "无 capability 时的错误路径" contract.
 */
import { describe, it, expect } from 'vitest';
import {
  assertDelegationCapabilities,
  buildSubagentRequest,
} from '../src/delegation-tool.js';

const textBlocks = (t: string) => [{ type: 'text' as const, text: t }];
const parent = { id: 'agent-1' };

describe('buildSubagentRequest (agentPreset 透传到请求组装)', () => {
  it('propagates agentPreset when the role resolved one', () => {
    const request = buildSubagentRequest({
      description: 'review',
      prompt: textBlocks('review it'),
      parent,
      agentPreset: 'reviewer',
    });
    expect(request).toMatchObject({
      prompt: textBlocks('review it'),
      parent,
      agentPreset: 'reviewer',
    });
  });

  it('omits agentPreset when the role resolved none', () => {
    const request = buildSubagentRequest({
      description: 'bare',
      prompt: textBlocks('go'),
      parent,
    });
    expect(request).not.toHaveProperty('agentPreset');
    expect(request).not.toHaveProperty('agentOptions');
    expect(request).not.toHaveProperty('maxDepth');
    expect(request).toEqual({ prompt: textBlocks('go'), parent });
  });

  it('carries agentOptions and maxDepth alongside agentPreset when present', () => {
    const request = buildSubagentRequest({
      description: 'full',
      prompt: textBlocks('x'),
      parent,
      agentOptions: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
      agentPreset: 'reviewer',
      maxDepth: 2,
    });
    expect(request.agentOptions).toEqual({ provider: 'opencode-go', model: 'deepseek-v4-flash' });
    expect(request.agentPreset).toBe('reviewer');
    expect(request.maxDepth).toBe(2);
  });

  it('round-trips an undefined agentOptions out of the body (zero intrusion)', () => {
    const request = buildSubagentRequest({
      description: 'inherit',
      prompt: textBlocks('y'),
      parent,
      agentOptions: undefined,
    });
    expect(request).not.toHaveProperty('agentOptions');
  });

  it('never emits the removed persona/toolFilter request fields', () => {
    const request = buildSubagentRequest({
      description: 'legacy',
      prompt: textBlocks('z'),
      parent,
      agentPreset: 'reviewer',
    });
    expect(request).not.toHaveProperty('persona');
    expect(request).not.toHaveProperty('toolFilter');
  });
});

describe('assertDelegationCapabilities (无 capability 时的错误路径)', () => {
  const yes = { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true };
  const noPreset = { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true };
  const noDepth = { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: false };

  it('does not throw when every resolved feature has a supported capability', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        agentPreset: 'reviewer',
        capabilities: yes,
        inheritsParentContext: false,
        maxDepth: 2,
      }),
    ).not.toThrow();
  });

  it('throws a hard error when the provider lacks the agentPreset capability', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        agentPreset: 'reviewer',
        capabilities: noPreset,
      }),
    ).toThrow(/does not support independent preset selection/);
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        agentPreset: 'reviewer',
        capabilities: noPreset,
      }),
    ).toThrow(/spawn/);
  });

  it('throws when an inheriting provider cannot select an independent preset', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'fork',
        agentPreset: 'reviewer',
        capabilities: yes,
        inheritsParentContext: true,
      }),
    ).toThrow(/does not support independent preset selection/);
  });

  it('does not gate agentPreset when the role resolved none even if capability is missing', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'fork',
        agentPreset: undefined,
        capabilities: noPreset,
        inheritsParentContext: true,
      }),
    ).not.toThrow();
  });

  it('throws a depthLimit error when maxDepth is numeric but the provider cannot enforce it', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        capabilities: noDepth,
        maxDepth: 3,
      }),
    ).toThrow(/maxDepth/);
  });

  it('accepts provider-managed maxDepth (no numeric budget to enforce)', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        capabilities: noDepth,
        maxDepth: 'provider-managed',
      }),
    ).not.toThrow();
    expect(() =>
      assertDelegationCapabilities({ providerName: 'spawn', capabilities: noDepth }),
    ).not.toThrow();
  });
});

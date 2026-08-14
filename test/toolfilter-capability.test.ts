/**
 * Unit tests for the toolFilter capability path (design section 7.3 / FR-8.1).
 *
 * The two pure helpers extracted from delegation-tool.execute cover the parts
 * that were previously untestable without a live DSH context:
 *   - buildSubagentRequest: asserts that a role-resolved toolFilter (and
 *     persona / agentOptions / maxDepth) propagate into the assembled
 *     SubagentStartRequest body only when present — the "透传到请求组装" contract;
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

describe('buildSubagentRequest (toolFilter 透传到请求组装)', () => {
  it('propagates toolFilter when the role resolved one', () => {
    const request = buildSubagentRequest({
      description: 'review',
      prompt: textBlocks('review it'),
      parent,
      persona: 'You are a reviewer.',
      toolFilter: { allow: ['apply_patch'], deny: ['bash'] },
    });
    expect(request).toMatchObject({
      label: 'review',
      prompt: textBlocks('review it'),
      parent,
      persona: 'You are a reviewer.',
      toolFilter: { allow: ['apply_patch'], deny: ['bash'] },
    });
  });

  it('omits toolFilter (and persona) when the role resolved none', () => {
    const request = buildSubagentRequest({
      description: 'bare',
      prompt: textBlocks('go'),
      parent,
    });
    expect(request).not.toHaveProperty('toolFilter');
    expect(request).not.toHaveProperty('persona');
    expect(request).not.toHaveProperty('agentOptions');
    expect(request).not.toHaveProperty('maxDepth');
    expect(request).toEqual({ label: 'bare', prompt: textBlocks('go'), parent });
  });

  it('carries agentOptions and maxDepth alongside toolFilter when present', () => {
    const request = buildSubagentRequest({
      description: 'full',
      prompt: textBlocks('x'),
      parent,
      agentOptions: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
      toolFilter: { deny: ['kill'] },
      maxDepth: 2,
    });
    expect(request.agentOptions).toEqual({ provider: 'opencode-go', model: 'deepseek-v4-flash' });
    expect(request.toolFilter).toEqual({ deny: ['kill'] });
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
});

describe('assertDelegationCapabilities (无 capability 时的错误路径)', () => {
  const yes = { persona: true, toolFilter: true, depthLimit: true };
  const noToolFilter = { persona: true, toolFilter: false, depthLimit: true };
  const noPersona = { persona: false, toolFilter: true, depthLimit: true };
  const noDepth = { persona: true, toolFilter: true, depthLimit: false };

  it('does not throw when every resolved feature has a supported capability', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        persona: 'reviewer',
        toolFilter: { allow: ['x'] },
        capabilities: yes,
        maxDepth: 2,
      }),
    ).not.toThrow();
  });

  it('throws a hard toolFilter error when the provider lacks the toolFilter capability', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        toolFilter: { allow: ['x'] },
        capabilities: noToolFilter,
      }),
    ).toThrow(/role binds a tool filter/);
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        toolFilter: { allow: ['x'] },
        capabilities: noToolFilter,
      }),
    ).toThrow(/spawn/);
  });

  it('does not gate toolFilter when the role resolved none even if capability is missing', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        toolFilter: undefined,
        capabilities: noToolFilter,
      }),
    ).not.toThrow();
  });

  it('throws a hard persona error when the provider lacks the persona capability', () => {
    expect(() =>
      assertDelegationCapabilities({
        providerName: 'spawn',
        persona: 'reviewer',
        capabilities: noPersona,
      }),
    ).toThrow(/role binds a persona/);
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

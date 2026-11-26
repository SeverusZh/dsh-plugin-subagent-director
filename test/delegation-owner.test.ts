/**
 * Regression test for issue #10 and the 0.2.2 flat activation spec: the
 * background delegation path must hand the exact live parent Agent and the
 * whole request body at the top level of `SubagentActivationSpec`. The old
 * `request` wrapper is not part of the 0.2.2+ host contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createDelegationTool } from '../src/delegation-tool.js';
import { clearResidentHandles, closeResident } from '../src/resident-handles.js';

describe('delegation background owner (issue #10, 0.2.x startActivation)', () => {
  beforeEach(() => {
    clearResidentHandles();
  });

  it('passes the calling parent and request body at the flat activation spec', async () => {
    const activations: Array<{
      provider: string;
      label: string;
      delivery: string;
      parent: unknown;
      prompt: unknown;
      maxDepth?: number;
      signal: AbortSignal;
      request?: unknown;
    }> = [];
    const ctx = {
      get(key: string) {
        if (key === 'llm') return undefined;
        if (key === 'settings') return undefined;
        return undefined;
      },
      subagents: {
        startActivation: async (spec: {
          provider: string;
          label: string;
          delivery: string;
          parent: unknown;
          prompt: unknown;
          maxDepth?: number;
          signal: AbortSignal;
          request?: unknown;
        }) => {
          activations.push({
            provider: spec.provider,
            label: spec.label,
            delivery: spec.delivery,
            parent: spec.parent,
            prompt: spec.prompt,
            maxDepth: spec.maxDepth,
            signal: spec.signal,
            request: spec.request,
          });
          return { childId: 'child-session-1', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} };
        },
      },
      logger: { info() {}, warn() {} },
    } as unknown as Context;

    const parentAgent = { id: 'parent-session-1', options: {} };
    const provider = {
      name: 'spawn',
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      // No prepareContinuable → one-shot external child → 'background' kind.
    };

    const tool = createDelegationTool({
      ctx,
      config: { subagentProvider: 'spawn', backgroundMode: 'one-shot', enableRunInBackground: true, maxDepth: 2 },
      provider: provider as never,
      getSettings: () => ({}),
    });

    const exec = {
      agent: parentAgent,
      signal: new AbortController().signal,
    };

    const result = await tool.execute(
      { description: 'demo task', prompt: 'do it', run_in_background: true },
      exec as never,
    );

    expect(result).toEqual({ kind: 'background', jobId: 'child-session-1' });
    expect(activations).toHaveLength(1);
    expect(activations[0].provider).toBe('spawn');
    expect(activations[0].label).toBe('demo task');
    expect(activations[0].delivery).toBe('parent');
    expect(activations[0].parent).toBe(parentAgent);
    expect(activations[0].prompt).toEqual([{ type: 'text', text: 'do it' }]);
    expect(activations[0].maxDepth).toBe(2);
    expect(activations[0].request).toBeUndefined();
    expect(activations[0].signal).toBe(exec.signal);
  });

  it('tracks the activation receipt when the provider supports prepareContinuable', async () => {
    const dispose = vi.fn(async () => {});
    const ctx = {
      get: () => undefined,
      subagents: {
        startActivation: async () => ({
          childId: 'child-session-2',
          result: Promise.resolve({ stopReason: 'completed', output: [] }),
          dispose,
        }),
      },
      logger: { info() {}, warn() {} },
    } as unknown as Context;

    const parentAgent = { id: 'parent-session-2', options: {} };
    const provider = {
      name: 'spawn',
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      prepareContinuable: async () => ({}),
    };

    const tool = createDelegationTool({
      ctx,
      config: { subagentProvider: 'spawn', backgroundMode: 'continuable', enableRunInBackground: true },
      provider: provider as never,
      getSettings: () => ({}),
    });

    const result = await tool.execute(
      { description: 'demo task', prompt: 'do it' },
      { agent: parentAgent, signal: new AbortController().signal } as never,
    );

    expect(result).toEqual({ kind: 'continuable', subagentId: 'child-session-2' });
    await expect(closeResident('parent-session-2', 'child-session-2')).resolves.toBe('closed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

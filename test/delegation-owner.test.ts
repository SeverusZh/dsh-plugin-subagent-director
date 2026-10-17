/**
 * Regression test for issue #10 (re-expressed on the 0.2.x startActivation
 * seam): the background delegation path must hand the exact live parent Agent
 * to the activation request (`request.parent`), and the runtime derives the
 * durable owner from it. The old jobs.start `owner: parent.id` string contract
 * is superseded — startActivation carries the parent Agent object and the
 * subagent runtime fences ownership by it.
 *
 * This test pins the background (delivery 'parent') spec shape: provider,
 * label, request.parent (the calling agent), signal, and delivery.
 */
import { describe, it, expect } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createDelegationTool } from '../src/delegation-tool.js';

describe('delegation background owner (issue #10, 0.2.x startActivation)', () => {
  it('passes the calling parent Agent to startActivation request.parent and returns the child id', async () => {
    const activations: Array<{
      provider: string;
      label: string;
      delivery: string;
      parent: unknown;
      signal: AbortSignal;
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
          request: { parent: unknown };
          signal: AbortSignal;
        }) => {
          activations.push({
            provider: spec.provider,
            label: spec.label,
            delivery: spec.delivery,
            parent: spec.request.parent,
            signal: spec.signal,
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
      config: { subagentProvider: 'spawn', backgroundMode: 'one-shot', enableRunInBackground: true },
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
    // The exact live parent Agent is handed to the request (the runtime fences
    // ownership by it); its id is the durable owner address.
    expect(activations[0].parent).toBe(parentAgent);
    expect(typeof (activations[0].parent as { id: string }).id).toBe('string');
    expect((activations[0].parent as { id: string }).id).toBe('parent-session-1');
    expect(activations[0].signal).toBe(exec.signal);
  });

  it('returns the continuable kind when the provider supports prepareContinuable', async () => {
    const ctx = {
      get: () => undefined,
      subagents: {
        startActivation: async () => ({
          childId: 'child-session-2',
          result: Promise.resolve({ stopReason: 'completed', output: [] }),
          dispose: async () => {},
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
  });
});

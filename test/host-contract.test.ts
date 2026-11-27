/**
 * Host-contract probe for the DSH 0.2.2+ activation seam.
 *
 * Unit tests that mock `ctx.subagents` cannot catch a host API drift: the
 * 0.6.0 suite passed while every real 0.2.2 call crashed because its fake
 * service still accepted the removed `request` wrapper. This test imports the
 * real `SubagentRuntime` and drives its public `startActivation` method with a
 * stubbed manager, so the checked shape is the installed host's shape. The
 * instance is assembled with the runtime's private provider/manager fields;
 * this is an intentional host-contract probe, not a production usage pattern.
 */
import { describe, it, expect } from 'vitest';
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent';

function runtimeProbe() {
  const parent = { id: 'parent-1' };
  const calls: Array<Record<string, unknown>> = [];
  const provider = {
    name: 'spawn',
    capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
    inheritsParentContext: false,
    start: async () => ({}),
  };
  const runtime = Object.create(SubagentRuntime.prototype) as {
    providers: Map<string, unknown>;
    ctx: { get(name: string): unknown };
    manager: { startExternal(spec: Record<string, unknown>): Promise<unknown> };
    startActivation(spec: Record<string, unknown>): Promise<{ childId: string }>;
  };
  runtime.providers = new Map([['spawn', provider]]);
  runtime.ctx = {
    get: (name: string) =>
      name === 'agents' ? { get: (id: string) => (id === parent.id ? parent : undefined) } : undefined,
  };
  runtime.manager = {
    startExternal: async (spec) => {
      calls.push(spec);
      return {
        childId: 'child-1',
        name: 'agent-1',
        result: Promise.resolve({ stopReason: 'completed', output: [] }),
        dispose: async () => {},
      };
    },
  };
  return { runtime, parent, calls };
}

describe('host contract: SubagentActivationSpec is flat on DSH 0.2.2+', () => {
  it('rejects the removed wrapped request shape before reaching the manager', async () => {
    const { runtime, parent, calls } = runtimeProbe();
    await expect(
      runtime.startActivation({
        provider: 'spawn',
        label: 'probe',
        request: { prompt: [], parent },
        signal: new AbortController().signal,
        delivery: 'caller',
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('accepts prompt and parent at the spec top level', async () => {
    const { runtime, parent, calls } = runtimeProbe();
    const signal = new AbortController().signal;
    const activation = await runtime.startActivation({
      provider: 'spawn',
      label: 'probe',
      prompt: [{ type: 'text', text: 'hello' }],
      parent,
      agentPreset: 'standard',
      maxDepth: 1,
      signal,
      delivery: 'caller',
    });

    expect(activation.childId).toBe('child-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].parent).toBe(parent);
    expect(calls[0].prompt).toEqual([{ type: 'text', text: 'hello' }]);
    expect(calls[0].agentPreset).toBe('standard');
    expect(calls[0].maxDepth).toBe(1);
    expect(calls[0].request).toBeUndefined();
  });
});

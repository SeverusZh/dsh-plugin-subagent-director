/**
 * Real-Cordis lifecycle probe: a Director agent gets the card-required
 * delegation shadow, the work-tool restriction, and the default Team selection;
 * switching the blank session to standard removes all three.
 */
import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply, Config, inject, name } from '../src/index.js';
import { createMemoryDomain } from './card-fixtures.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

describe('Director preset lifecycle', () => {
  it('mounts and removes Director-only tools, restrictions, and Team defaults on preset switches', async () => {
    const ctx = new Context();
    const memory = createMemoryDomain();
    const hostTools: string[] = [];
    const shadowTools: Array<{ name: string; parameters: { required?: string[] } }> = [];
    const restrictions: Array<{ allow?: string[]; deny?: string[] }> = [];
    let shadowDisposed = 0;
    let restrictionDisposed = 0;
    let teamEnabled = false;
    let currentPreset = 'director';

    const provider = {
      name: 'spawn',
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      prepareContinuable: async () => ({}),
    };
    const agent = {
      id: 'agent-1',
      session: { header: {}, snapshotEvents: () => [] },
      ctx: {
        tools: {
          register: (definition: { name: string; parameters: { required?: string[] } }) => {
            shadowTools.push(definition);
            return () => {
              shadowDisposed += 1;
            };
          },
          definitions: () => [{ name: 'bash' }, { name: 'read' }, { name: 'subagent_role' }],
          restrict: (filter: { allow?: string[]; deny?: string[] }) => {
            restrictions.push(filter);
            return () => {
              restrictionDisposed += 1;
            };
          },
        },
      },
    };

    ctx.provide('storageDomain', memory.facility as never);
    ctx.provide('tools', {
      register: (definition: { name: string }) => {
        hostTools.push(definition.name);
        return () => {};
      },
      restrict: () => () => {},
      guard: () => () => {},
      definitions: () => [{ name: 'bash' }],
    } as never);
    ctx.provide('subagents', {
      getProvider: (name: string) => (name === 'spawn' ? provider : undefined),
      startActivation: async () => ({ childId: 'x', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }),
    } as never);
    ctx.provide('llm', { listProviders: () => [{ id: 'p' }] });
    ctx.provide('settings', { configure: () => () => {}, describe: () => [], mutate: async () => {} } as never);
    ctx.provide('agents', { list: () => [], get: (id: string) => (id === 'agent-1' ? agent : undefined) } as never);
    ctx.provide('agentTeams', {
      setEnabled: async (_agent: unknown, enabled: boolean) => {
        teamEnabled = enabled;
      },
    } as never);
    ctx.provide('agentPresets', {
      register: async () => async () => {},
      composedPreset: () => currentPreset,
      presetForSession: () => currentPreset,
    } as never);

    void ctx.plugin({ name, inject, apply, Config }, {});
    await settle();
    expect(hostTools).toContain('subagent_role');

    await ctx.emit('agent/created', { agent, source: 'startup' } as never);
    await settle();
    const shadow = shadowTools.find((tool) => tool.name === 'subagent_role');
    expect(shadow).toBeDefined();
    expect(shadow?.parameters.required).toContain('role');
    expect(restrictions).toHaveLength(1);
    expect(teamEnabled).toBe(true);

    currentPreset = 'standard';
    await ctx.emit('agent-preset/selected', 'agent-1', 'standard');
    await settle();
    expect(shadowDisposed).toBe(1);
    expect(restrictionDisposed).toBe(1);
    expect(teamEnabled).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createDelegationTool } from '../src/delegation-tool.js';
import { CardService } from '../src/card-store.js';
import type { CardService as CardServiceType } from '../src/card-store.js';
import { createCardService } from './card-fixtures.js';

interface Call {
  childId?: string;
  prompt: Array<{ type: string; text?: string }>;
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
  agentPreset?: string;
  provider?: string;
  delivery: string;
  promptAtStart: string;
}

function harness(options: {
  providerName?: string;
  continuable?: boolean;
  card?: Record<string, unknown>;
  requireRole?: boolean;
  defaultWorkerPreset?: string;
  includeBuiltInCards?: boolean;
  directorGuard?: boolean;
  agentPresetCapability?: boolean;
}) {
  const cardsCreated = createCardService();
  const cards = cardsCreated.service;
  const calls: Call[] = [];
  const providerName = options.providerName ?? 'spawn';
  const provider = {
    name: providerName,
    capabilities: {
      agentOptions: true,
      agentPreset: options.agentPresetCapability === true,
      outputSchema: false,
      depthLimit: false,
    },
    inheritsParentContext: providerName === 'fork',
    ...(options.continuable === true ? { prepareContinuable: async () => ({}) } : {}),
  };
  const activation = (spec: { childId?: string }) => ({
    childId: spec.childId ?? 'generated-child',
    name: 'agent-1',
    result: Promise.resolve({ stopReason: 'completed' as const, output: [] }),
    dispose: async () => {},
  });
  const startActivation = async (spec: {
    childId?: string;
    provider?: string;
    delivery: string;
    prompt: Array<{ type: string; text?: string }>;
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    agentPreset?: string;
  }) => {
    calls.push({
      ...(spec.provider !== undefined ? { provider: spec.provider } : {}),
      ...(spec.childId !== undefined ? { childId: spec.childId } : {}),
      prompt: spec.prompt,
      ...(spec.agentOptions !== undefined ? { agentOptions: spec.agentOptions } : {}),
      ...(spec.agentPreset !== undefined ? { agentPreset: spec.agentPreset } : {}),
      delivery: spec.delivery,
      promptAtStart: spec.childId === undefined ? '' : cards.bindingText(spec.childId),
    });
    return activation(spec);
  };
  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    get: (name: string) => {
      if (name === 'llm') return { listProviders: () => [{ id: 'p' }] };
      if (name === 'settings') {
        return {
          describe: () => [
            {
              ns: 'subagent-model-selection-settings',
              value: { enabled: true, allowedModels: [{ provider: 'p', model: 'm' }] },
            },
          ],
        };
      }
      return undefined;
    },
    subagents: {
      startActivation,
      getProvider: (name: string) => {
        if (name === providerName) return provider;
        if (name !== 'spawn') return undefined;
        return {
          name: 'spawn',
          capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
          inheritsParentContext: false,
          prepareContinuable: async () => ({}),
        };
      },
    },
  } as never;
  const config = {
    subagentProvider: providerName,
    toolName: 'subagent_role',
    enableRunInBackground: true,
    backgroundMode: options.continuable === true ? ('continuable' as const) : ('one-shot' as const),
  };
  const tool = createDelegationTool({
    ctx,
    config,
    provider: provider as never,
    getSettings: () => cards.settingsWithCards({}, { includeBuiltIn: options.includeBuiltInCards === true }),
    cards: cards as CardServiceType,
    requireRole: options.requireRole === true,
    defaultWorkerPreset: options.defaultWorkerPreset,
    includeBuiltInCards: options.includeBuiltInCards === true,
    directorGuard: options.directorGuard === true ? () => true : undefined,
  });
  const exec = {
    agent: { id: 'parent-1', options: { provider: 'p', model: 'm' } },
    signal: new AbortController().signal,
  } as never;
  return { cards, calls, tool, exec };
}

beforeEach(() => {});

describe('character-card delegation', () => {
  it('reserves a child id, injects the fixed prompt as a binding, and cleans up a foreground run', async () => {
    const h = harness({});
    await h.cards.ready();
    await h.cards.put(
      {
        id: 'reviewer',
        name: 'Reviewer',
        delegationGuidance: 'Review work.',
        systemPrompt: 'You are a reviewer.',
        persona: 'Terse.',
        model: { provider: 'p', model: 'm', reasoningEffort: 'high' },
      },
      { create: true },
    );
    const result = await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'review', prompt: 'Do the work', role: 'reviewer', run_in_background: false },
      h.exec,
    );
    expect(result).toMatchObject({ kind: 'foreground' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.childId).toBeDefined();
    expect(h.calls[0]?.childId).not.toBe('generated-child');
    expect(h.cards.bindingText(h.calls[0]!.childId!)).toBe('');
    expect(h.calls[0]?.promptAtStart).toContain('Character card: Reviewer');
    expect(h.calls[0]?.promptAtStart).toContain('You are a reviewer.');
    expect(h.calls[0]?.agentOptions).toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' });
    expect(h.calls[0]?.prompt[0]?.text).toBe('Do the work');
  });

  it('keeps a continuable binding after a background start', async () => {
    const h = harness({ continuable: true });
    await h.cards.ready();
    await h.cards.put(
      { id: 'reviewer', name: 'Reviewer', delegationGuidance: 'Review.', systemPrompt: 'Prompt.' },
      { create: true },
    );
    const result = await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'review', prompt: 'Do the work', role: 'reviewer' },
      h.exec,
    );
    expect(result).toMatchObject({ kind: 'continuable' });
    const childId = h.calls[0]?.childId;
    expect(childId).toBeDefined();
    expect(h.cards.bindingText(childId!)).toContain('Prompt.');
    await h.cards.endBinding(childId!);
    expect(h.cards.bindingText(childId!)).toBe('');
  });

  it('appends the card prompt to the task when the transport cannot reserve a child id', async () => {
    const h = harness({ providerName: 'acp' });
    await h.cards.ready();
    await h.cards.put(
      { id: 'reviewer', name: 'Reviewer', delegationGuidance: 'Review.', systemPrompt: 'Prompt.' },
      { create: true },
    );
    await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'review', prompt: 'Do the work', role: 'reviewer', run_in_background: false },
      h.exec,
    );
    expect(h.calls[0]?.childId).toBeUndefined();
    expect(h.calls[0]?.prompt[0]?.text).toContain('Do the work');
    expect(h.calls[0]?.prompt[0]?.text).toContain('Character card: Reviewer');
    expect(h.cards.bindingCount()).toBe(0);
  });

  it('does not create a prompt binding when a pre-start validation rejects', async () => {
    const h = harness({});
    await h.cards.ready();
    await h.cards.put(
      { id: 'preset-card', name: 'Preset Card', delegationGuidance: 'Guide.', systemPrompt: 'Prompt.', agentPreset: 'missing-preset' },
      { create: true },
    );
    await expect(
      (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'preset', prompt: 'Work', role: 'preset-card', run_in_background: false },
        h.exec,
      ),
    ).rejects.toThrow(/does not support independent preset selection/);
    expect(h.cards.bindingCount()).toBe(0);
  });

  it('requires a character card in Director mode', async () => {
    const h = harness({
      directorGuard: true,
      agentPresetCapability: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    await expect(
      (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'direct', prompt: 'Work', run_in_background: false },
        h.exec,
      ),
    ).rejects.toThrow(/Director Mode requires a character card/);
  });

  it('rejects an unknown card in Director mode with the card creation hint', async () => {
    const h = harness({
      requireRole: true,
      agentPresetCapability: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    await expect(
      (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'missing', prompt: 'Work', role: 'ghost', run_in_background: false },
        h.exec,
      ),
    ).rejects.toThrow(/subagent_card_create/);
  });

  it('falls a card without agentPreset back to the Director worker preset', async () => {
    const h = harness({
      requireRole: true,
      agentPresetCapability: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    await h.cards.put(
      { id: 'worker', name: 'Worker', delegationGuidance: 'Work.', systemPrompt: 'Do the work.' },
      { create: true },
    );
    await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'work', prompt: 'Do the work', role: 'worker', run_in_background: false },
      h.exec,
    );
    expect(h.calls[0]?.agentPreset).toBe('standard');
  });

  it('rejects legacy roles in Director mode even when the role template exists', async () => {
    const h = harness({
      requireRole: true,
      agentPresetCapability: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    const legacy = { roles: { legacy: { displayName: 'Legacy', description: 'Old.' } } };
    const tool = createDelegationTool({
      ctx: {
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
        get: (name: string) => {
          if (name === 'llm') return { listProviders: () => [{ id: 'p' }] };
          if (name === 'settings') return { describe: () => [] };
          return undefined;
        },
        subagents: {
          startActivation: async () => ({
            childId: 'x',
            result: Promise.resolve({ stopReason: 'completed', output: [] }),
            dispose: async () => {},
          }),
        },
      } as never,
      config: { subagentProvider: 'spawn', toolName: 'subagent_role', backgroundMode: 'one-shot' },
      provider: {
        name: 'spawn',
        capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: false },
        inheritsParentContext: false,
        prepareContinuable: async () => ({}),
      } as never,
      getSettings: () => h.cards.settingsWithCards(legacy, { includeBuiltIn: true }),
      cards: h.cards,
      requireRole: true,
      includeBuiltInCards: true,
    });
    await expect(
      (tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'legacy', prompt: 'Work', role: 'legacy', run_in_background: false },
        h.exec,
      ),
    ).rejects.toThrow(/only delegates to character cards/);
  });

  it('fails closed when Director card storage is unavailable', async () => {
    const offline = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
    });
    await offline.ready();
    const tool = createDelegationTool({
      ctx: {
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
        get: (name: string) => {
          if (name === 'llm') return { listProviders: () => [{ id: 'p' }] };
          if (name === 'settings') return { describe: () => [] };
          return undefined;
        },
        subagents: {
          startActivation: async () => ({
            childId: 'x',
            result: Promise.resolve({ stopReason: 'completed', output: [] }),
            dispose: async () => {},
          }),
        },
      } as never,
      config: { subagentProvider: 'spawn', toolName: 'subagent_role', backgroundMode: 'one-shot' },
      provider: {
        name: 'spawn',
        capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: false },
        inheritsParentContext: false,
        prepareContinuable: async () => ({}),
      } as never,
      getSettings: () => ({}),
      cards: offline,
      directorGuard: () => true,
    });
    await expect(
      (tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'offline', prompt: 'Work', role: 'anything', run_in_background: false },
        { agent: { id: 'parent-1', options: {} }, signal: new AbortController().signal } as never,
      ),
    ).rejects.toThrow(/requires character-card storage/);
  });

  it('uses the spawn-like Director transport when the mounted provider inherits context', async () => {
    const h = harness({
      providerName: 'fork',
      directorGuard: true,
      agentPresetCapability: false,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    await h.cards.put(
      { id: 'worker', name: 'Worker', delegationGuidance: 'Work.', systemPrompt: 'Do the work.' },
      { create: true },
    );
    await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'work', prompt: 'Do the work', role: 'worker', run_in_background: false },
      h.exec,
    );
    expect(h.calls[0]?.provider).toBe('spawn');
    expect(h.calls[0]?.agentPreset).toBe('standard');
  });

  it('uses the Director transport for background delegation too', async () => {
    const h = harness({
      providerName: 'fork',
      continuable: true,
      directorGuard: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    await h.cards.put(
      { id: 'worker', name: 'Worker', delegationGuidance: 'Work.', systemPrompt: 'Do the work.' },
      { create: true },
    );
    const result = await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'work', prompt: 'Do the work', role: 'worker' },
      h.exec,
    );
    expect(result).toMatchObject({ kind: 'continuable' });
    expect(h.calls[0]?.provider).toBe('spawn');
  });

  it('resolves the built-in Director card only in Director mode', async () => {
    const h = harness({
      requireRole: true,
      agentPresetCapability: true,
      defaultWorkerPreset: 'standard',
      includeBuiltInCards: true,
    });
    await h.cards.ready();
    expect(h.cards.get('director')).toBeUndefined();
    await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'direct', prompt: 'Coordinate this', role: 'director', run_in_background: false },
      h.exec,
    );
    expect(h.calls[0]?.agentPreset).toBe('director');
    expect(h.calls[0]?.promptAtStart).toContain('built-in Director character card');
  });

  it('omits the child id when the card has no fixed prompt', async () => {
    const h = harness({});
    await h.cards.ready();
    await h.cards.put({ id: 'plain', name: 'Plain', delegationGuidance: 'No prompt.' }, { create: true });
    await (h.tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
      { description: 'plain', prompt: 'Work', role: 'plain', run_in_background: false },
      h.exec,
    );
    expect(h.calls[0]?.childId).toBeUndefined();
    expect(h.cards.bindingCount()).toBe(0);
  });
});


describe('character-card storage readiness', () => {
  it('fails an explicit role when card storage is not ready instead of silently dropping the card', async () => {
    const offline = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
    const ctx = {
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
      get: (name: string) => {
        if (name === 'llm') return { listProviders: () => [{ id: 'p' }] };
        if (name === 'settings') return { describe: () => [] };
        return undefined;
      },
      subagents: { startActivation: async () => ({ childId: 'x', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }) },
    } as never;
    const tool = createDelegationTool({
      ctx,
      config: { subagentProvider: 'spawn', toolName: 'subagent_role', backgroundMode: 'one-shot' },
      provider: {
        name: 'spawn',
        capabilities: {
          agentOptions: true,
          agentPreset: false,
          outputSchema: false,
          depthLimit: false,
        },
        inheritsParentContext: false,
        prepareContinuable: async () => ({}),
      } as never,
      getSettings: () => ({}),
      cards: offline,
    });
    await expect(
      (tool as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { description: 'offline', prompt: 'Work', role: 'missing', run_in_background: false },
        { agent: { id: 'parent-1', options: { provider: 'p', model: 'm' } }, signal: new AbortController().signal } as never,
      ),
    ).rejects.toThrow(/card storage is unavailable/);
  });
});

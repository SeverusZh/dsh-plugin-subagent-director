/**
 * Real-host integration probe: the main plugin entry mounted beside the real
 * storage domain and the real system-prompt registry. It proves the two seams
 * that unit fakes cannot:
 *   - the card repository opens its production per-record JSON domain; and
 *   - a binding written before the child starts renders through the real
 *     `systemPrompt.assemble()` for exactly that child session.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { apply as applyJson, Config as JsonConfig, inject as jsonInject, name as jsonName } from '@deepseek-ai/dsh-storage-json';
import { apply as applyDomain, Config as DomainConfig, inject as domainInject, name as domainName } from '@deepseek-ai/dsh-storage-domain';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { name as pluginName, inject as pluginInject, apply, Config } from '../src/index.js';
import type { CardService } from '../src/card-store.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

let root: string;
let ctx: Context;
let cards: CardService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sd-host-probe-'));
  ctx = new Context();
  ctx.plugin(Storage);
  ctx.plugin({ name: jsonName, inject: jsonInject, apply: applyJson, Config: JsonConfig }, { root });
  ctx.plugin({ name: domainName, inject: domainInject, apply: applyDomain, Config: DomainConfig }, { backend: 'json' });
  ctx.provide('sessionProjections', { register: async () => ({ stateOf: () => undefined }) } as never);
  ctx.plugin(SystemPrompt);

  const provider = {
    name: 'spawn',
    capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: async () => ({}),
  };
  ctx.provide('tools', { register: () => () => {} });
  ctx.provide('subagents', {
    getProvider: (name: string) => (name === 'spawn' ? provider : undefined),
    startActivation: async () => ({ childId: 'generated', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }),
  } as never);
  ctx.provide('llm', { listProviders: () => [{ id: 'p' }] });
  ctx.provide('settings', {
    configure: () => () => {},
    describe: () => [],
    mutate: async () => {},
  } as never);

  for (let i = 0; i < 40 && (ctx as unknown as { get(name: string): unknown }).get('systemPrompt') === undefined; i += 1) await settle();
  void ctx.plugin({ name: pluginName, inject: pluginInject, apply, Config }, {});
  await settle();

  const service = (ctx as unknown as { get(name: string): unknown }).get('subagentDirectorCards') as CardService | undefined;
  expect(service).toBeDefined();
  cards = service!;
  for (let i = 0; i < 60 && cards.status().state !== 'ready'; i += 1) await settle();
  expect(cards.status().state).toBe('ready');
});

afterAll(async () => {
  await cards?.dispose();
  await rm(root, { recursive: true, force: true });
});

describe('real host integration probe', () => {
  it('persists a card to disk and renders its binding through the real prompt registry', async () => {
    await cards.put(
      {
        id: 'probe-card',
        name: 'Probe Card',
        delegationGuidance: 'Use the probe.',
        systemPrompt: 'REAL SYSTEM PROMPT {{literal}}',
        persona: 'REAL PERSONA',
      },
      { create: true },
    );

    const file = join(root, 'subagent_director', 'cards', 'probe-card.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as { record: { systemPrompt: string } };
    expect(stored.record.systemPrompt).toBe('REAL SYSTEM PROMPT {{literal}}');

    await cards.beginBinding({
      sessionId: 'child-probe',
      cardId: 'probe-card',
      cardName: 'Probe Card',
      systemPrompt: 'REAL SYSTEM PROMPT {{literal}}',
      persona: 'REAL PERSONA',
    });

    const systemPrompt = (ctx as unknown as { get(name: string): unknown }).get('systemPrompt') as {
      assemble(context: { session?: unknown }): Promise<{ sections: Array<{ name: string; text: string }> }>;
    };
    expect(cards.bindingText('child-probe')).toContain('REAL SYSTEM PROMPT');
    const assembly = await systemPrompt.assemble({ session: Session.create(SessionId('child-probe')) });
    const section = assembly.sections.find((entry) => entry.name === 'subagent-director:character-card');
    expect(section).toBeDefined();
    expect(section?.text).toContain('REAL SYSTEM PROMPT {{literal}}');
    expect(section?.text).toContain('REAL PERSONA');

    const other = await systemPrompt.assemble({ session: Session.create(SessionId('other-child')) });
    expect(other.sections.find((entry) => entry.name === 'subagent-director:character-card')?.text ?? '').toBe('');
  });
});

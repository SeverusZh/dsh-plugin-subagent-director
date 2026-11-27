/**
 * Real storage-domain probe: mount the actual storage hub, JSON backend, and
 * domain facility, then let the card repository open its domain. This proves
 * the production persistence shape — one JSON document per card under the
 * Host storage root — rather than only the in-memory test fake.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { apply as applyJson, Config as JsonConfig, inject as jsonInject, name as jsonName } from '@deepseek-ai/dsh-storage-json';
import { apply as applyDomain, Config as DomainConfig, inject as domainInject, name as domainName } from '@deepseek-ai/dsh-storage-domain';
import { CardService, CARD_DOMAIN_NAME, cardDomainSpec } from '../src/card-store.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

let root: string;
let ctx: Context;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sd-card-probe-'));
  ctx = new Context();
  ctx.plugin(Storage);
  ctx.plugin({ name: jsonName, inject: jsonInject, apply: applyJson, Config: JsonConfig }, { root });
  ctx.plugin({ name: domainName, inject: domainInject, apply: applyDomain, Config: DomainConfig }, { backend: 'json' });
  await settle();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('real storage domain probe', () => {
  it('writes one file per card and reloads it through a fresh domain handle', async () => {
    const facility = (ctx as unknown as { get(name: string): unknown }).get('storageDomain') as never;
    expect(facility).toBeDefined();

    const service = new CardService({
      ctx,
      getSettings: () => ({}),
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
    service.attachStorage(facility);
    await service.ready();
    expect(service.status().state).toBe('ready');

    await service.put(
      {
        id: 'probe-reviewer',
        name: 'Probe Reviewer',
        delegationGuidance: 'Review the probe.',
        systemPrompt: 'Fixed prompt.',
      },
      { create: true },
    );
    await service.setDefault('probe-reviewer');

    const file = join(root, CARD_DOMAIN_NAME, 'cards', 'probe-reviewer.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as { version: number; record: { id: string; name: string } };
    expect(stored.version).toBe(1);
    expect(stored.record.id).toBe('probe-reviewer');
    expect(stored.record.name).toBe('Probe Reviewer');

    await service.dispose();
    const reopened = await (facility as {
      open(spec: typeof cardDomainSpec): Promise<{
        table(name: string): { get(key: string): unknown };
        global: { get(): { defaultCardId?: string } };
      }>;
    }).open(cardDomainSpec);
    const record = reopened.table('cards').get('probe-reviewer') as { name: string } | undefined;
    expect(record?.name).toBe('Probe Reviewer');
    expect(reopened.global.get().defaultCardId).toBe('probe-reviewer');
  });
});

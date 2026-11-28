import { describe, it, expect, beforeEach } from 'vitest';
import { CardService } from '../src/card-store.js';
import { createCardService, card, type MemoryDomain } from './card-fixtures.js';
import type { SubagentDirectorSettings } from '../src/route-resolver.js';

let service: CardService;
let memory: MemoryDomain;

beforeEach(async () => {
  const created = createCardService();
  service = created.service;
  memory = created.memory;
  await service.ready();
});

describe('card repository', () => {
  it('creates, updates, and lists cards with managed timestamps', async () => {
    const created = await service.put(card('reviewer'), { create: true });
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
    expect(created.enabled).toBe(true);
    expect(service.list().map((entry) => entry.id)).toEqual(['reviewer']);

    const updated = await service.put({ ...created, name: 'Reviewer 2' }, { create: false });
    expect(updated.name).toBe('Reviewer 2');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeDefined();
    expect((memory.tables.get('cards')!.get('reviewer') as { name: string }).name).toBe('Reviewer 2');
  });

  it('rejects duplicate creation and updating a missing card', async () => {
    await service.put(card('a'), { create: true });
    await expect(service.put(card('a'), { create: true })).rejects.toThrow(/already exists/);
    await expect(service.put(card('missing'), { create: false })).rejects.toThrow(/does not exist/);
  });

  it('creates an id from the name when the draft omits it', async () => {
    const created = await service.put({ name: 'Named Card', delegationGuidance: 'Guide.' }, { create: true });
    expect(created.id).toBe('named-card');
  });

  it('tracks the default card and clears it when deleted or disabled', async () => {
    await service.put(card('a'), { create: true });
    await service.put(card('b'), { create: true });
    await service.setDefault('a');
    expect(service.defaultId()).toBe('a');

    await service.setEnabled(['a'], false);
    expect(service.defaultId()).toBeUndefined();

    await service.setEnabled(['a'], true);
    await service.setDefault('a');
    expect(service.defaultId()).toBe('a');

    await service.remove(['a']);
    expect(service.defaultId()).toBeUndefined();
    expect(service.list().map((entry) => entry.id)).toEqual(['b']);
  });

  it('rejects setting a missing default and reports unavailable storage', async () => {
    await expect(service.setDefault('ghost')).rejects.toThrow(/does not exist/);
    const offline = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
    });
    await offline.ready();
    expect(offline.status().state).toBe('unavailable');
    await expect(offline.put(card('a'), { create: true })).rejects.toThrow(/not available/);
  });
});

describe('card import and export', () => {
  it('supports skip, overwrite, and duplicate strategies', async () => {
    await service.put(card('a', { name: 'A' }), { create: true });

    const skip = await service.importCards(
      { kind: 'subagent-director/character-card-collection', version: 1, cards: [card('a', { name: 'A2' }), card('b')] },
      'skip',
    );
    expect(skip.skipped).toBe(1);
    expect(skip.imported).toBe(1);
    expect(service.get('a')?.name).toBe('A');

    const overwrite = await service.importCards([card('a', { name: 'A3' })], 'overwrite');
    expect(overwrite.overwritten).toBe(1);
    expect(service.get('a')?.name).toBe('A3');

    const duplicate = await service.importCards([card('a', { name: 'A4' })], 'duplicate');
    expect(duplicate.duplicated).toBe(1);
    expect(service.list().some((entry) => entry.name === 'A4')).toBe(true);
    expect(duplicate.cards[0]?.id).not.toBe('a');
  });

  it('reports invalid entries without failing the valid ones', async () => {
    const result = await service.importCards([{ name: '', delegationGuidance: 'x' }, card('ok')], 'skip');
    expect(result.imported).toBe(1);
    expect(result.issues).toHaveLength(1);
  });

  it('exports all or a selection as a versioned bundle', async () => {
    await service.put(card('a'), { create: true });
    await service.put(card('b'), { create: true });
    expect(service.exportCards().cards).toHaveLength(2);
    expect(service.exportCards(['a']).cards.map((entry) => entry.id)).toEqual(['a']);
    expect(service.exportCards(['missing']).cards).toHaveLength(0);
  });
});

describe('legacy migration', () => {
  it('migrates roles idempotently and promotes the legacy default role', async () => {
    const settings: SubagentDirectorSettings = {
      roles: {
        'legacy-one': {
          displayName: 'Legacy One',
          description: 'Old guidance.',
          persona: 'Old persona.',
          provider: 'p',
          model: 'm',
        },
      },
      defaultRole: 'legacy-one',
    };
    const created = createCardService(() => settings);
    await created.service.ready();
    const first = await created.service.migrateLegacy();
    expect(first.migrated).toEqual(['legacy-one']);
    expect(first.defaultCardId).toBe('legacy-one');
    expect(created.service.get('legacy-one')?.persona).toBe('Old persona.');
    expect(created.service.get('legacy-one')?.source).toBe('legacy');

    const second = await created.service.migrateLegacy();
    expect(second.migrated).toEqual([]);
    expect(second.skipped).toEqual(['legacy-one']);
  });

  it('projects cards over legacy roles and honours the default card', async () => {
    const settings: SubagentDirectorSettings = {
      roles: { legacy: { displayName: 'Legacy', description: 'Old.' } },
      defaultRole: 'legacy',
    };
    const created = createCardService(() => settings);
    await created.service.ready();
    await created.service.put(card('card-a', { name: 'Card A' }), { create: true });
    await created.service.setDefault('card-a');
    const merged = created.service.settingsWithCards();
    expect(merged.roles?.['card-a']?.displayName).toBe('Card A');
    expect(merged.roles?.legacy?.displayName).toBe('Legacy');
    expect(merged.defaultRole).toBe('card-a');

    await created.service.setEnabled(['card-a'], false);
    const disabled = created.service.settingsWithCards();
    expect(disabled.roles?.['card-a']).toBeUndefined();
    expect(disabled.defaultRole).toBe('legacy');
  });

  it('does not resurrect a same-id legacy role when its card is disabled', async () => {
    const settings: SubagentDirectorSettings = {
      roles: { 'same-id': { displayName: 'Legacy same-id', description: 'Old.' } },
    };
    const created = createCardService(() => settings);
    await created.service.ready();
    await created.service.put(card('same-id', { name: 'Card same-id' }), { create: true });
    expect(created.service.settingsWithCards().roles?.['same-id']?.displayName).toBe('Card same-id');
    await created.service.setEnabled(['same-id'], false);
    expect(created.service.settingsWithCards().roles?.['same-id']).toBeUndefined();
  });
});

describe('active prompt bindings', () => {
  it('stores, renders, persists, and removes a child binding', async () => {
    await service.beginBinding({
      sessionId: 'child-1',
      cardId: 'a',
      cardName: 'A',
      systemPrompt: 'System.',
      persona: 'Persona.',
      parentSessionId: 'parent-1',
      continuable: true,
    });
    expect(service.bindingText('child-1')).toContain('Character card: A');
    expect(service.bindingText('child-1')).toContain('Persona.');
    expect(service.bindingText('missing')).toBe('');
    expect(service.bindingCount()).toBe(1);

    await service.endBinding('child-1', { onlyEphemeral: true });
    expect(service.bindingCount()).toBe(1);
    await service.endBinding('child-1');
    expect(service.bindingCount()).toBe(0);

    await service.beginBinding({ sessionId: 'child-2', cardId: 'a', cardName: 'A', continuable: false });
    await service.endBinding('child-2', { onlyEphemeral: true });
    expect(service.bindingCount()).toBe(0);
  });

  it('serializes concurrent retries after a transient storage open failure', async () => {
    const memory = createCardService().memory;
    let opens = 0;
    const original = (memory.facility as unknown as { open(spec: unknown): Promise<unknown> }).open.bind(memory.facility);
    (memory.facility as unknown as { open(spec: unknown): Promise<unknown> }).open = async (spec) => {
      opens += 1;
      if (opens === 1) throw new Error('transient');
      return original(spec);
    };
    const recovering = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
    recovering.attachStorage(memory.facility);
    await recovering.ready();
    expect(recovering.status().state).toBe('error');
    await Promise.all([recovering.retry(), recovering.retry()]);
    expect(opens).toBe(2);
    expect(recovering.status().state).toBe('ready');
  });

  it('reloads persisted bindings into a fresh service', async () => {
    await service.beginBinding({ sessionId: 'child-1', cardId: 'a', cardName: 'A', persona: 'P' });
    const restarted = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
    restarted.attachStorage(memory.facility);
    await restarted.ready();
    expect(restarted.bindingText('child-1')).toContain('Persona:\nP');
  });
});

describe('built-in director card', () => {
  it('stays hidden unless the caller asks for Director visibility', async () => {
    expect(service.list().map((entry) => entry.id)).toEqual([]);
    expect(service.get('director')).toBeUndefined();
    expect(service.resolveCard('director')).toBeUndefined();

    const visible = service.list({ includeBuiltIn: true });
    expect(visible.map((entry) => entry.id)).toContain('director');
    expect(visible.find((entry) => entry.id === 'director')?.source).toBe('builtin');
    expect(service.get('director', { includeBuiltIn: true })?.name).toBe('Director');
    expect(service.resolveCard('director', { includeBuiltIn: true })?.card.id).toBe('director');
    expect(service.settingsWithCards({}, { includeBuiltIn: true }).roles?.['director']?.displayName).toBe('Director');
  });

  it('never enters the settings snapshot, export, or stored library', async () => {
    expect(service.librarySnapshot().cards).toEqual([]);
    expect(service.exportCards().cards).toEqual([]);
    await expect(service.put(card('director'), { create: true })).rejects.toThrow(/reserved/);
    const imported = await service.importCards([{ ...card('director'), id: 'director' }], 'skip');
    expect(imported.imported).toBe(0);
    expect(imported.issues[0]?.message).toContain('reserved');
    expect(service.list().map((entry) => entry.id)).toEqual([]);
  });
});

describe('built-in director card precedence', () => {
  it('wins over a stored card with the reserved id when Director visibility is requested', async () => {
    const { service: scoped, memory } = createCardService();
    const cards = new Map<string, unknown>();
    cards.set('director', {
      id: 'director',
      name: 'Old Custom Director',
      delegationGuidance: 'Old guidance.',
      enabled: true,
      source: 'local',
    });
    memory.tables.set('cards', cards);
    await scoped.ready();
    const renamed = scoped.list().find((card) => card.name === 'Old Custom Director');
    expect(renamed?.id).not.toBe('director');
    expect(scoped.get('director')).toBeUndefined();
    expect(scoped.get('director', { includeBuiltIn: true })?.name).toBe('Director');
    expect(memory.tables.get('cards')?.has('director')).toBe(false);
    const visible = scoped.list({ includeBuiltIn: true });
    expect(visible.filter((card) => card.id === 'director')).toHaveLength(1);
    expect(visible.find((card) => card.id === 'director')?.source).toBe('builtin');
  });

  it('renames a reserved legacy role instead of colliding with the built-in card', async () => {
    const created = createCardService(() => ({
      roles: { director: { displayName: 'Legacy Director', description: 'Old role.' } },
    }));
    await created.service.ready();
    const result = await created.service.migrateLegacy();
    expect(result.failed).toEqual([]);
    expect(result.migrated).not.toContain('director');
    expect(result.migrated[0]).not.toBe('director');
    expect(created.service.list().map((card) => card.id)).not.toContain('director');
  });
});

describe('reserved card rename durability', () => {
  it('keeps the original card when persisting the renamed copy fails', async () => {
    const { service, memory } = createCardService();
    const cards = new Map<string, unknown>();
    cards.set('director', {
      id: 'director',
      name: 'Old Custom',
      delegationGuidance: 'Old guidance.',
      enabled: true,
      source: 'local',
    });
    memory.tables.set('cards', cards);
    memory.failPuts.add('old-custom-legacy');
    await service.ready();
    expect(service.status().state).toBe('error');
    expect(service.get('director')?.name).toBe('Old Custom');
    expect(cards.has('director')).toBe(true);
    expect(cards.has('old-custom-legacy')).toBe(false);
  });
});
describe('card usage and closed pool', () => {
  const AT = '2026-11-28T00:00:00.000Z';

  it('records uses, exposes them in the snapshot, and serializes concurrent writes', async () => {
    await service.put(card('reviewer'), { create: true });
    await Promise.all(Array.from({ length: 5 }, () => service.recordCardUse('reviewer', AT)));
    expect(service.cardUsage('reviewer')).toEqual({ uses: 5, lastUsedAt: AT });
    expect(memory.tables.get('usage')?.get('reviewer')).toEqual({ uses: 5, lastUsedAt: AT });
    expect(service.librarySnapshot().usage).toEqual({ reviewer: { uses: 5, lastUsedAt: AT } });
  });

  it('ignores usage for unknown cards and removes the record with the card', async () => {
    await service.put(card('a'), { create: true });
    await service.recordCardUse('ghost');
    expect(service.cardUsage('ghost')).toBeUndefined();
    await service.recordCardUse('a', AT);
    await service.remove(['a']);
    expect(service.cardUsage('a')).toBeUndefined();
    expect(memory.tables.get('usage')?.has('a')).toBe(false);
  });

  it('keeps card writes independent from a failing usage write', async () => {
    await service.put(card('a'), { create: true });
    memory.failTablePuts.set('usage', new Set(['a']));
    await expect(service.recordCardUse('a', AT)).resolves.toBeUndefined();
    expect(service.cardUsage('a')).toBeUndefined();
    expect(service.get('a')).toBeDefined();
  });

  it('pins and unpins without touching updatedAt', async () => {
    const created = await service.put(card('a'), { create: true });
    const pinned = await service.setNeverClose(['a'], true);
    expect(pinned[0]?.neverClose).toBe(true);
    expect(pinned[0]?.updatedAt).toBe(created.updatedAt);
    const stored = memory.tables.get('cards')?.get('a') as { neverClose?: boolean; updatedAt?: string };
    expect(stored.neverClose).toBe(true);
    expect(stored.updatedAt).toBe(created.updatedAt);

    const unpinned = await service.setNeverClose(['a'], false);
    expect(unpinned[0]).not.toHaveProperty('neverClose');
    expect(unpinned[0]?.updatedAt).toBe(created.updatedAt);
    expect((memory.tables.get('cards')?.get('a') as { neverClose?: boolean }).neverClose).toBeUndefined();
  });

  it('keeps a pin when an editor-shaped draft omits neverClose', async () => {
    await service.put(card('reviewer'), { create: true });
    await service.setNeverClose(['reviewer'], true);
    const draft = { id: 'reviewer', name: 'Card reviewer', delegationGuidance: 'Use this card for reviewer.' };

    const saved = await service.put(draft, { create: false });
    expect(saved.neverClose).toBe(true);
    expect(service.get('reviewer')?.neverClose).toBe(true);
    expect((memory.tables.get('cards')?.get('reviewer') as { neverClose?: boolean }).neverClose).toBe(true);

    const cleared = await service.put({ ...draft, neverClose: false }, { create: false });
    expect(cleared.neverClose).toBe(false);
    expect((memory.tables.get('cards')?.get('reviewer') as { neverClose?: boolean }).neverClose).toBe(false);
  });

  it('keeps import overwrite semantics for neverClose', async () => {
    await service.put(card('reviewer'), { create: true });
    await service.setNeverClose(['reviewer'], true);
    const result = await service.importCards(
      [{ id: 'reviewer', name: 'Card reviewer', delegationGuidance: 'Replaced guidance.' }],
      'overwrite',
    );
    expect(result.overwritten).toBe(1);
    expect(service.get('reviewer')?.neverClose).toBeUndefined();
  });

  it('ranks a seeded library by weight while list() keeps display order', async () => {
    const seeded = createCardService();
    const cards = new Map<string, unknown>();
    cards.set('hot', { ...card('hot', { name: 'Hot', createdAt: '2026-11-27T00:00:00.000Z' }) });
    cards.set('cold', { ...card('cold', { name: 'Cold', createdAt: '2026-01-01T00:00:00.000Z' }) });
    cards.set('imported', {
      ...card('imported', { name: 'Imported', createdAt: '2025-01-01T00:00:00.000Z', source: 'import' }),
    });
    seeded.memory.tables.set('cards', cards);
    await seeded.service.ready();
    await seeded.service.recordCardUse('hot', '2026-11-28T00:00:00.000Z');

    const ranked = seeded.service.rankedCards({ now: Date.parse('2026-11-28T12:00:00.000Z') });
    expect(ranked.map((entry) => [entry.card.id, entry.state])).toEqual([
      ['hot', 'active'],
      ['cold', 'closed'],
      ['imported', 'exempt'],
    ]);
    expect(seeded.service.list().map((entry) => entry.id)).toEqual(['cold', 'hot', 'imported']);
  });

  it('includes the built-in Director card only when asked', () => {
    expect(service.rankedCards().map((entry) => entry.card.id)).toEqual([]);
    expect(service.rankedCards({ includeBuiltIn: true }).map((entry) => entry.card.id)).toContain('director');
  });
});

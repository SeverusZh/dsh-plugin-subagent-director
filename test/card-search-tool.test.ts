import { describe, it, expect } from 'vitest';
import { createCardSearchTool, createCardGetTool } from '../src/card-search-tool.js';
import { createCardService } from './card-fixtures.js';
import type { CharacterCard } from '../src/card-types.js';

const NOW = Date.parse('2026-11-28T12:00:00.000Z');
const DAY = 86_400_000;

function daysBefore(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function card(id: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id,
    name: 'Card ' + id,
    delegationGuidance: 'Use card ' + id + '.',
    enabled: true,
    source: 'local',
    createdAt: daysBefore(1),
    ...overrides,
  };
}

async function harness(cards: CharacterCard[], usage: Record<string, { uses: number; lastUsedAt: string }> = {}) {
  const created = createCardService();
  const cardTable = new Map<string, unknown>();
  for (const entry of cards) cardTable.set(entry.id, entry);
  created.memory.tables.set('cards', cardTable);
  const usageTable = new Map<string, unknown>();
  for (const [id, record] of Object.entries(usage)) usageTable.set(id, record);
  created.memory.tables.set('usage', usageTable);
  await created.service.ready();
  const search = createCardSearchTool({ cards: created.service, now: () => NOW });
  const get = createCardGetTool({ cards: created.service, now: () => NOW });
  const run = (tool: unknown, args: unknown) =>
    (tool as { execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }).execute(args, {});
  return { ...created, search, get, run };
}

const reviewer = card('reviewer', {
  name: 'Reviewer',
  tags: ['code', 'review'],
  model: { provider: 'p', model: 'm' },
  notes: 'Security matters here.',
  systemPrompt: 'You review code.',
  persona: 'Terse.',
});
const writer = card('writer', { name: 'Writer', tags: ['code'] });
const old = card('old', { name: 'Old Card', tags: ['code'], createdAt: daysBefore(200) });
const archived = card('archived', { name: 'Archived', createdAt: daysBefore(400), source: 'import' });
const disabled = card('disabled', { name: 'Disabled', enabled: false });

describe('subagent_card_search', () => {
  it('defaults to 8 results and caps any limit at 25', async () => {
    const many = Array.from({ length: 30 }, (_, index) => card('c' + String(index).padStart(2, '0')));
    const h = await harness(many);
    const fallback = await h.run(h.search, {});
    expect(fallback.shown).toBe(8);
    expect(fallback.matched).toBe(31);
    expect(fallback.total).toBe(31);
    expect((fallback.cards as unknown[]).length).toBe(8);

    const capped = await h.run(h.search, { limit: 999 });
    expect(capped.shown).toBe(25);
    expect((capped.cards as unknown[]).length).toBe(25);

    const floored = await h.run(h.search, { limit: 0 });
    expect(floored.shown).toBe(1);
  });

  it('matches query text case-insensitively across name, id, tags, guidance, and notes', async () => {
    const h = await harness([reviewer, writer]);
    const byNotes = await h.run(h.search, { query: 'SECURITY' });
    expect((byNotes.cards as Array<{ id: string }>).map((row) => row.id)).toEqual(['reviewer']);

    const byTag = await h.run(h.search, { query: 'REVIEW' });
    expect((byTag.cards as Array<{ id: string }>).map((row) => row.id)).toEqual(['reviewer']);

    const byId = await h.run(h.search, { query: 'writer' });
    expect((byId.cards as Array<{ id: string }>).map((row) => row.id)).toEqual(['writer']);
  });

  it('treats multiple tags as AND', async () => {
    const h = await harness([reviewer, writer]);
    const both = await h.run(h.search, { tags: ['code', 'review'] });
    expect((both.cards as Array<{ id: string }>).map((row) => row.id)).toEqual(['reviewer']);
    const missing = await h.run(h.search, { tags: ['code', 'missing'] });
    expect(missing.cards).toEqual([]);
    expect(missing.matched).toBe(0);
  });

  it('hides closed-pool cards by default and lists them after active cards on request', async () => {
    const activeOld = card('active-old', { name: 'Old Active' });
    const h = await harness([reviewer, activeOld, old, archived]);
    const hidden = await h.run(h.search, { query: 'old' });
    expect((hidden.cards as Array<{ id: string }>).map((row) => row.id)).toEqual(['active-old']);
    expect(hidden.closedPool).toBe(1);

    const included = await h.run(h.search, { query: 'old', includeClosed: true });
    const rows = included.cards as Array<{ id: string; state: string }>;
    expect(rows.map((row) => row.id)).toEqual(['active-old', 'old']);
    expect(rows.at(-1)?.state).toBe('closed');
  });

  it('returns compact rows with counters, tags, model, and a 160-character use preview', async () => {
    const long = card('long', { name: 'Long', delegationGuidance: 'z'.repeat(300) });
    const h = await harness([reviewer, long], { reviewer: { uses: 3, lastUsedAt: daysBefore(2) } });
    const result = await h.run(h.search, { query: 'reviewer' });
    const row = (result.cards as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({ id: 'reviewer', name: 'Reviewer', state: 'active', uses: 3, tags: 'code,review', model: 'p/m' });
    expect(row.lastUsed).toBe(daysBefore(2));
    expect(typeof row.score).toBe('number');

    const preview = await h.run(h.search, { query: 'long' });
    const longRow = (preview.cards as Array<Record<string, unknown>>)[0]!;
    expect((longRow.useWhen as string).length).toBe(160);

    const rendered = (
      h.search as unknown as {
        output: { render: (args: unknown, value: Record<string, unknown>) => Array<{ text: string }> };
      }
    ).output.render({}, result);
    expect(rendered[0]?.text).toContain('state=active');
    expect(rendered[0]?.text).toContain('uses=3');
    expect(rendered[0]?.text).toContain('Use when: Use card reviewer.');
  });

  it('keeps a pinned card listed even past the closed-pool thresholds', async () => {
    const pinned = card('pinned', { name: 'Pinned', createdAt: daysBefore(400), neverClose: true });
    const h = await harness([pinned]);
    const result = await h.run(h.search, {});
    expect((result.cards as Array<{ state: string }>)[0]?.state).toBe('exempt');
  });

  it('omits disabled cards', async () => {
    const h = await harness([reviewer, disabled]);
    const result = await h.run(h.search, {});
    expect((result.cards as Array<{ id: string }>).map((row) => row.id)).not.toContain('disabled');
  });
});

describe('subagent_card_get', () => {
  it('returns one card by id with full prompt fields and statistics', async () => {
    const h = await harness([reviewer], { reviewer: { uses: 4, lastUsedAt: daysBefore(3) } });
    const value = await h.run(h.get, { id: 'reviewer' });
    expect(value).toMatchObject({
      id: 'reviewer',
      name: 'Reviewer',
      state: 'active',
      enabled: true,
      neverClose: false,
      uses: 4,
      delegationGuidance: 'Use card reviewer.',
      tags: 'code,review',
      model: 'p/m',
      systemPrompt: 'You review code.',
      persona: 'Terse.',
      notes: 'Security matters here.',
      source: 'local',
    });
    expect(value.lastUsedAt).toBe(daysBefore(3));
    expect(value.idleDays).toBeCloseTo(3, 4);
    expect(typeof value.score).toBe('number');
  });

  it('accepts an exact display name', async () => {
    const h = await harness([reviewer]);
    const value = await h.run(h.get, { id: 'Reviewer' });
    expect(value.id).toBe('reviewer');
  });

  it('returns disabled cards with enabled=false so the Director can explain why', async () => {
    const h = await harness([disabled]);
    const value = await h.run(h.get, { id: 'disabled' });
    expect(value.enabled).toBe(false);
  });

  it('fails with a search-first hint for an unknown card', async () => {
    const h = await harness([reviewer]);
    await expect(h.run(h.get, { id: 'ghost' })).rejects.toThrow(/subagent_card_search/);
  });

  it('renders the full child prompt and avoid guidance', async () => {
    const withAvoid = card('avoid', {
      name: 'Avoid Card',
      avoidGuidance: 'Do not use for docs.',
      systemPrompt: 'Fixed prompt.',
      persona: 'Persona.',
      notes: 'Human note.',
    });
    const h = await harness([withAvoid]);
    const value = await h.run(h.get, { id: 'avoid' });
    const text = (
      h.get as unknown as {
        output: { render: (args: unknown, value: Record<string, unknown>) => Array<{ text: string }> };
      }
    ).output.render({}, value)[0]?.text;
    expect(text).toContain('Do not use when: Do not use for docs.');
    expect(text).toContain('System prompt:');
    expect(text).toContain('Persona:');
    expect(text).toContain('Notes:');
  });
});

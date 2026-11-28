/**
 * The settings page projects the card library through one pure function:
 * weight state, status filter, and ordering. These tests pin the user-visible
 * rules: closed-pool cards stay listed under "all", the closed filter only
 * holds closed cards, every sort is stable, and pinning exempts a card.
 */
import { describe, it, expect } from 'vitest';
import { CARD_FILTERS, CARD_SORTS, cardLibraryRows, cardVisibleState, formatUsageTime } from '../src/client/card-library-view.js';
import type { CharacterCard } from '../src/card-types.js';

const NOW = new Date('2026-11-28T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function card(id: string, name: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id,
    name,
    delegationGuidance: 'Guidance for ' + name,
    createdAt: daysAgo(1),
    ...overrides,
  };
}

const cards: CharacterCard[] = [
  card('recent', 'Recent', { createdAt: daysAgo(200) }),
  card('stale', 'Stale', { createdAt: daysAgo(120) }),
  card('low', 'Low Use', { createdAt: daysAgo(60), tags: ['review'] }),
  card('disabled', 'Disabled', { createdAt: daysAgo(200), enabled: false }),
  card('pinned', 'Pinned', { createdAt: daysAgo(400), neverClose: true }),
  card('default', 'Default', { createdAt: daysAgo(400) }),
  card('imported', 'Imported', { createdAt: daysAgo(400), source: 'import' }),
];

const usage = {
  recent: { uses: 6, lastUsedAt: daysAgo(2) },
  disabled: { uses: 2, lastUsedAt: daysAgo(3) },
  low: { uses: 1, lastUsedAt: daysAgo(45) },
};

const base = { now: NOW, usage, defaultCardId: 'default' } as const;

describe('card library projection', () => {
  it('lists every card under "all" and maps the three visible states', () => {
    const rows = cardLibraryRows(cards, base);
    expect(rows).toHaveLength(cards.length);
    const stateById = Object.fromEntries(rows.map((row) => [row.card.id, row.visibleState]));
    expect(stateById).toEqual({
      recent: 'active',
      stale: 'closed',
      low: 'closed',
      disabled: 'disabled',
      pinned: 'active',
      default: 'active',
      imported: 'active',
    });
    expect(cardVisibleState(cards[0]!, 'closed')).toBe('closed');
    expect(cardVisibleState(cards[3]!, 'closed')).toBe('disabled');
    expect(cardVisibleState(cards[0]!, 'exempt')).toBe('active');
  });

  it('filters by usage state without dropping closed cards from explicit use', () => {
    const ids = (filter: (typeof CARD_FILTERS)[number]): string[] =>
      cardLibraryRows(cards, { ...base, filter }).map((row) => row.card.id);
    expect(ids('all')).toHaveLength(7);
    expect(ids('active')).toEqual(['recent', 'default', 'imported', 'pinned']);
    expect(ids('closed')).toEqual(['low', 'stale']);
    expect(ids('disabled')).toEqual(['disabled']);
  });

  it('orders by weight by default, then by recent use, then by name', () => {
    const weight = cardLibraryRows(cards, { ...base, sort: 'weight' });
    expect(weight[0]?.card.id).toBe('recent');
    for (let i = 1; i < weight.length; i += 1) {
      expect(weight[i - 1]!.score).toBeGreaterThanOrEqual(weight[i]!.score);
    }

    const recent = cardLibraryRows(cards, { ...base, sort: 'recent' }).map((row) => row.card.id);
    expect(recent.slice(0, 3)).toEqual(['recent', 'disabled', 'low']);
    expect(recent.slice(3)).toEqual(['default', 'imported', 'pinned', 'stale']);

    const byName = cardLibraryRows(cards, { ...base, sort: 'name' }).map((row) => row.card.name);
    expect(byName).toEqual(['Default', 'Disabled', 'Imported', 'Low Use', 'Pinned', 'Recent', 'Stale']);
  });

  it('searches names, ids, tags, and guidance before ordering', () => {
    const byTag = cardLibraryRows(cards, { ...base, query: 'review' });
    expect(byTag.map((row) => row.card.id)).toEqual(['low']);
    const combined = cardLibraryRows(cards, { ...base, filter: 'closed', query: 'stale' });
    expect(combined.map((row) => row.card.id)).toEqual(['stale']);
    expect(cardLibraryRows(cards, { ...base, query: 'guidance for stale' }).map((row) => row.card.id)).toEqual(['stale']);
  });

  it('exposes the toolbar tokens and formats usage timestamps', () => {
    expect(CARD_FILTERS).toEqual(['all', 'active', 'closed', 'disabled']);
    expect(CARD_SORTS).toEqual(['weight', 'recent', 'name']);
    expect(formatUsageTime('2026-11-28T00:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatUsageTime('not-a-time')).toBeUndefined();
  });
});

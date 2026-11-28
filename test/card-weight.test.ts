import { describe, it, expect } from 'vitest';
import {
  CARD_CLOSED_IDLE_DAYS,
  CARD_CLOSED_LOW_USE_IDLE_DAYS,
  CARD_SCORE_IDLE_HALF_LIFE_DAYS,
  CARD_SCORE_USE_FACTOR,
  MS_PER_DAY,
  cardIdleDays,
  cardScore,
  cardUsageState,
  isCardExempt,
  rankCards,
} from '../src/card-weight.js';
import { DIRECTOR_CARD_ID } from '../src/director.js';
import type { CharacterCard } from '../src/card-types.js';

const NOW = Date.parse('2026-11-28T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * MS_PER_DAY).toISOString();
}

function card(id: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    delegationGuidance: 'Use ' + id + '.',
    enabled: true,
    source: 'local',
    ...overrides,
  };
}

describe('card weight formula', () => {
  it('scores a fresh, unused card at exactly 1', () => {
    expect(cardScore({ uses: 0, idleDays: 0 })).toBeCloseTo(1, 10);
  });

  it('follows 1.6 * ln(1 + uses) + 0.5^(idleDays/30)', () => {
    const uses = 3;
    const idleDays = 30;
    const expected =
      CARD_SCORE_USE_FACTOR * Math.log1p(uses) + Math.pow(0.5, idleDays / CARD_SCORE_IDLE_HALF_LIFE_DAYS);
    expect(cardScore({ uses, idleDays })).toBeCloseTo(expected, 10);
    expect(cardScore({ uses, idleDays })).toBeCloseTo(2.7180709778, 8);
  });

  it('clamps negative use counts and idle ages to zero', () => {
    expect(cardScore({ uses: -4, idleDays: -10 })).toBe(1);
  });
});

describe('idle-age baseline', () => {
  it('prefers the last use, then createdAt, then treats a missing baseline as just created', () => {
    const created = card('reviewer', { createdAt: daysAgo(10) });
    expect(cardIdleDays({ card: created, usage: { uses: 2, lastUsedAt: daysAgo(2) }, now: NOW })).toBeCloseTo(2, 6);
    expect(cardIdleDays({ card: created, now: NOW })).toBeCloseTo(10, 6);
    expect(cardIdleDays({ card: card('no-time'), now: NOW })).toBe(0);
  });

  it('clamps a future last use to zero idle days', () => {
    const created = card('future', { createdAt: daysAgo(100) });
    expect(cardIdleDays({ card: created, usage: { uses: 1, lastUsedAt: daysAgo(-5) }, now: NOW })).toBe(0);
  });
});

describe('closed-pool classification', () => {
  it('keeps a brand-new unused card active', () => {
    expect(cardUsageState({ card: card('fresh', { createdAt: daysAgo(0) }), now: NOW })).toBe('active');
  });

  it('closes an unused or once-used card after 30 idle days', () => {
    expect(CARD_CLOSED_LOW_USE_IDLE_DAYS).toBe(30);
    const once = card('once', { createdAt: daysAgo(30) });
    expect(cardUsageState({ card: once, usage: { uses: 1, lastUsedAt: daysAgo(30) }, now: NOW })).toBe('closed');
    expect(cardUsageState({ card: once, usage: { uses: 0, lastUsedAt: daysAgo(30) }, now: NOW })).toBe('closed');
    expect(cardUsageState({ card: once, usage: { uses: 2, lastUsedAt: daysAgo(30) }, now: NOW })).toBe('active');
  });

  it('closes any non-exempt card after 90 idle days regardless of use count', () => {
    expect(CARD_CLOSED_IDLE_DAYS).toBe(90);
    const heavy = card('heavy', { createdAt: daysAgo(200) });
    expect(cardUsageState({ card: heavy, usage: { uses: 50, lastUsedAt: daysAgo(90) }, now: NOW })).toBe('closed');
    expect(cardUsageState({ card: heavy, usage: { uses: 50, lastUsedAt: daysAgo(89) }, now: NOW })).toBe('active');
  });

  it('never closes a pinned card', () => {
    const pinned = card('pinned', { createdAt: daysAgo(400), neverClose: true });
    expect(cardUsageState({ card: pinned, now: NOW })).toBe('exempt');
    expect(isCardExempt({ card: pinned })).toBe(true);
  });

  it('exempts the built-in Director card, the default card, and every non-local source', () => {
    expect(isCardExempt({ card: { ...card(DIRECTOR_CARD_ID), source: 'builtin' } })).toBe(true);
    expect(isCardExempt({ card: card('fallback'), isDefault: true })).toBe(true);
    for (const source of ['import', 'legacy', 'builtin'] as const) {
      expect(isCardExempt({ card: card('source-' + source, { source }) })).toBe(true);
    }
    expect(isCardExempt({ card: card('local-card', { source: 'local' }) })).toBe(false);
    expect(isCardExempt({ card: card('unknown-source', { source: undefined }) })).toBe(false);
  });

  it('takes the clock from the caller rather than reading one internally', () => {
    const fresh = card('clocked', { createdAt: daysAgo(40) });
    expect(cardUsageState({ card: fresh, now: NOW })).toBe('closed');
    expect(cardUsageState({ card: fresh, now: NOW - 20 * MS_PER_DAY })).toBe('active');
  });
});

describe('card ranking', () => {
  it('sorts by score descending and then by name ascending', () => {
    const ranked = rankCards(
      [card('beta'), card('gamma'), card('alpha'), card('charlie')],
      {
        now: NOW,
        usage: {
          beta: { uses: 5, lastUsedAt: daysAgo(0) },
          gamma: { uses: 2, lastUsedAt: daysAgo(0) },
          alpha: { uses: 1, lastUsedAt: daysAgo(0) },
          charlie: { uses: 1, lastUsedAt: daysAgo(0) },
        },
      },
    );
    expect(ranked.map((entry) => entry.card.id)).toEqual(['beta', 'gamma', 'alpha', 'charlie']);
  });

  it('keeps closed cards in the ranking and marks their state', () => {
    const ranked = rankCards([card('old', { createdAt: daysAgo(120) }), card('new', { createdAt: daysAgo(0) })], {
      now: NOW,
    });
    expect(ranked.map((entry) => entry.card.id)).toEqual(['new', 'old']);
    expect(ranked[1]?.state).toBe('closed');
  });

  it('carries use counters and last-use time into every entry', () => {
    const ranked = rankCards([card('used')], {
      now: NOW,
      usage: { used: { uses: 4, lastUsedAt: daysAgo(3) } },
    });
    expect(ranked[0]).toMatchObject({ uses: 4, state: 'active' });
    expect(ranked[0]?.lastUsedAt).toBe(daysAgo(3));
    expect(ranked[0]?.idleDays).toBeCloseTo(3, 6);
    expect(ranked[0]?.score).toBeCloseTo(1.6 * Math.log(5) + Math.pow(0.5, 0.1), 8);
  });

  it('marks the configured default card exempt', () => {
    const ranked = rankCards([card('fallback', { createdAt: daysAgo(200) })], { now: NOW, defaultCardId: 'fallback' });
    expect(ranked[0]?.state).toBe('exempt');
  });
});

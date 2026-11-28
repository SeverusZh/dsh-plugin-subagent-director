/**
 * Unit tests for the role guidance renderer (方案 A follow-up).
 * The rendered role list must tell the model to reference roles by their id
 * (the Delegate line value), not by display name.
 */
import { describe, it, expect } from 'vitest';
import { renderRolesGuidance } from '../src/guidance.js';

const settings = {
  roles: {
    role: {
      displayName: '基础开发工程师',
      description: '一个基础的开发工程师',
      provider: 'opencode-go',
      model: 'mimo-v2.5',
    },
  },
};

describe('renderRolesGuidance', () => {
  it('renders an empty string when there are no roles', () => {
    expect(renderRolesGuidance({}, 'subagent_role')).toBe('');
  });

  it('includes the id-reference instruction and the delegate line', () => {
    const text = renderRolesGuidance(settings, 'subagent_role');
    expect(text).toContain('Reference cards by their bracketed id');
    expect(text).toContain('never by display name');
    expect(text).toContain('subagent_role({ role: "role", prompt: "..." })');
    expect(text).toContain('基础开发工程师');
  });

  it('appends a dangling defaultRole warning so it reaches the agent', () => {
    const text = renderRolesGuidance({ ...settings, defaultRole: 'ghost' }, 'subagent_role');
    expect(text).toContain('defaultRole "ghost"');
    expect(text).toContain('does not reference a defined role');
  });

  it('adds no warning for a sound or unset defaultRole', () => {
    expect(renderRolesGuidance({ ...settings, defaultRole: 'role' }, 'subagent_role')).not.toContain('does not reference');
    expect(renderRolesGuidance(settings, 'subagent_role')).not.toContain('does not reference');
  });

  it('keeps a dangling defaultRole from resurrecting an empty role section', () => {
    expect(renderRolesGuidance({ roles: {}, defaultRole: 'ghost' }, 'subagent_role')).toBe('');
  });
});

import { BUILTIN_DIRECTOR_CARD } from '../src/director-card.js';
import { rankCards } from '../src/card-weight.js';
import type { CharacterCard } from '../src/card-types.js';

const reviewer: CharacterCard = {
  id: 'reviewer',
  name: 'Reviewer',
  delegationGuidance: 'Use when a diff needs correctness review.',
  avoidGuidance: 'Do not use when the task is to write a new feature.',
  enabled: true,
};

const cardSource = {
  list: (options?: { includeBuiltIn?: boolean }) =>
    options?.includeBuiltIn === true ? [reviewer, BUILTIN_DIRECTOR_CARD] : [reviewer],
};

describe('renderRolesGuidance guidance split', () => {
  it('renders both recommended and not-recommended sections', () => {
    const text = renderRolesGuidance({}, 'subagent_role', cardSource);
    expect(text).toContain('Use when: Use when a diff needs correctness review.');
    expect(text).toContain('Do not use when: Do not use when the task is to write a new feature.');
    expect(text).not.toContain('Director Mode card policy');
    expect(text).not.toContain('director');
  });

  it('includes the built-in director card and card-first policy only in Director mode', () => {
    const text = renderRolesGuidance({}, 'subagent_role', cardSource, { director: true });
    expect(text).toContain('Director Mode card policy');
    expect(text).toContain('subagent_card_create');
    expect(text).toContain('Director [director]');
    expect(text).toContain('built-in');
  });

  it('hides legacy roles in Director mode', () => {
    const legacy = {
      roles: { legacy: { displayName: 'Legacy', description: 'Old guidance.' } },
    };
    expect(renderRolesGuidance(legacy, 'subagent_role', cardSource)).toContain('Legacy role templates');
    expect(renderRolesGuidance(legacy, 'subagent_role', cardSource, { director: true })).not.toContain('Legacy role templates');
  });
});
const GUIDANCE_NOW = Date.parse('2026-11-28T12:00:00.000Z');
const DAY = 86_400_000;
const daysBefore = (days: number): string => new Date(GUIDANCE_NOW - days * DAY).toISOString();

function recentCard(id: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
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

function sourceOf(cards: CharacterCard[]) {
  return {
    list: (options?: { includeBuiltIn?: boolean }) =>
      options?.includeBuiltIn === true ? [...cards, BUILTIN_DIRECTOR_CARD] : cards,
  };
}

function sourceWithUsage(
  cards: CharacterCard[],
  usage: Record<string, { uses: number; lastUsedAt: string }>,
) {
  const all = (includeBuiltIn: boolean | undefined) =>
    includeBuiltIn === true ? [...cards, BUILTIN_DIRECTOR_CARD] : cards;
  return {
    list: (options?: { includeBuiltIn?: boolean }) => all(options?.includeBuiltIn),
    rankedCards: (options?: { includeBuiltIn?: boolean; now?: number | Date }) =>
      rankCards(all(options?.includeBuiltIn), { now: options?.now ?? GUIDANCE_NOW, usage }),
  };
}

describe('guidance prompt budget', () => {
  it('renders at most 12 active cards and says how many were omitted', () => {
    const cards = Array.from({ length: 15 }, (_, index) => recentCard(String(index).padStart(2, '0')));
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf(cards), { now: GUIDANCE_NOW });
    expect(text).toContain('Card library: 15 card(s) total, 12 listed here, 0 in the closed pool.');
    expect(text).toContain('3 more active card(s) not listed here');
    expect(text).toContain('Card 11');
    expect(text).not.toContain('Card 12');
  });

  it('keeps the built-in Director card in the list when 12 other cards outrank it', () => {
    const cards = Array.from({ length: 12 }, (_, index) => recentCard(String(index).padStart(2, '0')));
    const usage = Object.fromEntries(
      cards.map((entry) => [entry.id, { uses: 3, lastUsedAt: daysBefore(0) }]),
    );
    const text = renderRolesGuidance({}, 'subagent_role', sourceWithUsage(cards, usage), {
      director: true,
      now: GUIDANCE_NOW,
    });
    expect(text).toContain('Director [director]');
    expect(text).toContain('Card library: 13 card(s) total, 12 listed here, 0 in the closed pool.');
    expect(text).toContain('Card 10');
    expect(text).not.toContain('Card 11');
    expect(text).toContain('1 more active card(s) not listed here');
  });

  it('excludes closed-pool cards and reports their count', () => {
    const cards = [
      recentCard('active'),
      recentCard('stale', { createdAt: daysBefore(200) }),
      { id: 'unused', name: 'Unused', delegationGuidance: 'Old.', enabled: true, source: 'local' as const, createdAt: daysBefore(45) },
    ];
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf(cards), { now: GUIDANCE_NOW });
    expect(text).toContain('Card library: 3 card(s) total, 1 listed here, 2 in the closed pool.');
    expect(text).toContain('Card active');
    expect(text).not.toContain('Card stale');
    expect(text).not.toContain('Unused');
    expect(text).toContain('Closed-pool cards are not listed here');
  });

  it('clips per-card guidance at 720 characters and points at the detail tool in Director mode', () => {
    const long = 'x'.repeat(900);
    const cards = sourceOf([recentCard('long', { delegationGuidance: long })]);
    const directorText = renderRolesGuidance({}, 'subagent_role', cards, { director: true, now: GUIDANCE_NOW });
    expect(directorText).toContain('x'.repeat(720));
    expect(directorText).not.toContain('x'.repeat(721));
    expect(directorText).toContain('truncated; call subagent_card_get');
  });

  it('uses a neutral truncation note when no Director detail tool is available', () => {
    const long = 'x'.repeat(900);
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf([recentCard('long', { delegationGuidance: long })]), {
      now: GUIDANCE_NOW,
    });
    expect(text).toContain('x'.repeat(720));
    expect(text).not.toContain('x'.repeat(721));
    expect(text).toContain('truncated');
    expect(text).toContain('character-card library');
    expect(text).not.toContain('subagent_card_get');
  });

  it('caps the whole section at 12000 characters across many large cards', () => {
    const cards = Array.from({ length: 12 }, (_, index) =>
      recentCard(String(index).padStart(2, '0'), {
        delegationGuidance: 'g'.repeat(1000),
        avoidGuidance: 'a'.repeat(1000),
      }),
    );
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf(cards), { now: GUIDANCE_NOW });
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text).toContain('more active card(s) not listed here');
    expect(text).toContain('Card library: 12 card(s) total');
  });

  it('keeps the built-in Director card even when the budget trims large cards', () => {
    const cards = Array.from({ length: 12 }, (_, index) =>
      recentCard(String(index).padStart(2, '0'), {
        delegationGuidance: 'g'.repeat(1000),
        avoidGuidance: 'a'.repeat(1000),
      }),
    );
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf(cards), {
      director: true,
      now: GUIDANCE_NOW,
    });
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text).toContain('Director [director]');
    expect(text).toContain('more active card(s) not listed here');
  });

  it('names the search and detail tools in the Director header', () => {
    const text = renderRolesGuidance({}, 'subagent_role', sourceOf([recentCard('a')]), {
      director: true,
      now: GUIDANCE_NOW,
    });
    expect(text).toContain('subagent_card_search');
    expect(text).toContain('subagent_card_get');
    expect(text).toContain('Card library: 2 card(s) total');
    expect(text).not.toContain('unpin');
    expect(text).toContain('A closed-pool card returns to active after one successful delegation to its id.');
  });
});

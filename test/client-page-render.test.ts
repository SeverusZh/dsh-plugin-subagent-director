import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SubagentOptionsSection } from '../src/client/SubagentOptionsSection.js';
import { initialSubagentOptionsState, type SubagentOptionsStore } from '../src/client/store.js';
import type { SubagentOptionsState } from '../src/client/store.js';

function render(state: SubagentOptionsState): string {
  const controller = {
    load: async () => {},
    refreshCards: async () => {},
    exportCards: async () => ({ ok: true as const, value: { cards: [] } }),
    saveCard: async () => undefined,
    deleteCards: async () => undefined,
    setDefaultCard: async () => undefined,
    batchCards: async () => undefined,
    importCards: async () => ({ ok: false as const, message: 'not-called' }),
    migrateLegacy: async () => ({ ok: false as const, message: 'not-called' }),
    setDefaultModel: async () => undefined,
    restoreDefaults: async () => undefined,
    store: { getSnapshot: () => state, subscribe: () => () => {}, update: () => {} },
  } as unknown as SubagentOptionsStore;
  const useSnapshot = ((selector: (value: SubagentOptionsState) => unknown) => selector(state)) as never;
  return renderToStaticMarkup(
    createElement(SubagentOptionsSection, {
      controller,
      useSnapshot,
      t: (key: string) => key,
      view: 'page',
    } as never),
  );
}

function readyState(overrides: Partial<SubagentOptionsState> = {}): SubagentOptionsState {
  return {
    ...initialSubagentOptionsState(),
    status: 'ready',
    loading: false,
    cardStorage: { state: 'ready' },
    allowedRoutes: [{ provider: 'p', model: 'm' }],
    section: { defaultProvider: 'p', defaultModel: 'm' },
    ...overrides,
  };
}

describe('character-card settings page render', () => {
  it('renders the page, library, default panel, and a card', () => {
    const html = render(
      readyState({
        cards: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            delegationGuidance: 'Review the diff.',
            systemPrompt: 'Prompt.',
            tags: ['code'],
            model: { provider: 'p', model: 'm' },
            enabled: true,
          },
        ],
        defaultCardId: 'reviewer',
      }),
    );
    expect(html).toContain('pageTitle');
    expect(html).toContain('newCard');
    expect(html).toContain('cardsHeading');
    expect(html).toContain('Reviewer');
    expect(html).toContain('defaultModelPanel');
    expect(html).toContain('statDefault');
    expect(html).not.toContain('emptyCardsTitle');
  });

  it('renders the empty state and legacy migration banner', () => {
    const html = render(
      readyState({
        cards: [],
        legacyRoles: ['old-role'],
      }),
    );
    expect(html).toContain('emptyCardsTitle');
    expect(html).toContain('legacyBanner');
    expect(html).toContain('legacyMigrate');
  });

  it('renders the storage warning when cards are unavailable', () => {
    const html = render(readyState({ cardStorage: { state: 'unavailable', message: 'No storage' } }));
    expect(html).toContain('storageUnavailable');
    expect(html).toContain('No storage');
  });
});

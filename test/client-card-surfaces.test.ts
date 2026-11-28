/**
 * Server-rendered assertions for the user-visible card surfaces: the page
 * header icon, the per-card usage state and pin switch, and the avatar glyph
 * picker. A real dictionary is used so the assertions read the copy users see.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CARD_GLYPHS, type CharacterCard } from '../src/card-types.js';
import { CardAvatar } from '../src/client/CardAvatar.js';
import { CardEditor } from '../src/client/CardEditor.js';
import { en } from '../src/client/locales.js';
import { SubagentOptionsSection } from '../src/client/SubagentOptionsSection.js';
import { initialSubagentOptionsState, type SubagentOptionsState, type SubagentOptionsStore } from '../src/client/store.js';

const t = (key: keyof typeof en): string => en[key];

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

function renderPage(state: SubagentOptionsState): string {
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
      t,
      view: 'page',
    } as never),
  );
}

function card(id: string, name: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id,
    name,
    delegationGuidance: 'Guidance for ' + name,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const CARDS: CharacterCard[] = [
  card('used', 'Used', {}),
  card('stale', 'Stale', { createdAt: '2025-01-01T00:00:00.000Z' }),
  card('off', 'Off', { enabled: false }),
  card('pinned', 'Pinned', { neverClose: true, createdAt: '2025-01-01T00:00:00.000Z' }),
];

const USAGE = {
  used: { uses: 5, lastUsedAt: '2026-11-20T08:30:00.000Z' },
};

describe('card library page surfaces', () => {
  it('renders the director icon in the page header', () => {
    const html = renderPage(readyState({ cards: [] }));
    expect(html).toContain('sd-page-title-icon');
    expect(html).toContain('Character cards');
    expect(html).toContain('<circle cx="12" cy="4.8" r="2.3"');
  });

  it('shows the usage state, counters, and pin switch on every card', () => {
    const html = renderPage(readyState({ cards: CARDS, usage: USAGE, defaultCardId: undefined }));
    expect(html).toContain('5 uses');
    expect(html).toContain('Last used ');
    expect(html).toContain('Never used');
    expect(html).toContain('In use');
    expect(html).toContain('Closed pool');
    expect(html).toContain('Disabled');
    expect(html).toContain('Never close');
    expect((html.match(/type="checkbox" checked=""/g) ?? []).length).toBe(1);
  });

  it('offers the usage and usage-order toolbar choices', () => {
    const html = renderPage(readyState({ cards: CARDS, usage: USAGE }));
    for (const label of ['All', 'In use', 'Closed pool', 'Disabled', 'Weight', 'Recently used', 'Name']) {
      expect(html).toContain(label);
    }
  });

  it('renders a closed card as closed even though it stays delegatable', () => {
    const html = renderPage(readyState({ cards: [CARDS[1]!], usage: {} }));
    expect(html).toContain('Stale');
    expect(html).toContain('Closed pool');
    expect(html).not.toContain('No character cards yet');
  });
});

function renderEditor(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CardEditor, {
      open: true,
      routes: [],
      modelSelectionEnabled: false,
      existingIds: new Set<string>(),
      t,
      onClose: () => {},
      onSave: async () => undefined,
      ...overrides,
    } as never),
  );
}

describe('card editor avatar picker', () => {
  it('defaults to the name initial and offers every fixed glyph', () => {
    const html = renderEditor();
    expect(html).toContain('Use the name initial');
    expect(html).toContain('sd-avatar-option is-initial is-active');
    for (const glyph of CARD_GLYPHS) expect(html).toContain(glyph);
    expect(html).not.toContain('id="sd-card-emoji"');
    expect(html).toContain('sd-card-avatar sd-accent-blue is-lg');
  });

  it('keeps a glyph outside the fixed set as a replaceable custom value', () => {
    const html = renderEditor({ card: card('fox', 'Fox', { emoji: '🦊', accent: 'violet' }) });
    expect(html).toContain('Current custom glyph');
    expect(html).toContain('🦊');
    expect(html).toContain('sd-accent-violet');
    expect(html).not.toContain('sd-avatar-option is-initial is-active');
  });

  it('marks the stored fixed glyph as selected and hides the custom value', () => {
    const html = renderEditor({ card: card('compass', 'Compass', { emoji: '🧭' }) });
    expect(html).toContain('🧭');
    expect(html).not.toContain('Current custom glyph');
    expect(html).toContain('sd-avatar-option is-active');
  });
});

describe('shared card avatar', () => {
  it('renders the configured glyph, or the first name character as fallback', () => {
    const glyph = renderToStaticMarkup(createElement(CardAvatar, { name: 'Reviewer', emoji: '🛡', accent: 'rose' }));
    expect(glyph).toContain('🛡');
    expect(glyph).toContain('sd-accent-rose');

    const fallback = renderToStaticMarkup(createElement(CardAvatar, { name: 'reviewer' }));
    expect(fallback).toContain('>R<');
  });
});

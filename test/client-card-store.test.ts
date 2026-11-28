/**
 * Client store contract for the card library: the snapshot carries usage
 * counters, pin/unpin go through the cardBatch action without touching
 * updatedAt on the client, and every rejected wire call surfaces localized
 * page copy instead of the host's English message.
 */
import { describe, it, expect } from 'vitest';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { CardLibrarySnapshot, CharacterCard } from '../src/card-types.js';
import { SubagentOptionsStore } from '../src/client/store.js';

const CARD: CharacterCard = {
  id: 'alpha',
  name: 'Alpha',
  delegationGuidance: 'Use Alpha for reviews.',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function library(overrides: Partial<CardLibrarySnapshot> = {}): CardLibrarySnapshot {
  return {
    storage: { state: 'ready' },
    cards: [CARD],
    usage: { alpha: { uses: 3, lastUsedAt: '2026-11-20T08:30:00.000Z' } },
    legacyRoles: [],
    ...overrides,
  };
}

type Reply = (endpoint: string, payload: unknown) => unknown;

function harness(reply: Reply) {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const rpc = {
    call: async (_channel: string, endpoint: string, payload: unknown) => {
      calls.push({ endpoint, payload });
      return await reply(endpoint, payload);
    },
  };
  const store = new SubagentOptionsStore({
    rpc: rpc as unknown as ClientConnectionRpc,
    t: (key: string) => 'T:' + key,
  });
  return { store, calls };
}

function viewReply(): unknown {
  return { ok: true, value: { writable: true, view: { revision: 1, value: {} } } };
}

describe('card library store', () => {
  it('keeps the usage counters and pin state from the acknowledged library', async () => {
    let current = library();
    const { store, calls } = harness((endpoint) => {
      if (endpoint === 'settingsView') return viewReply();
      if (endpoint === 'settingsCatalog') return { ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } };
      if (endpoint === 'cardList') return { ok: true, value: current };
      if (endpoint === 'cardBatch') {
        current = library({ cards: [{ ...CARD, neverClose: true }] });
        return { ok: true, value: { library: current, cards: current.cards, removed: [] } };
      }
      return { ok: false, error: { code: 'bad-request', message: 'unexpected endpoint ' + endpoint } };
    });

    await store.load();
    expect(store.store.getSnapshot().usage).toEqual({
      alpha: { uses: 3, lastUsedAt: '2026-11-20T08:30:00.000Z' },
    });

    expect(await store.batchCards('pin', ['alpha'])).toBeUndefined();
    expect(calls.at(-1)).toEqual({ endpoint: 'cardBatch', payload: { ids: ['alpha'], action: 'pin' } });
    const pinned = store.store.getSnapshot();
    expect(pinned.cards[0]?.neverClose).toBe(true);
    expect(pinned.cards[0]?.updatedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(pinned.usage.alpha?.uses).toBe(3);

    await store.batchCards('unpin', ['alpha']);
    expect(calls.at(-1)).toEqual({ endpoint: 'cardBatch', payload: { ids: ['alpha'], action: 'unpin' } });
  });

  it('maps rejected bridge codes to localized copy instead of the host message', async () => {
    const { store } = harness(() => ({
      ok: false,
      error: { code: 'bad-request', message: 'cardBatch: expected { ids, action }' },
    }));
    expect(await store.batchCards('pin', ['alpha'])).toBe('T:requestRejected');

    const internal = harness(() => ({
      ok: false,
      error: { code: 'internal', message: 'card library unavailable' },
    }));
    expect(await internal.store.batchCards('pin', ['alpha'])).toBe('T:requestFailed');
  });

  it('reports a settings conflict with the conflict copy', async () => {
    const { store } = harness(() => ({
      ok: false,
      error: { code: 'settings-conflict', message: 'The settings changed on the server.' },
    }));
    expect(await store.setDefaultModel({ provider: 'p', model: 'm' })).toBe('T:conflict');
  });

  it('degrades a failing bridge call into localized page copy, not English', async () => {
    const { store } = harness((endpoint) => {
      if (endpoint === 'settingsView') return viewReply();
      throw new Error('socket closed');
    });
    await store.load();
    const state = store.store.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.allowedRoutes).toEqual([]);
    expect(state.cardStorage).toEqual({ state: 'error' });
  });

  it('does not pass an internal English message through to the card banner', async () => {
    const { store } = harness((endpoint) => {
      if (endpoint === 'settingsView') return viewReply();
      if (endpoint === 'settingsCatalog') return { ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } };
      return { ok: false, error: { code: 'internal', message: 'card library unavailable' } };
    });
    await store.load();
    const state = store.store.getSnapshot();
    expect(state.cardStorage).toEqual({ state: 'error' });
    expect(JSON.stringify(state)).not.toContain('card library unavailable');
  });

  it('drops the host storage diagnostic from an acknowledged library', async () => {
    const { store } = harness((endpoint) => {
      if (endpoint === 'settingsView') return viewReply();
      if (endpoint === 'settingsCatalog') return { ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } };
      return {
        ok: true,
        value: library({ storage: { state: 'error', message: 'EACCES: permission denied, open /root/storage' } }),
      };
    });
    await store.load();
    const state = store.store.getSnapshot();
    expect(state.cardStorage).toEqual({ state: 'error' });
    expect(JSON.stringify(state.cardStorage)).not.toContain('EACCES');
  });

  it('keeps the host clear-error diagnostic off the migration outcome', async () => {
    const migratedLibrary = library({ legacyRoles: [] });
    const { store } = harness(() => ({
      ok: true,
      value: {
        result: { migrated: ['alpha'], skipped: [], failed: [], remainingLegacy: [] },
        library: migratedLibrary,
        cleared: false,
        clearError: 'settings mutate failed: EACCES permission denied',
      },
    }));
    const outcome = await store.migrateLegacy(true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({
      result: { migrated: ['alpha'], skipped: [], failed: [], remainingLegacy: [] },
      cleared: false,
    });
    expect('clearError' in outcome.value).toBe(false);
  });
});

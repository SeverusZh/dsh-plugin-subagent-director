/**
 * Real-cordis probe for the client half on the alpha.4/alpha.5 host line.
 *
 * Unlike the pure unit tests, this boots a GENUINE cordis Context and mounts
 * the real client entry (`src/client/index.ts`) against alpha.4-shaped stub
 * services (slots registry, locale runtime, remote event bus, connection
 * handle). It proves the client half actually APPLIES on the alpha host
 * contract — the regression that the rc-era `dsh-client-runtime` import
 * broke at bundle load:
 *
 *   a) the settings section, the composer-dock readout, and the header close
 *      action all register through the slots seam;
 *   b) the dock's injected face carries the alpha.4 chat-snapshot hook
 *      (`useChatSnapshot`) next to the RPC caller — the data source that
 *      replaced the removed `ConversationSnapshot.nodes` owner prop;
 *   c) the chat-snapshot source resolves the uiConversation service lazily
 *      (the settings page must not depend on the conversation UI).
 */
import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { name as pluginName, inject as pluginInject, apply } from '../src/client/index.js';

/** Let cordis fiber loads / reactivations settle (they resolve in microtasks). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** Fake slots registry recording registrations and running inject fns. */
function slotsStub() {
  const registrations: Array<{ name: string; id: string; inject?: () => unknown }> = [];
  return {
    registrations,
    inject: (_key: string, fn: () => unknown) => {
      fn();
      return () => {};
    },
    register: (opts: { name: string; id: string; inject?: () => unknown }, _component: unknown) => {
      registrations.push(opts);
      return () => {};
    },
  };
}

/** Fake locale runtime: register dictionaries, bind a key-returning t. */
function localeStub() {
  const namespaces: string[] = [];
  return {
    namespaces,
    register: (ns: string) => {
      namespaces.push(ns);
      return () => {};
    },
    bind: () => (key: string) => key,
  };
}

/** Fake remote event bus: $on records topics and returns a disposer. */
function remoteStub() {
  const topics: string[] = [];
  return {
    topics,
    $on: (topic: string) => {
      topics.push(topic);
      return () => {};
    },
  };
}

/** Fake connection handle: a generic RPC caller that answers ok. */
function connectionStub() {
  return {
    rpc: {
      call: async () => ({ ok: true as const, value: {} }),
    },
  };
}

/** Mount the client entry on a real Context with the stub services. */
function loadClient(ctx: Context, slots: ReturnType<typeof slotsStub>, locale: ReturnType<typeof localeStub>, remote: ReturnType<typeof remoteStub>, connection: ReturnType<typeof connectionStub>): void {
  ctx.provide('slots', slots);
  ctx.provide('locale', locale);
  ctx.provide('remote', remote);
  ctx.provide('connection', connection);
  void ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
}

describe('real cordis probe — client half mounts on alpha.4-shaped services', () => {
  it('registers the settings section, the composer dock, and the header close action', async () => {
    const ctx = new Context();
    const slots = slotsStub();
    const locale = localeStub();
    const remote = remoteStub();
    const connection = connectionStub();
    loadClient(ctx, slots, locale, remote, connection);
    await settle();

    const names = slots.registrations.map((r) => r.name);
    expect(names).toContain('settings.section');
    expect(names).toContain('conversation.composer.dock');
    expect(names).toContain('conversation.session.header.actions');
    expect(locale.namespaces).toContain('settings.subagentDirector');
    expect(remote.topics).toEqual(
      expect.arrayContaining(['settings/document-updated', 'llm/adapters-updated']),
    );
  });

  it('injects the alpha.4 chat-snapshot hook into the dock entry', async () => {
    const ctx = new Context();
    const slots = slotsStub();
    loadClient(ctx, slots, localeStub(), remoteStub(), connectionStub());
    await settle();

    const dock = slots.registrations.find((r) => r.name === 'conversation.composer.dock');
    expect(dock).toBeDefined();
    const injected = dock!.inject!() as { rpc?: unknown; useChatSnapshot?: unknown };
    expect(typeof injected.rpc).toBe('object');
    expect(typeof injected.useChatSnapshot).toBe('function');
  });

  it('keeps the settings page independent of the conversation UI (lazy uiConversation)', async () => {
    const ctx = new Context();
    const slots = slotsStub();
    // No uiConversation service provided: apply must still mount and the
    // settings section must register (the chat source is only resolved at
    // render time, inside the conversation shell).
    loadClient(ctx, slots, localeStub(), remoteStub(), connectionStub());
    await settle();

    expect(slots.registrations.map((r) => r.name)).toContain('settings.section');
    expect(slots.registrations.map((r) => r.name)).toContain('conversation.composer.dock');
  });
});

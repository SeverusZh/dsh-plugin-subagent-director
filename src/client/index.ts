/**
 * Subagent Director — browser half (DSH client plugin).
 *
 * Registers the `settings.section` page that lets a user pick the default LLM
 * provider/model for subagents and manage role templates (each binds a persona
 * and optional provider/model to a delegation). Data flows through the
 * connection's wire API into a snapshot store; writes travel as path ops
 * through settings.mutate with an optimistic-revision lock.
 *
 * On the DSH alpha.4/alpha.5 host line the client context is the plain cordis
 * Context (the client service merges come from the imported client packages),
 * the store runtime is `@deepseek-ai/dsh-client-store`, and the composer-dock
 * readout reads the current session's chat-view snapshot through the
 * uiConversation binding (see SubagentModelDock).
 */
import { useSyncExternalStore } from 'react';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
// Type-only: pulls the ui-conversation SlotMap + Context merges (the dock and
// header-action seats, and the uiConversation service) into this compilation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
// Type-only: pulls the ui-renderer Context merge (ctx.slots) and the
// api-remotes Context merge (ctx.remote) into this compilation.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { bindSnapshotSelector } from './bind.js';
import { en, zh, type SubagentDirectorKey } from './locales.js';
import { SubagentOptionsStore, type SubagentOptionsState } from './store.js';
import type { SubagentOptionsSectionInjected } from './SubagentOptionsSection.js';
import { SubagentOptionsSection } from './SubagentOptionsSection.js';
import { SubagentModelDock, type SubagentModelDockInjected } from './SubagentModelDock.js';
import { SubagentCloseAction, type SubagentCloseActionInjected } from './SubagentCloseAction.js';

/** Dictionary namespace owned by Subagent Director (bilingual, typed). */
export const NS = 'settings.subagentDirector';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent Director settings-page copy. */
    'settings.subagentDirector': SubagentDirectorKey;
  }
}

export { en, zh };
export type { SubagentDirectorKey } from './locales.js';
export type { SubagentOptionsSectionInjected, SubagentOptionsSectionProps } from './SubagentOptionsSection.js';
export type { SubagentOptionsState, SubagentOptionsStore } from './store.js';

/** Refetch the page snapshot only after its first load. */
export function refreshIfLoaded(controller: SubagentOptionsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return;
  void controller.load();
}

/** Services required by the settings registration (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote'];

/**
 * Register the Subagent Director section once the `settings.section`
 * declaration is on the ledger, wire its store to the connection, and keep it
 * fresh on every pushed invalidation (settings or provider topology).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'subagent-director: copy dictionaries');

  // ctx.get('connection') is typed as the host HostConnectionHandle when the
  // host connection package (pulled in by ../remote.ts) augments Context; the
  // client ConnectionHandle is what the browser transport actually provides.
  const connection = ctx.get('connection') as unknown as ConnectionHandle;
  const t = ctx.locale.bind(NS);
  // The settings namespace and the Subagent model-selection allowlist ride the
  // self-published /subagent-director RPC channel (the Host apiproxy allowlist
  // would answer settings-not-exposed; the alpha.4 client has no llm catalog
  // RPC anymore), so the page's only wire face is the generic RPC caller.
  const controller = new SubagentOptionsStore({
    rpc: connection.rpc,
    t: t as (key: SubagentDirectorKey) => string,
  });
  const useSnapshot = bindSnapshotSelector<SubagentOptionsState>(controller.store);
  const injected = (): SubagentOptionsSectionInjected => ({
    controller,
    useSnapshot,
    t: t as SubagentOptionsSectionInjected['t'],
  });

  // Per-session chat-view snapshot sources for the composer-dock readout.
  // The uiConversation service is read lazily (the dock only renders inside
  // the conversation shell, where the service is live) so the settings page
  // does not depend on the conversation UI being present.
  const chatSources = new Map<string, ObservableSnapshot<ChatSnapshot | undefined>>();
  const chatSource = (sessionId: SessionId): ObservableSnapshot<ChatSnapshot | undefined> => {
    let source = chatSources.get(sessionId);
    if (source === undefined) {
      const uiConversation = ctx.get('uiConversation');
      if (uiConversation === undefined) {
        source = { getSnapshot: () => undefined, subscribe: () => () => {} };
      } else {
        const target = uiConversation.binding(sessionId).target('chat');
        source = {
          getSnapshot: () => target.getSnapshot(),
          subscribe: (listener) => target.subscribe(listener),
        };
      }
      chatSources.set(sessionId, source);
    }
    return source;
  };
  const useChatSnapshot = (sessionId: SessionId | undefined): ChatSnapshot | undefined =>
    useSyncExternalStore(
      (listener) => (sessionId === undefined ? () => {} : chatSource(sessionId).subscribe(listener)),
      () => (sessionId === undefined ? undefined : chatSource(sessionId).getSnapshot()),
    );

  const dockInjected = (): SubagentModelDockInjected => ({ rpc: connection.rpc, useChatSnapshot });
  const closeInjected = (): SubagentCloseActionInjected => ({ rpc: connection.rpc });

  ctx.effect(() => {
    const refresh = (): void => refreshIfLoaded(controller);
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'subagent-director: pushed invalidations');

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'subagent-director',
        order: 20,
        label: (): string => t('nav'),
        locale: NS,
        inject: injected,
      },
      SubagentOptionsSection,
    ),
  );

  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'subagent-director-model',
        order: 90,
        locale: NS,
        inject: dockInjected,
      },
      SubagentModelDock,
    ),
  );

  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'subagent-director-close',
        order: 20,
        locale: NS,
        inject: closeInjected,
      },
      SubagentCloseAction,
    ),
  );
}

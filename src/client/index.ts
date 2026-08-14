/**
 * Subagent Director — browser half (DSH client plugin).
 *
 * Registers the `settings.section` page that lets a user pick the default LLM
 * provider/model for subagents and manage role templates (each binds a persona
 * and optional provider/model to a delegation). Data flows through the
 * connection's wire API into a snapshot store; writes travel as path ops
 * through settings.mutate with an optimistic-revision lock.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { ClientContext, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react';
import { en, zh, type SubagentDirectorKey } from './locales.js';
import { SubagentOptionsStore, type SubagentOptionsState } from './store.js';
import type { SubagentOptionsSectionInjected } from './SubagentOptionsSection.js';
import { SubagentOptionsSection } from './SubagentOptionsSection.js';
import { SubagentModelDock } from './SubagentModelDock.js';

/** Dictionary namespace owned by Subagent Director (bilingual, typed). */
export const NS = 'settings.subagentDirector';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent Director settings-page copy. */
    'settings.subagentDirector': SubagentDirectorKey;
  }
}
/**
 * Compile-time view of `conversation.composer.dock`: declared here only to
 * strongly type our occupant. The runtime seat is owned by
 * dsh-client-ui-conversation's bundle; this augmentation contributes no
 * runtime declaration (it stays in this package's own module scope).
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.composer.dock': {
      kind: 'list';
      scope: 'session';
      owner: { readonly session: ConversationSnapshot | undefined; readonly input: unknown };
    };
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
  // The settings namespace rides the self-published /subagent-director RPC
  // channel (the Host apiproxy allowlist would answer settings-not-exposed);
  // llm.providers/llm.models still go through connection.api.llm.
  const controller = new SubagentOptionsStore({
    rpc: connection.rpc,
    llm: connection.api.llm,
    t: t as (key: SubagentDirectorKey) => string,
  });
  const useSnapshot = bindSnapshotSelector<SubagentOptionsState>(controller.store);
  const injected = (): SubagentOptionsSectionInjected => ({
    controller,
    useSnapshot,
    api: connection.api,
    t: t as SubagentOptionsSectionInjected['t'],
  });

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
      },
      SubagentModelDock,
    ),
  );
}

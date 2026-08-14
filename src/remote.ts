/**
 * Subagent Director — self-published setting bridge (design addition for the
 * "namespace not exposed" fix).
 *
 * The Web settings client read/writes the plugin's `subagent-director`
 * namespace through `connection.api.settings.describe/mutate`, which the host
 * API proxy gates behind its hard-coded `exposedNamespaces()` allowlist
 * (dsh-host-apiproxy). A tree-external plugin cannot add its own namespace to
 * that list, so those calls answer `settings-not-exposed`. To bypass the
 * allowlist without touching apiproxy, this module self-publishes a dedicated
 * direct RPC channel (`/subagent-director`) via
 * `ctx.connection.rpc.handle(...)`, reading and writing `ctx.settings` itself.
 *
 * The wire contract mirrors the settings domain slice apiproxy exposes for
 * one namespace: `settingsView` returns `{ writable, view }` where `view` is a
 * `SettingsNamespaceView` (redacted), and `settingsMutate` applies path ops
 * with an optimistic `expectedRevision` and returns the new redacted view, or
 * an error with the same `settings-conflict` / `settings-rejected` semantics so
 * the existing client conflict-reload logic works unchanged.
 *
 * Pure mapping helpers live at the top (no cordis) so the host side is
 * unit-testable in a plain node environment.
 */
import type { Context } from '@deepseek-ai/cordis';
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings';
import type {
  RpcResult,
  RpcError,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-host-apiproxy/api';
import type {
  ConnectionRpcHandler,
  HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection';
import {
  SettingsSchema,
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
} from './settings.js';
import {
  SUBAGENT_DIRECTOR_RPC_CHANNEL,
  SUBAGENT_DIRECTOR_RPC_VIEW,
  SUBAGENT_DIRECTOR_RPC_MUTATE,
  type DirectorMutateRequest,
  type DirectorViewSuccess,
} from './bridge-contract.js';

/** Wire channel/endpoint constants shared with the client (see bridge-contract). */
export {
  SUBAGENT_DIRECTOR_RPC_CHANNEL,
  SUBAGENT_DIRECTOR_RPC_VIEW,
  SUBAGENT_DIRECTOR_RPC_MUTATE,
};
/** Request payload for the settingsMutate bridge endpoint. */
export type { DirectorMutateRequest, DirectorViewSuccess };

/**
 * Map one redacted settings descriptor to its wire view — mirrors apiproxy's
 * `namespaceView` (dsh-host-apiproxy/lib/index.js:2385-2399) exactly, so the
 * client store sees the same `SettingsNamespaceView` shape it already renders.
 */
export function toDirectorNamespaceView(descriptor: SettingsDescriptor): SettingsNamespaceView {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema,
    value: descriptor.value,
    ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    applies: descriptor.applies,
    secrets: (descriptor.secrets ?? []).map((secret) => ({
      path: [...secret.path],
      set: secret.set,
    })),
    revision: descriptor.revision,
  };
}

/**
 * Find the Subagent Director namespace in a redacted describe result and map
 * it to its wire view; `undefined` when the namespace is not registered.
 */
export function pickDirectorNamespaceView(
  descriptors: readonly SettingsDescriptor[],
): SettingsNamespaceView | undefined {
  for (const descriptor of descriptors) {
    if (descriptor.ns === SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE) {
      return toDirectorNamespaceView(descriptor);
    }
  }
  return undefined;
}

/**
 * Read the current redacted namespace view straight from the settings seam.
 * Exported for reuse by tests and by the bridge handler.
 */
export function readDirectorNamespaceView(settings: SettingsProvider): DirectorViewSuccess {
  const descriptors = settings.describe({ redactSecrets: true });
  return {
    writable: settings.writable,
    view: pickDirectorNamespaceView(descriptors),
  };
}

/** Build the `settings-rejected` RPC error for one seam failure. */
export function directorRejected(ns: string, error: unknown): RpcError {
  return {
    code: 'settings-rejected',
    message: error instanceof Error ? error.message : String(error),
    details: { ns },
  };
}

/** Build the `settings-conflict` RPC error, mirroring apiproxy's mapping. */
export function directorConflict(conflict: SettingsConflictError): RpcError {
  // The runtime carries the branded namespace; the service type does not
  // declare it, so recover it structurally for the details payload.
  const ns = (conflict as unknown as { ns?: unknown }).ns;
  return {
    code: 'settings-conflict',
    message: conflict.message,
    details: {
      ns: ns === undefined ? 'subagent-director' : String(ns),
      expected: conflict.expected,
      actual: conflict.actual,
    },
  };
}

/**
 * Build the ok payload for the settingsView endpoint.
 * Mirrors the apiproxy `settings.describe` value minus `hasDocument` (the
 * bridge does not own the document affordance; the client ignores it).
 */
export function directorViewOk(settings: SettingsProvider): RpcResult<DirectorViewSuccess> {
  return { ok: true, value: readDirectorNamespaceView(settings) };
}

/**
 * Execute one path-op mutation against the settings seam and map the outcome
 * to an RpcResult carrying the new redacted view (or a `settings-conflict` /
 * `settings-rejected` error). Pure over the injected primitives for testing.
 */
export async function directorMutate(
  mutate: SettingsProvider['mutate'],
  describe: SettingsProvider['describe'],
  ns: string,
  ops: readonly SettingsPathOpView[],
  expectedRevision: number | undefined,
): Promise<RpcResult<SettingsNamespaceView>> {
  const branded = settingsNamespace(ns);
  try {
    await mutate(branded, ops, expectedRevision);
  } catch (error) {
    if (error instanceof SettingsConflictError) {
      return { ok: false, error: directorConflict(error) };
    }
    return { ok: false, error: directorRejected(ns, error) };
  }
  const descriptor = describe({ redactSecrets: true }).find(
    (candidate) => candidate.ns === branded,
  );
  if (descriptor === undefined) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: 'settings namespace "' + ns + '" was disposed after the mutate',
        details: {},
      },
    };
  }
  return { ok: true, value: toDirectorNamespaceView(descriptor) };
}

/**
 * Install the Subagent Director setting bridge on the Host web transport.
 * Registered only while both a settings provider (`ctx.settings`) and a
 * connection transport (`ctx.connection`) are mounted, so a deployment without
 * either degrades to the previous behavior. Returns a disposer.
 */
export function installDirectorRemoteBridge(ctx: Context): () => void {
  const settings = ctx.get('settings') as SettingsProvider | undefined;
  const connection = ctx.get('connection') as HostConnectionHandle | undefined;
  if (settings === undefined || connection === undefined) {
    ctx.logger.debug(
      '[subagent-director] settings bridge not installed ' +
        '(settings:' + String(settings !== undefined) +
        ', connection:' + String(connection !== undefined) + ')',
    );
    return () => {};
  }

  const handler: ConnectionRpcHandler = async (endpoint, payload) => {
    if (endpoint === SUBAGENT_DIRECTOR_RPC_VIEW) {
      return directorViewOk(settings);
    }
    if (endpoint === SUBAGENT_DIRECTOR_RPC_MUTATE) {
      const request = payload as DirectorMutateRequest | null;
      if (request?.ns !== String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE)) {
        return {
          ok: false,
          error: {
            code: 'bad-request',
            message: 'settingsMutate: expected ns "' + String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE) + '"',
            details: { issues: [] },
          },
        } as RpcResult<SettingsNamespaceView>;
      }
      const ops = request?.ops ?? [];
      return directorMutate(
        (n, o, r) => settings.mutate(n, o, r),
        (opts) => settings.describe(opts),
        String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE),
        ops,
        request?.expectedRevision,
      );
    }
    return {
      ok: false,
      error: {
        code: 'bad-request',
        message: 'unknown bridge endpoint ' + JSON.stringify(endpoint),
        details: { issues: [] },
      },
    } as RpcResult<unknown>;
  };

  return connection.rpc.handle(
    SUBAGENT_DIRECTOR_RPC_CHANNEL,
    handler,
    { authority: 'loopback' },
  );
}

/** Convenience re-export for the namespaced schema used to document the view. */
export { SettingsSchema };

/**
 * Subagent Director settings page store: one snapshot joining the configurable
 * provider directory (llm.providers), the model catalog (llm.models), and the
 * plugin's own settings namespace. The settings namespace is read/written
 * through the plugin's self-published `/subagent-director` RPC channel (see
 * ../remote.ts) because the Host apiproxy's exposedNamespaces() allowlist
 * answers `settings-not-exposed` for namespaces outside the model-provider
 * plane; llm.providers/llm.models still ride `connection.api.llm`. The host
 * stays the single fact source: every write travels as path ops through the
 * bridge's settingsMutate endpoint with an expectedRevision optimistic lock,
 * and pushed invalidations (settings/document-updated, llm/adapters-updated,
 * connection/reset) refresh the page.
 */
import type {
  ClientConnectionRpc,
  ConfigurableProviderView,
  IApiClient,
  ModelProviderGroup,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-client-connection/client';
import {
  SUBAGENT_DIRECTOR_RPC_CHANNEL,
  SUBAGENT_DIRECTOR_RPC_VIEW,
  SUBAGENT_DIRECTOR_RPC_MUTATE,
  type DirectorViewSuccess,
} from '../bridge-contract.js';
import type { SubagentDirectorKey } from './locales.js';
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import {
  addRoleOps,
  classifyMutateError,
  defaultModelOps,
  removeRoleOps,
  restoreDefaultsOps,
  setDefaultRoleOps,
  updateRoleOps,
  type DefaultModelEdits,
  type MutationErrorKind,
  type RoleDraft,
  type StoredRole,
  type StoredSection,
} from './store-logic.js';

/** The settings namespace this page reads and writes. */
export const SUBAGENT_DIRECTOR_NS = 'subagent-director';

/** Page snapshot rendered by the section component. */
export interface SubagentOptionsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Whole-load failure text; write failures stay in the calling card. */
  error: string | null;
  /** Whether the settings provider accepts writes. */
  writable: boolean;
  /** Namespace view (redacted). */
  namespace: SettingsNamespaceView | undefined;
  /** The plugin's own user-layer section, cast to its known shape. */
  section: StoredSection | undefined;
  /** Current expectedRevision for the next mutate. */
  revision: number;
  /** Configurable provider directory. */
  providers: readonly ConfigurableProviderView[];
  /** Model catalog groups (provider → models → reasoning efforts). */
  models: readonly ModelProviderGroup[];
  /** The plugin name surfaced to the section. */
  loading: boolean;
}

/** Initial empty snapshot. */
export function initialSubagentOptionsState(): SubagentOptionsState {
  return {
    status: 'idle',
    error: null,
    writable: true,
    namespace: undefined,
    section: undefined,
    revision: 0,
    providers: [],
    models: [],
    loading: false,
  };
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

/**
 * Raised when the /subagent-director bridge channel is not reachable on the
 * current transport (a Host that predates the bridge answers nothing). The
 * store surfaces this as the localized `bridgeUnavailable` copy instead of a
 * raw transport string.
 */
export class BridgeUnavailableError extends Error {
  constructor() {
    super('Subagent Director settings bridge (/subagent-director) is not available on this server');
  }
}

/** Whether a thrown value means the bridge channel could not be called at all. */
export function isBridgeUnavailable(error: unknown): boolean {
  return error instanceof BridgeUnavailableError;
}

/** Wire faces the settings page needs: the bridge RPC caller, the llm face, and copy. */
export interface StoreWire {
  /** Generic RPC caller for the self-published /subagent-director channel. */
  rpc: ClientConnectionRpc;
  /** llm catalog/adapters face (still connection.api.llm). */
  llm: IApiClient['llm'];
  /** Section copy binder (for the localized bridge-unavailable message). */
  t: (key: SubagentDirectorKey) => string;
}

/** The settings page controller (one per settings surface). */
export class SubagentOptionsStore {
  readonly store: SnapshotStore<SubagentOptionsState>;
  private readonly wire: StoreWire;
  private generation = 0;

  constructor(wire: StoreWire) {
    this.wire = wire;
    this.store = createSnapshotStore<SubagentOptionsState>(initialSubagentOptionsState());
  }

  /**
   * Call one bridge endpoint over the generic RPC channel. Returns the RpcResult
   * (ok or error branch). A transport-level rejection — the Host has no
   * /subagent-director channel — is folded into BridgeUnavailableError so the
   * caller can show the localized message.
   */
  private async callBridge<T>(endpoint: string, payload?: unknown): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    let result;
    try {
      result = (await this.wire.rpc.call(SUBAGENT_DIRECTOR_RPC_CHANNEL, endpoint, payload)) as
        | { ok: true; value: T }
        | { ok: false; error: { code?: string; message?: string } };
    } catch (error) {
      throw new BridgeUnavailableError();
    }
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, value: result.value };
  }

  /** Refresh the whole page snapshot: provider directory + model catalog + own namespace. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.store.update((s) => {
      s.status = 'loading';
      s.error = null;
      s.loading = true;
    });
    try {
      const [providersResponse, modelsResponse, viewResult] = await Promise.all([
        this.wire.llm.providers({}),
        this.wire.llm.models({}),
        this.callBridge<DirectorViewSuccess>(SUBAGENT_DIRECTOR_RPC_VIEW),
      ]);
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message);
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message);
      if (!viewResult.ok) throw new Error(this.errorMessage(viewResult.error));
      if (generation !== this.generation) return;
      const view = viewResult.value.view;
      const section = (view?.value ?? {}) as StoredSection;
      const writable = viewResult.value.writable;
      const providers = providersResponse.result.value.providers;
      const models = modelsResponse.result.value.groups;
      this.store.update((s) => {
        s.status = 'ready';
        s.error = null;
        s.writable = writable;
        s.providers = providers;
        s.models = models;
        s.namespace = view;
        s.section = section;
        s.revision = view?.revision ?? 0;
        s.loading = false;
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.store.update((s) => {
        s.status = 'error';
        s.error = isBridgeUnavailable(error) ? this.wire.t('bridgeUnavailable') : messageOf(error);
        s.loading = false;
      });
    }
  }

  /** Human text for a bridge RPC error branch. */
  private errorMessage(error: unknown): string {
    if (error !== null && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: string }).message;
      if (typeof message === 'string') return message;
    }
    return messageOf(error);
  }

  /**
   * Run one mutate and update the snapshot's revision. Returns a failure
   * message (localized by the caller) or undefined on success. A
   * settings-conflict re-reads the namespace and returns the conflict kind so
   * the UI can show the "please review and retry" message.
   */
  private async mutate(ops: SettingsPathOpView[]): Promise<MutationOutcome> {
    const state = this.store.getSnapshot();
    const ns = SUBAGENT_DIRECTOR_NS;
    const revision = state.revision;
    let result;
    try {
      result = await this.callBridge<SettingsNamespaceView>(SUBAGENT_DIRECTOR_RPC_MUTATE, { ns, ops, expectedRevision: revision });
    } catch (error) {
      return {
        ok: false,
        kind: 'fatal',
        message: isBridgeUnavailable(error) ? this.wire.t('bridgeUnavailable') : messageOf(error),
      };
    }
    if (result.ok) {
      const admitted = result.value;
      this.store.update((s) => {
        s.revision = admitted.revision;
        // Refresh the cached section/namespace from the acknowledged view.
        s.namespace = admitted;
        s.section = (admitted.value ?? {}) as StoredSection;
      });
      return { ok: true, kind: 'fatal', message: undefined };
    }
    const code = this.errorCode(result.error);
    const message = this.errorMessage(result.error);
    const kind = classifyMutateError(code, message);
    if (kind === 'conflict') {
      // Re-read the authoritative namespace so the user reviews fresh values.
      await this.reloadNamespace();
      return { ok: false, kind, message };
    }
    return { ok: false, kind, message };
  }

  private async reloadNamespace(): Promise<void> {
    try {
      const result = await this.callBridge<DirectorViewSuccess>(SUBAGENT_DIRECTOR_RPC_VIEW);
      if (!result.ok) return;
      const view = result.value.view;
      if (!view) return;
      this.store.update((s) => {
        s.namespace = view;
        s.section = (view.value ?? {}) as StoredSection;
        s.revision = view.revision;
        s.writable = result.value.writable;
      });
    } catch {
      /* keep last good snapshot */
    }
  }

  /** Error code of a bridge RPC error branch, when present. */
  private errorCode(error: unknown): string | undefined {
    if (error !== null && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  async addRole(id: string, draft: RoleDraft): Promise<string | undefined> {
    const result = await this.mutate(addRoleOps(id, draft));
    return result.ok ? undefined : result.message;
  }

  async updateRole(id: string, before: StoredRole | undefined, draft: RoleDraft): Promise<string | undefined> {
    const result = await this.mutate(updateRoleOps(id, before, draft));
    return result.ok ? undefined : result.message;
  }

  async removeRole(id: string): Promise<string | undefined> {
    const state = this.store.getSnapshot();
    const result = await this.mutate(removeRoleOps(id, { defaultRole: state.section?.defaultRole }));
    return result.ok ? undefined : result.message;
  }

  async setDefaultRole(id: string): Promise<string | undefined> {
    const result = await this.mutate(setDefaultRoleOps(id));
    return result.ok ? undefined : result.message;
  }

  async setDefaultModel(edits: DefaultModelEdits): Promise<string | undefined> {
    const state = this.store.getSnapshot();
    const result = await this.mutate(defaultModelOps(state.section ?? {}, edits));
    return result.ok ? undefined : result.message;
  }

  async restoreDefaults(): Promise<string | undefined> {
    const state = this.store.getSnapshot();
    const result = await this.mutate(restoreDefaultsOps(state.section ?? {}));
    return result.ok ? undefined : result.message;
  }
}

/** Outcome of one write so the UI can pick the right message. */
export interface MutationOutcome {
  ok: boolean;
  kind: MutationErrorKind;
  message: string | undefined;
}

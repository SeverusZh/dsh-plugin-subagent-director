/**
 * Subagent Director settings page store: one snapshot joining the configurable
 * provider directory (llm.providers), the model catalog (llm.models), and the
 * plugin's own settings namespace (settings.describe → the `subagent-director`
 * namespace). The host stays the single fact source: every write travels as
 * path ops through settings.mutate with an expectedRevision optimistic lock,
 * and pushed invalidations (settings/document-updated, llm/adapters-updated,
 * connection/reset) refresh the page.
 */
import type {
  ConfigurableProviderView,
  IApiClient,
  ModelProviderGroup,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-client-connection/client';
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

/** The settings page controller (one per settings surface). */
export class SubagentOptionsStore {
  readonly store: SnapshotStore<SubagentOptionsState>;
  private readonly api: Pick<IApiClient, 'settings' | 'llm'>;
  private generation = 0;

  constructor(api: Pick<IApiClient, 'settings' | 'llm'>) {
    this.api = api;
    this.store = createSnapshotStore<SubagentOptionsState>(initialSubagentOptionsState());
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
      const [providersResponse, settingsResponse, modelsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.settings.describe({}),
        this.api.llm.models({}),
      ]);
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message);
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message);
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message);
      if (generation !== this.generation) return;
      const namespace = settingsResponse.result.value.namespaces.find(
        (n) => n.ns === SUBAGENT_DIRECTOR_NS,
      );
      const section = (namespace?.value ?? {}) as StoredSection;
      const writable = settingsResponse.result.value.writable;
      const providers = providersResponse.result.value.providers;
      const models = modelsResponse.result.value.groups;
      this.store.update((s) => {
        s.status = 'ready';
        s.error = null;
        s.writable = writable;
        s.providers = providers;
        s.models = models;
        s.namespace = namespace;
        s.section = section;
        s.revision = namespace?.revision ?? 0;
        s.loading = false;
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.store.update((s) => {
        s.status = 'error';
        s.error = messageOf(error);
        s.loading = false;
      });
    }
  }

  /**
   * Run one mutate and update the snapshot's revision. Returns a failure
   * message (localized by the caller) or undefined on success. A
   * settings-conflict re-reads the namespace and returns the conflict kind so
   * the UI can show the "please review and retry" message.
   */
  private async mutate(ops: Parameters<IApiClient['settings']['mutate']>[0]['ops']): Promise<MutationOutcome> {
    const state = this.store.getSnapshot();
    const ns = SUBAGENT_DIRECTOR_NS;
    const revision = state.revision;
    let response;
    try {
      response = await this.api.settings.mutate({ ns, ops, expectedRevision: revision });
    } catch (error) {
      return { ok: false, kind: 'fatal', message: messageOf(error) };
    }
    if (response.result.ok) {
      const admitted = response.result.value;
      this.store.update((s) => {
        s.revision = admitted.revision;
        // Refresh the cached section/namespace from the acknowledged view.
        s.namespace = admitted;
        s.section = (admitted.value ?? {}) as StoredSection;
      });
      return { ok: true, kind: 'fatal', message: undefined };
    }
    const kind = classifyMutateError(response.result.error.code, response.result.error.message);
    if (kind === 'conflict') {
      // Re-read the authoritative namespace so the user reviews fresh values.
      await this.reloadNamespace();
      return { ok: false, kind, message: response.result.error.message };
    }
    return { ok: false, kind, message: response.result.error.message };
  }

  private async reloadNamespace(): Promise<void> {
    try {
      const settingsResponse = await this.api.settings.describe({});
      if (!settingsResponse.result.ok) return;
      const namespace = settingsResponse.result.value.namespaces.find(
        (n) => n.ns === SUBAGENT_DIRECTOR_NS,
      );
      if (!namespace) return;
      const writable = settingsResponse.result.value.writable;
      this.store.update((s) => {
        s.namespace = namespace;
        s.section = (namespace.value ?? {}) as StoredSection;
        s.revision = namespace.revision;
        s.writable = writable;
      });
    } catch {
      /* keep last good snapshot */
    }
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

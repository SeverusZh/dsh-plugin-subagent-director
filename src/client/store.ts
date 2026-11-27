/**
 * Character-card settings page store.
 *
 * One snapshot joins four host facts: the plugin's own settings namespace
 * (default model), the official Subagent model-selection allowlist, the
 * model-visible tool catalog, and the character-card library served by the
 * self-published `/subagent-director` bridge. Card writes never travel through
 * the public settings namespace: they call the card endpoints, which update the
 * independent per-card storage domain.
 *
 * Every write reloads the acknowledged library from the Host, so the page never
 * invents a local truth. Pushed invalidations (settings/document-updated,
 * llm/adapters-updated, connection/reset) refresh the whole snapshot.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types';
import {
  SUBAGENT_DIRECTOR_RPC_CHANNEL,
  SUBAGENT_DIRECTOR_RPC_VIEW,
  SUBAGENT_DIRECTOR_RPC_MUTATE,
  SUBAGENT_DIRECTOR_RPC_CATALOG,
  SUBAGENT_DIRECTOR_RPC_CARDS,
  SUBAGENT_DIRECTOR_RPC_CARD_PUT,
  SUBAGENT_DIRECTOR_RPC_CARD_DELETE,
  SUBAGENT_DIRECTOR_RPC_CARD_DEFAULT,
  SUBAGENT_DIRECTOR_RPC_CARD_IMPORT,
  SUBAGENT_DIRECTOR_RPC_CARD_EXPORT,
  SUBAGENT_DIRECTOR_RPC_CARD_MIGRATE,
  SUBAGENT_DIRECTOR_RPC_CARD_BATCH,
  type DirectorAllowedRoute,
  type DirectorCardBatchRequest,
  type DirectorCardBatchSuccess,
  type DirectorCardDefaultRequest,
  type DirectorCardDeleteRequest,
  type DirectorCardExportRequest,
  type DirectorCardExportSuccess,
  type DirectorCardImportRequest,
  type DirectorCardImportSuccess,
  type DirectorCardMigrateRequest,
  type DirectorCardMigrateSuccess,
  type DirectorCardPutRequest,
  type DirectorCardPutSuccess,
  type DirectorCatalogSuccess,
  type DirectorViewSuccess,
} from '../bridge-contract.js';
import type {
  CardImportResult,
  CardImportStrategy,
  CardLibrarySnapshot,
  CardMigrationResult,
  CardStorageStatus,
  CharacterCard,
  CharacterCardBundle,
} from '../card-types.js';
import type { SubagentDirectorKey } from './locales.js';
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import {
  classifyMutateError,
  defaultModelOps,
  restoreDefaultsOps,
  type DefaultModelEdits,
  type MutationErrorKind,
  type StoredSection,
} from './store-logic.js';

/** The settings namespace this page reads and writes for default model fields. */
export const SUBAGENT_DIRECTOR_NS = 'subagent-director';

/** Card-library snapshot held by the page. */
export interface SubagentOptionsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Whole-load failure text; write failures stay in the calling surface. */
  error: string | null;
  /** Whether the settings provider accepts writes. */
  writable: boolean;
  /** Namespace view (redacted). */
  namespace: SettingsNamespaceView | undefined;
  /** The plugin's own user-layer section, cast to its known shape. */
  section: StoredSection | undefined;
  /** Current expectedRevision for the next settings mutate. */
  revision: number;
  /** Whether the official Subagent model selection is enabled. */
  modelSelectionEnabled: boolean;
  /** Authorized exact routes; the only selectable provider/model pairs. */
  allowedRoutes: readonly DirectorAllowedRoute[];
  /** Character cards as acknowledged by the Host. */
  cards: CharacterCard[];
  /** Default card id stored in the card domain. */
  defaultCardId: string | undefined;
  /** Legacy settings role ids that still exist. */
  legacyRoles: string[];
  /** Legacy settings default role id. */
  legacyDefaultRole: string | undefined;
  /** Availability of the independent card storage. */
  cardStorage: CardStorageStatus;
  /** First-load indicator. */
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
    modelSelectionEnabled: false,
    allowedRoutes: [],
    cards: [],
    defaultCardId: undefined,
    legacyRoles: [],
    legacyDefaultRole: undefined,
    cardStorage: { state: 'unavailable' },
    loading: false,
  };
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

/** Raised when the /subagent-director bridge channel is not reachable. */
export class BridgeUnavailableError extends Error {
  constructor() {
    super('Subagent Director bridge (/subagent-director) is not available on this server');
  }
}

/** Whether a thrown value means the bridge channel could not be called. */
export function isBridgeUnavailable(error: unknown): boolean {
  return error instanceof BridgeUnavailableError;
}

/** Wire faces the page needs. */
export interface StoreWire {
  rpc: ClientConnectionRpc;
  t: (key: SubagentDirectorKey) => string;
}

/** Generic card action outcome with the host's message preserved. */
export type CardActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Outcome of one card import/export/migration action. */
export type CardImportOutcome = CardActionResult<CardImportResult>;
/** Export outcome. */
export type CardExportOutcome = CardActionResult<CharacterCardBundle>;
/** Migration outcome. */
export type CardMigrationOutcome = CardActionResult<{
  result: CardMigrationResult;
  cleared: boolean;
  clearError?: string;
}>;

/** The settings page controller. */
export class SubagentOptionsStore {
  readonly store: SnapshotStore<SubagentOptionsState>;
  private readonly wire: StoreWire;
  private generation = 0;

  constructor(wire: StoreWire) {
    this.wire = wire;
    this.store = createSnapshotStore<SubagentOptionsState>(initialSubagentOptionsState());
  }

  private async callBridge<T>(
    endpoint: string,
    payload?: unknown,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    let result;
    try {
      result = (await this.wire.rpc.call(SUBAGENT_DIRECTOR_RPC_CHANNEL, endpoint, payload)) as
        | { ok: true; value: T }
        | { ok: false; error: { code?: string; message?: string } };
    } catch {
      throw new BridgeUnavailableError();
    }
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }

  /** One card call, flattening a failure into a localizable message. */
  private async callCard<T>(endpoint: string, payload?: unknown): Promise<CardActionResult<T>> {
    try {
      const result = await this.callBridge<T>(endpoint, payload);
      if (!result.ok) return { ok: false, message: this.errorMessage(result.error) };
      return { ok: true, value: result.value };
    } catch (error) {
      return { ok: false, message: isBridgeUnavailable(error) ? this.wire.t('bridgeUnavailable') : messageOf(error) };
    }
  }

  /** Refresh the whole page snapshot. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.store.update((s) => {
      s.status = 'loading';
      s.error = null;
      s.loading = true;
    });
    try {
      const [viewResult, catalogResult, cardsResult] = await Promise.all([
        this.callBridge<DirectorViewSuccess>(SUBAGENT_DIRECTOR_RPC_VIEW),
        this.callBridge<DirectorCatalogSuccess>(SUBAGENT_DIRECTOR_RPC_CATALOG).catch(() => ({
          ok: false as const,
          error: { code: 'internal', message: 'model-selection catalog unavailable' },
        })),
        this.callBridge<CardLibrarySnapshot>(SUBAGENT_DIRECTOR_RPC_CARDS).catch(() => ({
          ok: false as const,
          error: { code: 'internal', message: 'card library unavailable' },
        })),
      ]);
      if (!viewResult.ok) throw new Error(this.errorMessage(viewResult.error));
      if (generation !== this.generation) return;
      const view = viewResult.value.view;
      const section = (view?.value ?? {}) as StoredSection;
      const catalog = catalogResult.ok ? catalogResult.value : { modelSelectionEnabled: false, allowedRoutes: [] };
      this.store.update((s) => {
        s.status = 'ready';
        s.error = null;
        s.writable = viewResult.value.writable;
        s.modelSelectionEnabled = catalog.modelSelectionEnabled;
        s.allowedRoutes = catalog.allowedRoutes;
        s.namespace = view;
        s.section = section;
        s.revision = view?.revision ?? 0;
        s.loading = false;
        if (cardsResult.ok) {
          this.applyLibraryTo(s, cardsResult.value);
        } else {
          s.cards = [];
          s.legacyRoles = [];
          s.cardStorage = { state: 'error', message: this.errorMessage(cardsResult.error) };
        }
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

  private applyLibraryTo(state: SubagentOptionsState, library: CardLibrarySnapshot): void {
    state.cards = library.cards;
    state.defaultCardId = library.defaultCardId;
    state.legacyRoles = library.legacyRoles;
    state.legacyDefaultRole = library.legacyDefaultRole;
    state.cardStorage = library.storage;
  }

  private commitLibrary(library: CardLibrarySnapshot): void {
    this.store.update((s) => this.applyLibraryTo(s, library));
  }

  private errorMessage(error: unknown): string {
    if (error !== null && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: string }).message;
      if (typeof message === 'string') return message;
    }
    return messageOf(error);
  }

  // ---- character cards ----------------------------------------------------

  /** Refresh only the card library. */
  async refreshCards(): Promise<void> {
    const result = await this.callCard<CardLibrarySnapshot>(SUBAGENT_DIRECTOR_RPC_CARDS);
    if (result.ok) this.commitLibrary(result.value);
  }

  /** Create or update one card. */
  async saveCard(card: CharacterCard, create: boolean): Promise<string | undefined> {
    const payload: DirectorCardPutRequest = { card, create };
    const result = await this.callCard<DirectorCardPutSuccess>(SUBAGENT_DIRECTOR_RPC_CARD_PUT, payload);
    if (!result.ok) return result.message;
    this.commitLibrary(result.value.library);
    return undefined;
  }

  /** Delete one or more cards. */
  async deleteCards(ids: readonly string[]): Promise<string | undefined> {
    const payload: DirectorCardDeleteRequest = { ids: [...ids] };
    const result = await this.callCard<{ library: CardLibrarySnapshot }>(SUBAGENT_DIRECTOR_RPC_CARD_DELETE, payload);
    if (!result.ok) return result.message;
    this.commitLibrary(result.value.library);
    return undefined;
  }

  /** Set or clear the default card. */
  async setDefaultCard(id: string | undefined): Promise<string | undefined> {
    const payload: DirectorCardDefaultRequest = id === undefined ? {} : { id };
    const result = await this.callCard<{ library: CardLibrarySnapshot }>(SUBAGENT_DIRECTOR_RPC_CARD_DEFAULT, payload);
    if (!result.ok) return result.message;
    this.commitLibrary(result.value.library);
    return undefined;
  }

  /** Enable/disable/delete a card selection. */
  async batchCards(action: DirectorCardBatchRequest['action'], ids: readonly string[]): Promise<string | undefined> {
    const payload: DirectorCardBatchRequest = { action, ids: [...ids] };
    const result = await this.callCard<DirectorCardBatchSuccess>(SUBAGENT_DIRECTOR_RPC_CARD_BATCH, payload);
    if (!result.ok) return result.message;
    this.commitLibrary(result.value.library);
    return undefined;
  }

  /** Import a portable payload under the chosen conflict strategy. */
  async importCards(payload: unknown, strategy: CardImportStrategy): Promise<CardImportOutcome> {
    const request: DirectorCardImportRequest = { payload, strategy };
    const result = await this.callCard<DirectorCardImportSuccess>(SUBAGENT_DIRECTOR_RPC_CARD_IMPORT, request);
    if (!result.ok) return result;
    this.commitLibrary(result.value.library);
    return { ok: true, value: result.value.result };
  }

  /** Export all cards or a selection. */
  async exportCards(ids?: readonly string[]): Promise<CardExportOutcome> {
    const request: DirectorCardExportRequest = ids === undefined ? {} : { ids: [...ids] };
    const result = await this.callCard<DirectorCardExportSuccess>(SUBAGENT_DIRECTOR_RPC_CARD_EXPORT, request);
    if (!result.ok) return result;
    return { ok: true, value: result.value.bundle };
  }

  /** Migrate legacy settings roles; optionally clear the legacy fields. */
  async migrateLegacy(clearLegacy: boolean): Promise<CardMigrationOutcome> {
    const request: DirectorCardMigrateRequest = { clearLegacy };
    const result = await this.callCard<DirectorCardMigrateSuccess>(SUBAGENT_DIRECTOR_RPC_CARD_MIGRATE, request);
    if (!result.ok) return result;
    this.commitLibrary(result.value.library);
    if (result.value.cleared) await this.reloadNamespace();
    return {
      ok: true,
      value: {
        result: result.value.result,
        cleared: result.value.cleared,
        ...(result.value.clearError !== undefined ? { clearError: result.value.clearError } : {}),
      },
    };
  }

  // ---- default model settings ---------------------------------------------

  private async mutate(ops: SettingsPathOpView[]): Promise<MutationOutcome> {
    const state = this.store.getSnapshot();
    const ns = SUBAGENT_DIRECTOR_NS;
    let result;
    try {
      result = await this.callBridge<SettingsNamespaceView>(SUBAGENT_DIRECTOR_RPC_MUTATE, {
        ns,
        ops,
        expectedRevision: state.revision,
      });
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
        s.namespace = admitted;
        s.section = (admitted.value ?? {}) as StoredSection;
      });
      return { ok: true, kind: 'fatal', message: undefined };
    }
    const code = this.errorCode(result.error);
    const message = this.errorMessage(result.error);
    const kind = classifyMutateError(code, message);
    if (kind === 'conflict') await this.reloadNamespace();
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

  private errorCode(error: unknown): string | undefined {
    if (error !== null && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
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

/** Outcome of one settings write. */
export interface MutationOutcome {
  ok: boolean;
  kind: MutationErrorKind;
  message: string | undefined;
}

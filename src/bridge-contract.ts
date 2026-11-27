/**
 * Wire contract shared by the Host bridge (src/remote.ts) and the client store
 * (src/client/store.ts) for the self-published "/subagent-director" settings
 * channel. Kept in a plain module so the browser bundle can import it without
 * pulling any Host-only runtime dependency into the client.
 *
 * The channel bypasses the Host apiproxy's exposedNamespaces() allowlist,
 * which answers `settings-not-exposed` for namespaces outside the model-provider
 * plane (dsh-host-apiproxy/lib/index.js:2410-2423, 3470-3475). The client calls
 * connection.rpc.call(channel, endpoint, payload) and the Host handler answers
 * with the existing RpcResult shape.
 */
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types';
import type {
  CardImportResult,
  CardImportStrategy,
  CardLibrarySnapshot,
  CardMigrationResult,
  CharacterCard,
  CharacterCardBundle,
} from './card-types.js';

/** Absolute RPC channel the bridge owns on the Host web server. */
export const SUBAGENT_DIRECTOR_RPC_CHANNEL = '/subagent-director';
/** Endpoint that returns the namespace's redacted wire view. */
export const SUBAGENT_DIRECTOR_RPC_VIEW = 'settingsView';
/** Endpoint that applies one path-op mutation. */
export const SUBAGENT_DIRECTOR_RPC_MUTATE = 'settingsMutate';
/** Endpoint that releases one resident continuable child of a live parent. */
export const SUBAGENT_DIRECTOR_RPC_CLOSE = 'subagentClose';
/** Endpoint that returns the actual provider/model of one child session. */
export const SUBAGENT_DIRECTOR_RPC_MODEL = 'subagentModel';
/** Endpoint that returns the model-visible tool catalog for role tool-set editing. */
export const SUBAGENT_DIRECTOR_RPC_TOOLS = 'toolCatalog';

/**
 * Endpoint that returns the Subagent model-selection allowlist the page must
 * constrain picks to (the official `subagent-model-selection` section: the
 * "Subagent" plugin-config model list). Additive endpoint for alpha.4: the
 * llm catalog RPC is gone from the client, and Subagent Director may select a
 * provider/model ONLY from this list.
 */
export const SUBAGENT_DIRECTOR_RPC_CATALOG = 'settingsCatalog';

/** Endpoint that returns the character-card library and storage status. */
export const SUBAGENT_DIRECTOR_RPC_CARDS = 'cardList';
/** Endpoint that creates or updates one character card. */
export const SUBAGENT_DIRECTOR_RPC_CARD_PUT = 'cardPut';
/** Endpoint that deletes one or more character cards. */
export const SUBAGENT_DIRECTOR_RPC_CARD_DELETE = 'cardDelete';
/** Endpoint that sets or clears the default character card. */
export const SUBAGENT_DIRECTOR_RPC_CARD_DEFAULT = 'cardDefault';
/** Endpoint that imports one portable payload. */
export const SUBAGENT_DIRECTOR_RPC_CARD_IMPORT = 'cardImport';
/** Endpoint that exports the selected cards as a portable bundle. */
export const SUBAGENT_DIRECTOR_RPC_CARD_EXPORT = 'cardExport';
/** Endpoint that migrates the legacy settings roles into cards. */
export const SUBAGENT_DIRECTOR_RPC_CARD_MIGRATE = 'cardMigrate';
/** Endpoint that enables, disables, or deletes a card selection. */
export const SUBAGENT_DIRECTOR_RPC_CARD_BATCH = 'cardBatch';

/** One exact route authorized in the Subagent model-selection list. */
export interface DirectorAllowedRoute {
  provider: string;
  model: string;
}

/** Successful settingsCatalog bridge response. */
export interface DirectorCatalogSuccess {
  /** Whether the official Subagent model selection is enabled. */
  modelSelectionEnabled: boolean;
  /** The exact routes the user has authorized (the only selectable models). */
  allowedRoutes: DirectorAllowedRoute[];
}

/** Successful settingsView bridge response. */
export interface DirectorViewSuccess {
  writable: boolean;
  /** The redacted namespace wire view, absent when the namespace is not registered. */
  view: SettingsNamespaceView | undefined;
  /**
   * Read-time settings warnings for the current namespace value (e.g. a
   * `defaultRole` referencing no defined role — a cross-field constraint the
   * schemastery write gate cannot express). Omitted when there are none, so a
   * sound configuration yields the exact pre-existing response shape.
   */
  warnings?: string[];
}

/** Request payload for the settingsMutate bridge endpoint. */
export interface DirectorMutateRequest {
  ns: string;
  ops: SettingsPathOpViewLike[];
  expectedRevision?: number;
}

/** Structural subset of the wire mutate op; the Host casts to the real type. */
export type SettingsPathOpViewLike =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] };

/** Request payload for the subagentClose bridge endpoint. */
export interface DirectorCloseRequest {
  parentSessionId: string;
  childSessionId: string;
}

/** Request payload for the subagentModel bridge endpoint. */
export interface DirectorModelRequest {
  sessionId: string;
}

/** Successful subagentModel bridge response. */
export type DirectorModelSuccess = { found: true; provider: string; model: string } | { found: false };

/** Successful toolCatalog bridge response. */
export interface DirectorToolsSuccess {
  /** Distinct model-visible tool names, sorted. */
  tools: string[];
}

/** Request payload for the toolCatalog bridge endpoint. */
export interface DirectorToolsRequest {
  /**
   * Session whose agent's tool view is enumerated (preset tools like
   * bash/read/write live in the agent scope, not the global registry).
   * Omitted → the global registry view.
   */
  sessionId?: string;
}

/** Request payload for the cardPut bridge endpoint. */
export interface DirectorCardPutRequest {
  card: unknown;
  /** True for a new card; false/omitted updates an existing id. */
  create?: boolean;
  /** Optional id override when the editor keeps the id out of the form body. */
  id?: string;
}

/** Successful cardPut bridge response. */
export interface DirectorCardPutSuccess {
  card: CharacterCard;
  library: CardLibrarySnapshot;
}

/** Request payload for the cardDelete bridge endpoint. */
export interface DirectorCardDeleteRequest {
  ids: string[];
}

/** Request payload for the cardDefault bridge endpoint. */
export interface DirectorCardDefaultRequest {
  /** Omit or send undefined to clear the default card. */
  id?: string;
}

/** Request payload for the cardImport bridge endpoint. */
export interface DirectorCardImportRequest {
  payload: unknown;
  strategy: CardImportStrategy;
}

/** Successful cardImport bridge response. */
export interface DirectorCardImportSuccess {
  result: CardImportResult;
  library: CardLibrarySnapshot;
}

/** Request payload for the cardExport bridge endpoint. */
export interface DirectorCardExportRequest {
  /** Omit to export every card. */
  ids?: string[];
}

/** Successful cardExport bridge response. */
export interface DirectorCardExportSuccess {
  bundle: CharacterCardBundle;
}

/** Request payload for the cardMigrate bridge endpoint. */
export interface DirectorCardMigrateRequest {
  /** Unset the legacy `roles`/`defaultRole` settings after a successful migration. */
  clearLegacy?: boolean;
}

/** Successful cardMigrate bridge response. */
export interface DirectorCardMigrateSuccess {
  result: CardMigrationResult;
  library: CardLibrarySnapshot;
  /** True when the legacy settings were cleared as requested. */
  cleared: boolean;
  /** Non-fatal clear failure, when clearing was requested but refused. */
  clearError?: string;
}

/** Batch actions exposed by the card library toolbar. */
export type DirectorCardBatchAction = 'enable' | 'disable' | 'delete';

/** Request payload for the cardBatch bridge endpoint. */
export interface DirectorCardBatchRequest {
  ids: string[];
  action: DirectorCardBatchAction;
}

/** Successful cardBatch bridge response. */
export interface DirectorCardBatchSuccess {
  library: CardLibrarySnapshot;
  /** Cards changed by an enable/disable batch. */
  cards: CharacterCard[];
  /** Ids removed by a delete batch. */
  removed: string[];
}

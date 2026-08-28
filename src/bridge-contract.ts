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
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-host-apiproxy/api';

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

/** Successful settingsView bridge response. */
export interface DirectorViewSuccess {
  writable: boolean;
  /** The redacted namespace wire view, absent when the namespace is not registered. */
  view: SettingsNamespaceView | undefined;
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

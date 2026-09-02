/**
 * Subagent Director — self-published setting bridge on the Host web server
 * (design fix: "namespace not exposed").
 *
 * The Web settings client read/writes the plugin's `subagent-director`
 * namespace via a dedicated "/subagent-director" webServer prefix route instead
 * of the Host apiproxy's settings.describe/mutate, which the API proxy gates
 * behind its hard-coded exposedNamespaces() allowlist
 * (dsh-host-apiproxy). A tree-external plugin cannot add its own namespace to
 * that list, so those calls answer `settings-not-exposed`. To bypass the
 * allowlist without touching apiproxy, this module self-publishes a prefix
 * route (kind:"prefix", path:"/subagent-director") via `ctx.webServer.register`
 * (dsh-host-webserver/lib/index.js:53-60) and reads/writes `ctx.settings`
 * itself.
 *
 * The wire contract mirrors the settings domain slice apiproxy exposes for
 * one namespace: `settingsView` returns `{ writable, view }` where `view` is a
 * `SettingsNamespaceView` (redacted), and `settingsMutate` applies path ops
 * with an optimistic `expectedRevision` and returns the new redacted view, or
 * an error with the same `settings-conflict` / `settings-rejected` semantics so
 * the existing client conflict-reload logic works unchanged. The client already
 * speaks this contract unchanged (dsh-client-connection/lib/client.js:10094-10113
 * and src/client/store.ts), so no client change is required.
 *
 * Pure mapping / wire-envelope helpers live at the top (no cordis) so they are
 * unit-testable in a plain node environment. The route handler is a node:http
 * (req, res) handler, mirroring the Connection channel semantics in
 * dsh-client-connection/lib/index.js:275-300 and 322-328, plus a lightweight
 * loopback Host fence.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import {
  SettingsConflictError,
  type SettingsDescriptor,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings';
import type {
  RpcResult,
  RpcError,
  RpcErrorDetailsMap,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-host-apiproxy/api';

import {
  SettingsSchema,
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
} from './settings.js';
import {
  SUBAGENT_DIRECTOR_RPC_VIEW,
  SUBAGENT_DIRECTOR_RPC_MUTATE,
  SUBAGENT_DIRECTOR_RPC_CLOSE,
  SUBAGENT_DIRECTOR_RPC_MODEL,
  SUBAGENT_DIRECTOR_RPC_TOOLS,
  type DirectorCloseRequest,
  type DirectorModelRequest,
  type DirectorModelSuccess,
  type DirectorMutateRequest,
  type DirectorToolsSuccess,
  type DirectorViewSuccess,
} from './bridge-contract.js';
import {
  SUBAGENT_DIRECTOR_ROUTE_PATH,
  buildServerResponse,
  buildMethodMismatchResponse,
  buildBadRequestResponse,
  parseClientRequestEnvelope,
  isLoopbackHost,
  endpointFromPath,
  type ServerResponseEnvelope,
} from './envelope.js';

/** Wire route path the bridge owns on the Host web server. */
export { SUBAGENT_DIRECTOR_ROUTE_PATH as SUBAGENT_DIRECTOR_RPC_CHANNEL };
/** Endpoint that returns the namespace's redacted wire view. */
export { SUBAGENT_DIRECTOR_RPC_VIEW };
/** Endpoint that applies one path-op mutation. */
export { SUBAGENT_DIRECTOR_RPC_MUTATE };
/** Endpoint that releases one resident continuable child of a live parent. */
export { SUBAGENT_DIRECTOR_RPC_CLOSE };
/** Endpoint that returns the actual provider/model of one child session. */
export { SUBAGENT_DIRECTOR_RPC_MODEL };
/** Endpoint that returns the model-visible tool catalog for role tool-set editing. */
export { SUBAGENT_DIRECTOR_RPC_TOOLS };
/** Request payload for the settingsMutate bridge endpoint. */
export type { DirectorMutateRequest, DirectorViewSuccess, DirectorCloseRequest, DirectorModelRequest, DirectorModelSuccess, DirectorToolsSuccess };

/**
 * The services the bridge dispatch needs beyond settings. Kept structural so
 * the module stays testable without a live cordis context; installers resolve
 * them lazily through ctx.get and may leave optional ones undefined.
 */
export interface BridgeDeps {
  settings: SettingsProvider;
  /** Live agent registry (dsh-agent ctx.agents). */
  agents?: { get(id: SessionId): unknown };
  /** Subagent service (dsh-subagent ctx.subagents). */
  subagents?: { drainContinuableChildren(parent: unknown, childIds: readonly SessionId[]): Promise<void> };
  /** Unified session query (dsh-session-query ctx.sessionQuery). */
  sessionQuery?: { readSession(sessionId: SessionId): Promise<{ events: readonly unknown[] }> };
  /** Tool registry (dsh-tools ctx.tools), for the role tool-set catalog. */
  tools?: { schemas(): readonly { name: string }[] };
}

/**
 * Fold the actual provider/model off a session event log: walk from the tail
 * and take the LAST `request/header` event's `data.header.config`, which the
 * agent loop records on every model request (the durable "what actually ran"
 * source; assistant messages carry no provider/model in current DSH).
 * Returns undefined when the log records none.
 */
export function latestRequestHeaderModel(events: readonly unknown[]): { provider: string; model: string } | undefined {
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === null || typeof event !== 'object') continue;
    const record = event as { type?: unknown; data?: unknown };
    if (record.type !== 'request/header') continue;
    const data = record.data as { header?: { config?: unknown } } | null | undefined;
    const config = data?.header?.config as { provider?: unknown; model?: unknown } | null | undefined;
    if (config !== null && typeof config === 'object') {
      const provider = config.provider;
      const model = config.model;
      if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
        return { provider, model };
      }
    }
  }
  return undefined;
}

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
 * alpha.4: namespaces are plain kebab-case strings (the seam validates the
 * format and throws TypeError for malformed ones, which this maps to
 * `settings-rejected`).
 */
export async function directorMutate(
  mutate: SettingsProvider['mutate'],
  describe: SettingsProvider['describe'],
  ns: string,
  ops: readonly SettingsPathOpView[],
  expectedRevision: number | undefined,
): Promise<RpcResult<SettingsNamespaceView>> {
  try {
    await mutate(ns, ops, expectedRevision);
  } catch (error) {
    if (error instanceof SettingsConflictError) {
      return { ok: false, error: directorConflict(error) };
    }
    return { ok: false, error: directorRejected(ns, error) };
  }
  const descriptor = describe({ redactSecrets: true }).find(
    (candidate) => candidate.ns === ns,
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

/** Re-export the wire-envelope helpers so tests import them from one place. */
export {
  parseClientRequestEnvelope,
  isLoopbackHost,
  isLoopbackHostname,
  endpointFromPath,
  buildServerResponse,
  buildMethodMismatchResponse,
  buildBadRequestResponse,
  INVALID_REQUEST_RPC_ID,
} from './envelope.js';

/**
 * The node:http handler for the "/subagent-director" prefix route. Owns the
 * full response lifecycle. Wire contract mirrors the generic Connection RPC
 * channel (dsh-client-connection/lib/index.js:275-328):
 *   - non-POST        → 404 "not found"
 *   - wrong content-type → 415
 *   - unparseable JSON body → 400 "body is not JSON"
 *   - malformed client-request envelope → 200 bad-request (fixed rpcId)
 *   - method vs endpoint mismatch → 200 bad-request
 *   - non-loopback Host header → 403 "forbidden" (lightweight trust fence)
 *   - dispatch error → 500 "handler failure: ..."
 */
export function handleDirectorBridgeRequest(
  deps: BridgeDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return handleDirectorBridgeRequestInner(deps, req.url ?? '/', req.headers.host, req, res);
}

async function handleDirectorBridgeRequestInner(
  deps: BridgeDeps,
  rawUrl: string,
  hostHeader: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Non-POST → 404.
  if (req.method !== 'POST') {
    sendPlain(res, 404, 'not found');
    return;
  }
  // Content type must be application/json → 415.
  const contentType = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendPlain(res, 415, 'content type must be application/json');
    return;
  }
  // Loopback Host fence → 403.
  if (hostHeader === undefined || !isLoopbackHost(hostHeader)) {
    sendPlain(res, 403, 'forbidden');
    return;
  }
  // Read the JSON body → 400 on unparseable.
  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    sendPlain(res, 400, 'body is not JSON');
    return;
  }
  // Envelope validation → 200 bad-request.
  const parsed = parseClientRequestEnvelope(body);
  if (!parsed.ok) {
    sendJson(res, 200, buildBadRequestResponse(parsed.issues));
    return;
  }
  const envelope = parsed.envelope;
  // Method must match the path-derived endpoint.
  const endpoint = endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, pathnameOf(rawUrl));
  if (endpoint === undefined || envelope.method !== endpoint) {
    sendJson(res, 200, buildMethodMismatchResponse(envelope.rpcId, envelope.method, endpoint ?? '(invalid path)'));
    return;
  }
  // Dispatch.
  const result = await dispatchBridgeEndpoint(deps, endpoint, envelope.payload);
  sendJson(res, 200, buildServerResponse(envelope.rpcId, result));
}

/** Dispatch one validated endpoint. Throws on unknown endpoint. */
async function dispatchBridgeEndpoint(
  deps: BridgeDeps,
  endpoint: string,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  if (endpoint === SUBAGENT_DIRECTOR_RPC_VIEW) {
    return directorViewOk(deps.settings) as RpcResult<unknown>;
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
      };
    }
    const ops = (request?.ops ?? []) as SettingsPathOpView[];
    return directorMutate(
      (n, o, r) => deps.settings.mutate(n, o, r),
      (opts) => deps.settings.describe(opts),
      String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE),
      ops,
      request?.expectedRevision,
    );
  }
  if (endpoint === SUBAGENT_DIRECTOR_RPC_CLOSE) {
    return dispatchSubagentClose(deps, payload);
  }
  if (endpoint === SUBAGENT_DIRECTOR_RPC_MODEL) {
    return dispatchSubagentModel(deps, payload);
  }
  if (endpoint === SUBAGENT_DIRECTOR_RPC_TOOLS) {
    return dispatchSubagentTools(deps, payload);
  }
  throw new Error('unknown bridge endpoint ' + JSON.stringify(endpoint));
}

/**
 * Return the distinct tool names for the role tool-set editor.
 *
 * The FULL model-visible set (preset tools such as bash/read/write/grep plus
 * registry tools) only exists in the calling agent's scope: preset tool
 * plugins register into the agent's ctx layers, so the global registry view
 * misses them. When the client supplies its session id, we enumerate through
 * that agent's own tools instance (`agent.ctx.get('tools').schemas(agent)`);
 * without a live agent we degrade to the global registry view so the page
 * still renders.
 */
export function dispatchSubagentTools(
  deps: BridgeDeps,
  payload: unknown,
): RpcResult<DirectorToolsSuccess> {
  const request = (payload ?? {}) as { sessionId?: unknown } | null;
  let view: readonly { name: string }[] | undefined;
  if (request !== null && typeof request === 'object' && typeof request.sessionId === 'string' && request.sessionId !== '') {
    const agent = deps.agents?.get(SessionId(request.sessionId)) as
      | { ctx?: { get(name: string): unknown } }
      | undefined;
    const agentTools = agent?.ctx?.get('tools') as
      | { schemas(scope?: unknown): readonly { name: string }[] }
      | undefined;
    if (agentTools !== undefined) {
      view = agentTools.schemas(agent);
    }
  }
  if (view === undefined) {
    view = deps.tools?.schemas() ?? [];
  }
  const names = new Set<string>();
  for (const schema of view) {
    if (schema !== null && typeof schema === 'object' && typeof schema.name === 'string' && schema.name !== '') {
      names.add(schema.name);
    }
  }
  return { ok: true, value: { tools: [...names].sort() } };
}

/**
 * Release one resident continuable child of an exact live parent (issue #1 UI
 * path). The parent agent is looked up by session id; when it is no longer
 * live its continuable children were released with it, which the client
 * surfaces as `subagent-parent-not-live`. A drain rejection (e.g. core
 * UNAUTHORIZED for a non-direct child) maps to `subagent-close-rejected`.
 */
export async function dispatchSubagentClose(
  deps: BridgeDeps,
  payload: unknown,
): Promise<RpcResult<{ closed: true }>> {
  const request = payload as DirectorCloseRequest | null;
  if (
    request === null ||
    typeof request !== 'object' ||
    typeof request.parentSessionId !== 'string' ||
    typeof request.childSessionId !== 'string'
  ) {
    return {
      ok: false,
      error: { code: 'bad-request', message: 'subagentClose: expected { parentSessionId, childSessionId }', details: { issues: [] } },
    };
  }
  const parent = deps.agents?.get(SessionId(request.parentSessionId));
  if (parent === undefined) {
    return {
      ok: false,
      error: {
        code: 'session-not-found',
        message: 'parent agent ' + request.parentSessionId + ' is not live; its continuable children are released with it',
        // dsh-host-apiproxy (0.1.1-rc.2) carries its own nested dsh-session
        // copy, so its SessionId brand differs from the root alpha.4 one; the
        // value itself is a plain id string, cast at the boundary.
        details: {
          sessionId: SessionId(request.parentSessionId) as unknown as RpcErrorDetailsMap['session-not-found']['sessionId'],
        },
      },
    };
  }
  if (deps.subagents === undefined) {
    return {
      ok: false,
      error: { code: 'internal', message: 'subagents service is not mounted', details: {} },
    };
  }
  try {
    await deps.subagents.drainContinuableChildren(parent, [SessionId(request.childSessionId)]);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    };
  }
  return { ok: true, value: { closed: true as const } };
}

/**
 * Return the actual provider/model of one child session from its last
 * `request/header` event (the observability data source; see
 * latestRequestHeaderModel). Degrades to { found: false } when the log
 * records none and to `subagent-model-unavailable` when the session query
 * service is not mounted.
 */
export async function dispatchSubagentModel(
  deps: BridgeDeps,
  payload: unknown,
): Promise<RpcResult<DirectorModelSuccess>> {
  const request = payload as DirectorModelRequest | null;
  if (request === null || typeof request !== 'object' || typeof request.sessionId !== 'string') {
    return {
      ok: false,
      error: { code: 'bad-request', message: 'subagentModel: expected { sessionId }', details: { issues: [] } },
    };
  }
  if (deps.sessionQuery === undefined) {
    return {
      ok: false,
      error: { code: 'internal', message: 'sessionQuery service is not mounted', details: {} },
    };
  }
  try {
    const log = await deps.sessionQuery.readSession(SessionId(request.sessionId));
    const model = latestRequestHeaderModel(log?.events);
    return model === undefined
      ? { ok: true, value: { found: false as const } }
      : { ok: true, value: { found: true as const, provider: model.provider, model: model.model } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    };
  }
}

/**
 * Install the Subagent Director setting bridge on the Host web server via a
 * self-published prefix route. Lazy-acquires `ctx.webServer`; a deployment
 * without that service (e.g. headless) logs a debug line naming the missing
 * service and installs nothing. Returns a disposer.
 */
export function installDirectorRemoteBridge(ctx: Context): () => void {
  const settings = ctx.get('settings') as SettingsProvider | undefined;
  const webServer = ctx.get('webServer');
  if (settings === undefined || webServer === undefined) {
    ctx.logger.debug(
      '[subagent-director] settings bridge not installed ' +
        '(settings:' + String(settings !== undefined) +
        ', webServer:' + String(webServer !== undefined) + ')',
    );
    return () => {};
  }

  // agents/subagents/sessionQuery stay lazy (ctx.get) so the bridge keeps
  // working in deployments where one of them is absent: the corresponding
  // endpoints answer a structured error instead of crashing the route.
  const deps: BridgeDeps = {
    settings,
    agents: ctx.get('agents') as BridgeDeps['agents'],
    subagents: ctx.get('subagents') as BridgeDeps['subagents'],
    sessionQuery: ctx.get('sessionQuery') as BridgeDeps['sessionQuery'],
    tools: ctx.get('tools') as BridgeDeps['tools'],
  };

  const handler = (req: IncomingMessage, res: ServerResponse): Promise<void> | void => {
    handleDirectorBridgeRequest(deps, req, res).catch((error) => {
      // Dispatch throw (unknown endpoint or a settings seam blow-up) → 500.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendPlain(res, 500, 'handler failure: ' + String(error));
    });
  };

  return ctx.effect(
    () => webServer.register({ kind: 'prefix', path: SUBAGENT_DIRECTOR_ROUTE_PATH, handler }),
    'subagent-director: settings bridge route',
  );
}

/** Collect the full request body as a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Pathname portion of a raw request URL (safe for endpointFromPath). */
function pathnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl, 'http://dsh.internal').pathname;
  } catch {
    return rawUrl;
  }
}

/** Write a plain-text response with the given status. */
function sendPlain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/** Write a JSON response with the given status. */
function sendJson(res: ServerResponse, status: number, payload: ServerResponseEnvelope): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/** Convenience re-export for the namespaced schema used to document the view. */
export { SettingsSchema };

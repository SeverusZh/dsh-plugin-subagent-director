/**
 * Wire envelope parsing/validation/response helpers for the self-published
 * "/subagent-director" settings bridge (src/remote.ts). Pure, zero-dependency
 * (no cordis): every function here is unit-testable in a plain node
 * environment and reused verbatim by the host route handler.
 *
 * The wire contract mirrors the generic Connection RPC channel that the client
 * already speaks (dsh-client-connection/lib/client.js:10094-10113): the browser
 * POSTs a "client-request" envelope and expects a "server-response" envelope
 * echoing the same rpcId with an RpcResult in the result slot. We implement the
 * host side directly on a webServer prefix route (kind:"prefix",
 * path:"/subagent-director") instead of via connection.rpc, so a tree-external
 * plugin needs no apiproxy changes.
 *
 * Referenced semantics: dsh-client-connection/lib/index.js:275-300
 * (rpcFetchHandler) and 322-328 (fullResponse).
 */
import type {
  RpcError,
  RpcResult,
} from '@deepseek-ai/dsh-host-apiproxy/api';

/** The rpcId the host uses for envelopes that fail top-level validation. */
export const INVALID_REQUEST_RPC_ID = 'invalid-request';

/** Wire "client-request" envelope a browser rpc.call sends to the channel. */
export interface ClientRequestEnvelope {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: unknown;
}

/** Wire "server-response" envelope the host answers with. */
export interface ServerResponseEnvelope<T = unknown> {
  type: 'server-response';
  rpcId: string;
  result: RpcResult<T>;
}

/** Outcome of parsing/validating a "client-request" envelope body. */
export type EnvelopeParseResult =
  | { ok: true; envelope: ClientRequestEnvelope }
  | { ok: false; issues: string[] };

/**
 * Parse and validate a decoded JSON body as a "client-request" envelope.
 * Accepts only an object whose `type` is exactly "client-request", with string
 * `rpcId` and `method`. Returns a structured outcome so the caller can build
 * an "invalid client-request message" bad-request response.
 */
export function parseClientRequestEnvelope(body: unknown): EnvelopeParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, issues: ['body must be a JSON object'] };
  }
  const record = body as Record<string, unknown>;
  const issues: string[] = [];
  if (record.type !== 'client-request') {
    issues.push('type must equal "client-request"');
  }
  if (typeof record.rpcId !== 'string') {
    issues.push('rpcId must be a string');
  }
  if (typeof record.method !== 'string') {
    issues.push('method must be a string');
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    envelope: {
      type: 'client-request',
      rpcId: record.rpcId as string,
      method: record.method as string,
      payload: record.payload,
    },
  };
}

/**
 * Build the "server-response" envelope for the requested rpcId carrying an
 * RpcResult, mirroring dsh-client-connection/lib/index.js:322-328 (fullResponse).
 */
export function buildServerResponse<T>(rpcId: string, result: RpcResult<T>): ServerResponseEnvelope<T> {
  return { type: 'server-response', rpcId, result };
}

/**
 * Build the bad-request "server-response" for a malformed client-request
 * envelope. The host cannot trust the caller's rpcId on a malformed message,
 * so it uses the fixed INVALID_REQUEST_RPC_ID (mirroring
 * invalidEnvelopeResponse in dsh-client-connection/lib/index.js:302-309).
 */
export function buildBadRequestResponse(issues: readonly string[]): ServerResponseEnvelope {
  const error: RpcError = {
    code: 'bad-request',
    message: 'invalid client-request message',
    details: { issues: [] },
  };
  return buildServerResponse(INVALID_REQUEST_RPC_ID, { ok: false, error });
}

/**
 * Build the bad-request "server-response" for a message whose `method` does not
 * match the path-derived endpoint (mirroring
 * dsh-client-connection/lib/index.js:289-293).
 */
export function buildMethodMismatchResponse(
  rpcId: string,
  method: unknown,
  endpoint: string,
): ServerResponseEnvelope {
  const error: RpcError = {
    code: 'bad-request',
    message: 'method ' + JSON.stringify(method) + ' does not match endpoint ' + JSON.stringify(endpoint),
    details: { issues: [] },
  };
  return buildServerResponse(rpcId, { ok: false, error });
}

const IPV4_OCTET = /^\d{1,3}$/;

/**
 * Whether a WHATWG URL hostname names the local loopback authority.
 * Accepts "localhost", the IPv6 loopback literal "[::1]" (brackets retained, as
 * WHATWG URL hostname does), or any IPv4 address in the 127/8 range. Rejects
 * everything else. Mirrors the client-connection predicate
 * (dsh-client-connection/lib/client.js:10135-10139).
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => IPV4_OCTET.test(part) && Number(part) <= 255)
  );
}

/**
 * Classify a raw "Host" request header as loopback. Strips a port suffix and
 * bracket-normalizes the authority before delegating to
 * {@link isLoopbackHostname}. With no port present the header is treated as a
 * bare hostname.
 */
export function isLoopbackHost(rawHost: string): boolean {
  let host = rawHost.trim();
  if (host.length === 0) return false;
  // IPv6 bracket literal may carry a trailing port: [::1]:3090
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close === -1) return false;
    host = host.slice(0, close + 1);
  } else {
    // Split off the first colon that separates host:port (plain hostnames/IPv4).
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  return isLoopbackHostname(host);
}

/**
 * Derive the endpoint segment from a pathname under the channel prefix.
 * Returns undefined when the path is not "<channel>/<single-valid-segment>",
 * mirroring the endpointFromPath semantics in
 * dsh-client-connection/lib/index.js:310-315 but without a global pattern
 * import. A valid endpoint is one non-empty segment with no "/", "." or ".."
 * traversal segments.
 */
export function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(channel + '/')) return undefined;
  const endpoint = pathname.slice(channel.length + 1);
  if (endpoint.length === 0) return undefined;
  if (endpoint.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  return endpoint;
}

/**
 * The absolute path our bridge owns on the Host web server. Kept here (rather
 * than only in bridge-contract) so the pure helpers and route handler share one
 * literal.
 */
export const SUBAGENT_DIRECTOR_ROUTE_PATH = '/subagent-director';

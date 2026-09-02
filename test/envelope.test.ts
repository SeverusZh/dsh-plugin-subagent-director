/**
 * Unit tests for the wire-envelope / loopback-helpers that back the
 * self-published "/subagent-director" settings bridge (src/envelope.ts) plus
 * the bridge mapping in src/remote.ts. Everything runs in a plain node
 * environment against the pure helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseClientRequestEnvelope,
  isLoopbackHost,
  isLoopbackHostname,
  endpointFromPath,
  buildServerResponse,
  buildMethodMismatchResponse,
  buildBadRequestResponse,
  INVALID_REQUEST_RPC_ID,
  SUBAGENT_DIRECTOR_ROUTE_PATH,
} from '../src/envelope.js';
import {
  pickDirectorNamespaceView,
  toDirectorNamespaceView,
  directorMutate,
} from '../src/remote.js';
import {
  SettingsConflictError,
  type SettingsDescriptor,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings';
import { SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE } from '../src/settings.js';

const NS = SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE;

/** A representative redacted descriptor for the subagent-director namespace. */
function descriptor(overrides: Partial<SettingsDescriptor> = {}): SettingsDescriptor {
  return {
    ns: NS,
    schema: { type: 'dict' },
    value: { defaultProvider: 'deepseek-official' },
    revision: 3,
    applies: 'live',
    secrets: [],
    base: undefined,
    user: undefined,
    ...overrides,
  };
}

describe('parseClientRequestEnvelope', () => {
  it('parses a valid client-request envelope', () => {
    const parsed = parseClientRequestEnvelope({
      type: 'client-request',
      rpcId: 't1',
      method: 'settingsView',
      payload: {},
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.envelope.rpcId).toBe('t1');
      expect(parsed.envelope.method).toBe('settingsView');
      expect(parsed.envelope.payload).toEqual({});
    }
  });

  it('rejects a body that is not a JSON object', () => {
    for (const bad of [null, 'string', 42, [1, 2, 3], true]) {
      const parsed = parseClientRequestEnvelope(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  it('detects a missing type / rpcId / method field', () => {
    const parsed = parseClientRequestEnvelope({ rpcId: 't1', method: 'x', payload: {} });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContain('type must equal "client-request"');

    const parsed2 = parseClientRequestEnvelope({ type: 'client-request', method: 1, payload: {} });
    expect(parsed2.ok).toBe(false);
    if (!parsed2.ok) expect(parsed2.issues).toContain('rpcId must be a string');

    const parsed3 = parseClientRequestEnvelope({ type: 'client-request', rpcId: 't1', method: null });
    expect(parsed3.ok).toBe(false);
    if (!parsed3.ok) expect(parsed3.issues).toContain('method must be a string');
  });
});

describe('frame-response builders', () => {
  it('builds a server-response echoing the rpcId and result', () => {
    const envelope = buildServerResponse('abc', { ok: true, value: { x: 1 } });
    expect(envelope).toEqual({
      type: 'server-response',
      rpcId: 'abc',
      result: { ok: true, value: { x: 1 } },
    });
  });

  it('builds a bad-request response with the fixed invalid-request rpcId', () => {
    const envelope = buildBadRequestResponse(['type must equal "client-request"', 'rpcId must be a string']);
    expect(envelope.type).toBe('server-response');
    expect(envelope.rpcId).toBe(INVALID_REQUEST_RPC_ID);
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe('bad-request');
      expect(envelope.result.error.message).toBe('invalid client-request message');
      expect(envelope.result.error.details).toEqual({ issues: [] });
    }
  });

  it('builds a method-mismatch bad-request response with the caller rpcId', () => {
    const envelope = buildMethodMismatchResponse('t1', 'settingsMutate', 'settingsView');
    expect(envelope.rpcId).toBe('t1');
    if (!envelope.result.ok) {
      expect(envelope.result.error.code).toBe('bad-request');
      expect(envelope.result.error.message).toContain('does not match endpoint');
      expect(envelope.result.error.message).toContain('settingsMutate');
      expect(envelope.result.error.message).toContain('settingsView');
    }
  });
});

describe('loopback Host classification', () => {
  it('accepts 127.0.0.1 with and without a port', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:3090')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:8080')).toBe(true);
  });

  it('accepts localhost and its variants with a port', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('localhost:3090')).toBe(true);
  });

  it('accepts the IPv6 loopback literal with and without a port', () => {
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('[::1]:3090')).toBe(true);
  });

  it('rejects any non-loopback authority', () => {
    expect(isLoopbackHost('evil.com')).toBe(false);
    expect(isLoopbackHost('evil.com:3090')).toBe(false);
    expect(isLoopbackHost('example.org')).toBe(false);
    expect(isLoopbackHost('8.8.8.8')).toBe(false);
    expect(isLoopbackHost('192.168.0.1')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost('127.0.0.256')).toBe(false);
  });
});

describe('endpointFromPath', () => {
  it('derives a single valid endpoint segment from the channel path', () => {
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director/settingsView')).toBe('settingsView');
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director/settingsMutate')).toBe('settingsMutate');
  });

  it('rejects traversal or empty segments and wrong prefixes', () => {
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director')).toBeUndefined();
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director/')).toBeUndefined();
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/other/settingsView')).toBeUndefined();
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director/a/b')).toBe('a/b');
    expect(endpointFromPath(SUBAGENT_DIRECTOR_ROUTE_PATH, '/subagent-director/a//b')).toBeUndefined();
    expect(endpointFromPath('/other', '/subagent-director/settingsView')).toBeUndefined();
  });
});

describe('toDirectorNamespaceView / pickDirectorNamespaceView', () => {
  it('maps a descriptor to the redacted wire view and omits absent layers', () => {
    const view = toDirectorNamespaceView(descriptor());
    expect(view.ns).toBe(String(NS));
    expect(view.revision).toBe(3);
    expect('base' in view).toBe(false);
    expect('user' in view).toBe(false);
  });

  it('picks the registered namespace and returns undefined otherwise', () => {
    const other: SettingsDescriptor = {
      // alpha.4 namespaces are plain kebab-case literals (brand is compile-time)
      ns: 'llm-deepseek' as SettingsNamespace,
      schema: { type: 'dict' },
      value: {},
      revision: 1,
      applies: 'live',
      secrets: [],
    };
    expect(pickDirectorNamespaceView([other])).toBeUndefined();
    expect(pickDirectorNamespaceView([descriptor()])?.ns).toBe(String(NS));
  });
});

describe('directorMutate (settings mutating pure function)', () => {
  const noopMutate = async () => {};
  const describeWith = (list: SettingsDescriptor[]) => () => list;

  it('returns ok with the fresh revised view after a successful write', async () => {
    const result = await directorMutate(
      noopMutate,
      describeWith([descriptor({ revision: 4, value: { defaultProvider: 'opencode-go' } })]),
      String(NS),
      [{ op: 'set', path: ['defaultProvider'], value: 'opencode-go' }],
      3,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revision).toBe(4);
      expect(result.value.value).toEqual({ defaultProvider: 'opencode-go' });
    }
  });

  it('maps a SettingsConflictError to settings-conflict (ns mismatch handled by caller)', async () => {
    const conflict = new SettingsConflictError(NS, 3, 5);
    const result = await directorMutate(
      async () => {
        throw conflict;
      },
      describeWith([]),
      String(NS),
      [{ op: 'set', path: ['x'], value: 'y' }],
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('settings-conflict');
      expect(result.error.details).toMatchObject({ ns: String(NS), expected: 3, actual: 5 });
    }
  });

  it('maps a plain Error to settings-rejected', async () => {
    const result = await directorMutate(
      async () => {
        throw new Error('schema: defaultProvider must be set');
      },
      describeWith([]),
      String(NS),
      [{ op: 'set', path: ['defaultProvider'], value: 'x' }],
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('settings-rejected');
  });
});

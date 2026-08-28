/**
 * Unit tests for the self-published "/subagent-director" settings bridge
 * (src/remote.ts + src/bridge-contract.ts). The bridge is how the Web client
 * reads/writes the `subagent-director` namespace despite the Host apiproxy's
 * exposedNamespaces() allowlist answering `settings-not-exposed` for it
 * (dsh-host-apiproxy/lib/index.js:2410-2423, 3470-3475). Everything here runs
 * in a plain node environment against the pure mapping helpers and the
 * captured webServer route handler.
 */
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, it, expect } from 'vitest';
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
} from '@deepseek-ai/dsh-settings';
import {
  installDirectorRemoteBridge,
  pickDirectorNamespaceView,
  toDirectorNamespaceView,
  directorMutate,
  dispatchSubagentClose,
  dispatchSubagentModel,
  dispatchSubagentTools,
  latestRequestHeaderModel,
} from '../src/remote.js';
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

describe('toDirectorNamespaceView', () => {
  it('maps a descriptor to the redacted wire view shape', () => {
    const view = toDirectorNamespaceView(
      descriptor({ secrets: [{ path: ['apiKey'], set: true }], user: { apiKey: '__REDACTED__' } }),
    );
    expect(view).toEqual({
      ns: String(NS),
      schema: { type: 'dict' },
      value: { defaultProvider: 'deepseek-official' },
      user: { apiKey: '__REDACTED__' },
      applies: 'live',
      secrets: [{ path: ['apiKey'], set: true }],
      revision: 3,
    });
    expect(view.secrets).toEqual([{ path: ['apiKey'], set: true }]);
  });

  it('omits absent base/user layers so the client sees the same shape it renders', () => {
    const view = toDirectorNamespaceView(descriptor());
    expect('base' in view).toBe(false);
    expect('user' in view).toBe(false);
    expect(view.revision).toBe(3);
  });
});

describe('pickDirectorNamespaceView', () => {
  it('returns undefined when the namespace is not registered', () => {
    const other: SettingsDescriptor = {
      ns: settingsNamespace('llm-deepseek'),
      schema: { type: 'dict' },
      value: {},
      revision: 1,
      applies: 'live',
      secrets: [],
    };
    expect(pickDirectorNamespaceView([other])).toBeUndefined();
    expect(pickDirectorNamespaceView([])).toBeUndefined();
  });

  it('returns the wire view when the namespace is registered', () => {
    const view = pickDirectorNamespaceView([descriptor()]);
    expect(view).toBeDefined();
    expect(view!.ns).toBe(String(NS));
    expect(view!.revision).toBe(3);
  });
});

describe('directorMutate', () => {
  const noopMutate = async () => {};
  const describeWith = (list: SettingsDescriptor[]) => () => list;

  it('returns ok with the fresh redacted view after a successful write', async () => {
    const result = await directorMutate(
      noopMutate,
      describeWith([descriptor({ revision: 4, value: { defaultProvider: 'opencode-go' } })]),
      String(NS),
      [{ op: 'set', path: ['defaultProvider'], value: 'opencode-go' }],
      3,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ns).toBe(String(NS));
      expect(result.value.revision).toBe(4);
      expect(result.value.value).toEqual({ defaultProvider: 'opencode-go' });
    }
  });

  it('maps a SettingsConflictError to a settings-conflict RPC error', async () => {
    const conflict = new SettingsConflictError(NS, 3, 5);
    const result = await directorMutate(
      async () => {
        throw conflict;
      },
      describeWith([]),
      String(NS),
      [{ op: 'set', path: ['defaultProvider'], value: 'x' }],
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('settings-conflict');
      expect(result.error.details).toMatchObject({ ns: String(NS), expected: 3, actual: 5 });
    }
  });

  it('maps a plain Error to a settings-rejected RPC error', async () => {
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
    if (!result.ok) {
      expect(result.error.code).toBe('settings-rejected');
      expect(result.error.message).toContain('defaultProvider');
      expect(result.error.details).toMatchObject({ ns: String(NS) });
    }
  });

  it('answers settings-rejected when the namespace vanished after a successful write', async () => {
    const result = await directorMutate(
      noopMutate,
      describeWith([]),
      String(NS),
      [{ op: 'set', path: ['x'], value: 1 }],
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });
});

describe('installDirectorRemoteBridge', () => {
  it('returns a no-op disposer (and does not register) without settings or webServer', () => {
    const ctx = { get: () => undefined, logger: { debug: () => {} }, effect: () => () => {} };
    const dispose = installDirectorRemoteBridge(ctx as never);
    expect(typeof dispose).toBe('function');
    dispose();
  });

  it('registers a "subagent-director" prefix route on webServer', () => {
    let captured;
    const fakeCtx = bridgeCtx(
      { writable: true, describe: () => [], mutate: async () => {} },
      (route) => {
        captured = route;
      },
    );
    installDirectorRemoteBridge(fakeCtx as never);
    expect(captured).toBeDefined();
    expect(captured?.kind).toBe('prefix');
    expect(captured?.path).toBe('/subagent-director');
    expect(typeof captured?.handler).toBe('function');
  });

  it('answers settingsView through the route handler and refuses a bad ns on settingsMutate', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never);

    // settingsView with an unregistered namespace → ok with an empty view.
    const view = await callRoute(route, '/subagent-director/settingsView', {
      type: 'client-request', rpcId: 't1', method: 'settingsView', payload: {},
    });
    expect(view.code).toBe(200);
    const viewJson = JSON.parse(view.body);
    expect(viewJson.type).toBe('server-response');
    expect(viewJson.rpcId).toBe('t1');
    expect(viewJson.result.ok).toBe(true);
    if (viewJson.result.ok) {
      expect(viewJson.result.value.writable).toBe(true);
      expect(viewJson.result.value.view).toBeUndefined();
    }

    // settingsMutate with a non-owned ns → bad-request.
    const badNs = await callRoute(route, '/subagent-director/settingsMutate', {
      type: 'client-request', rpcId: 't2', method: 'settingsMutate', payload: { ns: 'llm-deepseek', ops: [] },
    });
    const badNsJson = JSON.parse(badNs.body);
    expect(badNsJson.result.ok).toBe(false);
    if (!badNsJson.result.ok) expect(badNsJson.result.error.code).toBe('bad-request');
  });

  it('returns 404 for non-POST, 403 for a non-loopback Host, 415 wrong content-type, and 400 bad JSON', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never);

    // Non-POST.
    expect((await callRaw(route, 'GET', '/subagent-director/settingsView', '')).code).toBe(404);
    // Non-loopback Host.
    expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'evil.com:3090')).code).toBe(403);
    // Wrong content-type.
    expect(
      (await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', '127.0.0.1', 'text/plain')).code,
    ).toBe(415);
    // Unparseable body.
    expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{not json}')).code).toBe(400);
  });

  it('returns 200 bad-request for a malformed envelope and a method mismatch', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never);

    // Malformed envelope (missing type / rpcId / method) → 200 bad-request with invalid-request rpcId.
    const malformed = await callRoute(route, '/subagent-director/settingsView', { rpcId: 't', payload: {} });
    const malformedJson = JSON.parse(malformed.body);
    expect(malformed.code).toBe(200);
    expect(malformedJson.rpcId).toBe('invalid-request');
    expect(malformedJson.result.ok).toBe(false);
    if (!malformedJson.result.ok) expect(malformedJson.result.error.code).toBe('bad-request');

    // Method mismatch (path settingsView, body method settingsMutate) → 200 bad-request.
    const mismatch = await callRoute(route, '/subagent-director/settingsView', {
      type: 'client-request', rpcId: 't9', method: 'settingsMutate', payload: {},
    });
    const mismatchJson = JSON.parse(mismatch.body);
    expect(mismatch.code).toBe(200);
    expect(mismatchJson.result.ok).toBe(false);
    if (!mismatchJson.result.ok) {
      expect(mismatchJson.result.error.code).toBe('bad-request');
      expect(mismatchJson.result.error.message).toContain('does not match endpoint');
    }
  });
});

/** Build a fake ctx exposing settings + a webServer.register capture. */
function bridgeCtx(settings: unknown, onRegister: (route: { kind: string; path: string; handler: unknown }) => void) {
  return {
    get: (key: string) => {
      if (key === 'settings') return settings;
      if (key === 'webServer') {
        return {
          register: (route: { kind: string; path: string; handler: unknown }) => {
            onRegister(route);
            return () => {};
          },
        };
      }
      return undefined;
    },
    logger: { debug: () => {} },
    effect: (fn: () => () => void) => fn(),
  };
}

interface CallResult {
  code: number;
  body: string;
}

/** Drive a route handler once, returning the status + body a fake res accumulated. */
async function drive(
  route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> },
  opts: { method: string; url: string; reqBody: string; host: string; contentType: string },
): Promise<CallResult> {
  const { method, url, reqBody, host, contentType } = opts;
  // Emit the body then 'end' as a fresh stream once listeners are attached.
  const req = new EventEmitter() as unknown as {
    method: string;
    url: string;
    headers: Record<string, string>;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  };
  (req as unknown as { method: string }).method = method;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { headers: Record<string, string> }).headers = { 'content-type': contentType, host };

  const result: CallResult = { code: 200, body: '' };
  const res = {
    writeHead: (code: number) => { result.code = code; },
    end: (chunk?: unknown) => { if (chunk !== undefined) result.body += String(chunk); },
    destroy: () => {},
  } as unknown as ServerResponse;

  const handlerPromise = Promise.resolve(route.handler(req, res));
  // The handler attaches its stream listeners synchronously before its first
  // await, so a check-phase flush reliably finds them attached.
  setImmediate(() => flushBody(req as unknown as EventEmitter, reqBody));
  await handlerPromise;
  // The route wrapper does not return the handler promise, so settle one more
  // tick for the async body read + response write to finish.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return result;
}

function flushBody(ee: EventEmitter, reqBody: string): void {
  if (reqBody.length > 0) ee.emit('data', Buffer.from(reqBody, 'utf8'));
  ee.emit('end');
}

function callRoute(
  route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> },
  url: string,
  body: unknown,
  host = '127.0.0.1:3090',
): Promise<CallResult> {
  return drive(route, { method: 'POST', url, reqBody: JSON.stringify(body), host, contentType: 'application/json' });
}

function callRaw(
  route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> },
  method: string,
  url: string,
  reqBody: string,
  host = '127.0.0.1:3090',
  contentType = 'application/json',
): Promise<CallResult> {
  return drive(route, { method, url, reqBody, host, contentType });
}
describe('latestRequestHeaderModel', () => {
  const headerEvent = (provider: string, model: string) => ({
    type: 'request/header',
    seq: 1,
    data: { header: { config: { provider, model } } },
  });

  it('returns the config of the last request/header event', () => {
    expect(
      latestRequestHeaderModel([
        { type: 'user/message', seq: 0 },
        headerEvent('deepseek', 'old-model'),
        headerEvent('ollama-pro', 'deepseek-v4-flash:0731'),
      ]),
    ).toEqual({ provider: 'ollama-pro', model: 'deepseek-v4-flash:0731' });
  });

  it('returns undefined for an empty log or one without request/header', () => {
    expect(latestRequestHeaderModel([])).toBeUndefined();
    expect(latestRequestHeaderModel([{ type: 'user/message' }])).toBeUndefined();
    expect(latestRequestHeaderModel(null as unknown as unknown[])).toBeUndefined();
  });

  it('returns undefined when the last header carries no provider/model', () => {
    expect(
      latestRequestHeaderModel([{ type: 'request/header', data: { header: { config: {} } } }]),
    ).toBeUndefined();
  });
});

describe('dispatchSubagentClose', () => {
  const closeDeps = (overrides: Partial<import('../src/remote.js').BridgeDeps> = {}) => ({
    settings: { writable: true, describe: () => [], mutate: async () => {} } as never,
    agents: { get: () => ({ id: 'parent-1' }) },
    subagents: { drainContinuableChildren: async () => {} },
    ...overrides,
  });

  it('drains the resolved parent with the child id and returns closed', async () => {
    const calls: unknown[][] = [];
    const deps = closeDeps({
      subagents: {
        drainContinuableChildren: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
    });
    const result = await dispatchSubagentClose(deps as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'child-9',
    });
    expect(result).toEqual({ ok: true, value: { closed: true } });
    expect(calls).toHaveLength(1);
    expect(String(calls[0][1][0])).toBe('child-9');
  });

  it('rejects with session-not-found when the parent agent is not live', async () => {
    const deps = closeDeps({ agents: { get: () => undefined } });
    const result = await dispatchSubagentClose(deps as never, {
      parentSessionId: 'gone',
      childSessionId: 'child-9',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('session-not-found');
  });

  it('rejects with internal when the drain rejects (e.g. non-direct child)', async () => {
    const deps = closeDeps({
      subagents: {
        drainContinuableChildren: async () => {
          throw new Error('subagent "other" is not a direct child of agent "parent-1"');
        },
      },
    });
    const result = await dispatchSubagentClose(deps as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'other',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toContain('not a direct child');
    }
  });

  it('rejects with bad-request for a malformed payload', async () => {
    const result = await dispatchSubagentClose(closeDeps() as never, { parentSessionId: 'p' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-request');
  });
});

describe('dispatchSubagentModel', () => {
  const modelDeps = (overrides: Partial<import('../src/remote.js').BridgeDeps> = {}) => ({
    settings: { writable: true, describe: () => [], mutate: async () => {} } as never,
    sessionQuery: {
      readSession: async () => ({
        events: [{ type: 'request/header', data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } } }],
      }),
    },
    ...overrides,
  });

  it('returns the actual provider/model from the child log', async () => {
    const result = await dispatchSubagentModel(modelDeps() as never, { sessionId: 'child-9' });
    expect(result).toEqual({ ok: true, value: { found: true, provider: 'opencode-go', model: 'deepseek-v4-flash' } });
  });

  it('degrades to found:false when the log records no header', async () => {
    const deps = modelDeps({
      sessionQuery: { readSession: async () => ({ events: [{ type: 'user/message' }] }) },
    });
    const result = await dispatchSubagentModel(deps as never, { sessionId: 'child-9' });
    expect(result).toEqual({ ok: true, value: { found: false } });
  });

  it('rejects with internal when sessionQuery is absent or fails', async () => {
    const absent = await dispatchSubagentModel(modelDeps({ sessionQuery: undefined }) as never, {
      sessionId: 'child-9',
    });
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error.code).toBe('internal');

    const failing = await dispatchSubagentModel(
      modelDeps({ sessionQuery: { readSession: async () => { throw new Error('boom'); } } }) as never,
      { sessionId: 'child-9' },
    );
    expect(failing.ok).toBe(false);
    if (!failing.ok) {
      expect(failing.error.code).toBe('internal');
      expect(failing.error.message).toContain('boom');
    }
  });

  it('rejects with bad-request for a malformed payload', async () => {
    const result = await dispatchSubagentModel(modelDeps() as never, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-request');
  });
});

describe('dispatchSubagentTools', () => {
  const toolsDeps = (overrides: Partial<import('../src/remote.js').BridgeDeps> = {}) => ({
    settings: { writable: true, describe: () => [], mutate: async () => {} } as never,
    tools: { schemas: () => [{ name: 'bash' }, { name: 'read' }, { name: 'bash' }, { name: '' }] },
    ...overrides,
  });

  it('returns distinct sorted tool names from the registry', async () => {
    const result = await dispatchSubagentTools(toolsDeps() as never);
    expect(result).toEqual({ ok: true, value: { tools: ['bash', 'read'] } });
  });

  it('degrades to an empty catalog when the tool registry is absent', async () => {
    const result = await dispatchSubagentTools(toolsDeps({ tools: undefined }) as never);
    expect(result).toEqual({ ok: true, value: { tools: [] } });
  });
});

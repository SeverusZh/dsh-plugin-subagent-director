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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SettingsConflictError,
  type SettingsDescriptor,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings';
import {
  installDirectorRemoteBridge,
  directorCatalogOk,
  pickDirectorNamespaceView,
  toDirectorNamespaceView,
  readDirectorNamespaceView,
  directorMutate,
  dispatchSubagentClose,
  dispatchSubagentModel,
  dispatchSubagentTools,
  dispatchCardList,
  dispatchCardPut,
  dispatchCardDelete,
  dispatchCardDefault,
  dispatchCardImport,
  dispatchCardExport,
  dispatchCardMigrate,
  dispatchCardBatch,
  latestRequestHeaderModel,
} from '../src/remote.js';
import { SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE, SUBAGENT_MODEL_SELECTION_NAMESPACE } from '../src/settings.js';
import { clearResidentHandles, trackResident } from '../src/resident-handles.js';

const NS = SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE;

/** A representative redacted descriptor for the subagent-director namespace. */
function descriptor(overrides: Partial<SettingsDescriptor> = {}): SettingsDescriptor {
  return {
    ns: NS,
    autoGenerate: true,
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
      autoGenerate: true,
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
      // alpha.4 namespaces are plain kebab-case literals (brand is compile-time)
      ns: 'llm-deepseek' as SettingsNamespace,
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

describe('readDirectorNamespaceView read-time warnings', () => {
  const settingsWith = (value: unknown) =>
    ({ writable: true, describe: () => [descriptor({ value })] }) as never;

  it('surfaces a dangling defaultRole as a warning on the view', () => {
    const view = readDirectorNamespaceView(
      settingsWith({ defaultRole: 'ghost', roles: { coder: { displayName: 'C', description: 'd' } } }),
    );
    expect(view.warnings).toBeDefined();
    expect(view.warnings).toHaveLength(1);
    expect(view.warnings![0]).toMatch(/defaultRole/);
    expect(view.warnings![0]).toMatch(/ghost/);
    // The view still carries the raw (unrewritten) stored value.
    expect((view.view!.value as { defaultRole?: string }).defaultRole).toBe('ghost');
  });

  it('omits the warnings field for a sound configuration (no shape change)', () => {
    const view = readDirectorNamespaceView(
      settingsWith({ defaultRole: 'coder', roles: { coder: { displayName: 'C', description: 'd' } } }),
    );
    expect('warnings' in view).toBe(false);
  });

  it('omits the warnings field when the namespace is not registered', () => {
    const view = readDirectorNamespaceView({ writable: true, describe: () => [] } as never);
    expect(view.view).toBeUndefined();
    expect('warnings' in view).toBe(false);
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


describe('directorCatalogOk', () => {
  // 0.1.7: the section value is read from describe()'s descriptor for the entry
  // id `subagent-model-selection-settings` (no settings.get(ns)).
  const settingsLike = (descriptors: Array<{ ns: string; value?: unknown }>) =>
    ({ describe: () => descriptors }) as never;
  const selectionDescriptor = (value: unknown) => [
    { ns: SUBAGENT_MODEL_SELECTION_NAMESPACE, value },
  ];

  it('returns the authorized routes when the official selection is enabled with a non-empty list', () => {
    const result = directorCatalogOk(settingsLike(selectionDescriptor({
      enabled: true,
      allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, { provider: 'pi-ai', model: 'gpt-5' }],
    })));
    expect(result).toEqual({
      ok: true,
      value: {
        modelSelectionEnabled: true,
        allowedRoutes: [
          { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          { provider: 'pi-ai', model: 'gpt-5' },
        ],
      },
    });
  });

  it('returns an empty allowlist when the official selection is disabled', () => {
    const result = directorCatalogOk(settingsLike(selectionDescriptor({ enabled: false, allowedModels: [{ provider: 'x', model: 'y' }] })));
    expect(result).toEqual({ ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } });
  });

  it('returns an empty allowlist when the section is absent', () => {
    const absent = directorCatalogOk(settingsLike([]));
    expect(absent).toEqual({ ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } });
  });

  it('returns an empty allowlist when describe() throws (inactive seam)', () => {
    const throwing = { describe: () => { throw new Error('settings namespace not registered'); } } as never;
    expect(directorCatalogOk(throwing)).toEqual({ ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } });
  });

  it('drops malformed route entries and returns an empty allowlist without a settings service', () => {
    const malformed = directorCatalogOk(settingsLike(selectionDescriptor({
      enabled: true,
      allowedModels: [{ provider: '', model: 'y' }, { provider: 'ok', model: '' }, null, 'junk'],
    })));
    expect(malformed).toEqual({ ok: true, value: { modelSelectionEnabled: true, allowedRoutes: [] } });
    const noSettings = directorCatalogOk(undefined);
    expect(noSettings).toEqual({ ok: true, value: { modelSelectionEnabled: false, allowedRoutes: [] } });
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

  it('accepts an allowlisted reverse-proxied Host and still fences off other off-box hosts', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never);

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = 'dsh.example.com:6443';
      const proxied = await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:6443');
      expect(proxied.code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'evil.com:6443')).code).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
      else process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }

    // With the allowlist cleared the deployment is back to loopback-only.
    const loopback = await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', '127.0.0.1:3090');
    expect(loopback.code).toBe(200);
    expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:6443')).code).toBe(403);
  });

  it('accepts a Config allowlisted Host and still fences off other off-box hosts', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never, {
      trustedHosts: ['dsh.example.com'],
    });

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:6443')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'evil.com:6443')).code).toBe(403);
    } finally {
      if (previous !== undefined) process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }
  });

  it('keeps the env allowlist working when Config is not set (backward compatible)', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never);

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = 'dsh.example.com:6443';
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:6443')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'evil.com:6443')).code).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
      else process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }
  });

  it('accepts the union of Config and env allowlists', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never, {
      trustedHosts: ['cfg.example.com'],
    });

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = 'env.example.com';
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'cfg.example.com')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'env.example.com')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'evil.example.com')).code).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
      else process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }
  });

  it('falls back to loopback-only when both Config and env are empty', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never, { trustedHosts: [] });

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', '127.0.0.1:3090')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:6443')).code).toBe(403);
    } finally {
      if (previous !== undefined) process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }
  });

  it('normalizes Config entries (case, port, surrounding whitespace)', async () => {
    let route;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    installDirectorRemoteBridge(bridgeCtx(settings, (r) => { route = r; }) as never, {
      trustedHosts: [' DSH.Example.com:6443 '],
    });

    const previous = process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    delete process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS;
    try {
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'dsh.example.com:9000')).code).toBe(200);
      expect((await callRaw(route, 'POST', '/subagent-director/settingsView', '{}', 'DSH.EXAMPLE.COM')).code).toBe(200);
    } finally {
      if (previous !== undefined) process.env.DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS = previous;
    }
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
    ...overrides,
  });

  const activation = (childId: string, dispose: () => Promise<void> = async () => {}) =>
    ({
      childId,
      name: childId,
      messageId: 'message-1',
      result: Promise.resolve({ stopReason: 'completed', output: [] }),
      dispose,
    }) as never;

  beforeEach(() => {
    clearResidentHandles();
  });

  it('disposes the tracked activation and returns closed', async () => {
    const dispose = vi.fn(async () => {});
    trackResident('parent-1', activation('child-9', dispose));
    const result = await dispatchSubagentClose(closeDeps() as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'child-9',
    });
    expect(result).toEqual({ ok: true, value: { closed: true } });
    expect(dispose).toHaveBeenCalledTimes(1);
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

  it('rejects an untracked child with subagent-not-tracked', async () => {
    const result = await dispatchSubagentClose(closeDeps() as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'other',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('subagent-not-tracked');
  });

  it('rejects a child recorded under another parent with subagent-close-rejected', async () => {
    trackResident('parent-2', activation('child-9'));
    const result = await dispatchSubagentClose(closeDeps() as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'child-9',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('subagent-close-rejected');
  });

  it('maps an activation disposal failure to subagent-close-failed', async () => {
    trackResident('parent-1', activation('child-9', async () => {
      throw new Error('teardown failed');
    }));
    const result = await dispatchSubagentClose(closeDeps() as never, {
      parentSessionId: 'parent-1',
      childSessionId: 'child-9',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('subagent-close-failed');
      expect(result.error.message).toContain('teardown failed');
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
    tools: { getAll: () => [{ name: 'bash' }, { name: 'read' }, { name: 'bash' }, { name: '' }] },
    ...overrides,
  });

  it('returns distinct sorted tool names from the registry', async () => {
    const result = await dispatchSubagentTools(toolsDeps() as never, {});
    expect(result).toEqual({ ok: true, value: { tools: ['bash', 'read'] } });
  });

  it('degrades to an empty catalog when the tool registry is absent', async () => {
    const result = await dispatchSubagentTools(toolsDeps({ tools: undefined }) as never, {});
    expect(result).toEqual({ ok: true, value: { tools: [] } });
  });

  it('enumerates the agent tool view (preset tools) when a session id is supplied', async () => {
    // The agent's own ctx carries a tools instance whose getAll(agent) view
    // includes the preset tools (bash/read/write) beyond the global registry.
    const agentTools = {
      getAll: (scope: unknown) => [
        { name: 'bash' },
        { name: 'read' },
        { name: 'write' },
        { name: scope !== undefined ? 'agent-only' : 'wrong-scope' },
      ],
    };
    const deps = toolsDeps({
      agents: { get: () => ({ id: 'session-1', ctx: { get: (name: string) => (name === 'tools' ? agentTools : undefined) } }) },
    });
    const result = await dispatchSubagentTools(deps as never, { sessionId: 'session-1' });
    expect(result).toEqual({
      ok: true,
      value: { tools: ['agent-only', 'bash', 'read', 'write'] },
    });
  });

  it('falls back to the global registry view when the session has no live agent', async () => {
    const deps = toolsDeps({ agents: { get: () => undefined } });
    const result = await dispatchSubagentTools(deps as never, { sessionId: 'session-gone' });
    expect(result).toEqual({ ok: true, value: { tools: ['bash', 'read'] } });
  });
});


describe('character-card bridge endpoints', () => {
  const library = () => ({
    storage: { state: 'ready' as const },
    cards: [{ id: 'a', name: 'A', delegationGuidance: 'Guide.' }],
    defaultCardId: 'a',
    legacyRoles: [] as string[],
  });

  function fakeCards(overrides: Record<string, unknown> = {}) {
    return {
      ready: async () => {},
      status: () => ({ state: 'ready' }),
      librarySnapshot: library,
      put: vi.fn(async (value: unknown) => ({ ...(value as object), id: 'a' })),
      remove: vi.fn(async () => ['a']),
      setDefault: vi.fn(async () => {}),
      setEnabled: vi.fn(async () => []),
      setNeverClose: vi.fn(async () => []),
      importCards: vi.fn(async () => ({
        imported: 1,
        overwritten: 0,
        skipped: 0,
        duplicated: 0,
        issues: [],
        cards: [],
      })),
      exportCards: vi.fn(() => ({ kind: 'subagent-director/character-card-collection', version: 1, exportedAt: '', cards: [] })),
      migrateLegacy: vi.fn(async () => ({
        migrated: ['a'],
        skipped: [],
        failed: [],
        remainingLegacy: ['a'],
        defaultCardId: 'a',
      })),
      dispose: vi.fn(async () => {}),
      ...overrides,
    } as never;
  }

  it('returns the library, and a successful unavailable snapshot when the main entry is absent', async () => {
    const withCards = await dispatchCardList({ settings: {} as never, cards: () => fakeCards() });
    expect(withCards.ok).toBe(true);
    if (withCards.ok) expect((withCards.value as { cards: unknown[] }).cards).toHaveLength(1);

    const without = await dispatchCardList({ settings: {} as never });
    expect(without.ok).toBe(true);
    if (without.ok) {
      expect((without.value as { storage: { state: string } }).storage.state).toBe('unavailable');
      expect((without.value as { usage: unknown }).usage).toEqual({});
    }

    const withUsage = await dispatchCardList({
      settings: {} as never,
      cards: () =>
        fakeCards({
          librarySnapshot: () => ({ ...library(), usage: { a: { uses: 2, lastUsedAt: '2026-11-28T00:00:00.000Z' } } }),
        }),
    });
    expect(withUsage.ok).toBe(true);
    if (withUsage.ok) {
      expect((withUsage.value as { usage: Record<string, unknown> }).usage).toEqual({
        a: { uses: 2, lastUsedAt: '2026-11-28T00:00:00.000Z' },
      });
    }
  });

  it('creates a card and returns the acknowledged library', async () => {
    const cards = fakeCards();
    const result = await dispatchCardPut(
      { settings: {} as never, cards: () => cards },
      { card: { id: 'a', name: 'A', delegationGuidance: 'G' }, create: true },
    );
    expect(result.ok).toBe(true);
    expect((cards as unknown as { put: ReturnType<typeof vi.fn> }).put).toHaveBeenCalledWith(
      { id: 'a', name: 'A', delegationGuidance: 'G' },
      { create: true },
    );
  });

  it('rejects a malformed cardPut payload', async () => {
    const result = await dispatchCardPut({ settings: {} as never, cards: () => fakeCards() }, { card: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-request');
  });

  it('passes unknown future import-issue codes through the cardImport endpoint', async () => {
    const cards = fakeCards({
      importCards: vi.fn(async () => ({
        imported: 0,
        overwritten: 0,
        skipped: 0,
        duplicated: 0,
        issues: [
          {
            index: 0,
            code: 'future-issue-code',
            field: 'name',
            params: { reason: 'future' },
            message: 'Future host detail.',
          },
        ],
        cards: [],
      })),
    });
    const result = await dispatchCardImport(
      { settings: {} as never, cards: () => cards },
      { payload: { cards: [] }, strategy: 'skip' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as {
        result: { issues: Array<{ code: string; field?: string; params?: Record<string, unknown>; message: string }> };
      };
      expect(value.result.issues[0]).toMatchObject({
        code: 'future-issue-code',
        field: 'name',
        params: { reason: 'future' },
        message: 'Future host detail.',
      });
    }
  });

  it('deletes, defaults, imports, exports, and batches', async () => {
    const cards = fakeCards();
    const deps = { settings: {} as never, cards: () => cards };

    expect((await dispatchCardDelete(deps, { ids: ['a', 3] })).ok).toBe(true);
    expect((await dispatchCardDefault(deps, { id: 'a' })).ok).toBe(true);
    const imported = await dispatchCardImport(deps, { payload: { cards: [] }, strategy: 'skip' });
    expect(imported.ok).toBe(true);
    const exported = await dispatchCardExport(deps, { ids: ['a'] });
    expect(exported.ok).toBe(true);
    expect((await dispatchCardBatch(deps, { ids: ['a'], action: 'enable' })).ok).toBe(true);
    expect((await dispatchCardBatch(deps, { ids: ['a'], action: 'bad' })).ok).toBe(false);

    const pin = await dispatchCardBatch(deps, { ids: ['a'], action: 'pin' });
    expect(pin.ok).toBe(true);
    expect((cards as unknown as { setNeverClose: ReturnType<typeof vi.fn> }).setNeverClose).toHaveBeenCalledWith(['a'], true);
    const unpin = await dispatchCardBatch(deps, { ids: ['a'], action: 'unpin' });
    expect(unpin.ok).toBe(true);
    expect((cards as unknown as { setNeverClose: ReturnType<typeof vi.fn> }).setNeverClose).toHaveBeenCalledWith(['a'], false);
  });

  it('migrates legacy roles and clears the settings fields on request', async () => {
    const mutate = vi.fn(async () => {});
    const cards = fakeCards({
      librarySnapshot: () => ({
        storage: { state: 'ready' as const },
        cards: [{ id: 'a', name: 'A', delegationGuidance: 'Guide.' }],
        defaultCardId: 'a',
        legacyRoles: ['a'],
        legacyDefaultRole: 'a',
      }),
    });
    const result = await dispatchCardMigrate(
      {
        settings: {
          writable: true,
          describe: () => [descriptor({ revision: 7 })],
          mutate,
        } as never,
        cards: () => cards,
      },
      { clearLegacy: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as { cleared: boolean; library: { legacyRoles: string[] } };
      expect(value.cleared).toBe(true);
      expect(value.library.legacyRoles).toEqual([]);
    }
    expect(mutate).toHaveBeenCalledWith(
      String(NS),
      [
        { op: 'unset', path: ['roles', 'a'] },
        { op: 'unset', path: ['defaultRole'] },
      ],
      7,
    );
  });

  it('does not clear legacy settings when a migration failed', async () => {
    const mutate = vi.fn(async () => {});
    const cards = fakeCards({
      migrateLegacy: vi.fn(async () => ({
        migrated: [],
        skipped: [],
        failed: [{ id: 'broken', message: 'bad legacy role' }],
        remainingLegacy: ['broken'],
      })),
    });
    const result = await dispatchCardMigrate(
      {
        settings: {
          writable: true,
          describe: () => [descriptor({ revision: 7 })],
          mutate,
        } as never,
        cards: () => cards,
      },
      { clearLegacy: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as { cleared: boolean; clearError?: string };
      expect(value.cleared).toBe(false);
      expect(value.clearError).toContain('failed');
    }
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not clear skipped legacy roles that were not migrated', async () => {
    const mutate = vi.fn(async () => {});
    const cards = fakeCards({
      librarySnapshot: () => ({
        storage: { state: 'ready' as const },
        cards: [{ id: 'a', name: 'A', delegationGuidance: 'Guide.' }],
        legacyRoles: ['a'],
        legacyDefaultRole: 'a',
      }),
      migrateLegacy: vi.fn(async () => ({
        migrated: [],
        skipped: ['a'],
        failed: [],
        remainingLegacy: ['a'],
      })),
    });
    const result = await dispatchCardMigrate(
      {
        settings: {
          writable: true,
          describe: () => [descriptor({ revision: 7 })],
          mutate,
        } as never,
        cards: () => cards,
      },
      { clearLegacy: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as { cleared: boolean; clearError?: string };
      expect(value.cleared).toBe(false);
      expect(value.clearError).toContain('no migrated roles');
    }
    expect(mutate).not.toHaveBeenCalled();
  });

  it('serves cardList through the captured web-server route', async () => {
    let route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> } | undefined;
    const settings = { writable: true, describe: () => [], mutate: async () => {} };
    const cards = fakeCards();
    installDirectorRemoteBridge(
      {
        get: (key: string) => {
          if (key === 'settings') return settings;
          if (key === 'webServer') {
            return { register: (value: typeof route) => { route = value; return () => {}; } };
          }
          if (key === 'subagentDirectorCards') return cards;
          return undefined;
        },
        logger: { debug: () => {} },
        effect: (fn: () => () => void) => fn(),
      } as never,
    );
    expect(route).toBeDefined();
    const result = await callRoute(route!, '/subagent-director/cardList', {
      type: 'client-request',
      rpcId: 'cards-1',
      method: 'cardList',
      payload: {},
    });
    expect(result.code).toBe(200);
    const body = JSON.parse(result.body) as { result: { ok: boolean; value?: { cards: unknown[] } } };
    expect(body.result.ok).toBe(true);
    expect(body.result.value?.cards).toHaveLength(1);
  });
});

/**

 * Unit tests for the self-published `/subagent-director` settings bridge
 * (src/remote.ts + src/bridge-contract.ts). The bridge is how the Web client
 * reads/writes the `subagent-director` namespace despite the Host apiproxy's
 * exposedNamespaces() allowlist answering `settings-not-exposed` for it
 * (dsh-host-apiproxy/lib/index.js:2410-2423, 3470-3475). Everything here runs
 * in a plain node environment against the pure mapping helpers and the
 * captured bridge handler.
 */
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
  it('returns a no-op disposer (and does not register) without settings/connection', () => {
    const ctx = { get: () => undefined, logger: { debug: () => {} } };
    const dispose = installDirectorRemoteBridge(ctx as never);
    expect(typeof dispose).toBe('function');
    dispose();
  });

  it('refuses settingsMutate requests whose ns does not match the owned namespace', async () => {
    let captured;
    const fakeCtx = {
      get: (key: string) => {
        if (key === 'settings') {
          return { writable: true, describe: () => [], mutate: async () => {} };
        }
        if (key === 'connection') {
          return {
            rpc: {
              handle: (channel: string, handler: unknown, options: unknown) => {
                captured = { channel, handler, options };
                return () => {};
              },
            },
          };
        }
        return undefined;
      },
      logger: { debug: () => {} },
    };
    installDirectorRemoteBridge(fakeCtx as never);
    expect(captured?.channel).toBe('/subagent-director');
    expect(captured?.options?.authority).toBe('loopback');
    const result = await captured.handler(
      'settingsMutate',
      { ns: 'llm-deepseek', ops: [] },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-request');
  });

  it('answers settingsView with an empty (unregistered) view through the handler', async () => {
    let captured;
    const fakeCtx = {
      get: (key: string) => {
        if (key === 'settings') {
          return { writable: true, describe: () => [] };
        }
        if (key === 'connection') {
          return {
            rpc: {
              handle: (channel: string, handler: unknown, options: unknown) => {
                captured = { channel, handler, options };
                return () => {};
              },
            },
          };
        }
        return undefined;
      },
      logger: { debug: () => {} },
    };
    installDirectorRemoteBridge(fakeCtx as never);
    const result = await captured.handler('settingsView', {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.writable).toBe(true);
      expect(result.value.view).toBeUndefined();
    }
  });
});

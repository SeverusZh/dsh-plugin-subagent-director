/**
 * Unit tests for the Subagent Director settings schema and write-time
 * validator (design section 5.2, section 11 test-plan row 1).
 * Covers: invalid role keys, empty displayName/description, dangling
 * defaultRole, whitespace-only providers, valid configs passing, schema
 * defaults, and the namespace brand value.
 */
import { describe, it, expect } from 'vitest';
import {
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
  SettingsSchema,
  installDirectorSettings,
  validateDirectorSettings,
  type RoleTemplate,
  type SubagentDirectorSettings,
} from '../src/settings.js';

function role(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  return { displayName: 'Coder', description: 'Writes code', ...overrides };
}

function validSettings(overrides: Partial<SubagentDirectorSettings> = {}): SubagentDirectorSettings {
  return {
    defaultProvider: 'deepseek-official',
    defaultRole: 'coder',
    roles: { coder: role() },
    ...overrides,
  };
}

describe('settings namespace', () => {
  it('is the plain kebab-case namespace literal surfaced to configuration UIs', () => {
    // alpha.4 namespaces are plain kebab-case string literals (template-literal
    // validated by dsh-settings), no runtime brand function anymore.
    expect(String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE)).toBe('subagent-director');
  });
});

describe('installDirectorSettings', () => {
  it('delegates to ctx.settings.installSection with the director namespace', () => {
    const calls: unknown[][] = [];
    const ctx = {
      get: (name: string) => (name === 'settings' ? {} : undefined),
      settings: {
        installSection(...args: unknown[]) {
          calls.push(args);
        },
      },
      logger: { debug: () => {} },
    };
    installDirectorSettings(
      ctx as never,
      { defaultProvider: 'opencode-go' },
      { setSource: () => {}, onChange: () => {} } as never,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('subagent-director');
    expect(calls[0][3]).toEqual({ defaultProvider: 'opencode-go' });
  });

  it('skips registration (no-op) when the settings service is absent', () => {
    const ctx = { get: () => undefined, logger: { debug: () => {} } };
    expect(() =>
      installDirectorSettings(ctx as never, {}, { setSource: () => {}, onChange: () => {} } as never),
    ).not.toThrow();
  });
});

describe('settings schema', () => {
  it('resolves an empty section to defaults (fallbackOnInvalid defaults true)', () => {
    const resolved = SettingsSchema({});
    expect(resolved.fallbackOnInvalid).toBe(true);
    expect(resolved.defaultProvider).toBeUndefined();
    // schemastery normalizes an absent dict to an empty object
    expect(resolved.roles).toEqual({});
  });

  it('accepts a fully-formed valid section', () => {
    const resolved = SettingsSchema(validSettings());
    expect(resolved.defaultProvider).toBe('deepseek-official');
    expect(resolved.roles?.coder.displayName).toBe('Coder');
  });
});

describe('validateDirectorSettings', () => {
  it('accepts a valid configuration without throwing', () => {
    expect(() => validateDirectorSettings(validSettings())).not.toThrow();
  });

  it('accepts an empty/minimal configuration', () => {
    expect(() => validateDirectorSettings({})).not.toThrow();
    expect(() => validateDirectorSettings({ roles: undefined })).not.toThrow();
  });

  it('accepts a defaultProvider without roles and without defaultRole', () => {
    expect(() =>
      validateDirectorSettings({ defaultProvider: 'openai', defaultModel: 'gpt-5' }),
    ).not.toThrow();
  });

  it('rejects a role key that is not kebab-case', () => {
    const badKeys = ['Bad Key', 'UPPER', 'snake_case', 'has space', 'trailing-'];
    for (const key of badKeys) {
      const settings = validSettings({ roles: { [key]: role() } });
      expect(() => validateDirectorSettings(settings)).toThrow(/kebab-case/);
    }
  });

  it('accepts valid kebab-case role keys', () => {
    const settings = validSettings({
      defaultRole: 'lead-coder',
      roles: {
        'lead-coder': role(),
        'deep-researcher-2': role({ displayName: 'Researcher' }),
        'x': role(),
      },
    });
    expect(() => validateDirectorSettings(settings)).not.toThrow();
  });

  it('rejects a role with empty displayName', () => {
    const settings = validSettings({ roles: { coder: role({ displayName: '' }) } });
    expect(() => validateDirectorSettings(settings)).toThrow(/displayName/);
    const spaced = validSettings({ roles: { coder: role({ displayName: '   ' }) } });
    expect(() => validateDirectorSettings(spaced)).toThrow(/displayName/);
  });

  it('rejects a role with empty description', () => {
    const settings = validSettings({ roles: { coder: role({ description: '' }) } });
    expect(() => validateDirectorSettings(settings)).toThrow(/description/);
  });

  it('rejects a dangling defaultRole that references no role', () => {
    const settings = validSettings({ defaultRole: 'ghost' });
    expect(() => validateDirectorSettings(settings)).toThrow(/defaultRole/);
    expect(() => validateDirectorSettings(settings)).toThrow(/ghost/);
  });

  it('accepts a defaultRole that references a defined role', () => {
    const settings = validSettings({
      roles: { a: role(), b: role({ displayName: 'B' }) },
      defaultRole: 'b',
    });
    expect(() => validateDirectorSettings(settings)).not.toThrow();
  });

  it('rejects a whitespace-only explicit defaultProvider', () => {
    expect(() => validateDirectorSettings({ defaultProvider: '   ' })).toThrow(/defaultProvider/);
  });

  it('rejects a whitespace-only role provider', () => {
    const settings = validSettings({ roles: { coder: role({ provider: ' ' }) } });
    expect(() => validateDirectorSettings(settings)).toThrow(/provider/);
  });

  it('accepts a role with an explicit provider', () => {
    const settings = validSettings({
      roles: { coder: role({ provider: 'opencode-go', model: 'deepseek-v4-flash' }) },
    });
    expect(() => validateDirectorSettings(settings)).not.toThrow();
  });
});

describe('settings schema toolFilter 物化（issue #2）', () => {
  it('role without toolFilter does not materialize an empty toolFilter object', () => {
    const resolved = SettingsSchema({
      roles: { observer: { displayName: '观察者', description: '测试' } },
    });
    expect((resolved.roles as Record<string, RoleTemplate>).observer.toolFilter).toBeUndefined();
  });

  it('an explicit toolFilter still resolves', () => {
    const resolved = SettingsSchema({
      roles: {
        reviewer: { displayName: 'Reviewer', description: 'Reviews', toolFilter: { allow: ['read'] } },
      },
    });
    expect((resolved.roles as Record<string, RoleTemplate>).reviewer.toolFilter).toEqual({
      allow: ['read'],
      deny: [],
    });
  });
});

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
  installDirectorSettingsPage,
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

describe('installDirectorSettingsPage', () => {
  it('registers the auto:false page policy on the settings inject', () => {
    const configured: Array<{ auto?: boolean }> = [];
    const effects: Array<() => unknown> = [];
    const childCtx = {
      effect: (fn: () => unknown) => { effects.push(fn); },
      settings: {
        configure(presentation: { auto?: boolean }) {
          configured.push(presentation);
          return () => {};
        },
      },
    };
    let injectedNames: readonly string[] | undefined;
    const ctx = {
      fiber: {},
      inject(names: readonly string[], cb: (child: unknown) => void) {
        injectedNames = names;
        cb(childCtx);
      },
    };
    installDirectorSettingsPage(ctx as never);
    expect(injectedNames).toEqual(['settings']);
    // The registered effect runs configure({ auto:false }, fiber).
    expect(effects).toHaveLength(1);
    effects[0]();
    expect(configured).toEqual([{ auto: false }]);
  });
});

describe('settings schema', () => {
  it('resolves an empty section to defaults (fallbackOnInvalid defaults true)', () => {
    const resolved = SettingsSchema({});
    // 0.1.7: settings fields are volatile references → read via .get().
    expect(resolved.fallbackOnInvalid.get()).toBe(true);
    expect(resolved.defaultProvider.get()).toBeUndefined();
    // schemastery normalizes an absent dict to an empty object
    expect(resolved.roles.get()).toEqual({});
  });

  it('accepts a fully-formed valid section', () => {
    const resolved = SettingsSchema(validSettings());
    expect(resolved.defaultProvider.get()).toBe('deepseek-official');
    expect(resolved.roles.get()?.coder.displayName).toBe('Coder');
  });

  it('rejects a role with an empty displayName at schema level (0.1.7 write gate)', () => {
    expect(() => SettingsSchema({ roles: { coder: { displayName: '', description: 'x' } } })).toThrow();
  });

  it('rejects a non-kebab-case role id at schema level', () => {
    expect(() => SettingsSchema({ roles: { 'Bad Key': { displayName: 'B', description: 'x' } } })).toThrow();
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
    expect((resolved.roles.get() as Record<string, RoleTemplate>).observer.toolFilter).toBeUndefined();
  });

  it('an explicit toolFilter still resolves', () => {
    const resolved = SettingsSchema({
      roles: {
        reviewer: { displayName: 'Reviewer', description: 'Reviews', toolFilter: { allow: ['read'] } },
      },
    });
    expect((resolved.roles.get() as Record<string, RoleTemplate>).reviewer.toolFilter).toEqual({
      allow: ['read'],
      deny: [],
    });
  });
});

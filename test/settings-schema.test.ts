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
  readDirectorSettings,
  settingsWarnings,
  danglingDefaultRoleWarning,
  createSettingsWarner,
  type DirectorSettingsHandles,
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

describe('read-time dangling defaultRole surfacing (0.1.7 hardening)', () => {
  /** Build DirectorSettingsHandles reading from a fixed snapshot. */
  function handles(overrides: Partial<SubagentDirectorSettings> = {}): DirectorSettingsHandles {
    const values: SubagentDirectorSettings = {
      defaultProvider: undefined,
      defaultModel: undefined,
      defaultReasoningEffort: undefined,
      defaultRole: undefined,
      fallbackOnInvalid: true,
      roles: {},
      ...overrides,
    };
    return {
      defaultProvider: { get: () => values.defaultProvider },
      defaultModel: { get: () => values.defaultModel },
      defaultReasoningEffort: { get: () => values.defaultReasoningEffort },
      defaultRole: { get: () => values.defaultRole },
      fallbackOnInvalid: { get: () => values.fallbackOnInvalid ?? true },
      roles: { get: () => values.roles },
    } as unknown as DirectorSettingsHandles;
  }

  it('reports a dangling defaultRole and returns the raw value unchanged', () => {
    const warnings: string[] = [];
    const settings = readDirectorSettings(
      handles({ defaultRole: 'ghost', roles: { coder: role() } }),
      warnings,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/defaultRole/);
    expect(warnings[0]).toMatch(/ghost/);
    // The user's stored value must not be silently rewritten.
    expect(settings.defaultRole).toBe('ghost');
  });

  it('reports nothing when defaultRole references a defined role', () => {
    const warnings: string[] = [];
    const settings = readDirectorSettings(
      handles({ defaultRole: 'coder', roles: { coder: role() } }),
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(settings.defaultRole).toBe('coder');
  });

  it('reports nothing when defaultRole is unset, empty, or blank', () => {
    for (const dr of [undefined, '', '   ']) {
      const warnings: string[] = [];
      readDirectorSettings(handles({ defaultRole: dr, roles: { coder: role() } }), warnings);
      expect(warnings).toEqual([]);
    }
  });

  it('reports nothing for a dangling role only when roles is empty', () => {
    const warnings: string[] = [];
    readDirectorSettings(handles({ defaultRole: 'ghost', roles: undefined }), warnings);
    expect(warnings).toHaveLength(1);
  });

  it('omits the collector entirely when none is supplied (no signature change)', () => {
    const settings = readDirectorSettings(handles({ defaultRole: 'ghost' }));
    expect(settings.defaultRole).toBe('ghost');
  });

  it('settingsWarnings lists exactly the dangling-defaultRole warning (pure)', () => {
    expect(settingsWarnings({ defaultRole: 'ghost', roles: { coder: role() } })).toHaveLength(1);
    expect(settingsWarnings({ defaultRole: 'coder', roles: { coder: role() } })).toEqual([]);
    expect(settingsWarnings({})).toEqual([]);
  });

  it('danglingDefaultRoleWarning is undefined for sound references only', () => {
    expect(danglingDefaultRoleWarning({ defaultRole: 'ghost', roles: { coder: role() } })).toMatch(/ghost/);
    expect(danglingDefaultRoleWarning({ defaultRole: 'coder', roles: { coder: role() } })).toBeUndefined();
    expect(danglingDefaultRoleWarning({ defaultRole: undefined })).toBeUndefined();
  });
});

describe('createSettingsWarner (deduped log emission)', () => {
  it('emits a warning once and swallows repeats of the same set', () => {
    const emitted: string[] = [];
    const warn = createSettingsWarner((m) => emitted.push(m));
    warn(['a', 'b']);
    warn(['a', 'b']);
    warn(['a', 'b']);
    expect(emitted).toEqual(['a', 'b']);
  });

  it('stays silent for a sound configuration', () => {
    const emitted: string[] = [];
    const warn = createSettingsWarner((m) => emitted.push(m));
    warn([]);
    warn([]);
    expect(emitted).toEqual([]);
  });

  it('re-warns after the set changes, including break → fix → break', () => {
    const emitted: string[] = [];
    const warn = createSettingsWarner((m) => emitted.push(m));
    warn(['a']);           // break → warn
    warn([]);              // fix → silent (clears memory)
    warn(['a']);           // break again → warn
    warn(['a', 'c']);      // set changed → warn only the new set
    expect(emitted).toEqual(['a', 'a', 'a', 'c']);
  });
});

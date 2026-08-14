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
  it('brands the subagent-director namespace', () => {
    // Branded string surfaced to configuration UIs.
    expect(String(SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE)).toBe('subagent-director');
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

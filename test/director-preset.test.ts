import { describe, it, expect } from 'vitest';
import {
  DIRECTOR_PRESET,
  registerDirectorPreset,
  type DirectorPresetDefinition,
} from '../src/director-preset.js';
import { DIRECTOR_PRESET_ID, isDirectorAgent } from '../src/director.js';

const WORK_TOOLS = [
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-fork',
  '@deepseek-ai/dsh-tool-cordis',
  '@deepseek-ai/dsh-tool-present',
];

describe('Director preset composition', () => {
  it('declares a real preset that contributes no work tools', () => {
    expect(DIRECTOR_PRESET.id).toBe(DIRECTOR_PRESET_ID);
    expect(DIRECTOR_PRESET.name).toBe('导演模式');
    expect(DIRECTOR_PRESET.plugins.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-ask-user']),
    );
    for (const entry of DIRECTOR_PRESET.plugins) {
      expect(WORK_TOOLS).not.toContain(entry.name);
      expect(entry.name === 'cordis:group' || entry.name.startsWith('@deepseek-ai/')).toBe(true);
    }
  });

  it('publishes the preset through the registry and releases it on disposal', async () => {
    const registered: DirectorPresetDefinition[] = [];
    const disposers: Array<() => void> = [];
    let released = 0;
    const registry = {
      register: async (definition: DirectorPresetDefinition) => {
        registered.push(definition);
        return async () => {
          released += 1;
        };
      },
    };
    const ctx = {
      inject: (_deps: string[], callback: () => void) => callback(),
      get: (name: string) => (name === 'agentPresets' ? registry : undefined),
      effect: (callback: () => () => void) => {
        const disposer = callback();
        if (typeof disposer === 'function') disposers.push(disposer);
        return () => {};
      },
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    };
    registerDirectorPreset(ctx as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.id).toBe(DIRECTOR_PRESET_ID);
    for (const dispose of disposers) dispose();
    await Promise.resolve();
    expect(released).toBe(1);
  });

  it('does nothing when the registry is missing', () => {
    const ctx = {
      inject: (_deps: string[], callback: () => void) => callback(),
      get: () => undefined,
      effect: () => () => {},
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    };
    expect(() => registerDirectorPreset(ctx as never)).not.toThrow();
  });
});

describe('isDirectorAgent', () => {
  const agent = { ctx: {}, session: {} } as never;

  it('reads the live composed preset first', () => {
    const ctx = {
      get: () => ({
        composedPreset: () => DIRECTOR_PRESET_ID,
        presetForSession: () => 'standard',
      }),
    } as never;
    expect(isDirectorAgent(ctx, agent)).toBe(true);
  });

  it('falls back to the recorded session preset and rejects other modes', () => {
    const ctx = {
      get: () => ({
        composedPreset: () => undefined,
        presetForSession: () => DIRECTOR_PRESET_ID,
      }),
    } as never;
    expect(isDirectorAgent(ctx, agent)).toBe(true);
    const other = {
      get: () => ({ composedPreset: () => 'standard', presetForSession: () => 'standard' }),
    } as never;
    expect(isDirectorAgent(other, agent)).toBe(false);
    expect(isDirectorAgent({ get: () => undefined } as never, agent)).toBe(false);
    expect(isDirectorAgent(ctx, undefined)).toBe(false);
  });
});

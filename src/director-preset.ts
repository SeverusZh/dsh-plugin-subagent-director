/**
 * Director Mode Agent Preset declaration.
 *
 * Registered by the host entry while `agentPresets` is available. The
 * composition deliberately omits every work tool: the Director plans,
 * delegates, and coordinates, while children run on a worker preset.
 */
import type { Context } from '@deepseek-ai/cordis';

import { DIRECTOR_PRESET_ID } from './director.js';

/** One child plugin row of the preset composition. */
export interface DirectorPresetEntry {
  id: string;
  name: string;
  config?: unknown;
  group?: boolean;
  isolate?: Record<string, boolean>;
}

/** Declarative preset shape accepted by the registry. */
export interface DirectorPresetDefinition {
  id: string;
  name: string;
  description: string;
  order: number;
  plugins: DirectorPresetEntry[];
}

/** Minimal registry face required by the host entry. */
export interface AgentPresetRegistryLike {
  register(definition: DirectorPresetDefinition): Promise<() => Promise<void>>;
}

const DIRECTOR_PERSONA =
  'You are Director Mode: an orchestration-only agent. You plan, delegate, and integrate results. You never perform the work yourself.';

const COMPACTION_GROUP: DirectorPresetEntry = {
  id: 'compaction',
  name: 'cordis:group',
  group: true,
  isolate: { compaction: true, toolResultPruner: true },
  config: [
    { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
    { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    {
      id: 'tool-result-pruner',
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    },
  ],
};

/** The Director Mode composition. */
export const DIRECTOR_PRESET: DirectorPresetDefinition = {
  id: DIRECTOR_PRESET_ID,
  name: 'Director Mode',
  description:
    'Orchestration-only mode: the main agent plans and delegates, every subagent is card-bound, and Agent Teams is on by default.',
  order: 5,
  plugins: [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: DIRECTOR_PERSONA },
    },
    {
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: 65536 },
    },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    {
      id: 'tool-subagent-control',
      name: '@deepseek-ai/dsh-tool-subagent-control',
      config: { interrupt: false },
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    COMPACTION_GROUP,
  ],
};

/**
 * Register the Director preset once the preset registry exists. A host without
 * the registry keeps every other feature and simply has no Director Mode.
 * @param ctx - host plugin context owning the registration lifetime.
 */
export function registerDirectorPreset(ctx: Context): void {
  ctx.inject(['agentPresets'], () => {
    const registry = ctx.get('agentPresets') as AgentPresetRegistryLike | undefined;
    if (registry === undefined) return;
    let disposed = false;
    let release: (() => Promise<void>) | undefined;
    const disposeRelease = (): void => {
      const current = release;
      release = undefined;
      if (current === undefined) return;
      void current().catch((error: unknown) => {
        ctx.logger.warn(
          '[subagent-director] director preset release failed: ' + (error instanceof Error ? error.message : String(error)),
        );
      });
    };
    ctx.effect(
      () => () => {
        disposed = true;
        disposeRelease();
      },
      'subagent-director: director preset',
    );
    void registry
      .register(DIRECTOR_PRESET)
      .then((disposer) => {
        if (disposed) {
          void disposer().catch(() => {});
          return;
        }
        release = disposer;
        ctx.logger.info('[subagent-director] Director Mode preset registered');
      })
      .catch((error: unknown) => {
        ctx.logger.warn(
          '[subagent-director] Director Mode preset registration failed: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  });
}

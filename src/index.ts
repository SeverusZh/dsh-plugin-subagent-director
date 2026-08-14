/**
 * Subagent Director — host plugin composition entry (design section 3).
 *
 * Wires the settings section, the role-guidance section, and the subagent_role
 * delegation tool. Reads user settings live; a deployment without a settings
 * provider degrades to an empty resolved section (zero intrusion).
 *
 * Dependency posture: subagents and llm are required (the tool and its runtime
 * route validation need them); systemPrompt and settings are optional and are
 * acquired lazily so their absence does not block the rest.
 *
 * Continuable background is deferred to M2 and rejected here at assembly time.
 */
import type { Context } from '@deepseek-ai/cordis';
import { assertSubagentMaxDepth } from '@deepseek-ai/dsh-subagent';
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent';

import { createDelegationTool } from './delegation-tool.js';
import { applyGuidance } from './guidance.js';
import { installDirectorSettings } from './settings.js';

export { Config } from './config.js';
export type { DirectorConfig } from './config.js';
export {
  createDelegationParameters,
  createDelegationOutputSchema,
  createDelegationTool,
  DELEGATION_TOOL_PREFIX,
  type DelegationToolArgs,
} from './delegation-tool.js';
export { applyGuidance, renderRolesGuidance, GUIDANCE_SECTION_ORDER, GUIDANCE_SECTION_NAME } from './guidance.js';
export {
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
  SettingsSchema,
  validateDirectorSettings,
  installDirectorSettings,
  type RoleTemplate,
  type SubagentDirectorSettings,
} from './settings.js';

export const name = 'subagent-director';

export const inject = ['tools', 'subagents', 'llm'];

export function apply(ctx: Context, config: import('./config.js').DirectorConfig) {

  // M1 rejects continuable background at assembly time (design R5).
  if ((config.backgroundMode ?? 'one-shot') === 'continuable') {
    throw new Error('subagent-director: backgroundMode "continuable" is deferred to M2 and is not supported in M1 — use "one-shot"');
  }

  const toolName = config.toolName ?? 'subagent_role';
  const providerName = config.subagentProvider ?? 'spawn';

  // ---- settings snapshot -------------------------------------------------
  let settings: import('./settings.js').SubagentDirectorSettings = {};
  installDirectorSettings(ctx, {}, {
    setSource: (current) => {
      settings = current();
    },
    onChange: () => {
      // snapshot already updated by setSource; nothing further to do in M1.
    },
  });
  const getSettings = (): import('./settings.js').SubagentDirectorSettings => settings;

  // ---- role guidance ----------------------------------------------------
  applyGuidance(ctx, getSettings, toolName);

  // ---- delegation tool registration ------------------------------------
  if (typeof config.maxDepth === 'number') assertSubagentMaxDepth(config.maxDepth);
  let disposeTool: (() => void) | undefined;

  const mount = (provider: SubagentProvider) => {
    if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error('subagent-director: provider "' + provider.name + '" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: \'provider-managed\'');
    }
    ctx.logger.info('[' + name + '] registering ' + toolName + ' on subagent transport ' + '"' + providerName + '"');
    disposeTool = ctx.tools.register(createDelegationTool({ ctx, config, provider, getSettings }));
  };

  ctx.on('subagent/provider-added', (provider: SubagentProvider) => {
    if (provider.name === providerName && disposeTool === undefined) mount(provider);
  });
  ctx.on('subagent/provider-removed', (name2: string) => {
    if (name2 !== providerName || disposeTool === undefined) return;
    disposeTool();
    disposeTool = undefined;
  });

  const present = ctx.subagents.getProvider(providerName);
  if (present !== undefined) mount(present);
  else ctx.logger.info('[' + name + '] subagent provider ' + '"' + providerName + '" not registered yet; the "' + toolName + '" tool will register when it appears');
}

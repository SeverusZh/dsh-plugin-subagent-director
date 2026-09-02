/**
 * Subagent Director — host plugin composition entry (design section 3).
 *
 * Wires the settings section, the role-guidance section, and the subagent_role
 * delegation tool. Reads user settings live; a deployment without a settings
 * provider degrades to an empty resolved section (zero intrusion).
 *
 * Dependency posture: tools/subagents/llm/settings are required through inject
 * (both web and headless bundles mount the settings service); systemPrompt
 * remains optional and is acquired lazily so its absence does not block the
 * rest. The /orchestrate command's `commands` dependency likewise stays
 * optional — acquired reactively (ctx.inject child fiber) in orchestrate.ts,
 * so hosts without a command registry lose only that command. The
 * webServer-dependent HTTP bridge lives in the separate
 * \`subagent-director-bridge\` entry (src/bridge-entry.ts).
 *
 * Background modes: 'one-shot' defaults calls to foreground and runs background
 * calls as a plain Task; 'continuable' defaults them to background via
 * ctx.subagents.startContinuable() and requires the transport provider's
 * prepareContinuable capability, which is validated at mount time (mirrors
 * dsh-tool-subagent).
 */
import type { Context } from '@deepseek-ai/cordis';
import { assertSubagentMaxDepth } from '@deepseek-ai/dsh-subagent';
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent';

import { createDelegationTool } from './delegation-tool.js';
import { CLOSE_SUBAGENT_TOOL_NAME, createCloseSubagentTool } from './close-tool.js';
import { applyGuidance } from './guidance.js';
import { applyOrchestrate } from './orchestrate.js';
import { createSettingsSnapshot, installDirectorSettings } from './settings.js';

export { Config } from './config.js';
export type { DirectorConfig } from './config.js';
export {
  assertDelegationCapabilities,
  buildSubagentRequest,
  createDelegationParameters,
  createDelegationOutputSchema,
  createDelegationTool,
  DELEGATION_TOOL_PREFIX,
  resolveDelegationMode,
  renderDelegationResult,
  type DelegationToolArgs,
  type DelegationResult,
  type DelegationRoute,
  type DelegationModeDecision,
  type SubagentRequestParts,
} from './delegation-tool.js';
export { applyGuidance, renderRolesGuidance, GUIDANCE_SECTION_ORDER, GUIDANCE_SECTION_NAME } from './guidance.js';
export {
  applyOrchestrate,
  renderOrchestratorPrompt,
  renderOrchestratorRoles,
  renderOrchestratorUnavailableNotice,
  buildOrchestratorFrame,
  detectOrchestrateRequest,
  ORCHESTRATE_SECTION_NAME,
  ORCHESTRATE_SECTION_ORDER,
  ORCHESTRATE_PROJECTION_KEY,
  ORCHESTRATE_EVENT_TYPE,
  ORCHESTRATE_VALID_MODES,
  type OrchestrateMode,
  type OrchestrateRequest,
} from './orchestrate.js';
export { CLOSE_SUBAGENT_TOOL_NAME, createCloseSubagentTool } from './close-tool.js';
export {
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
  SettingsSchema,
  validateDirectorSettings,
  installDirectorSettings,
  type RoleTemplate,
  type SubagentDirectorSettings,
} from './settings.js';

export const name = 'subagent-director';

export const inject = ['tools', 'subagents', 'llm', 'settings'];

export function apply(ctx: Context, config: import('./config.js').DirectorConfig) {
  const backgroundMode = config.backgroundMode ?? 'one-shot';
  const toolName = config.toolName ?? 'subagent_role';
  const providerName = config.subagentProvider ?? 'spawn';

  // NOTE: the /subagent-director settings bridge route is installed by the
  // separate `subagent-director-bridge` plugin entry (src/bridge-entry.ts),
  // which injects webServer — tree-external plugins cannot see that service
  // through ctx.get(). The main entry must not touch webServer, or headless
  // profiles would lose the delegation tool.

  // ---- settings snapshot -------------------------------------------------
  // 快照跟随 dsh-settings 的 onChange 热更新（settings.yaml / 设置面板改动
  // 即时生效），不再只在挂载时读取一次。
  const settingsSnapshot = createSettingsSnapshot<import('./settings.js').SubagentDirectorSettings>({});
  installDirectorSettings(ctx, {}, settingsSnapshot.hooks);
  const getSettings = settingsSnapshot.get;

  // ---- role guidance ----------------------------------------------------
  applyGuidance(ctx, getSettings, toolName);

  // ---- orchestrate command + projection + prompt section ----------------
  applyOrchestrate(ctx, getSettings, toolName);

  // ---- close_subagent tool ----------------------------------------------
  // Provider-independent (drain is a global subagents operation), so it
  // registers at mount time like the control tools; on a deployment without
  // continuable children it is a safe no-op.
  ctx.effect(() => ctx.tools.register(createCloseSubagentTool({ ctx })), 'subagent-director: close_subagent tool');

  // ---- delegation tool registration ------------------------------------
  if (typeof config.maxDepth === 'number') assertSubagentMaxDepth(config.maxDepth);
  let disposeTool: (() => void) | undefined;

  const mount = (provider: SubagentProvider) => {
    if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error('subagent-director: provider "' + provider.name + '" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: \'provider-managed\'');
    }
    if (backgroundMode === 'continuable' && provider.prepareContinuable === undefined) {
      throw new Error('subagent-director: provider "' + provider.name + '" does not support backgroundMode: continuable — switch the subagent provider or use backgroundMode: "one-shot"');
    }
    ctx.logger.info(
      '[' + name + '] registering ' + toolName + ' on subagent transport ' + '"' + providerName + '"' + ' with backgroundMode ' + '"' + backgroundMode + '"',
    );
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

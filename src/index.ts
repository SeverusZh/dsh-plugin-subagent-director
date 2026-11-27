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
 * rest. Director Mode registers through the optional `agentPresets` service:
 * a host without agent presets keeps the delegation tool and card library but
 * has no Director preset. The webServer-dependent HTTP bridge lives in the
 * separate \`subagent-director-bridge\` entry (src/bridge-entry.ts).
 *
 * Background modes (0.2.x startActivation seam): 'one-shot' defaults calls to
 * foreground (delivery 'caller'); 'continuable' defaults them to background
 * (delivery 'parent') and requires the transport provider's prepareContinuable
 * capability, which is validated at mount time (mirrors dsh-tool-subagent).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { assertSubagentMaxDepth } from '@deepseek-ai/dsh-subagent';
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent';

import { createDelegationTool } from './delegation-tool.js';
import { CLOSE_SUBAGENT_TOOL_NAME, createCloseSubagentTool } from './close-tool.js';
import { forgetResident, clearResidentHandles } from './resident-handles.js';
import { applyCardPromptSection } from './card-prompt.js';
import { CARD_SERVICE_NAME, CardService } from './card-store.js';
import { applyGuidance } from './guidance.js';
import { DIRECTOR_PRESET_ID, isDirectorAgent } from './director.js';
import { registerDirectorPreset } from './director-preset.js';
import { applyDirectorPolicy, restrictDirectorWorkTools } from './director-policy.js';
import { applyDirectorToolGuard } from './director-guard.js';
import { shouldEnableDirectorTeam, teamEventCount } from './director-team.js';
import { createCardCreateTool } from './card-tool.js';
import { readDirectorSettings, installDirectorSettingsPage, createSettingsWarner, type DirectorSettingsHandles } from './settings.js';

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
export { DIRECTOR_CARD_ID, DIRECTOR_PRESET_ID, isDirectorAgent } from './director.js';
export { BUILTIN_DIRECTOR_CARD } from './director-card.js';
export {
  DIRECTOR_PRESET,
  registerDirectorPreset,
  type DirectorPresetDefinition,
  type DirectorPresetEntry,
} from './director-preset.js';
export {
  applyDirectorPolicy,
  DIRECTOR_POLICY_ORDER,
  DIRECTOR_POLICY_SECTION,
  renderDirectorPolicy,
  restrictDirectorWorkTools,
} from './director-policy.js';
export { CARD_CREATE_TOOL_NAME, createCardCreateTool, type CardCreateArgs } from './card-tool.js';
export { CLOSE_SUBAGENT_TOOL_NAME, createCloseSubagentTool } from './close-tool.js';
export {
  SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE,
  SettingsSchema,
  validateDirectorSettings,
  installDirectorSettingsPage,
  readDirectorSettings,
  settingsWarnings,
  danglingDefaultRoleWarning,
  createSettingsWarner,
  type RoleTemplate,
  type SubagentDirectorSettings,
} from './settings.js';

export {
  CardService,
  CARD_DOMAIN_NAME,
  CARD_DOMAIN_VERSION,
  CARD_SERVICE_NAME,
  CardBindingSchema,
  cardDomainSpec,
  type CardLogger,
  type CardServiceLike,
  type CardServiceOptions,
  type ResolvedCard,
} from './card-store.js';
export {
  CardModelSchema,
  CharacterCardInputSchema,
  CharacterCardSchema,
  buildCardBundle,
  cardToRoleTemplate,
  emptyImportResult,
  legacyRoleToCard,
  parseCardDraft,
  parseCardImportPayload,
  parseImportedCard,
  type CardDraft,
  type CardDraftInput,
  type CardImportPayload,
  type LegacyRole,
  type StoredCard,
} from './card-model.js';
export {
  CARD_ACCENTS,
  CARD_BUNDLE_KIND,
  CARD_FORMAT_VERSION,
  CARD_ID_PATTERN,
  CARD_KIND,
  CARD_LIMITS,
  cardAccentOf,
  cardIdFromName,
  cardInitial,
  formatTagInput,
  hasCardPrompt,
  isCardEnabled,
  isCardId,
  parseTagInput,
  renderCardPrompt,
  type CardAccent,
  type CardImportIssue,
  type CardImportResult,
  type CardImportStrategy,
  type CardLibrarySnapshot,
  type CardMigrationResult,
  type CardModelBinding,
  type CardPromptBinding,
  type CardStorageStatus,
  type CharacterCard,
  type CharacterCardBundle,
  type CharacterCardDraft,
} from './card-types.js';
export {
  applyCardPromptSection,
  CARD_PROMPT_SECTION_NAME,
  CARD_PROMPT_SECTION_ORDER,
} from './card-prompt.js';

export const name = 'subagent-director';

export const inject = ['tools', 'subagents', 'llm', 'settings'];

export function apply(ctx: Context, config: import('./config.js').DirectorConfig & DirectorSettingsHandles) {
  const backgroundMode = config.backgroundMode ?? 'one-shot';
  const toolName = config.toolName ?? 'subagent_role';
  const providerName = config.subagentProvider ?? 'spawn';

  // NOTE: the /subagent-director settings bridge route is installed by the
  // separate `subagent-director-bridge` plugin entry (src/bridge-entry.ts),
  // which injects webServer — tree-external plugins cannot see that service
  // through ctx.get(). The main entry must not touch webServer, or headless
  // profiles would lose the delegation tool.

  // ---- settings (0.1.7: plugin Config schema, volatile = live) ------------
  // 设置声明为插件 Config schema（src/config.ts 的 SettingsFields），读取用
  // `config.<field>.get()`；写入经 configEditor 就地更新引用，插件无需重启即
  // 生效（设置面板改动即时生效）。页面策略 auto:false = 使用插件自建 UI。
  installDirectorSettingsPage(ctx);
  // Single settings-read chokepoint for every consumer (guidance / resolver /
  // Director plane). Read-time warnings — currently a dangling defaultRole the
  // 0.1.7 write path admits — are logged here, deduped by warning-set signature
  // (persistent misconfiguration warns once, not on every read).
  const warnSettings = createSettingsWarner((message) => ctx.logger.warn('[' + name + '] ' + message));
  const getRawSettings = () => {
    const warnings: string[] = [];
    const settings = readDirectorSettings(config, warnings);
    warnSettings(warnings);
    return settings;
  };

  // ---- character cards ---------------------------------------------------
  // Cards are persisted by their own storage domain; the raw settings getter
  // remains the migration source for the legacy `roles` field.
  const cards = new CardService({ ctx, getSettings: getRawSettings, logger: ctx.logger });
  ctx.provide(CARD_SERVICE_NAME, cards);
  ctx.effect(
    () => () => cards.dispose(),
    'subagent-director: card service',
  );
  const storageDomain = (ctx as unknown as { get(name: string): unknown }).get('storageDomain') as
    | DomainFacility
    | undefined;
  if (storageDomain !== undefined) {
    cards.attachStorage(storageDomain);
  } else {
    cards.markUnavailable('the storage-domain service is not mounted in this deployment');
    ctx.inject(['storageDomain'], (child) => {
      const facility = (child as unknown as { get(name: string): unknown }).get('storageDomain') as
        | DomainFacility
        | undefined;
      if (facility !== undefined) cards.attachStorage(facility);
    });
  }
  // The active child prompt is keyed by the child session id reserved before
  // startActivation, so it applies to exactly that child and survives edits.
  applyCardPromptSection(ctx, (sessionId) => cards.bindingText(sessionId));
  const getSettings = (agent?: Agent) => {
    const director = isDirectorAgent(ctx, agent);
    return cards.settingsWithCards(getRawSettings(), {
      includeBuiltIn: director,
      includeLegacyRoles: !director,
    });
  };

  // ---- role guidance ----------------------------------------------------
  applyGuidance(ctx, getSettings, toolName, cards, (agent) => isDirectorAgent(ctx, agent));

  // ---- Director Mode ----------------------------------------------------
  // The preset composition selects the persona and tool surface; these host
  // contributions are gated by the live agent's preset id. The execution guard
  // evaluates that preset on every call, so preset switches apply immediately.
  registerDirectorPreset(ctx);
  applyDirectorPolicy(ctx, (agent) => isDirectorAgent(ctx, agent), toolName);
  applyDirectorToolGuard(ctx, (agent) => isDirectorAgent(ctx, agent), toolName);
  ctx.effect(
    () =>
      ctx.tools.register(
        createCardCreateTool({
          cards,
          toolName,
          workerPreset: config.directorWorkerPreset ?? 'standard',
        }),
        {
          when: ({ agent }) => isDirectorAgent(ctx, agent),
        },
      ),
    'subagent-director: card create tool',
  );

  // ---- close_subagent tool ----------------------------------------------
  // Registers at mount time like the control tools. It releases only the
  // activation receipts this plugin retains for its own continuable children;
  // a target started elsewhere or before a host restart is rejected.
  ctx.effect(() => ctx.tools.register(createCloseSubagentTool({ ctx, cards })), 'subagent-director: close_subagent tool');

  // A disposed child may have been released by its parent/teardown instead of
  // close_subagent; drop the stale receipt so the registry does not retain it.
  ctx.on('agent/disposed', ({ agent }) => {
    forgetResident(String(agent.id));
    void cards.endBinding(String(agent.id), { onlyEphemeral: true }).catch(() => {});
  });
  ctx.effect(() => () => clearResidentHandles(), 'subagent-director: resident receipts');

  // ---- delegation tool registration ------------------------------------
  if (typeof config.maxDepth === 'number') assertSubagentMaxDepth(config.maxDepth);
  let disposeTool: (() => void) | undefined;
  let activeProvider: SubagentProvider | undefined;
  const shadows = new Map<string, () => void>();
  const restrictions = new Map<string, () => void>();
  const autoTeam = new Map<string, number>();
  let refreshDirectorShadows: () => void = () => {};
  let refreshDirectorRestrictions: () => void = () => {};

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
    activeProvider = provider;
    refreshDirectorShadows();
    disposeTool = ctx.tools.register(
      createDelegationTool({
        ctx,
        config,
        provider,
        getSettings,
        cards,
        directorGuard: (agent) => isDirectorAgent(ctx, agent),
        defaultWorkerPreset: config.directorWorkerPreset ?? 'standard',
        directorProvider: config.directorProvider ?? 'spawn',
      }),
    );
    refreshDirectorRestrictions();
  };

  ctx.on('subagent/provider-added', (provider: SubagentProvider) => {
    if (provider.name === providerName && disposeTool === undefined) mount(provider);
  });
  ctx.on('subagent/provider-removed', (name2: string) => {
    if (name2 !== providerName || disposeTool === undefined) return;
    disposeTool();
    disposeTool = undefined;
    activeProvider = undefined;
    for (const id of [...shadows.keys()]) disposeShadow(id);
  });

  const present = ctx.subagents.getProvider(providerName);
  if (present !== undefined) mount(present);
  else ctx.logger.info('[' + name + '] subagent provider ' + '"' + providerName + '" not registered yet; the "' + toolName + '" tool will register when it appears');

  // ---- Director lifecycle ------------------------------------------------
  // A blank session switches presets through agentPresets.select() without a
  // new agent/created event. Restrictions and the card-required shadow tool are
  // therefore keyed by agent and synchronized on both creation and selection.
  const ensureDirectorTeam = async (agent: Agent): Promise<void> => {
    if (!shouldEnableDirectorTeam(agent, config.directorTeamDefault !== false)) return;
    const teams = ctx.get('agentTeams') as { setEnabled(agent: Agent, enabled: boolean): Promise<void> } | undefined;
    if (teams === undefined) return;
    try {
      await teams.setEnabled(agent, true);
      autoTeam.set(String(agent.id), teamEventCount(agent));
    } catch (error) {
      ctx.logger.warn(
        '[' + name + '] could not enable Agent Teams for the Director session: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };
  const disableAutoTeam = async (agent: Agent): Promise<void> => {
    const id = String(agent.id);
    const expected = autoTeam.get(id);
    if (expected === undefined) return;
    autoTeam.delete(id);
    if (teamEventCount(agent) !== expected) return;
    const teams = ctx.get('agentTeams') as { setEnabled(agent: Agent, enabled: boolean): Promise<void> } | undefined;
    if (teams === undefined) return;
    try {
      await teams.setEnabled(agent, false);
    } catch (error) {
      ctx.logger.warn(
        '[' + name + '] could not restore Agent Teams after leaving Director Mode: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const disposeShadow = (id: string): void => {
    const dispose = shadows.get(id);
    shadows.delete(id);
    dispose?.();
  };
  const liftRestriction = (id: string): void => {
    const dispose = restrictions.get(id);
    restrictions.delete(id);
    dispose?.();
  };
  const syncDirectorAgent = (agent: Agent, director: boolean): void => {
    const id = String(agent.id);
    if (!director) {
      disposeShadow(id);
      liftRestriction(id);
      return;
    }
    if (!restrictions.has(id)) {
      try {
        const dispose = restrictDirectorWorkTools(agent, toolName);
        if (dispose !== undefined) restrictions.set(id, dispose);
      } catch (error) {
        ctx.logger.warn(
          '[' + name + '] could not restrict work tools for the Director session: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    if (!shadows.has(id) && activeProvider !== undefined) {
      try {
        const dispose = agent.ctx.tools.register(
          createDelegationTool({
            ctx: agent.ctx,
            config,
            provider: activeProvider,
            getSettings,
            cards,
            requireRole: true,
            includeBuiltInCards: true,
            defaultWorkerPreset: config.directorWorkerPreset ?? 'standard',
            directorProvider: config.directorProvider ?? 'spawn',
            directorGuard: () => true,
          }),
        );
        shadows.set(id, dispose);
      } catch (error) {
        ctx.logger.warn(
          '[' + name + '] could not mount the card-required delegation tool for a Director session: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  };

  refreshDirectorShadows = (): void => {
    const agents = ctx.get('agents') as { list?: () => Agent[] } | undefined;
    if (agents?.list === undefined) return;
    for (const live of agents.list()) {
      if (isDirectorAgent(ctx, live)) syncDirectorAgent(live, true);
    }
  };
  refreshDirectorRestrictions = (): void => {
    const agents = ctx.get('agents') as { list?: () => Agent[] } | undefined;
    if (agents?.list === undefined) return;
    for (const live of agents.list()) {
      if (!isDirectorAgent(ctx, live)) continue;
      liftRestriction(String(live.id));
      syncDirectorAgent(live, true);
    }
  };
  refreshDirectorShadows();
  refreshDirectorRestrictions();

  ctx.on('agent/created', async ({ agent }) => {
    const director = isDirectorAgent(ctx, agent);
    syncDirectorAgent(agent, director);
    if (director) await ensureDirectorTeam(agent);
  });
  ctx.on('agent/disposed', ({ agent }) => {
    const id = String(agent.id);
    disposeShadow(id);
    liftRestriction(id);
    autoTeam.delete(id);
  });
  ctx.effect(
    () => () => {
      for (const id of [...shadows.keys()]) disposeShadow(id);
      for (const id of [...restrictions.keys()]) liftRestriction(id);
      autoTeam.clear();
    },
    'subagent-director: director lifecycle',
  );

  const agentEvents = ctx as unknown as {
    on(
      event: 'agent-preset/selected',
      listener: (sessionId: string, preset: string) => void,
    ): () => void;
  };
  agentEvents.on('agent-preset/selected', (sessionId, preset) => {
    const agents = ctx.get('agents') as { get(id: string): Agent | undefined } | undefined;
    const agent = agents?.get(sessionId);
    if (agent === undefined) return;
    const director = preset === DIRECTOR_PRESET_ID;
    syncDirectorAgent(agent, director);
    // The selection event is emitted inside the session append that records it;
    // Team changes append to the same log and must wait for that publication.
    queueMicrotask(() => {
      if (director) void ensureDirectorTeam(agent);
      else void disableAutoTeam(agent);
    });
  });
}

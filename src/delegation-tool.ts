/**
 * Delegation tool subagent_role (design section 7).
 *
 * A model-facing tool that lets the calling agent delegate to a subagent while
 * selecting an LLM route and/or a named character card. It resolves the four-layer
 * fallback chain via the pure resolveRoute (design section 6), validates the
 * resolution against live runtime facts, and assembles a SubagentStartRequest
 * on ctx.subagents.startActivation(...) exactly like dsh-workflow-worker-thread's
 * startChild and dsh-tool-subagent's activation path.
 *
 * Two provider namespaces coexist and MUST NOT be confused (design section 14, R2):
 *   - config.subagentProvider is the subagent TRANSPORT provider name handed
 *     as the spec's `provider` field to ctx.subagents.startActivation(spec) (e.g. spawn).
 *   - the resolved agentOptions.provider is an LLM route served by an adapter
 *     (e.g. deepseek-official).
 *
 * Execution contract (schema/execute mirror dsh-tool-subagent on the 0.2.x
 * startActivation seam):
 *   - foreground is the core path: startActivation with delivery 'caller',
 *     await activation.result, throw a stop-reason error for a non-completed
 *     child, dispose idempotently, return { kind: foreground, runId, output }.
 *   - background runs the child through startActivation with delivery 'parent'
 *     (the runtime owns result delivery and notifies the parent model) and
 *     returns the durable child id immediately: { kind: continuable, subagentId }
 *     when the provider is continuable (the parent later follows up with
 *     send_message), else { kind: background, jobId } for a one-shot child.
 *
 * reasoningEffort: alpha.4 `AgentOptions` carries `reasoningEffort?:
 * ReasoningEffortId` (dsh-agent runtime-types), so the resolver injects it
 * into agentOptions alongside a resolved route (and allows an explicit
 * effort alone). Provider/model selection is CONSTRAINED to the official
 * `subagent-model-selection` allowedModels list: the resolver throws for an
 * unlisted explicit pair and drops unlisted role/default routes, so this
 * plugin never double-writes a model route the official tool also owns.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SubagentActivation, SubagentCapabilities, SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent';
import { randomUUID } from 'node:crypto';

import type { DirectorConfig } from './config.js';
import type { CardService } from './card-store.js';
import { isCardEnabled, renderCardPrompt } from './card-types.js';
import { readNamespaceValue, SUBAGENT_MODEL_SELECTION_NAMESPACE } from './settings.js';
import { resolveRoute, type SubagentDirectorSettings } from './route-resolver.js';
import { trackResident } from './resident-handles.js';

/** Stable log namespace prefix for delegation/tool diagnostics (design section 10). */
export const DELEGATION_TOOL_PREFIX = 'subagent-director';

/** The canonical error prefix used across all structured failures (FR-8.1 / design 7.3). */
const ERROR_PREFIX = 'subagent-director:';

/**
 * Delegate a task to a character-card-bound subagent with an optional LLM route
 * override. Resolves card/model/provider through the call -> card -> default ->
 * inherit chain; the card's fixed prompt and persona are injected for the child.
 */
export interface DelegationToolArgs {
  /** A short (3-5 word) description of the delegated task, for display. */
  description: string;
  /** The complete, self-contained task for the subagent. */
  prompt: string;
  /** Character-card id (optional). Falls back to the configured default card. */
  role?: string;
  /** LLM provider route override (optional). Wins over any role binding. */
  provider?: string;
  /** Model id override (optional). Wins over any role binding. */
  model?: string;
  /**
   * Reasoning-effort override (optional). With alpha.4 AgentOptions this is
   * injected onto the resolved route; may also be supplied alone (provider and
   * model stay inherited or card-bound).
   */
  reasoningEffort?: string;
  /**
   * Whether to run in the background. Defaults to false in one-shot mode; in
   * continuable mode it defaults to true and returns the durable child id for
   * later send_message follow-up.
   */
  run_in_background?: boolean;
}

/**
 * Build the model-facing tool parameter schema given a config. Exposed as a
 * pure function so unit tests can assert the model-visible shape without a live
 * context: description/prompt are required; role/provider/model/reasoningEffort
 * are optional; run_in_background appears only when enableRunInBackground is not
 * false. In continuable mode its description notes the default of true and the
 * durable-child-id return shape (mirrors dsh-tool-subagent's wording).
 */
export function createDelegationParameters(
  config: Pick<DirectorConfig, 'enableRunInBackground' | 'backgroundMode'>,
  options: { requireRole?: boolean } = {},
): ParameterSchemaSpec {
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
  const requireRole = options.requireRole === true;
  const parameters: ParameterSchemaSpec = {
    description: {
      type: 'string',
      required: true,
      description: 'A short (3-5 word) description of the delegated task, for display.',
    },
    prompt: {
      type: 'string',
      required: true,
      description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
    },
    role: {
      type: 'string',
      ...(requireRole ? { required: true } : {}),
      description: requireRole
        ? 'Character-card id (required in Director Mode). Search the library with subagent_card_search first; create a card with subagent_card_create only when nothing matches.'
        : 'Character-card id (optional). Falls back to the configured default card when unset.',
    },
    provider: {
      type: 'string',
      description: 'LLM provider route override (optional). Explicit provider/model win over a role binding. Must match a route with a registered adapter.',
    },
    model: { type: 'string', description: 'Model id override (optional). Explicit provider/model win over a role binding.' },
    reasoningEffort: { type: 'string', description: 'Reasoning-effort override (optional). Adapter serving the route decides support.' },
  };
  if (config.enableRunInBackground !== false) {
    parameters.run_in_background = {
      type: 'boolean',
      description: continuable
        ? 'Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result when your next action depends on it.'
        : 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.',
    };
  }
  return parameters;
}

/** The model-facing output schema: exactly one of background, continuable, or foreground. */
export function createDelegationOutputSchema(): ValueSchemaSpec {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'background' },
          jobId: { type: 'string', required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'continuable' },
          subagentId: { type: 'string', required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'foreground' },
          runId: { type: 'string', required: true },
          output: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
    ],
  };
}

function isEmpty(value: string | undefined | null): boolean {
  return value === undefined || value === null || value === '';
}

/** A non-completed stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined;
    case 'aborted':
      return 'subagent run was cancelled';
    case 'error':
      return 'subagent run failed';
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing';
    case 'refusal':
      return 'subagent declined the task';
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`;
  }
}

/** Append the child's preserved partial answer to a stop-reason error. */
function withPartialText(error: string, output: readonly ContentBlock[]): string {
  const text = output
    .filter((block) => block.type === 'text')
    .map((block) => block.text as string)
    .join('');
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`;
}

/**
 * Collect and release one foreground activation without letting disposal
 * replace an independent result failure (mirrors dsh-tool-subagent's
 * settleForegroundRun). The activation's `result` resolves with the child's
 * terminal SubagentResult; `dispose()` releases the execution handle.
 */
async function settleForegroundActivation(activation: SubagentActivation): Promise<{ kind: 'foreground'; runId: string; output: JsonValue[] }> {
  const [execution] = await Promise.allSettled([
    activation.result.then((result) => {
      const error = stopReasonError(result);
      if (error !== undefined) throw new Error(withPartialText(error, result.output));
      return { kind: 'foreground' as const, runId: String(activation.childId), output: result.output as unknown as JsonValue[] };
    }),
  ]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => activation.dispose())]);
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      );
    }
    throw execution.reason;
  }
  if (disposal.status === 'rejected') throw disposal.reason;
  return execution.value;
}

/** Check whether an LLM route has a registered adapter (routable = listed). */
function isProviderRoutable(ctx: Context, provider: string): boolean {
  const llm = ctx.get('llm');
  if (llm === undefined) return true; // cannot validate without llm; assume routable
  return llm.listProviders().some((entry) => entry.id === provider);
}

/** The outcome of one execute-time read of the official model selection. */
export interface ModelSelectionRead {
  /** Whether a readable `subagent-model-selection` section exists on the seam. */
  sectionPresent: boolean;
  /**
   * The authorized exact routes when the official selection is enabled with a
   * non-empty allowlist; undefined otherwise (no constraint).
   */
  allowedRoutes: Array<{ provider: string; model: string }> | undefined;
}

/**
 * Read the official model-selection settings section through the settings seam
 * at execute time (the official dsh-tool-subagent owns this namespace). On
 * 0.1.7 there is no `settings.get(ns)`; the live value is read from
 * `describe()`'s descriptor for the entry id `subagent-model-selection-settings`
 * (see readNamespaceValue). An inactive/unreadable section simply means no
 * authorized list.
 */
export function readModelSelection(ctx: Context): ModelSelectionRead {
  const settings = ctx.get('settings') as
    | { describe(options?: { redactSecrets?: boolean }): readonly { ns: string; value?: unknown }[] }
    | undefined;
  const selection = readNamespaceValue(settings, SUBAGENT_MODEL_SELECTION_NAMESPACE);
  if (selection === null || typeof selection !== 'object') {
    return { sectionPresent: false, allowedRoutes: undefined };
  }
  const record = selection as { enabled?: unknown; allowedModels?: unknown };
  const models = Array.isArray(record.allowedModels)
    ? record.allowedModels.filter(
        (entry): entry is { provider: string; model: string } =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { provider?: unknown }).provider === 'string' &&
          typeof (entry as { model?: unknown }).model === 'string',
      )
    : [];
  return {
    sectionPresent: true,
    allowedRoutes: record.enabled === true && models.length > 0 ? models : undefined,
  };
}

/** Format the structured FR-8.1 error with the available route list. */
function invalidProviderError(provider: string, available: string[]): Error {
  const list = available.length > 0 ? available.join(', ') : '(none)';
  return new Error(`${ERROR_PREFIX} LLM provider route ${provider} is not routable (no adapter serves it). Available providers: ${list}`);
}

/** The resolved execution route for one delegation call. */
export type DelegationRoute = 'foreground' | 'one-shot' | 'continuable';

/** The mode decision for one delegation: whether to run in the background, and which route to use. */
export interface DelegationModeDecision {
  runInBackground: boolean;
  route: DelegationRoute;
}

/**
 * Pure mode decision (extracted for unit testing) mirroring dsh-tool-subagent's
 * resolveDelegationRun: a forced background while the flag is disabled is
 * rejected; otherwise background defaults to the configured mode's policy —
 * false for one-shot, true for continuable.
 */
export function resolveDelegationMode(
  request: Pick<DelegationToolArgs, 'run_in_background'>,
  options: { backgroundEnabled: boolean; continuable: boolean },
): DelegationModeDecision {
  if (!options.backgroundEnabled) {
    if (request.run_in_background === true) {
      throw new Error(`${ERROR_PREFIX} run_in_background is disabled for this tool instance (enableRunInBackground: false)`);
    }
    return { runInBackground: false, route: 'foreground' };
  }
  const runInBackground = request.run_in_background ?? options.continuable;
  return {
    runInBackground,
    route: runInBackground ? (options.continuable ? 'continuable' : 'one-shot') : 'foreground',
  };
}

/** The union of delegation result shapes produced by execute. */
export type DelegationResult =
  | { kind: 'background'; jobId: string }
  | { kind: 'continuable'; subagentId: string }
  | { kind: 'foreground'; runId: string; output: JsonValue[] };

/**
 * Pure renderer for a delegation result (extracted for unit testing). Mirrors
 * dsh-tool-subagent's output.render: a continuable child renders as
 * "started subagent <id>"; a one-shot task keeps its tool-name-qualified text;
 * a foreground result emits its joined text blocks.
 */
export function renderDelegationResult(value: DelegationResult | { kind: 'foreground'; output: object[] }, toolName: string): string {
  if (value.kind === 'background') return `started background ${toolName} task ${value.jobId}`;
  if (value.kind === 'continuable') return `started subagent ${value.subagentId}`;
  const blocks = value.output as Array<{ type?: unknown; text?: unknown }>;
  return blocks
    .filter((block) => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}


/**
 * Pure capability gate (extracted from execute for unit testing, behavioral
 * no-op): a resolved delegation feature demands a transport-provider capability,
 * and its absence is a hard error (FR-8.1 / design 7.3). An independent Agent
 * Preset requires `agentPreset` support and a provider that does not inherit
 * the parent conversation; a numeric maxDepth requires `depthLimit`.
 */
export function assertDelegationCapabilities(options: {
  providerName: string;
  agentPreset?: string;
  capabilities: SubagentCapabilities;
  inheritsParentContext?: boolean;
  maxDepth?: number | 'provider-managed';
}): void {
  const { providerName, agentPreset, capabilities, inheritsParentContext = false, maxDepth } = options;
  if (agentPreset !== undefined && (!capabilities.agentPreset || inheritsParentContext)) {
    throw new Error(
      `${ERROR_PREFIX} card binds Agent Preset "${agentPreset}" but transport provider "${providerName}" does not support independent preset selection — switch to a non-inheriting provider (e.g. spawn) or drop the card agentPreset`,
    );
  }
  if (typeof maxDepth === 'number' && !capabilities.depthLimit) {
    throw new Error(
      `${ERROR_PREFIX} transport provider "${providerName}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`,
    );
  }
}

/** The route-derived fields that flow into a SubagentStartRequest body. */
export interface SubagentRequestParts {
  description: string;
  prompt: ContentBlock[];
  parent: Agent;
  agentOptions?: Pick<AgentOptions, 'provider' | 'model' | 'reasoningEffort'>;
  agentPreset?: string;
  maxDepth?: number;
}

/**
 * Pure request-body assembly (extracted from execute for unit testing,
 * behavioral no-op): an Agent Preset propagates into the request only when the
 * role resolved one, so a bare delegation stays zero-intrusion. DSH 0.2.1
 * removed per-request persona/toolFilter; card prompt and persona are injected
 * through the card prompt section; tool composition lives in the selected Agent Preset.
 *
 * On the 0.2.x startActivation seam the `label` and `signal` are hoisted to
 * the activation spec, so the inner request omits them (the spec carries
 * `label: parts.description` and `signal: exec.signal`).
 */
export function buildSubagentRequest<Parts extends SubagentRequestParts>(parts: Parts) {
  return {
    prompt: parts.prompt,
    parent: parts.parent,
    ...(parts.agentOptions !== undefined ? { agentOptions: parts.agentOptions } : {}),
    ...(parts.agentPreset !== undefined ? { agentPreset: parts.agentPreset } : {}),
    ...(parts.maxDepth !== undefined ? { maxDepth: parts.maxDepth } : {}),
  };
}

/**
 * Create the subagent_role ToolDefinition for one mounted subagent transport
 * provider. getSettings returns the current settings snapshot so execute reads
 * live role/default layers.
 */
export function createDelegationTool(options: {
  ctx: Context;
  config: DirectorConfig;
  provider: SubagentProvider;
  getSettings: (agent?: Agent) => SubagentDirectorSettings;
  /** Card repository; when absent, card prompt injection and lookup are skipped. */
  cards?: CardService;
  /** Director-plane instances require a card id and reject the default-role fallback. */
  requireRole?: boolean;
  /** Director-plane instances resolve the code-defined built-in card. */
  includeBuiltInCards?: boolean;
  /** Worker preset used when a card binds none (Director Mode defaults to standard). */
  defaultWorkerPreset?: string;
  /** Host-plane instances still enforce card rules when the caller runs Director. */
  directorGuard?: (agent: Agent) => boolean;
  /** Transport used by Director sessions; independent preset composition requires a spawn-like provider. */
  directorProvider?: string;
}) {
  const { ctx, config, provider, getSettings, cards } = options;
  const requireRole = options.requireRole === true;
  const backgroundEnabled = config.enableRunInBackground !== false;
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
  const toolName = config.toolName ?? 'subagent_role';
  const providerName = config.subagentProvider ?? 'spawn';

  return defineTool({
    name: toolName,
    description:
      'Delegate a self-contained task to a character-card-bound subagent with an optional LLM route (provider/model) override. ' +
      'Resolves the model through call -> card -> default -> inherit; the card\'s fixed system prompt and persona are injected into that child session. ' +
      (backgroundEnabled
        ? continuable
          ? ' This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when your next action depends on receiving the result.'
          : ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
        : ' This call waits for the subagent and returns its result.'),
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
      },
      role: {
        type: 'string',
        ...(requireRole ? { required: true } : {}),
        description: requireRole
          ? 'Character-card id (required in Director Mode). Search the library with subagent_card_search first; create a card with subagent_card_create only when nothing matches.'
          : 'Character-card id (optional). Falls back to the configured default card when unset.',
      },
      provider: {
        type: 'string',
        description: 'LLM provider route override (optional). Explicit provider/model win over a role binding. Must match a route with a registered adapter.',
      },
      model: { type: 'string', description: 'Model id override (optional). Explicit provider/model win over a role binding.' },
      reasoningEffort: { type: 'string', description: 'Reasoning-effort override (optional). Adapter serving the route decides support.' },
      ...(backgroundEnabled
        ? {
            run_in_background: {
              type: 'boolean',
              description: continuable
                ? 'Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result when your next action depends on it.'
                : 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.',
            },
          }
        : {}),
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderDelegationResult(value, toolName) }],
    },
    isConcurrencySafe: () => true,
    async execute(args: DelegationToolArgs, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error(`${ERROR_PREFIX} tool requires a calling agent (exec.agent was undefined)`);

      const director = requireRole || options.directorGuard?.(parent) === true;
      const includeBuiltIn = director || options.includeBuiltInCards === true;
      const transportName = director ? (options.directorProvider ?? 'spawn') : providerName;
      const transportProvider =
        transportName === providerName ? provider : (ctx.subagents.getProvider(transportName) as SubagentProvider | undefined);
      if (transportProvider === undefined) {
        throw new Error(
          `${ERROR_PREFIX} Director transport provider "${transportName}" is not registered; ` +
            'configure a registered spawn-like provider as directorProvider',
        );
      }
      const requestedRole = typeof args.role === 'string' ? args.role.trim() : '';
      if (director && requestedRole.length === 0) {
        throw new Error(
          `${ERROR_PREFIX} Director Mode requires a character card for every subagent. ` +
            'Call subagent_card_create first when no existing card matches the task, then pass its id as role.',
        );
      }
      if (cards !== undefined) await cards.ready();
      const cardStorageState = cards?.status().state;
      if (director && (cards === undefined || cardStorageState !== 'ready')) {
        throw new Error(
          `${ERROR_PREFIX} Director Mode requires character-card storage to be ready; refusing to delegate without a card. ` +
            'Retry after card storage is available.',
        );
      }
      const settings = getSettings(parent);
      if (cardStorageState !== undefined && cardStorageState !== 'ready' && !isEmpty(args.role)) {
        // A legacy settings role may still be usable without card storage. Only
        // reject when the requested id/name is not a legacy role either; a card
        // binding would otherwise be silently dropped.
        const legacyRoles = settings.roles ?? {};
        const legacyRole =
          legacyRoles[args.role!] ??
          Object.values(legacyRoles).find((role) => role !== undefined && role.displayName === args.role);
        if (legacyRole === undefined) {
          throw new Error(
            `${ERROR_PREFIX} character card storage is ${cardStorageState}; cannot resolve role "${args.role}". ` +
              'Retry after card storage is available, or delegate without a role to use the plugin model defaults.',
          );
        }
      }
      // Authorized-model constraint: the official dsh-tool-subagent owns
      // `subagent-model-selection`; this plugin only selects provider/model
      // from its allowedModels. No section → no constraint, but the plugin is
      // warned that its own defaults apply unconstrained.
      const selection = readModelSelection(ctx);
      const warnings: string[] = [];
      if (cardStorageState !== undefined && cardStorageState !== 'ready') {
        warnings.push(
          `${ERROR_PREFIX} character card storage is ${cardStorageState}; card bindings will not be applied to this delegation`,
        );
      }
      if (
        !selection.sectionPresent &&
        (!isEmpty(settings.defaultProvider) || !isEmpty(settings.defaultModel))
      ) {
        warnings.push(
          `${ERROR_PREFIX} no authorized model list is configured (subagent-model-selection section absent); plugin defaults/roles apply unconstrained`,
        );
      }
      if (requestedRole.length > 0 && cards !== undefined && cardStorageState === 'ready') {
        const storedCard = cards.get(requestedRole, { includeBuiltIn });
        if (director && storedCard !== undefined && !isCardEnabled(storedCard)) {
          throw new Error(
            `${ERROR_PREFIX} character card "${requestedRole}" is disabled. Enable it or create a different card with subagent_card_create before delegating.`,
          );
        }
        const knownCard = cards.resolveCard(requestedRole, { includeBuiltIn });
        if (director && knownCard === undefined) {
          throw new Error(
            `${ERROR_PREFIX} character card "${requestedRole}" does not exist. ` +
              'Director Mode only delegates to character cards; migrate any legacy role first, or create a card with subagent_card_create and use its id.',
          );
        }
      }
      const route = resolveRoute({
        args,
        settings,
        parent: parent.options,
        allowedRoutes: selection.allowedRoutes,
      });
      warnings.push(...route.warnings);
      const resolvedCard =
        cards !== undefined && route.roleId !== undefined ? cards.resolveCard(route.roleId, { includeBuiltIn }) : undefined;
      const card = resolvedCard?.card;
      const cardPrompt = card !== undefined ? renderCardPrompt(card) : '';
      const localTransport =
        transportProvider.prepareContinuable !== undefined || transportName === 'spawn' || transportName === 'fork';
      // FR-8.1: an explicitly supplied provider must be routable — never silently swapped.
      const explicitProvider = isEmpty(args.provider) ? undefined : args.provider;
      if (explicitProvider !== undefined && !isProviderRoutable(ctx, explicitProvider)) {
        const llm = ctx.get('llm');
        const available = llm === undefined ? [] : llm.listProviders().map((entry) => entry.id);
        throw invalidProviderError(explicitProvider, available);
      }

      // FR-8.2: role/default-bound provider not routable -> fallback (fallbackOnInvalid) or error.
      let agentOptions = route.agentOptions;
      const routeProvider = agentOptions?.provider;
      if (routeProvider !== undefined && explicitProvider === undefined && !isProviderRoutable(ctx, routeProvider)) {
        const fallBack = settings.fallbackOnInvalid !== false;
        if (fallBack) {
          // Drop the un-routable route fields so the seam inherits the parent model (AC-8.2).
          agentOptions = undefined;
          warnings.push(`${ERROR_PREFIX} role/default provider ${routeProvider} is not routable; fell back to the parent model (fallbackOnInvalid: true)`);
          ctx.logger.warn(`[${DELEGATION_TOOL_PREFIX}] fell back to parent model for un-routable provider ${routeProvider}`);
        } else {
          const llm = ctx.get('llm');
          const available = llm === undefined ? [] : llm.listProviders().map((entry) => entry.id);
          throw invalidProviderError(routeProvider, available);
        }
      }

      // An independent Agent Preset requires the transport provider's
      // agentPreset capability and a non-inheriting (spawn-like) provider.
      const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined;
      const effectivePreset =
        route.agentPreset ?? (director && options.defaultWorkerPreset !== undefined ? options.defaultWorkerPreset : undefined);
      if (route.persona !== undefined || route.toolFilter !== undefined) {
        warnings.push(
          `${ERROR_PREFIX} role legacy persona/toolFilter are not applied on DSH 0.2.1; move them into an Agent Preset and set the role agentPreset`,
        );
      }
      assertDelegationCapabilities({
        providerName: transportName,
        agentPreset: effectivePreset,
        capabilities: transportProvider.capabilities,
        inheritsParentContext: transportProvider.inheritsParentContext,
        maxDepth,
      });

      const decision = resolveDelegationMode(args, { backgroundEnabled, continuable });

      let childId: SessionId | undefined;
      let cardBindingStarted = false;
      if (card !== undefined && cardPrompt.length > 0) {
        if (localTransport) {
          childId = SessionId(randomUUID());
          try {
            await cards!.beginBinding({
              sessionId: String(childId),
              cardId: card.id,
              cardName: card.name,
              ...(card.systemPrompt !== undefined ? { systemPrompt: card.systemPrompt } : {}),
              ...(card.persona !== undefined ? { persona: card.persona } : {}),
              parentSessionId: String(parent.id),
              continuable: transportProvider.prepareContinuable !== undefined,
            });
            cardBindingStarted = true;
          } catch (error) {
            try {
              await cards!.endBinding(String(childId));
            } catch {
              /* best-effort cleanup of a half-written binding */
            }
            throw error;
          }
        } else {
          warnings.push(
            `${ERROR_PREFIX} transport "${transportName}" cannot reserve a child session id; character card "${card.id}" prompt is appended to the task instead of the system prompt`,
          );
        }
      }
      const noteCardUse = async (): Promise<void> => {
        if (cards === undefined || card === undefined) return;
        try {
          await cards.recordCardUse(card.id);
        } catch (error) {
          ctx.logger.warn(
            `[${DELEGATION_TOOL_PREFIX}] failed to record card usage for ${card.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      const releaseCardBinding = async (): Promise<void> => {
        if (!cardBindingStarted || childId === undefined) return;
        try {
          await cards!.endBinding(String(childId));
        } catch (error) {
          ctx.logger.warn(
            `[${DELEGATION_TOOL_PREFIX}] failed to release card prompt binding for ${String(childId)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      ctx.logger.info(
        `[${DELEGATION_TOOL_PREFIX}] delegate layer=${route.layer} mode=${continuable ? 'continuable' : 'one-shot'} transport=${transportName} route=${JSON.stringify(route.agentOptions ?? null)} card=${card?.id ?? '(none)'} prompt=${cardPrompt.length > 0 ? (localTransport ? 'system' : 'task') : 'none'} warnings=${JSON.stringify(warnings)}`,
      );

      const taskText =
        cardPrompt.length > 0 && !localTransport ? args.prompt + '\n\n---\n' + cardPrompt : args.prompt;
      const request = buildSubagentRequest({
        description: args.description,
        prompt: [{ type: 'text' as const, text: taskText }],
        parent,
        agentOptions,
        agentPreset: effectivePreset,
        maxDepth,
      });

      // Foreground: the caller owns the result (delivery 'caller'), so await the
      // activation's result, map a non-completed stop reason to an error, and
      // dispose idempotently. The card prompt binding is released only after the
      // run settles, so the child's whole turn sees its fixed prompt.
      if (!decision.runInBackground) {
        try {
          const activation = await ctx.subagents.startActivation({
            provider: transportName,
            label: args.description,
            ...request,
            ...(childId !== undefined ? { childId } : {}),
            signal: exec.signal,
            delivery: 'caller',
          });
          const execution = await settleForegroundActivation(activation);
          await noteCardUse();
          return execution;
        } finally {
          await releaseCardBinding();
        }
      }

      // Background: the runtime owns result delivery (delivery 'parent') and
      // notifies the parent model when the child settles; return the durable
      // child id immediately. A provider with prepareContinuable yields a local
      // child the parent can later steer with send_message (continuable);
      // otherwise the child is a one-shot external execution (background).
      let started = false;
      try {
        const activation = await ctx.subagents.startActivation({
          provider: transportName,
          label: args.description,
          ...request,
          ...(childId !== undefined ? { childId } : {}),
          signal: exec.signal,
          delivery: 'parent',
        });
        started = true;
        await noteCardUse();
        if (transportProvider.prepareContinuable !== undefined) {
          trackResident(String(parent.id), activation);
          return { kind: 'continuable' as const, subagentId: activation.childId };
        }
        return { kind: 'background' as const, jobId: activation.childId };
      } finally {
        if (!started) await releaseCardBinding();
      }
    },
  });
}

/**
 * Delegation tool subagent_role (design section 7).
 *
 * Resolves the four-layer fallback chain (call -> role -> default -> inherit)
 * via the pure resolveRoute (design section 6), validates against live runtime
 * facts, and assembles a SubagentStartRequest on ctx.subagents.start(...).
 *
 * Two provider namespaces MUST NOT be confused (design 14, R2):
 * config.subagentProvider is the subagent TRANSPORT provider name; the
 * resolved agentOptions.provider is an LLM route served by an adapter.
 *
 * Execution contract (mirrors dsh-tool-subagent): foreground awaits run.result
 * and throws a stop-reason error for a non-completed child; one-shot background
 * registers a Task on ctx.jobs.start; continuable runs through
 * ctx.subagents.startContinuable() and returns the durable child id.
 *
 * reasoningEffort rides agentOptions alongside a resolved route (and may be
 * supplied alone). Provider/model selection is CONSTRAINED to the official
 * `subagent-model-selection` allowedModels list: an unlisted explicit pair
 * throws, unlisted role/default routes are dropped — this plugin never
 * double-writes a model route the official tool also owns.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { settleRun } from '@deepseek-ai/dsh-subagent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent';

import type { DirectorConfig } from './config.js';
import { resolveRoute, type RouteToolFilter, type SubagentDirectorSettings } from './route-resolver.js';

/** Stable log namespace prefix for delegation/tool diagnostics (design section 10). */
export const DELEGATION_TOOL_PREFIX = 'subagent-director';

/** The canonical error prefix used across all structured failures (FR-8.1 / design 7.3). */
const ERROR_PREFIX = 'subagent-director:';

/** Model-facing arguments of subagent_role. */
export interface DelegationToolArgs {
  /** A short (3-5 word) description of the delegated task, for display. */
  description: string;
  /** The complete, self-contained task for the subagent. */
  prompt: string;
  /** Role template id (optional). Falls back to the configured default role. */
  role?: string;
  /** LLM provider route override (optional). Wins over any role binding. */
  provider?: string;
  /** Model id override (optional). Wins over any role binding. */
  model?: string;
  /** Reasoning-effort override (optional); may be supplied alone. */
  reasoningEffort?: string;
  /** Background policy: defaults to false in one-shot, true in continuable. */
  run_in_background?: boolean;
}

/**
 * Shared base parameter fields (description/prompt/role/provider/model/
 * reasoningEffort). Kept as a const so both createDelegationParameters and the
 * inline tool definition reuse one literal while TypeScript still infers the
 * exact parameter shape for execute().
 */
const BASE_PARAMETER_FIELDS = {
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
    description: 'Role template id (optional). Falls back to the configured default role when unset.',
  },
  provider: {
    type: 'string',
    description: 'LLM provider route override (optional). Explicit provider/model win over a role binding. Must match a route with a registered adapter.',
  },
  model: { type: 'string', description: 'Model id override (optional). Explicit provider/model win over a role binding.' },
  reasoningEffort: { type: 'string', description: 'Reasoning-effort override (optional). Adapter serving the route decides support.' },
} as const satisfies ParameterSchemaSpec;

/**
 * Build the model-facing tool parameter schema (pure, exposed for tests).
 * run_in_background appears only when enableRunInBackground is not false.
 */
export function createDelegationParameters(
  config: Pick<DirectorConfig, 'enableRunInBackground' | 'backgroundMode'>,
): ParameterSchemaSpec {
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
  const parameters: ParameterSchemaSpec = { ...BASE_PARAMETER_FIELDS };
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

/** Shared literal output schema so the tool definition keeps exact type inference. */
const DELEGATION_OUTPUT_SCHEMA = {
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
} as const satisfies ValueSchemaSpec;

/** The model-facing output schema: exactly one of background, continuable, or foreground. */
export function createDelegationOutputSchema(): ValueSchemaSpec {
  return { ...DELEGATION_OUTPUT_SCHEMA };
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
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure (mirrors dsh-tool-subagent settleForegroundRun).
 */
async function settleForegroundRun(run: SubagentRun): Promise<{ kind: 'foreground'; runId: string; output: JsonValue[] }> {
  const [execution, disposal] = await Promise.allSettled([
    run.result.then((result) => {
      const error = stopReasonError(result);
      if (error !== undefined) throw new Error(withPartialText(error, result.output));
      return { kind: 'foreground' as const, runId: String(run.id), output: result.output as unknown as JsonValue[] };
    }),
    Promise.resolve().then(() => run.dispose()),
  ]);
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

/** Settle a background child without rejecting the Task producer contract. */
async function settleBackgroundRun(start: Promise<SubagentRun>, signal: AbortSignal) {
  try {
    return await settleRun(await start);
  } catch (error) {
    return signal.aborted ? { status: 'killed' as const } : { status: 'failed' as const, detail: String(error) };
  }
}

/** Registered LLM provider ids, or [] when the llm service is absent. */
function availableProviders(ctx: Context): string[] {
  const llm = ctx.get('llm');
  return llm === undefined ? [] : llm.listProviders().map((entry) => entry.id);
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
 * Read the official `subagent-model-selection` section through the settings
 * seam at execute time (the official dsh-tool-subagent owns this namespace).
 * `settings.get` throws for namespace values the seam rejects, so the read is
 * guarded — an unreadable section simply means no authorized list.
 */
export function readModelSelection(ctx: Context): ModelSelectionRead {
  const settings = ctx.get('settings') as { get(ns: string): unknown } | undefined;
  if (settings === undefined) return { sectionPresent: false, allowedRoutes: undefined };
  let selection: unknown;
  try {
    selection = settings.get('subagent-model-selection');
  } catch {
    return { sectionPresent: false, allowedRoutes: undefined };
  }
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
 * rejected; otherwise background defaults to the configured mode's policy.
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
 * dsh-tool-subagent's output.render.
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
 * and its absence is a hard error (FR-8.1 / design 7.3).
 */
export function assertDelegationCapabilities(options: {
  providerName: string;
  persona?: string;
  toolFilter?: RouteToolFilter;
  capabilities: { persona: boolean; toolFilter: boolean; depthLimit: boolean };
  maxDepth?: number | 'provider-managed';
}): void {
  const { providerName, persona, toolFilter, capabilities, maxDepth } = options;
  if (persona !== undefined && !capabilities.persona) {
    throw new Error(
      `${ERROR_PREFIX} role binds a persona but transport provider "${providerName}" does not support the persona capability — switch the subagent provider or drop the role persona`,
    );
  }
  if (toolFilter !== undefined && !capabilities.toolFilter) {
    throw new Error(
      `${ERROR_PREFIX} role binds a tool filter but transport provider "${providerName}" does not support the toolFilter capability — switch the subagent provider or drop the role filter`,
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
  persona?: string;
  toolFilter?: RouteToolFilter;
  maxDepth?: number;
}

/**
 * Pure request-body assembly (extracted from execute for unit testing,
 * behavioral no-op): persona and toolFilter propagate into the request only
 * when the role resolved them, so a bare delegation stays zero-intrusion.
 */
export function buildSubagentRequest<Parts extends SubagentRequestParts>(parts: Parts) {
  return {
    label: parts.description,
    prompt: parts.prompt,
    parent: parts.parent,
    ...(parts.agentOptions !== undefined ? { agentOptions: parts.agentOptions } : {}),
    ...(parts.persona !== undefined ? { persona: parts.persona } : {}),
    ...(parts.toolFilter !== undefined ? { toolFilter: parts.toolFilter } : {}),
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
  getSettings: () => SubagentDirectorSettings;
}) {
  const { ctx, config, provider, getSettings } = options;
  const backgroundEnabled = config.enableRunInBackground !== false;
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
  const toolName = config.toolName ?? 'subagent_role';
  const providerName = config.subagentProvider ?? 'spawn';

  return defineTool({
    name: toolName,
    description:
      'Delegate a self-contained task to a role-bound subagent with an optional LLM route (provider/model) override. ' +
      'Resolves the model through configure -> role -> default -> inherit; role persona and tool filtering are applied when supported. ' +
      (backgroundEnabled
        ? continuable
          ? ' This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when your next action depends on receiving the result.'
          : ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
        : ' This call waits for the subagent and returns its result.'),
    parameters: {
      ...BASE_PARAMETER_FIELDS,
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
      schema: { ...DELEGATION_OUTPUT_SCHEMA },
      render: (_args, value) => [{ type: 'text', text: renderDelegationResult(value, toolName) }],
    },
    isConcurrencySafe: () => true,
    async execute(args: DelegationToolArgs, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error(`${ERROR_PREFIX} tool requires a calling agent (exec.agent was undefined)`);

      const settings = getSettings();
      // Authorized-model constraint: the official dsh-tool-subagent owns
      // `subagent-model-selection`; this plugin only selects provider/model
      // from its allowedModels. No section → no constraint, but the plugin is
      // warned that its own defaults apply unconstrained.
      const selection = readModelSelection(ctx);
      const warnings: string[] = [];
      if (
        !selection.sectionPresent &&
        (!isEmpty(settings.defaultProvider) || !isEmpty(settings.defaultModel))
      ) {
        warnings.push(
          `${ERROR_PREFIX} no authorized model list is configured (subagent-model-selection section absent); plugin defaults/roles apply unconstrained`,
        );
      }
      const route = resolveRoute({
        args,
        settings,
        parent: parent.options,
        allowedRoutes: selection.allowedRoutes,
      });
      warnings.push(...route.warnings);
      ctx.logger.info(
        `[${DELEGATION_TOOL_PREFIX}] delegate layer=${route.layer} mode=${continuable ? 'continuable' : 'one-shot'} transport=${providerName} route=${JSON.stringify(route.agentOptions ?? null)} persona=${route.persona ? 'yes' : 'no'} warnings=${JSON.stringify(warnings)}`,
      );

      // FR-8.1: an explicitly supplied provider must be routable — never silently swapped.
      const explicitProvider = isEmpty(args.provider) ? undefined : args.provider;
      if (explicitProvider !== undefined && !isProviderRoutable(ctx, explicitProvider)) {
        throw invalidProviderError(explicitProvider, availableProviders(ctx));
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
          throw invalidProviderError(routeProvider, availableProviders(ctx));
        }
      }

      // persona/toolFilter require the transport provider's capabilities.
      const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined;
      assertDelegationCapabilities({
        providerName,
        persona: route.persona,
        toolFilter: route.toolFilter,
        capabilities: provider.capabilities,
        maxDepth,
      });

      const request = buildSubagentRequest({
        description: args.description,
        prompt: [{ type: 'text' as const, text: args.prompt }],
        parent,
        agentOptions,
        persona: route.persona,
        toolFilter: route.toolFilter,
        maxDepth,
      });

      const decision = resolveDelegationMode(args, { backgroundEnabled, continuable });

      // Continuable background runs the child through startContinuable and returns
      // the durable child id for later send_message follow-up (FR-5.3 / F11).
      if (decision.route === 'continuable') {
        if (provider.prepareContinuable === undefined) {
          throw new Error(
            `${ERROR_PREFIX} transport provider "${providerName}" does not support backgroundMode: continuable — switch the subagent provider or use backgroundMode: 'one-shot'`,
          );
        }
        const start = await ctx.subagents.startContinuable({
          provider: providerName,
          label: args.description,
          request,
          signal: exec.signal,
        });
        return { kind: 'continuable' as const, subagentId: start.childId };
      }

      if (decision.route === 'one-shot') {
        const jobs = ctx.get('jobs');
        if (jobs === undefined) {
          throw new Error(`${ERROR_PREFIX} background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`);
        }
        return {
          kind: 'background' as const,
          jobId: jobs.start({
            kind: 'subagent',
            label: args.description,
            owner: parent,
            run: () => {
              const controller = new AbortController();
              return {
                cancel: (reason?: string) => controller.abort(reason ?? 'background subagent task killed'),
                done: settleBackgroundRun(ctx.subagents.start(providerName, { ...request, signal: controller.signal }), controller.signal),
              };
            },
          }),
        };
      }

      return settleForegroundRun(await ctx.subagents.start(providerName, { ...request, signal: exec.signal }));
    },
  });
}

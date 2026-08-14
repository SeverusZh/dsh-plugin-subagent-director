/**
 * Delegation tool subagent_role (design section 7).
 *
 * A model-facing tool that lets the calling agent delegate to a subagent while
 * selecting an LLM route and/or a named role template. It resolves the four-layer
 * fallback chain via the pure resolveRoute (design section 6), validates the
 * resolution against live runtime facts, and assembles a SubagentStartRequest
 * on ctx.subagents.start(...) exactly like dsh-workflow-worker-thread's
 * startChild and dsh-tool-subagent's one-shot path.
 *
 * Two provider namespaces coexist and MUST NOT be confused (design section 14, R2):
 *   - config.subagentProvider is the subagent TRANSPORT provider name handed
 *     to ctx.subagents.start(name, ...) (e.g. spawn).
 *   - the resolved agentOptions.provider is an LLM route served by an adapter
 *     (e.g. deepseek-official).
 *
 * Execution contract (schema/execute mirror dsh-tool-subagent):
 *   - foreground is the core path: await run.result, throw a stop-reason
 *     error for a non-completed child, dispose idempotently, return
 *     { kind: foreground, runId, output }.
 *   - one-shot background mirrors the official Task registration on
 *     ctx.jobs.start({ kind: subagent, ... }) returning { kind: background, jobId }.
 *   - continuable runs the child through ctx.subagents.startContinuable() and
 *     returns { kind: continuable, subagentId } (the durable child id), which the
 *     parent later follows up on with send_message (M3a / FR-5.3).
 *
 * reasoningEffort: the DSH AgentOptions and SubagentStartRequest shapes do
 * not carry reasoning effort (dsh-agent runtime-types.d.ts, dsh-subagent
 * types.d.ts), so it is surfaced and logged only, never injected (route-resolver
 * already returns it separately for auditability).
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import { settleRun } from '@deepseek-ai/dsh-subagent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent';

import type { DirectorConfig } from './config.js';
import { resolveRoute, type SubagentDirectorSettings } from './route-resolver.js';

/** Stable log namespace prefix for delegation/tool diagnostics (design section 10). */
export const DELEGATION_TOOL_PREFIX = 'subagent-director';

/** The canonical error prefix used across all structured failures (FR-8.1 / design 7.3). */
const ERROR_PREFIX = 'subagent-director:';

/**
 * Delegate a task to a role-bound subagent with an optional LLM route override.
 * Resolves role/model/provider through the configure -> role -> default ->
 * inherit chain; role persona and tool filtering are applied when the chosen
 * subagent transport supports them.
 */
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
  /** Reasoning-effort override (optional; advisory — logged, not injected). */
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
): ParameterSchemaSpec {
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
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
      description: 'Role template id (optional). Falls back to the configured default role when unset.',
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
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure (mirrors dsh-tool-subagent settleForegroundRun).
 */
async function settleForegroundRun(run: SubagentRun): Promise<{ kind: 'foreground'; runId: string; output: JsonValue[] }> {
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      const error = stopReasonError(result);
      if (error !== undefined) throw new Error(withPartialText(error, result.output));
      return { kind: 'foreground' as const, runId: String(run.id), output: result.output as unknown as JsonValue[] };
    }),
  ]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
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

/** Check whether an LLM route has a registered adapter (routable = listed). */
function isProviderRoutable(ctx: Context, provider: string): boolean {
  const llm = ctx.get('llm');
  if (llm === undefined) return true; // cannot validate without llm; assume routable
  return llm.listProviders().some((entry) => entry.id === provider);
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

      const settings = getSettings();
      const route = resolveRoute({ args, settings, parent: parent.options });
      const warnings = [...route.warnings];
      ctx.logger.info(
        `[${DELEGATION_TOOL_PREFIX}] delegate layer=${route.layer} mode=${continuable ? 'continuable' : 'one-shot'} transport=${providerName} route=${JSON.stringify(route.agentOptions ?? null)} persona=${route.persona ? 'yes' : 'no'} warnings=${JSON.stringify(warnings)}`,
      );

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

      // persona/toolFilter require the transport provider's capabilities.
      if (route.persona !== undefined && !provider.capabilities.persona) {
        throw new Error(`${ERROR_PREFIX} role binds a persona but transport provider "${providerName}" does not support the persona capability — switch the subagent provider or drop the role persona`);
      }
      if (route.toolFilter !== undefined && !provider.capabilities.toolFilter) {
        throw new Error(`${ERROR_PREFIX} role binds a tool filter but transport provider "${providerName}" does not support the toolFilter capability — switch the subagent provider or drop the role filter`);
      }
      if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
        throw new Error(`${ERROR_PREFIX} transport provider "${providerName}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`);
      }

      // reasoningEffort is advisory and not part of AgentOptions/SubagentStartRequest.
      if (route.reasoningEffort !== undefined) {
        ctx.logger.info(`[${DELEGATION_TOOL_PREFIX}] reasoningEffort=${route.reasoningEffort} is advisory and logged only (not injectable via AgentOptions)`);
      }

      const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined;
      const request = {
        label: args.description,
        prompt: [{ type: 'text' as const, text: args.prompt }],
        parent,
        ...(agentOptions !== undefined ? { agentOptions } : {}),
        ...(route.persona !== undefined ? { persona: route.persona } : {}),
        ...(route.toolFilter !== undefined ? { toolFilter: route.toolFilter } : {}),
        ...(maxDepth !== undefined ? { maxDepth } : {}),
      };

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

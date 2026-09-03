import { defineTool } from '@deepseek-ai/dsh-tools';
import { settleRun } from '@deepseek-ai/dsh-subagent';
import { resolveRoute } from './route-resolver.js';
/** Stable log namespace prefix for delegation/tool diagnostics (design section 10). */
export const DELEGATION_TOOL_PREFIX = 'subagent-director';
/** The canonical error prefix used across all structured failures (FR-8.1 / design 7.3). */
const ERROR_PREFIX = 'subagent-director:';
/**
 * Build the model-facing tool parameter schema given a config. Exposed as a
 * pure function so unit tests can assert the model-visible shape without a live
 * context: description/prompt are required; role/provider/model/reasoningEffort
 * are optional; run_in_background appears only when enableRunInBackground is not
 * false. In continuable mode its description notes the default of true and the
 * durable-child-id return shape (mirrors dsh-tool-subagent's wording).
 */
export function createDelegationParameters(config) {
    const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
    const parameters = {
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
export function createDelegationOutputSchema() {
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
function isEmpty(value) {
    return value === undefined || value === null || value === '';
}
/** A non-completed stop reason means the child did not finish cleanly. */
function stopReasonError(result) {
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
function withPartialText(error, output) {
    const text = output
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`;
}
/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure (mirrors dsh-tool-subagent settleForegroundRun).
 */
async function settleForegroundRun(run) {
    const [execution] = await Promise.allSettled([
        run.result.then((result) => {
            const error = stopReasonError(result);
            if (error !== undefined)
                throw new Error(withPartialText(error, result.output));
            return { kind: 'foreground', runId: String(run.id), output: result.output };
        }),
    ]);
    const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
    if (execution.status === 'rejected') {
        if (disposal.status === 'rejected') {
            throw new AggregateError([execution.reason, disposal.reason], `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`);
        }
        throw execution.reason;
    }
    if (disposal.status === 'rejected')
        throw disposal.reason;
    return execution.value;
}
/** Settle a background child without rejecting the Task producer contract. */
async function settleBackgroundRun(start, signal) {
    try {
        return await settleRun(await start);
    }
    catch (error) {
        return signal.aborted ? { status: 'killed' } : { status: 'failed', detail: String(error) };
    }
}
/** Check whether an LLM route has a registered adapter (routable = listed). */
function isProviderRoutable(ctx, provider) {
    const llm = ctx.get('llm');
    if (llm === undefined)
        return true; // cannot validate without llm; assume routable
    return llm.listProviders().some((entry) => entry.id === provider);
}
/**
 * Read the official `subagent-model-selection` section through the settings
 * seam at execute time (the official dsh-tool-subagent owns this namespace).
 * `settings.get` throws for namespace values the seam rejects, so the read is
 * guarded — an unreadable section simply means no authorized list.
 */
export function readModelSelection(ctx) {
    const settings = ctx.get('settings');
    if (settings === undefined)
        return { sectionPresent: false, allowedRoutes: undefined };
    let selection;
    try {
        selection = settings.get('subagent-model-selection');
    }
    catch {
        return { sectionPresent: false, allowedRoutes: undefined };
    }
    if (selection === null || typeof selection !== 'object') {
        return { sectionPresent: false, allowedRoutes: undefined };
    }
    const record = selection;
    const models = Array.isArray(record.allowedModels)
        ? record.allowedModels.filter((entry) => typeof entry === 'object' &&
            entry !== null &&
            typeof entry.provider === 'string' &&
            typeof entry.model === 'string')
        : [];
    return {
        sectionPresent: true,
        allowedRoutes: record.enabled === true && models.length > 0 ? models : undefined,
    };
}
/** Format the structured FR-8.1 error with the available route list. */
function invalidProviderError(provider, available) {
    const list = available.length > 0 ? available.join(', ') : '(none)';
    return new Error(`${ERROR_PREFIX} LLM provider route ${provider} is not routable (no adapter serves it). Available providers: ${list}`);
}
/**
 * Pure mode decision (extracted for unit testing) mirroring dsh-tool-subagent's
 * resolveDelegationRun: a forced background while the flag is disabled is
 * rejected; otherwise background defaults to the configured mode's policy —
 * false for one-shot, true for continuable.
 */
export function resolveDelegationMode(request, options) {
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
/**
 * Pure renderer for a delegation result (extracted for unit testing). Mirrors
 * dsh-tool-subagent's output.render: a continuable child renders as
 * "started subagent <id>"; a one-shot task keeps its tool-name-qualified text;
 * a foreground result emits its joined text blocks.
 */
export function renderDelegationResult(value, toolName) {
    if (value.kind === 'background')
        return `started background ${toolName} task ${value.jobId}`;
    if (value.kind === 'continuable')
        return `started subagent ${value.subagentId}`;
    const blocks = value.output;
    return blocks
        .filter((block) => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
}
/**
 * Pure capability gate (extracted from execute for unit testing, behavioral
 * no-op): a resolved delegation feature demands a transport-provider capability,
 * and its absence is a hard error (FR-8.1 / design 7.3). persona, toolFilter,
 * and a numeric maxDepth each require the matching capability flag.
 */
export function assertDelegationCapabilities(options) {
    const { providerName, persona, toolFilter, capabilities, maxDepth } = options;
    if (persona !== undefined && !capabilities.persona) {
        throw new Error(`${ERROR_PREFIX} role binds a persona but transport provider "${providerName}" does not support the persona capability — switch the subagent provider or drop the role persona`);
    }
    if (toolFilter !== undefined && !capabilities.toolFilter) {
        throw new Error(`${ERROR_PREFIX} role binds a tool filter but transport provider "${providerName}" does not support the toolFilter capability — switch the subagent provider or drop the role filter`);
    }
    if (typeof maxDepth === 'number' && !capabilities.depthLimit) {
        throw new Error(`${ERROR_PREFIX} transport provider "${providerName}" cannot enforce maxDepth (no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion budget to the provider`);
    }
}
/**
 * Pure request-body assembly (extracted from execute for unit testing,
 * behavioral no-op): persona and toolFilter propagate into the request only
 * when the role resolved them, so a bare delegation stays zero-intrusion.
 */
export function buildSubagentRequest(parts) {
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
export function createDelegationTool(options) {
    const { ctx, config, provider, getSettings } = options;
    const backgroundEnabled = config.enableRunInBackground !== false;
    const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable';
    const toolName = config.toolName ?? 'subagent_role';
    const providerName = config.subagentProvider ?? 'spawn';
    return defineTool({
        name: toolName,
        description: 'Delegate a self-contained task to a role-bound subagent with an optional LLM route (provider/model) override. ' +
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
        async execute(args, exec) {
            const parent = exec.agent;
            if (!parent)
                throw new Error(`${ERROR_PREFIX} tool requires a calling agent (exec.agent was undefined)`);
            const settings = getSettings();
            // Authorized-model constraint: the official dsh-tool-subagent owns
            // `subagent-model-selection`; this plugin only selects provider/model
            // from its allowedModels. No section → no constraint, but the plugin is
            // warned that its own defaults apply unconstrained.
            const selection = readModelSelection(ctx);
            const warnings = [];
            if (!selection.sectionPresent &&
                (!isEmpty(settings.defaultProvider) || !isEmpty(settings.defaultModel))) {
                warnings.push(`${ERROR_PREFIX} no authorized model list is configured (subagent-model-selection section absent); plugin defaults/roles apply unconstrained`);
            }
            const route = resolveRoute({
                args,
                settings,
                parent: parent.options,
                allowedRoutes: selection.allowedRoutes,
            });
            warnings.push(...route.warnings);
            ctx.logger.info(`[${DELEGATION_TOOL_PREFIX}] delegate layer=${route.layer} mode=${continuable ? 'continuable' : 'one-shot'} transport=${providerName} route=${JSON.stringify(route.agentOptions ?? null)} persona=${route.persona ? 'yes' : 'no'} warnings=${JSON.stringify(warnings)}`);
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
                }
                else {
                    const llm = ctx.get('llm');
                    const available = llm === undefined ? [] : llm.listProviders().map((entry) => entry.id);
                    throw invalidProviderError(routeProvider, available);
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
                prompt: [{ type: 'text', text: args.prompt }],
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
                    throw new Error(`${ERROR_PREFIX} transport provider "${providerName}" does not support backgroundMode: continuable — switch the subagent provider or use backgroundMode: 'one-shot'`);
                }
                const start = await ctx.subagents.startContinuable({
                    provider: providerName,
                    label: args.description,
                    request,
                    signal: exec.signal,
                });
                return { kind: 'continuable', subagentId: start.childId };
            }
            if (decision.route === 'one-shot') {
                const jobs = ctx.get('jobs');
                if (jobs === undefined) {
                    throw new Error(`${ERROR_PREFIX} background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`);
                }
                return {
                    kind: 'background',
                    jobId: jobs.start({
                        kind: 'subagent',
                        label: args.description,
                        owner: parent,
                        run: () => {
                            const controller = new AbortController();
                            return {
                                cancel: (reason) => controller.abort(reason ?? 'background subagent task killed'),
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
//# sourceMappingURL=delegation-tool.js.map
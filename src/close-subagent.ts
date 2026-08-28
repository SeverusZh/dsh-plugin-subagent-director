/**
 * close_subagent lifecycle tool (issue #1).
 *
 * A model-facing tool that lets the calling agent close/release one resident
 * continuable subagent it started: a thin adapter over
 * ctx.subagents.drainContinuableChildren(parent, [subagent_id]), mirroring how
 * the core's interrupt_agent adapts ctx.subagents.interrupt() (see
 * @deepseek-ai/dsh-tool-subagent-control). Lifecycle authority stays with the
 * subagent service — the tool only forwards the exact calling agent as the
 * parent and performs no routing of its own.
 *
 * Semantics (documented by drainContinuableChildren): absent targets and a
 * manager-less composition are accepted no-ops; a resident child owned by a
 * different parent is rejected with a SubagentError `UNAUTHORIZED`. Unlike
 * interrupt_agent this is teardown: the released child no longer stays
 * resident and cannot be resumed with send_message afterwards, so its memory
 * and session context are freed before the parent session ends.
 *
 * The tool is registered unconditionally (like the core control tools) —
 * drainContinuableChildren is a no-op in one-shot compositions — and
 * registerCloseSubagent guards against duplicate registration so several
 * plugin instances (distinct toolName) share one close_subagent.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';

/** The canonical model-visible tool name (mirrors interrupt_agent naming). */
export const CLOSE_SUBAGENT_TOOL_NAME = 'close_subagent';

/** The canonical error prefix used across structured failures (FR-8.1 convention). */
const ERROR_PREFIX = 'subagent-director:';

/** The model-facing arguments: the durable id of the continuable child to release. */
export interface CloseSubagentArgs {
  /** The subagent id returned when the background subagent was started. */
  subagent_id: string;
}

/**
 * Build the model-facing parameter schema. Exposed as a pure function so unit
 * tests can assert the model-visible shape without a live context. The literal
 * return type (via `satisfies`) lets defineTool infer the validated args shape.
 */
export function createCloseSubagentParameters() {
  return {
    subagent_id: {
      type: 'string',
      required: true,
      description: 'The subagent id returned when the background subagent was started (see list_agents for resident ids).',
    },
  } satisfies ParameterSchemaSpec;
}

/** The model-facing output schema: a closed object confirming the release. */
export function createCloseSubagentOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      closed: { type: 'boolean', required: true },
    },
  } satisfies ValueSchemaSpec;
}

/** Pure renderer for a close_subagent result (extracted for unit testing). */
export function renderCloseResult(args: CloseSubagentArgs, _value: unknown): string {
  return `closed subagent ${args.subagent_id}`;
}

/**
 * Create the close_subagent ToolDefinition for one mounted context. execute
 * releases the named resident continuable direct child of the exact calling
 * agent via ctx.subagents.drainContinuableChildren; the service authorizes the
 * exact live caller, so the tool adds no authority of its own.
 */
export function createCloseSubagentTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: CLOSE_SUBAGENT_TOOL_NAME,
    description:
      'Close/release a resident continuable subagent by its subagent id, freeing its memory and session context. ' +
      'The target must be a direct continuable child of the exact calling agent: absent or already-released ids are accepted no-ops, ' +
      'and a resident child owned by another parent is rejected. ' +
      'This is teardown, not interrupt — the released child no longer stays resident and cannot be resumed with `send_message` afterwards. ' +
      'Use `list_agents` to see which subagents are still resident.',
    parameters: createCloseSubagentParameters(),
    output: {
      schema: createCloseSubagentOutputSchema(),
      render: (args, value) => [{ type: 'text', text: renderCloseResult(args as CloseSubagentArgs, value) }],
    },
    async execute(args: CloseSubagentArgs, exec) {
      const parent: Agent | undefined = exec.agent;
      if (!parent) throw new Error(`${ERROR_PREFIX} close_subagent requires a calling agent (exec.agent was undefined)`);
      await ctx.subagents.drainContinuableChildren(parent, [SessionId(args.subagent_id)]);
      return { closed: true };
    },
  });
}

/**
 * Register close_subagent once per context. Returns the registry disposer, or
 * undefined when a tool with the same name is already registered (a second
 * plugin instance with a distinct delegation toolName must not double-register
 * the shared control tool).
 */
export function registerCloseSubagent(ctx: Context): (() => void) | undefined {
  if (ctx.tools.get(CLOSE_SUBAGENT_TOOL_NAME) !== undefined) return undefined;
  return ctx.tools.register(createCloseSubagentTool(ctx));
}

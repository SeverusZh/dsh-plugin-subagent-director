/**
 * close_subagent — release one resident continuable subagent (issue #1).
 *
 * Model-facing counterpart of dsh-tool-subagent-control's send_message /
 * interrupt_agent: the calling agent (exec.agent) authorizes release of its
 * OWN direct continuable child through ctx.subagents.drainContinuableChildren,
 * which throws UNAUTHORIZED when the target is not a direct child of the
 * caller and treats absent/non-resident targets as a no-op. The tool is
 * registered unconditionally (like the control tools); on a deployment
 * without continuable children it is a safe no-op.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';

/** Stable tool name (fixed, mirroring send_message / interrupt_agent). */
export const CLOSE_SUBAGENT_TOOL_NAME = 'close_subagent';

const ERROR_PREFIX = 'subagent-director:';

/** Model-facing arguments of close_subagent. */
export interface CloseSubagentArgs {
  /** Durable child id returned by a continuable delegation (subagent_role). */
  subagent_id: string;
}

/** Parameter schema (pure, exposed for tests). */
export function createCloseSubagentParameters(): ParameterSchemaSpec {
  return {
    subagent_id: {
      type: 'string',
      required: true,
      description:
        'The durable subagent id returned when the background subagent was started (continuable mode). Releases the resident child so the parent no longer holds its handle.',
    },
  };
}

/** Output schema (pure, exposed for tests). */
export function createCloseSubagentOutputSchema(): ValueSchemaSpec {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      closed: { type: 'boolean', required: true },
    },
  };
}

/** Create the close_subagent ToolDefinition bound to one context. */
export function createCloseSubagentTool(options: { ctx: Context }) {
  const { ctx } = options;
  return defineTool({
    name: CLOSE_SUBAGENT_TOOL_NAME,
    description:
      'Close/release one resident continuable subagent by its durable id: the continuation manager stops holding its AgentHandle, freeing memory and session context. The target must be a direct child of the calling agent; a non-resident or already-finished target is an accepted no-op. Pairs with send_message (continue) and interrupt_agent (stop one turn) to complete the lifecycle.',
    parameters: {
      subagent_id: {
        type: 'string',
        required: true,
        description:
          'The durable subagent id returned when the background subagent was started (continuable mode). Releases the resident child so the parent no longer holds its handle.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: { type: 'boolean', required: true },
        },
      },
      render: (args, _value) => [{ type: 'text', text: `closed subagent ${args.subagent_id}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args: CloseSubagentArgs, exec) {
      const parent = exec.agent;
      if (!parent) {
        throw new Error(`${ERROR_PREFIX} close_subagent requires a calling agent (exec.agent was undefined)`);
      }
      await ctx.subagents.drainContinuableChildren(parent, [SessionId(args.subagent_id)]);
      return { closed: true };
    },
  });
}

/**
 * close_subagent — release one resident continuable subagent (issue #1).
 *
 * DSH 0.2.2 removed `drainChildren`; the only public per-child teardown is the
 * `SubagentActivation` receipt returned by `startActivation`. The plugin keeps
 * the receipt of every continuable child it starts, and this tool disposes that
 * exact receipt after checking the caller is its recorded direct parent.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';

import { closeResident } from './resident-handles.js';

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
        'The durable subagent id returned when a continuable subagent_role call started the child. Releases the resident child so the parent no longer holds its handle.',
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

/** Create the close_subagent ToolDefinition. The ctx argument is accepted for
 * composition symmetry; release uses the shared receipt registry. */
export function createCloseSubagentTool(_options: { ctx: Context }) {
  return defineTool({
    name: CLOSE_SUBAGENT_TOOL_NAME,
    description:
      'Close/release one resident continuable subagent started by this plugin instance: the continuation manager disposes that exact activation, freeing its resident handle and capacity. The target must be a direct child of the calling agent. Untracked targets are rejected because DSH 0.2.2 removed the host per-child close API; use send_message to continue or interrupt_agent to stop one turn.',
    parameters: {
      subagent_id: {
        type: 'string',
        required: true,
        description:
          'The durable subagent id returned when a continuable subagent_role call started the child. Releases the resident child so the parent no longer holds its handle.',
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
      let outcome: Awaited<ReturnType<typeof closeResident>>;
      try {
        outcome = await closeResident(String(parent.id), args.subagent_id);
      } catch (error) {
        throw new Error(
          `${ERROR_PREFIX} close_subagent failed to release "${args.subagent_id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (outcome === 'not-tracked') {
        throw new Error(
          `${ERROR_PREFIX} close_subagent cannot release "${args.subagent_id}": only resident continuable children started by subagent_role in this process are tracked`,
        );
      }
      if (outcome === 'unauthorized') {
        throw new Error(
          `${ERROR_PREFIX} close_subagent target "${args.subagent_id}" is not a direct child of the calling agent`,
        );
      }
      return { closed: true };
    },
  });
}

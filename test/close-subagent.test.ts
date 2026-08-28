/**
 * Unit tests for the close_subagent lifecycle tool (issue #1: expose a
 * model-visible "close/release continuable subagent" tool).
 *
 * close_subagent is a thin model-facing adapter over
 * ctx.subagents.drainContinuableChildren(parent, [subagent_id]): it releases a
 * resident continuable direct child of the exact calling agent, mirroring how
 * the core's interrupt_agent adapts ctx.subagents.interrupt(). The pure schema
 * / render helpers are asserted directly; execute behavior runs against a fake
 * subagents service so the adapter contract (parent authority, child id
 * forwarding, error propagation) is pinned without a live DSH context.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import {
  CLOSE_SUBAGENT_TOOL_NAME,
  createCloseSubagentParameters,
  createCloseSubagentOutputSchema,
  renderCloseResult,
  createCloseSubagentTool,
  registerCloseSubagent,
  type CloseSubagentArgs,
} from '../src/close-subagent.js';

/** A fake subagents service that records drainContinuableChildren calls. */
function recordingSubagents() {
  const calls: Array<{ parent: unknown; childIds: string[] }> = [];
  const drain = vi.fn(async (parent: unknown, childIds: readonly string[]) => {
    calls.push({ parent, childIds: [...childIds] });
  });
  return { calls, drain };
}

function fakeContext(subagents: { drainContinuableChildren: (parent: unknown, childIds: readonly string[]) => Promise<void> }) {
  return { subagents } as unknown as Context;
}

/** A representative live calling agent. */
function parentAgent(): Agent {
  return { id: 'session-parent-1', options: {} } as unknown as Agent;
}

function toolExec(agent: Agent): ToolRunContext {
  return { agent, signal: new AbortController().signal } as unknown as ToolRunContext;
}

function runExecute(tool: ToolDefinition, args: CloseSubagentArgs, exec: ToolRunContext): Promise<unknown> {
  return tool.execute(args, exec);
}

describe('createCloseSubagentParameters', () => {
  it('exposes subagent_id as a required string', () => {
    const schema = createCloseSubagentParameters();
    expect(schema.subagent_id).toMatchObject({ type: 'string', required: true });
  });
});

describe('createCloseSubagentOutputSchema', () => {
  it('is a closed object carrying a required closed boolean', () => {
    const schema = createCloseSubagentOutputSchema();
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect((schema.properties as Record<string, unknown>).closed).toMatchObject({ type: 'boolean', required: true });
  });
});

describe('renderCloseResult', () => {
  it('renders the released subagent id', () => {
    expect(renderCloseResult({ subagent_id: 'child-9' }, { closed: true })).toBe('closed subagent child-9');
  });
});

describe('createCloseSubagentTool execute', () => {
  it('releases the named continuable child of the exact calling agent', async () => {
    const { calls, drain } = recordingSubagents();
    const tool = createCloseSubagentTool(fakeContext({ drainContinuableChildren: drain }));
    const parent = parentAgent();

    const result = await runExecute(tool, { subagent_id: 'child-9' }, toolExec(parent));

    expect(result).toEqual({ closed: true });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([{ parent, childIds: ['child-9'] }]);
  });

  it('requires a calling agent (parent authority)', async () => {
    const { drain } = recordingSubagents();
    const tool = createCloseSubagentTool(fakeContext({ drainContinuableChildren: drain }));

    await expect(runExecute(tool, { subagent_id: 'child-9' }, toolExec(undefined as unknown as Agent))).rejects.toThrow(
      /requires a calling agent/,
    );
    expect(drain).not.toHaveBeenCalled();
  });

  it('propagates a service rejection (e.g. UNAUTHORIZED for another parent\'s child)', async () => {
    const drain = vi.fn(async () => {
      throw new Error('subagent-director: UNAUTHORIZED: resident child belongs to a different parent');
    });
    const tool = createCloseSubagentTool(fakeContext({ drainContinuableChildren: drain }));

    await expect(runExecute(tool, { subagent_id: 'foreign-1' }, toolExec(parentAgent()))).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe('registerCloseSubagent', () => {
  it('registers the tool under close_subagent when absent', () => {
    const registered: string[] = [];
    const ctx = {
      tools: {
        get: vi.fn(() => undefined),
        register: vi.fn((definition: ToolDefinition) => {
          registered.push(definition.name);
          return () => undefined;
        }),
      },
    } as unknown as Context;

    const dispose = registerCloseSubagent(ctx);

    expect(ctx.tools.get).toHaveBeenCalledWith(CLOSE_SUBAGENT_TOOL_NAME);
    expect(ctx.tools.register).toHaveBeenCalledTimes(1);
    expect(registered).toEqual([CLOSE_SUBAGENT_TOOL_NAME]);
    expect(dispose).toBeTypeOf('function');
  });

  it('skips registration when the name is already taken (multi-instance guard)', () => {
    const ctx = {
      tools: {
        get: vi.fn(() => ({ name: CLOSE_SUBAGENT_TOOL_NAME }) as ToolDefinition),
        register: vi.fn(),
      },
    } as unknown as Context;

    const dispose = registerCloseSubagent(ctx);

    expect(ctx.tools.register).not.toHaveBeenCalled();
    expect(dispose).toBeUndefined();
  });
});

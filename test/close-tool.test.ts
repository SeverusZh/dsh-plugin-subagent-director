/**
 * Unit tests for the close_subagent tool (issue #1).
 *
 * Covers the pure schema builders (model-visible shape) and the execute
 * contract: the calling agent authorizes release of its own direct continuable
 * child through ctx.subagents.drainContinuableChildren(parent, [SessionId]),
 * with the missing-caller hard error. The drain call itself is the core's
 * behavior (UNAUTHORIZED on non-direct children, no-op on absent targets) and
 * is exercised through a fake context here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CLOSE_SUBAGENT_TOOL_NAME,
  createCloseSubagentOutputSchema,
  createCloseSubagentParameters,
  createCloseSubagentTool,
} from '../src/close-tool.js';

describe('createCloseSubagentParameters', () => {
  it('requires subagent_id as a string', () => {
    const schema = createCloseSubagentParameters();
    expect(schema.subagent_id).toMatchObject({ type: 'string', required: true });
  });
});

describe('createCloseSubagentOutputSchema', () => {
  it('returns exactly { closed: boolean }', () => {
    const schema = createCloseSubagentOutputSchema();
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { closed: { type: 'boolean', required: true } },
    });
  });
});

describe('createCloseSubagentTool', () => {
  it('registers under the stable close_subagent name with lifecycle copy', () => {
    const tool = createCloseSubagentTool({ ctx: { subagents: {} } as never });
    expect(tool.name).toBe(CLOSE_SUBAGENT_TOOL_NAME);
    expect(tool.description).toContain('continuable');
    expect(tool.description).toContain('direct child');
  });

  it('calls drainContinuableChildren with the calling agent and the durable id', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const parent = { id: 'agent-1' };
    const tool = createCloseSubagentTool({
      ctx: { subagents: { drainContinuableChildren: drain } } as never,
    });
    const result = await tool.execute({ subagent_id: 'child-9' }, { agent: parent } as never);
    expect(drain).toHaveBeenCalledTimes(1);
    const [parentArg, idsArg] = drain.mock.calls[0];
    expect(parentArg).toBe(parent);
    expect(String(idsArg[0])).toBe('child-9');
    expect(result).toEqual({ closed: true });
  });

  it('throws a structured error when no calling agent is present', async () => {
    const drain = vi.fn().mockResolvedValue(undefined);
    const tool = createCloseSubagentTool({
      ctx: { subagents: { drainContinuableChildren: drain } } as never,
    });
    await expect(
      tool.execute({ subagent_id: 'child-9' }, { agent: undefined } as never),
    ).rejects.toThrow(/close_subagent requires a calling agent/);
    expect(drain).not.toHaveBeenCalled();
  });

  it('propagates a core drain rejection (e.g. UNAUTHORIZED for a non-direct child)', async () => {
    const drain = vi.fn().mockRejectedValue(new Error('subagent "other" is not a direct child of agent "agent-1"'));
    const tool = createCloseSubagentTool({
      ctx: { subagents: { drainContinuableChildren: drain } } as never,
    });
    await expect(
      tool.execute({ subagent_id: 'other' }, { agent: { id: 'agent-1' } } as never),
    ).rejects.toThrow(/not a direct child/);
  });
});

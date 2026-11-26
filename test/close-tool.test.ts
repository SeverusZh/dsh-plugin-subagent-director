/**
 * Unit tests for the close_subagent tool (issue #1, DSH 0.2.2+ contract).
 *
 * DSH 0.2.2 removed `drainChildren`; the plugin retains each continuable
 * activation receipt and disposes that exact receipt. These tests cover the
 * registry-backed execute contract and the model-visible schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent';
import {
  CLOSE_SUBAGENT_TOOL_NAME,
  createCloseSubagentOutputSchema,
  createCloseSubagentParameters,
  createCloseSubagentTool,
} from '../src/close-tool.js';
import { clearResidentHandles, closeResident, forgetResident, trackResident } from '../src/resident-handles.js';

function fakeActivation(childId: string, dispose: () => Promise<void> = async () => {}): SubagentActivation {
  return {
    childId,
    name: childId,
    messageId: 'message-1',
    result: Promise.resolve({ stopReason: 'completed', output: [] }),
    dispose,
  } as unknown as SubagentActivation;
}

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
  beforeEach(() => {
    clearResidentHandles();
  });

  it('registers under the stable close_subagent name with lifecycle copy', () => {
    const tool = createCloseSubagentTool({ ctx: {} as never });
    expect(tool.name).toBe(CLOSE_SUBAGENT_TOOL_NAME);
    expect(tool.description).toContain('continuable');
    expect(tool.description).toContain('direct child');
  });

  it('disposes the tracked activation of a direct child', async () => {
    const dispose = vi.fn(async () => {});
    trackResident('agent-1', fakeActivation('child-9', dispose));
    const tool = createCloseSubagentTool({ ctx: {} as never });

    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).resolves.toEqual({
      closed: true,
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).rejects.toThrow(
      /cannot release "child-9"/,
    );
  });

  it('coalesces concurrent releases into one disposal', async () => {
    const dispose = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    trackResident('agent-1', fakeActivation('child-9', dispose));
    const [first, second] = await Promise.all([
      closeResident('agent-1', 'child-9'),
      closeResident('agent-1', 'child-9'),
    ]);
    expect([first, second]).toEqual(['closed', 'closed']);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('forgets a receipt after the host disposes the child', async () => {
    trackResident('agent-1', fakeActivation('child-9'));
    forgetResident('child-9');
    const tool = createCloseSubagentTool({ ctx: {} as never });
    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).rejects.toThrow(
      /cannot release "child-9"/,
    );
  });

  it('rejects a target recorded under another direct parent without disposing it', async () => {
    const dispose = vi.fn(async () => {});
    trackResident('agent-2', fakeActivation('child-9', dispose));
    const tool = createCloseSubagentTool({ ctx: {} as never });

    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).rejects.toThrow(
      /is not a direct child of the calling agent/,
    );
    expect(dispose).not.toHaveBeenCalled();
  });

  it('rejects an untracked target instead of claiming a release', async () => {
    const tool = createCloseSubagentTool({ ctx: {} as never });
    await expect(tool.execute({ subagent_id: 'other' }, { agent: { id: 'agent-1' } } as never)).rejects.toThrow(
      /cannot release "other"/,
    );
  });

  it('keeps the receipt after a disposal failure so a retry can succeed', async () => {
    let attempts = 0;
    const dispose = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('teardown failed');
    });
    trackResident('agent-1', fakeActivation('child-9', dispose));
    const tool = createCloseSubagentTool({ ctx: {} as never });

    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).rejects.toThrow(
      /close_subagent failed to release "child-9".*teardown failed/,
    );
    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: { id: 'agent-1' } } as never)).resolves.toEqual({
      closed: true,
    });
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('throws a structured error when no calling agent is present', async () => {
    const tool = createCloseSubagentTool({ ctx: {} as never });
    await expect(tool.execute({ subagent_id: 'child-9' }, { agent: undefined } as never)).rejects.toThrow(
      /close_subagent requires a calling agent/,
    );
  });
});

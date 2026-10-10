/**
 * Regression test for issue #10: the one-shot background delegation path must
 * pass the parent agent's session id (a string) as `jobs.start`'s `owner`, not
 * the Agent object itself.
 *
 * Passing the object handed it straight to the core jobs manager's
 * resolveOwner(session), which indexes live agents by SessionId
 * (`agents.get(session)`). A non-string key misses, so the job threw:
 *   session "[object Object]" has no live agent (background job owner must be live)
 */
import { describe, it, expect } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createDelegationTool } from '../src/delegation-tool.js';

describe('delegation one-shot background owner (issue #10)', () => {
  it('passes the parent agent id (string) as jobs.start owner, not the agent object', async () => {
    const started: Array<{ kind: string; label: string; owner: unknown }> = [];
    const ctx = {
      get(key: string) {
        if (key === 'jobs') {
          return {
            start: (spec: { kind: string; label: string; owner: unknown }) => {
              started.push(spec);
              return 'job-1';
            },
          };
        }
        return undefined;
      },
      logger: { info() {}, warn() {} },
    } as unknown as Context;

    const provider = {
      name: 'spawn',
      capabilities: { agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => {
        throw new Error('transport start must not be reached in this test');
      },
    };

    const tool = createDelegationTool({
      ctx,
      config: { subagentProvider: 'spawn', backgroundMode: 'one-shot', enableRunInBackground: true },
      provider: provider as never,
      getSettings: () => ({}),
    });

    const exec = {
      agent: { id: 'parent-session-1', options: {} },
      signal: new AbortController().signal,
    };

    const result = await tool.execute(
      { description: 'demo task', prompt: 'do it', run_in_background: true },
      exec as never,
    );

    expect(result).toEqual({ kind: 'background', jobId: 'job-1' });
    expect(started).toHaveLength(1);
    expect(started[0].kind).toBe('subagent');
    expect(typeof started[0].owner).toBe('string');
    expect(started[0].owner).toBe('parent-session-1');
    expect(started[0].owner).not.toBe(exec.agent);
  });
});

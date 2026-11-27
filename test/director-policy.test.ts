import { describe, it, expect } from 'vitest';
import {
  applyDirectorPolicy,
  DIRECTOR_POLICY_SECTION,
  renderDirectorPolicy,
} from '../src/director-policy.js';

describe('Director contract section', () => {
  it('states the card-first, no-takeover, and Agent Teams rules', () => {
    const text = renderDirectorPolicy('subagent_role');
    expect(text).toContain('subagent_card_create');
    expect(text).toContain('Do not take over a failed subagent');
    expect(text).toContain('Agent Teams is available');
    expect(text).toContain('Every delegation prompt must be self-contained');
  });

  it('renders only for Director agents', () => {
    const sections: Array<{ name: string; text: (context: { agent?: { id: string } } | undefined) => string }> = [];
    const ctx = {
      get: (name: string) =>
        name === 'systemPrompt'
          ? {
              section: (section: { name: string; text: (context: { agent?: { id: string } } | undefined) => string }) => {
                sections.push(section);
                return () => {};
              },
            }
          : undefined,
      effect: (callback: () => () => void) => {
        callback();
        return () => {};
      },
      inject: () => {},
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    };
    applyDirectorPolicy(ctx as never, (agent) => agent?.id === 'director-agent', 'subagent_role');
    expect(sections.map((section) => section.name)).toEqual([DIRECTOR_POLICY_SECTION]);
    expect(sections[0]?.text({ agent: { id: 'director-agent' } })).toContain('Director Mode contract');
    expect(sections[0]?.text({ agent: { id: 'worker' } })).toBe('');
    expect(sections[0]?.text(undefined)).toBe('');
  });
});

import { restrictDirectorWorkTools } from '../src/director-policy.js';

describe('Director work-tool restriction', () => {
  it('keeps only orchestration tools and returns the restriction disposer', () => {
    const allowed: string[][] = [];
    let disposed = 0;
    const agent = {
      ctx: {
        tools: {
          definitions: () => [
            { name: 'bash' },
            { name: 'read' },
            { name: 'subagent_role' },
            { name: 'send_message' },
            { name: 'team_task_create' },
            { name: 'subagent_card_create' },
          ],
          restrict: (filter: { allow?: string[] }) => {
            allowed.push(filter.allow ?? []);
            return () => {
              disposed += 1;
            };
          },
        },
      },
    } as never;
    const dispose = restrictDirectorWorkTools(agent, 'subagent_role');
    expect(allowed).toHaveLength(1);
    expect(allowed[0]).toContain('subagent_role');
    expect(allowed[0]).toContain('team_task_create');
    expect(allowed[0]).not.toContain('bash');
    expect(allowed[0]).not.toContain('read');
    expect(typeof dispose).toBe('function');
    dispose?.();
    expect(disposed).toBe(1);
  });

  it('does not restrict when no allowlisted tool is visible', () => {
    let calls = 0;
    const agent = {
      ctx: {
        tools: {
          definitions: () => [{ name: 'bash' }],
          restrict: () => {
            calls += 1;
            return () => {};
          },
        },
      },
    } as never;
    expect(restrictDirectorWorkTools(agent, 'subagent_role')).toBeUndefined();
    expect(calls).toBe(0);
  });
});

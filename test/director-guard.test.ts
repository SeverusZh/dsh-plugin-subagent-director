import { describe, it, expect } from 'vitest';
import {
  applyDirectorToolGuard,
  DIRECTOR_ALLOWED_TOOLS,
  isDirectorAllowedTool,
} from '../src/director-guard.js';

describe('Director tool allowlist', () => {
  it('allows orchestration tools and the configured delegation tool', () => {
    expect(isDirectorAllowedTool('subagent_role', 'subagent_role')).toBe(true);
    expect(isDirectorAllowedTool('subagent_role_custom', 'subagent_role_custom')).toBe(true);
    for (const name of DIRECTOR_ALLOWED_TOOLS) {
      expect(isDirectorAllowedTool(name, 'subagent_role')).toBe(true);
    }
    expect(isDirectorAllowedTool('team_task_create', 'subagent_role')).toBe(true);
    expect(isDirectorAllowedTool('interrupt_agent', 'subagent_role')).toBe(false);
    expect(isDirectorAllowedTool('team_task_update', 'subagent_role')).toBe(true);
  });

  it('rejects work, MCP, and unknown tools', () => {
    for (const name of [
      'bash',
      'read',
      'write',
      'grep',
      'subagent',
      'subagent_fork',
      'run_code',
      'present',
      'list_mcp_resources',
      'read_mcp_resource',
      'mcp__github__search_code',
    ]) {
      expect(isDirectorAllowedTool(name, 'subagent_role')).toBe(false);
    }
  });

  it('registers a guard that only denies Director callers', () => {
    const guards: Array<(execution: { name: string; agent?: { id: string } }) => unknown> = [];
    const ctx = {
      tools: { guard: (guard: never) => (guards.push(guard), () => {}) },
      effect: (callback: () => () => void) => {
        callback();
        return () => {};
      },
    } as never;
    applyDirectorToolGuard(ctx, (agent) => agent?.id === 'director', 'subagent_role');
    expect(guards).toHaveLength(1);
    const guard = guards[0]!;
    expect(guard({ name: 'bash', agent: { id: 'director' } })).toMatchObject({ reason: expect.stringContaining('Director Mode') });
    expect(guard({ name: 'bash', agent: { id: 'standard' } })).toBeUndefined();
    expect(guard({ name: 'subagent_role', agent: { id: 'director' } })).toBeUndefined();
  });
});

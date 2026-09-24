/**
 * Unit tests for the role guidance renderer (方案 A follow-up).
 * The rendered role list must tell the model to reference roles by their id
 * (the Delegate line value), not by display name.
 */
import { describe, it, expect } from 'vitest';
import { renderRolesGuidance } from '../src/guidance.js';

const settings = {
  roles: {
    role: {
      displayName: '基础开发工程师',
      description: '一个基础的开发工程师',
      provider: 'opencode-go',
      model: 'mimo-v2.5',
    },
  },
};

describe('renderRolesGuidance', () => {
  it('renders an empty string when there are no roles', () => {
    expect(renderRolesGuidance({}, 'subagent_role')).toBe('');
  });

  it('includes the id-reference instruction and the delegate line', () => {
    const text = renderRolesGuidance(settings, 'subagent_role');
    expect(text).toContain('Reference roles by their id');
    expect(text).toContain('never by display name');
    expect(text).toContain('subagent_role({ role: "role", prompt: "..." })');
    expect(text).toContain('基础开发工程师');
  });

  it('appends a dangling defaultRole warning so it reaches the agent', () => {
    const text = renderRolesGuidance({ ...settings, defaultRole: 'ghost' }, 'subagent_role');
    expect(text).toContain('defaultRole "ghost"');
    expect(text).toContain('does not reference a defined role');
  });

  it('adds no warning for a sound or unset defaultRole', () => {
    expect(renderRolesGuidance({ ...settings, defaultRole: 'role' }, 'subagent_role')).not.toContain('does not reference');
    expect(renderRolesGuidance(settings, 'subagent_role')).not.toContain('does not reference');
  });

  it('keeps a dangling defaultRole from resurrecting an empty role section', () => {
    expect(renderRolesGuidance({ roles: {}, defaultRole: 'ghost' }, 'subagent_role')).toBe('');
  });
});

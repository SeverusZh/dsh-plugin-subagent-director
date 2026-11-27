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
    expect(text).toContain('Reference cards by their bracketed id');
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

import { BUILTIN_DIRECTOR_CARD } from '../src/director-card.js';
import type { CharacterCard } from '../src/card-types.js';

const reviewer: CharacterCard = {
  id: 'reviewer',
  name: 'Reviewer',
  delegationGuidance: 'Use when a diff needs correctness review.',
  avoidGuidance: 'Do not use when the task is to write a new feature.',
  enabled: true,
};

const cardSource = {
  list: (options?: { includeBuiltIn?: boolean }) =>
    options?.includeBuiltIn === true ? [reviewer, BUILTIN_DIRECTOR_CARD] : [reviewer],
};

describe('renderRolesGuidance guidance split', () => {
  it('renders both recommended and not-recommended sections', () => {
    const text = renderRolesGuidance({}, 'subagent_role', cardSource);
    expect(text).toContain('Use when: Use when a diff needs correctness review.');
    expect(text).toContain('Do not use when: Do not use when the task is to write a new feature.');
    expect(text).not.toContain('Director Mode card policy');
    expect(text).not.toContain('director');
  });

  it('includes the built-in director card and card-first policy only in Director mode', () => {
    const text = renderRolesGuidance({}, 'subagent_role', cardSource, { director: true });
    expect(text).toContain('Director Mode card policy');
    expect(text).toContain('subagent_card_create');
    expect(text).toContain('Director [director]');
    expect(text).toContain('built-in');
  });

  it('hides legacy roles in Director mode', () => {
    const legacy = {
      roles: { legacy: { displayName: 'Legacy', description: 'Old guidance.' } },
    };
    expect(renderRolesGuidance(legacy, 'subagent_role', cardSource)).toContain('Legacy role templates');
    expect(renderRolesGuidance(legacy, 'subagent_role', cardSource, { director: true })).not.toContain('Legacy role templates');
  });
});

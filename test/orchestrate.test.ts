/**
 * Unit tests for the orchestrate prompt renderer (merged /orchestrate command).
 * Covers: dynamic role rendering from settings, the empty-roles notice, and
 * that the coordinator reference is generalized (never hard-codes a role id).
 */
import { describe, it, expect } from 'vitest';
import {
  renderOrchestratorRoles,
  renderOrchestratorPrompt,
  buildOrchestratorFrame,
  ORCHESTRATE_VALID_MODES,
} from '../src/orchestrate.js';

const settings = {
  roles: {
    'dev-role': {
      displayName: '开发工程师',
      description: '实现功能代码',
      provider: 'opencode-go',
      model: 'mimo-v2.5',
    },
    'coord-role': {
      displayName: '项目协调者',
      description: '分解与协调任务',
      provider: 'opencode-go',
      model: 'mimo-v2.5',
    },
  },
};

describe('renderOrchestratorRoles', () => {
  it('tells the user to configure roles when none are set', () => {
    const text = renderOrchestratorRoles({}, 'subagent_role');
    expect(text).toContain('No Subagent Director roles are configured');
    expect(text).toContain('subagent-director.roles');
  });

  it('lists each configured role by id with its delegate line', () => {
    const text = renderOrchestratorRoles(settings, 'subagent_role');
    expect(text).toContain('subagent_role({ role: "dev-role", prompt: "..." })');
    expect(text).toContain('开发工程师');
    expect(text).toContain('项目协调者');
  });

  it('never hard-codes a specific coordinator role id', () => {
    const text = renderOrchestratorPrompt(settings, 'subagent_role');
    expect(text).not.toMatch(/\brole-3\b/);
    // Coordinator is referenced by display-name semantics, not a literal id.
    expect(text).toMatch(/协调|Orchestrator|Coordinator/);
  });
});

describe('renderOrchestratorPrompt', () => {
  it('uses the configured tool name, not a hard-coded one', () => {
    const text = renderOrchestratorPrompt(settings, 'my_role_tool');
    expect(text).toContain('my_role_tool({ role: "dev-role", prompt: "..." })');
    expect(text).not.toContain('subagent_role({ role: "dev-role"');
  });

  it('injects the empty-roles notice when settings have no roles', () => {
    const text = renderOrchestratorPrompt({}, 'subagent_role');
    expect(text).toContain('No Subagent Director roles are configured');
  });
});

describe('buildOrchestratorFrame', () => {
  it('substitutes the tool name into the framing', () => {
    expect(buildOrchestratorFrame('dispatch')).toContain('`dispatch` tool');
  });
});

describe('ORCHESTRATE_VALID_MODES', () => {
  it('accepts only on/off', () => {
    expect(ORCHESTRATE_VALID_MODES).toEqual(['on', 'off']);
  });
});

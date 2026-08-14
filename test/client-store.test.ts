/**
 * Unit tests for the pure settings-write logic of the Subagent Director client
 * (src/client/store-logic.ts). Everything here runs in a plain node env without
 * a host or React: path-op construction, the revision state machine, the
 * conflict → re-read decision, default-role switching, and the
 * clear-to-composition-default unset ops are all pure functions.
 */
import { describe, it, expect } from 'vitest';
import {
  addRoleOps,
  advanceRevision,
  adoptRevision,
  classifyMutateError,
  defaultModelOps,
  defaultRoleValid,
  markConflict,
  optional,
  removeRoleOps,
  restoreDefaultsOps,
  roleIdFromName,
  setDefaultRoleOps,
  updateRoleOps,
  type DefaultModelEdits,
  type RevisionState,
  type RoleDraft,
  type StoredRole,
  type StoredSection,
} from '../src/client/store-logic.js';

/** A fully-populated role draft. */
function draft(overrides: Partial<RoleDraft> = {}): RoleDraft {
  return {
    displayName: 'Code Reviewer',
    description: 'Reviews every diff for correctness.',
    persona: 'You are a careful reviewer.',
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    reasoningEffort: 'high',
    ...overrides,
  };
}

describe('addRoleOps', () => {
  it('builds one set op at the role root carrying every non-blank field', () => {
    expect(addRoleOps('reviewer', draft())).toEqual([
      {
        op: 'set',
        path: ['roles', 'reviewer'],
        value: {
          displayName: 'Code Reviewer',
          description: 'Reviews every diff for correctness.',
          persona: 'You are a careful reviewer.',
          provider: 'deepseek-official',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
        },
      },
    ]);
  });

  it('drops blank persona/provider/model/effort so the stored role has no empty strings', () => {
    const ops = addRoleOps('writer', {
      displayName: 'Writer',
      description: 'Writes prose',
      persona: '   ',
      provider: '',
      model: '  ',
      reasoningEffort: undefined,
    });
    expect(ops).toEqual([
      {
        op: 'set',
        path: ['roles', 'writer'],
        value: { displayName: 'Writer', description: 'Writes prose' },
      },
    ]);
  });
});

describe('optional', () => {
  it('normalizes blank/whitespace to undefined and passes through real strings', () => {
    expect(optional(undefined)).toBeUndefined();
    expect(optional('   ')).toBeUndefined();
    expect(optional('')).toBeUndefined();
    expect(optional('deepseek-chat')).toBe('deepseek-chat');
    expect(optional('  ai ')).toBe('ai');
  });
});

describe('updateRoleOps', () => {
  const stored: StoredRole = {
    displayName: 'Coder',
    description: 'Write code',
    persona: 'You are a coder.',
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    reasoningEffort: 'low',
  };

  it('emits no ops when the draft is unchanged from the stored role', () => {
    expect(updateRoleOps('coder', stored, stored)).toEqual([]);
  });

  it('turns a changed field into a set op at the field path', () => {
    const ops = updateRoleOps('coder', stored, { ...stored, model: 'deepseek-reasoner' });
    expect(ops).toContainEqual({
      op: 'set',
      path: ['roles', 'coder', 'model'],
      value: 'deepseek-reasoner',
    });
  });

  it('turns a cleared field into an unset op (restore composition default)', () => {
    const ops = updateRoleOps('coder', stored, { ...stored, persona: '' });
    expect(ops).toContainEqual({ op: 'unset', path: ['roles', 'coder', 'persona'] });
    // the unchanged fields must not produce ops
    expect(ops).not.toContainEqual({ op: 'set', path: ['roles', 'coder', 'displayName'], value: 'Coder' });
  });

  it('handles a previously-absent role (before undefined) by treating it as empty', () => {
    const ops = updateRoleOps('fresh', undefined, draft({ model: '' }));
    expect(ops).toContainEqual({ op: 'set', path: ['roles', 'fresh', 'displayName'], value: 'Code Reviewer' });
    // a blank model equals the absent stored model, so it is simply left out (no op)
    expect(ops).not.toContainEqual(expect.objectContaining({ path: ['roles', 'fresh', 'model'] }));
  });
});

describe('removeRoleOps', () => {
  it('unstets the role and, when it was default, also clears defaultRole', () => {
    expect(removeRoleOps('coder', { defaultRole: 'coder' })).toEqual([
      { op: 'unset', path: ['roles', 'coder'] },
      { op: 'unset', path: ['defaultRole'] },
    ]);
  });

  it('only unstets the role when it was not the default', () => {
    expect(removeRoleOps('writer', { defaultRole: 'coder' })).toEqual([
      { op: 'unset', path: ['roles', 'writer'] },
    ]);
  });
});

describe('setDefaultRoleOps', () => {
  it('sets defaultRole to the promoted id', () => {
    expect(setDefaultRoleOps('reviewer')).toEqual([
      { op: 'set', path: ['defaultRole'], value: 'reviewer' },
    ]);
  });
});

describe('defaultModelOps', () => {
  it('sets changed fields and unsets cleared fields against the stored section', () => {
    const before: StoredSection = {
      defaultProvider: 'deepseek-official',
      defaultModel: 'deepseek-chat',
      defaultReasoningEffort: 'low',
    };
    const edits: DefaultModelEdits = {
      provider: 'opencode-go',
      model: undefined, // cleared
      reasoningEffort: 'high',
    };
    expect(defaultModelOps(before, edits)).toEqual([
      { op: 'set', path: ['defaultProvider'], value: 'opencode-go' },
      { op: 'unset', path: ['defaultModel'] },
      { op: 'set', path: ['defaultReasoningEffort'], value: 'high' },
    ]);
  });

  it('emits no ops when nothing changed', () => {
    const before: StoredSection = { defaultProvider: 'x', defaultModel: 'y' };
    expect(defaultModelOps(before, { provider: 'x', model: 'y', reasoningEffort: undefined })).toEqual([]);
  });
});

describe('restoreDefaultsOps', () => {
  it('unsets every default field currently present (and leaves absent ones alone)', () => {
    expect(
      restoreDefaultsOps({
        defaultProvider: 'a',
        defaultModel: 'b',
        defaultReasoningEffort: 'c',
        defaultRole: 'd',
      }),
    ).toEqual([
      { op: 'unset', path: ['defaultProvider'] },
      { op: 'unset', path: ['defaultModel'] },
      { op: 'unset', path: ['defaultReasoningEffort'] },
      { op: 'unset', path: ['defaultRole'] },
    ]);
  });

  it('returns an empty op list when nothing is set', () => {
    expect(restoreDefaultsOps({})).toEqual([]);
  });
});

describe('defaultRoleValid', () => {
  it('is true when unset or when the referenced role exists', () => {
    expect(defaultRoleValid({})).toBe(true);
    expect(defaultRoleValid({ defaultRole: 'coder', roles: { coder: draft() } })).toBe(true);
  });

  it('is false when defaultRole points at a missing role', () => {
    expect(defaultRoleValid({ defaultRole: 'ghost', roles: { coder: draft() } })).toBe(false);
  });
});

describe('roleIdFromName', () => {
  it('kebab-cases a display name and dedupes with a numeric suffix', () => {
    expect(roleIdFromName('My Code Reviewer!', new Set())).toBe('my-code-reviewer');
    expect(roleIdFromName('my-code-reviewer', new Set(['my-code-reviewer']))).toBe('my-code-reviewer-2');
  });

  it('falls back to the prefix when a name produces no characters', () => {
    expect(roleIdFromName('!!!', new Set())).toBe('role');
  });
});

describe('classifyMutateError', () => {
  it('maps settings-conflict to conflict and schema validation to rejected', () => {
    expect(classifyMutateError('settings-conflict')).toBe('conflict');
    expect(classifyMutateError('schema-validation')).toBe('rejected');
    expect(classifyMutateError('settings-rejected')).toBe('rejected');
  });

  it('treats unknown/undefined codes as fatal so the UI can fall back to server text', () => {
    expect(classifyMutateError('nope')).toBe('fatal');
    expect(classifyMutateError(undefined)).toBe('fatal');
  });
});

describe('revision state machine', () => {
  const idle: RevisionState = { revision: 3, conflicted: false };

  it('advanceRevision adopts the server revision and clears the conflict flag', () => {
    expect(advanceRevision(idle, 5)).toEqual({ revision: 5, conflicted: false });
  });

  it('markConflict keeps the stale revision and flags conflicted so the editor must reload', () => {
    expect(markConflict({ revision: 3, conflicted: false })).toEqual({ revision: 3, conflicted: true });
  });

  it('adoptRevision rebases to a freshly described revision', () => {
    expect(adoptRevision({ revision: 3, conflicted: true }, 9)).toEqual({ revision: 9, conflicted: false });
  });
});

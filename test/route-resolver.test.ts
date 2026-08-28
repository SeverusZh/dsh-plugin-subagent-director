/**
 * Unit tests for the four-layer route resolver (design section 6 test matrix).
 * Covers: four layers each supplying fields, per-field fall-through, call-layer
 * empty-string skip, nonexistent-role warnings + degrade, dangling defaultRole
 * warnings + degrade, persona/toolFilter role-layer-only output, and inherit
 * layer zero intrusion (AC-3.2).
 */
import { describe, it, expect } from 'vitest';
import { resolveRoute, type RouteInput } from '../src/route-resolver.js';

function baseSettings(overrides = {}) {
  return {
    defaultProvider: 'deepseek-official',
    defaultModel: 'deepseek-chat',
    defaultRole: 'coder',
    fallbackOnInvalid: true,
    roles: {
      coder: {
        displayName: 'Coder',
        description: 'Write code',
        persona: 'You are a careful engineer.',
        provider: 'opencode-go',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
        toolFilter: { allow: ['apply_patch'], deny: [] },
      },
      writer: {
        displayName: 'Writer',
        description: 'Write prose',
        persona: 'You are a concise writer.',
      },
    },
    ...overrides,
  };
}

function resolve(input: Partial<RouteInput>) {
  return resolveRoute({
    settings: baseSettings(),
    ...input,
  });
}

describe('resolveRoute', () => {
  it('call layer supplies provider/model and dominates', () => {
    const r = resolve({
      args: { provider: 'cli', model: 'claude' },
    });
    expect(r.layer).toBe('call');
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'claude' });
    // role still bound for persona/toolFilter
    expect(r.roleId).toBe('coder');
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.toolFilter).toEqual({ allow: ['apply_patch'], deny: [] });
    expect(r.warnings).toEqual([]);
  });

  it('role layer fills fields when call supplies only some (per-field)', () => {
    const r = resolve({
      args: { provider: 'cli' }, // call provides provider; role fills model
    });
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'deepseek-v4-flash' });
    expect(r.layer).toBe('call');
  });

  it('role layer contributes roleId/persona when it binds no provider/model', () => {
    // writer binds no provider/model fields, so agentOptions falls through to
    // the default layer; layer reports the highest layer that supplied an
    // agentOptions field, hence 'default'.
    const r = resolve({ args: { role: 'writer' } });
    expect(r.layer).toBe('default');
    expect(r.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    });
    expect(r.reasoningEffort).toBeUndefined();
    expect(r.roleId).toBe('writer');
    expect(r.persona).toBe('You are a concise writer.');
  });

  it('default layer fills when no call/role provider/model', () => {
    const r = resolve({
      settings: baseSettings({ defaultRole: undefined }),
      args: { role: 'writer' }, // writer has no provider/model
    });
    expect(r.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    });
    expect(r.layer).toBe('default');
  });

  it('inherit layer: nothing configured => no injection (zero intrusion, AC-3.2)', () => {
    const r = resolve({
      settings: {},
      args: {},
    });
    expect(r.layer).toBe('inherit');
    expect(r.agentOptions).toBeUndefined();
    expect(r.reasoningEffort).toBeUndefined();
    expect(r.roleId).toBeUndefined();
    expect(r.persona).toBeUndefined();
    expect(r.toolFilter).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('call-layer empty strings are treated as unspecified (skip)', () => {
    const r = resolve({
      args: { provider: '', model: '', reasoningEffort: '', role: '' },
    });
    // falls back to role -> then default
    expect(r.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
    });
    expect(r.reasoningEffort).toBe('high');
    expect(r.layer).toBe('role');
    expect(r.warnings).toEqual([]);
  });

  it('nonexistent role => warning + degrade to default', () => {
    const r = resolve({
      args: { role: 'ghost' },
    });
    expect(r.roleId).toBeUndefined();
    expect(r.persona).toBeUndefined();
    expect(r.toolFilter).toBeUndefined();
    expect(r.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    });
    expect(r.layer).toBe('default');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('ghost');
    expect(r.warnings[0]).toContain('does not exist');
  });

  it('nonexistent role still lets call fields apply (degrade partially)', () => {
    const r = resolve({
      args: { role: 'ghost', provider: 'cli' },
    });
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'deepseek-chat' });
    expect(r.warnings).toHaveLength(1);
  });

  it('dangling defaultRole => warning + degrade to default layer', () => {
    const r = resolve({
      settings: baseSettings({ defaultRole: 'missing' }),
    });
    expect(r.layer).toBe('default');
    expect(r.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    });
    expect(r.persona).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('missing');
    expect(r.warnings[0]).toContain('does not exist');
  });

  it('explicit role wins over defaultRole (no double warning)', () => {
    const r = resolve({
      settings: baseSettings({ defaultRole: 'missing' }),
      args: { role: 'coder' },
    });
    expect(r.roleId).toBe('coder');
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.warnings).toEqual([]);
  });

  it('persona and toolFilter come ONLY from the role layer', () => {
    // default-level path (no role) yields neither
    const noRole = resolve({
      settings: { defaultProvider: 'x', defaultModel: 'y' },
    });
    expect(noRole.persona).toBeUndefined();
    expect(noRole.toolFilter).toBeUndefined();
    // role layer yields both
    const withRole = resolve({
      settings: {
        defaultProvider: 'x',
        defaultModel: 'y',
        roles: {
          coder: {
            displayName: 'Coder',
            description: 'Write code',
            persona: 'You are a careful engineer.',
            provider: 'opencode-go',
            model: 'deepseek-v4-flash',
            toolFilter: { allow: ['apply_patch'], deny: [] },
          },
        },
      },
      args: { role: 'coder' },
    });
    expect(withRole.persona).toBe('You are a careful engineer.');
    expect(withRole.toolFilter).toEqual({ allow: ['apply_patch'], deny: [] });
  });

  it('calling with a role still attaches its persona/toolFilter alongside call overrides', () => {
    const r = resolve({
      args: { role: 'coder', provider: 'cli', model: 'm' },
    });
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'm' });
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.toolFilter).toEqual({ allow: ['apply_patch'], deny: [] });
  });

  it('reasoningEffort resolves per-field across layers, as a separate field', () => {
    // call effort dominates
    const call = resolve({ args: { reasoningEffort: 'low' } });
    expect(call.reasoningEffort).toBe('low');
    // role effort fills when no call effort
    const role = resolve({ args: { role: 'coder', provider: '' } });
    expect(role.reasoningEffort).toBe('high');
    // default effort fills last
    const dflt = resolve({
      settings: baseSettings({ defaultReasoningEffort: 'medium', roles: {} }),
    });
    expect(dflt.reasoningEffort).toBe('medium');
  });

  it('reasoningEffort is not part of agentOptions', () => {
    const r = resolve({
      settings: { defaultModel: 'y', defaultReasoningEffort: 'max' },
    });
    expect(r.agentOptions).toEqual({ model: 'y' });
    expect(r.reasoningEffort).toBe('max');
  });

  it('role with no persona emits no persona field', () => {
    const r = resolve({
      settings: baseSettings({
        roles: { bare: { displayName: 'Bare', description: 'no persona' } },
      }),
      args: { role: 'bare' },
    });
    expect(r.roleId).toBe('bare');
    expect(r.persona).toBeUndefined();
    expect(r.toolFilter).toBeUndefined();
  });

  it('resolves a role by displayName when the id is not a key', () => {
    const r = resolve({ args: { role: 'Coder' } }); // displayName of the coder role
    expect(r.roleId).toBe('coder');
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.agentOptions).toEqual({ provider: 'opencode-go', model: 'deepseek-v4-flash' });
    expect(r.layer).toBe('role');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('resolved by displayName to id "coder"');
  });

  it('exact id wins over another role whose displayName equals that id', () => {
    const r = resolve({
      settings: baseSettings({
        roles: {
          writer: { displayName: 'Coder', description: 'Writes prose' },
          coder: { displayName: 'Writer', description: 'Writes code' },
        },
      }),
      args: { role: 'coder' },
    });
    expect(r.roleId).toBe('coder');
    expect(r.persona).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('ambiguous displayName picks the first role and warns', () => {
    const r = resolve({
      settings: baseSettings({
        roles: {
          first: { displayName: 'Same', description: 'first' },
          second: { displayName: 'Same', description: 'second' },
        },
      }),
      args: { role: 'Same' },
    });
    expect(r.roleId).toBe('first');
    expect(r.warnings.some((w) => w.includes('multiple roles share displayName "Same"'))).toBe(true);
  });
});

describe('resolveRoute toolFilter 空值语义（issue #2）', () => {
  it('不输出 dsh-settings 物化的空 toolFilter（{allow:[],deny:[]}）', () => {
    const r = resolveRoute({
      args: { role: 'coder' },
      settings: baseSettings({
        roles: {
          coder: {
            displayName: 'Coder',
            description: 'Write code',
            toolFilter: { allow: [], deny: [] },
          },
        },
      }),
    });
    expect(r.toolFilter).toBeUndefined();
    expect(r.roleId).toBe('coder');
  });

  it('不输出缺失 allow/deny 的空对象 toolFilter（{}）', () => {
    const r = resolveRoute({
      args: { role: 'coder' },
      settings: baseSettings({
        roles: {
          coder: { displayName: 'Coder', description: 'Write code', toolFilter: {} },
        },
      }),
    });
    expect(r.toolFilter).toBeUndefined();
  });

  it('仍输出非空 allow 的 toolFilter', () => {
    const r = resolveRoute({
      args: { role: 'coder' },
      settings: baseSettings({
        roles: {
          coder: {
            displayName: 'Coder',
            description: 'Write code',
            toolFilter: { allow: ['apply_patch'] },
          },
        },
      }),
    });
    expect(r.toolFilter).toEqual({ allow: ['apply_patch'] });
  });

  it('仍输出非空 deny 的 toolFilter', () => {
    const r = resolveRoute({
      args: { role: 'coder' },
      settings: baseSettings({
        roles: {
          coder: {
            displayName: 'Coder',
            description: 'Write code',
            toolFilter: { deny: ['bash'] },
          },
        },
      }),
    });
    expect(r.toolFilter).toEqual({ deny: ['bash'] });
  });
});

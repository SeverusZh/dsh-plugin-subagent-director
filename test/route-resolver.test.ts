/**
 * Unit tests for the four-layer route resolver (design section 6 test matrix).
 * Covers: four layers each supplying fields, per-field fall-through, call-layer
 * empty-string skip, nonexistent-role warnings + degrade, dangling defaultRole
 * warnings + degrade, persona/toolFilter role-layer-only output, and inherit
 * layer zero intrusion (AC-3.2).
 */
import { describe, it, expect } from 'vitest';
import { resolveRoute, isRouteAllowed, type RouteInput } from '../src/route-resolver.js';

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
    // the bound coder role contributes its resolved reasoningEffort alongside
    // the admitted route (alpha.4 AgentOptions)
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'claude', reasoningEffort: 'high' });
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
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'deepseek-v4-flash', reasoningEffort: 'high' });
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
    // falls back to role -> then default; the resolved role effort now rides
    // agentOptions because a route was resolved
    expect(r.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
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
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'm', reasoningEffort: 'high' });
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.toolFilter).toEqual({ allow: ['apply_patch'], deny: [] });
  });

  it('reasoningEffort resolves per-field across layers and rides agentOptions with a route', () => {
    // call effort dominates (isolated settings: no default role binding)
    const call = resolve({ settings: {}, args: { reasoningEffort: 'low' } });
    expect(call.reasoningEffort).toBe('low');
    // effort may be supplied alone: no route resolved, but the explicit call
    // effort still lands in agentOptions (alpha.4 AgentOptions supports it)
    expect(call.agentOptions).toEqual({ reasoningEffort: 'low' });
    expect(call.layer).toBe('call');
    // role effort fills when no call effort
    const role = resolve({ args: { role: 'coder', provider: '' } });
    expect(role.reasoningEffort).toBe('high');
    expect(role.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    });
    // default effort fills last
    const dflt = resolve({
      settings: baseSettings({ defaultReasoningEffort: 'medium', roles: {} }),
    });
    expect(dflt.reasoningEffort).toBe('medium');
    expect(dflt.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      reasoningEffort: 'medium',
    });
  });

  it('injects a resolved effort into agentOptions when a route resolves', () => {
    const r = resolve({
      settings: { defaultModel: 'y', defaultReasoningEffort: 'max' },
    });
    expect(r.agentOptions).toEqual({ model: 'y', reasoningEffort: 'max' });
    expect(r.reasoningEffort).toBe('max');
  });

  it('does NOT inject a role/default effort without a route or an explicit effort', () => {
    // default effort alone, no route -> nothing injected (effort is route-owned)
    const dflt = resolve({ settings: { defaultReasoningEffort: 'max' } });
    expect(dflt.agentOptions).toBeUndefined();
    expect(dflt.reasoningEffort).toBe('max');
    expect(dflt.layer).toBe('inherit');
    // role effort alone (role binds no route) -> nothing injected
    const role = resolve({
      settings: {
        roles: { thinker: { displayName: 'Thinker', description: 't', reasoningEffort: 'high' } },
      },
      args: { role: 'thinker' },
    });
    expect(role.agentOptions).toBeUndefined();
    expect(role.reasoningEffort).toBe('high');
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
    expect(r.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    });
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

describe('resolveRoute allowed-model constraint (subagent-model-selection)', () => {
  // The authorized list mirrors the official `subagent-model-selection`
  // namespace: exact provider/model pairs. baseSettings' coder role binds
  // opencode-go/deepseek-v4-flash and the defaults are
  // deepseek-official/deepseek-chat.
  const LIST = [
    { provider: 'cli', model: 'claude' },
    { provider: 'deepseek-official', model: 'deepseek-chat' },
  ];

  it('admits an explicit call pair that appears in the allowed list', () => {
    const r = resolve({ args: { provider: 'cli', model: 'claude' }, allowedRoutes: LIST });
    expect(r.agentOptions).toEqual({ provider: 'cli', model: 'claude', reasoningEffort: 'high' });
    expect(r.layer).toBe('call');
    expect(r.warnings).toEqual([]);
  });

  it('rejects an explicit call pair that is NOT in the allowed list (hard error)', () => {
    expect(() => resolve({ args: { provider: 'rogue', model: 'x' }, allowedRoutes: LIST })).toThrow(
      /subagent-director:.*not in the authorized model list/,
    );
  });

  it('rejects a partial explicit call (provider without model) when a list is configured', () => {
    expect(() => resolve({ args: { provider: 'cli' }, allowedRoutes: LIST })).toThrow(
      /subagent-director:.*supplied together/,
    );
    expect(() => resolve({ args: { model: 'claude' }, allowedRoutes: LIST })).toThrow(
      /subagent-director:.*supplied together/,
    );
  });

  it('drops an unlisted role-bound route with a warning, keeping persona/toolFilter', () => {
    // coder binds opencode-go/deepseek-v4-flash which is NOT in LIST -> the
    // route fields are dropped (inherit); persona/toolFilter survive.
    const r = resolve({ args: { role: 'coder' }, allowedRoutes: LIST });
    expect(r.agentOptions).toBeUndefined();
    expect(r.layer).toBe('inherit');
    expect(r.persona).toBe('You are a careful engineer.');
    expect(r.toolFilter).toEqual({ allow: ['apply_patch'], deny: [] });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('not in the authorized model list');
    expect(r.warnings[0]).toContain('opencode-go/deepseek-v4-flash');
  });

  it('drops an unlisted default-layer route with a warning', () => {
    // defaults deepseek-official/deepseek-chat are not in this list
    const r = resolve({
      settings: baseSettings({ roles: {}, defaultRole: undefined }),
      allowedRoutes: [{ provider: 'cli', model: 'claude' }],
    });
    expect(r.agentOptions).toBeUndefined();
    expect(r.layer).toBe('inherit');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('deepseek-official/deepseek-chat');
    expect(r.warnings[0]).toContain('not in the authorized model list');
  });

  it('admits a listed default-layer route without warnings', () => {
    const r = resolve({
      settings: baseSettings({ roles: {}, defaultRole: undefined }),
      allowedRoutes: LIST,
    });
    expect(r.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' });
    expect(r.layer).toBe('default');
    expect(r.warnings).toEqual([]);
  });

  it('admits a listed role-bound route without warnings', () => {
    const r = resolve({
      args: { role: 'coder' },
      allowedRoutes: [
        { provider: 'opencode-go', model: 'deepseek-v4-flash' },
        { provider: 'deepseek-official', model: 'deepseek-chat' },
      ],
    });
    expect(r.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    });
    expect(r.layer).toBe('role');
    expect(r.warnings).toEqual([]);
  });

  it('treats an empty allowedRoutes as no constraint (existing behavior)', () => {
    // partial explicit call is permitted again without an authorized list
    const r = resolve({ args: { provider: 'cli' }, allowedRoutes: [] });
    expect(r.agentOptions).toEqual({
      provider: 'cli',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    });
    expect(r.layer).toBe('call');
    expect(r.warnings).toEqual([]);
  });

  it('keeps effort-only resolution under a configured list (effort may be supplied alone)', () => {
    const r = resolve({ settings: {}, args: { reasoningEffort: 'low' }, allowedRoutes: LIST });
    expect(r.agentOptions).toEqual({ reasoningEffort: 'low' });
    expect(r.layer).toBe('call');
    expect(r.warnings).toEqual([]);
  });

  it('drops the route-owned effort together with a dropped role route', () => {
    // coder's route is unlisted; its effort is route-owned and must not leak
    const r = resolve({ args: { role: 'coder', provider: '' }, allowedRoutes: LIST });
    expect(r.agentOptions).toBeUndefined();
    expect(r.reasoningEffort).toBe('high'); // raw diagnostic mirror still resolves
    expect(r.warnings).toHaveLength(1);
  });
});

describe('isRouteAllowed', () => {
  const LIST = [{ provider: 'cli', model: 'claude' }];

  it('returns true without a list or with an empty list', () => {
    expect(isRouteAllowed({ provider: 'a', model: 'b' }, undefined)).toBe(true);
    expect(isRouteAllowed({ provider: 'a', model: 'b' }, [])).toBe(true);
  });

  it('returns true only for an exact listed pair', () => {
    expect(isRouteAllowed({ provider: 'cli', model: 'claude' }, LIST)).toBe(true);
    expect(isRouteAllowed({ provider: 'cli', model: 'other' }, LIST)).toBe(false);
    expect(isRouteAllowed({ provider: 'other', model: 'claude' }, LIST)).toBe(false);
  });

  it('returns false for a partial route when a list is configured', () => {
    expect(isRouteAllowed({ provider: 'cli' }, LIST)).toBe(false);
    expect(isRouteAllowed({ model: 'claude' }, LIST)).toBe(false);
    expect(isRouteAllowed({}, LIST)).toBe(false);
  });
});

# 角色按显示名解析 + 指引强化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `role` 参数可以按角色显示名解析到真实 id（模型传"基础开发工程师"也能命中 key `role`），并在系统提示里明确"按 id 引用角色"。

**Architecture:** 增强 `resolveRoute` 的角色查找（精确 id → displayName 别名 → 告警跳过）与 `renderRolesGuidance` 的首行指引；行为由纯函数承载，vitest 覆盖。

**Tech Stack:** TypeScript、vitest。

## Global Constraints

- 精确 id 永远优先于 displayName 匹配。
- 重名 displayName：取定义顺序第一个并告警。
- 未命中时维持现有"does not exist"告警与跳过绑定行为。
- 四级回退链、默认模型兜底 seam、config、profile 配置均不变。

---

### Task 1: `resolveRoute` 按 displayName 解析角色

**Files:**
- Modify: `src/route-resolver.ts`（角色查找分支）
- Test: `test/route-resolver.test.ts`

**Interfaces:**
- Consumes: `resolveRoute(input: RouteInput): RouteResult`（现有签名不变）。
- Produces: `RouteResult.roleId` 返回真实角色 key；warnings 新增两条可选提示：
  - `resolved by displayName to id "<id>" — prefer passing the id directly`
  - `multiple roles share displayName "<name>"; using id "<id>"`

- [ ] **Step 1: 写失败测试** — 在 `test/route-resolver.test.ts` 的 `describe('resolveRoute')` 末尾追加：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/route-resolver.test.ts`
Expected: FAIL — 新增用例中 `roleId` 为 `undefined`（`does not exist` 告警路径）。

- [ ] **Step 3: 最小实现** — 修改 `src/route-resolver.ts` 的角色查找分支：

```ts
  let role: RoleTemplate | undefined;
  let resolvedRoleId: string | undefined;
  if (roleIdRaw !== undefined) {
    const bound = roles[roleIdRaw];
    if (bound !== undefined) {
      role = bound;
      resolvedRoleId = roleIdRaw;
    } else {
      const byDisplay = Object.entries(roles).find(([, candidate]) => candidate?.displayName === roleIdRaw);
      if (byDisplay !== undefined) {
        role = byDisplay[1];
        resolvedRoleId = byDisplay[0];
        warnings.push(
          'subagent-director: role "' + roleIdRaw + '" is not an id; resolved by displayName to id "' + resolvedRoleId + '" — prefer passing the id directly',
        );
        const dupes = Object.entries(roles).filter(
          ([id, candidate]) => id !== resolvedRoleId && candidate?.displayName === roleIdRaw,
        );
        if (dupes.length > 0) {
          warnings.push(
            'subagent-director: multiple roles share displayName "' + roleIdRaw + '"; using id "' + resolvedRoleId + '"',
          );
        }
      } else {
        warnings.push(
          'subagent-director: role "' + roleIdRaw + '" does not exist; its binding (persona/provider/model) is skipped',
        );
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/route-resolver.test.ts`
Expected: PASS（原有用例 + 新增 3 个）。

- [ ] **Step 5: 提交**

```bash
git add src/route-resolver.ts test/route-resolver.test.ts
git commit -m "feat: role 参数支持按 displayName 解析到真实 id"
```

### Task 2: 角色指引强调按 id 引用

**Files:**
- Modify: `src/guidance.ts`（`renderRolesGuidance` 首行追加）
- Create: `test/guidance.test.ts`

**Interfaces:**
- Consumes: `renderRolesGuidance(settings, toolName): string`（现有签名不变）。
- Produces: 角色清单首行包含 id 引用说明。

- [ ] **Step 1: 写失败测试** — 创建 `test/guidance.test.ts`：

```ts
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
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/guidance.test.ts`
Expected: FAIL — 渲染文本不含 `Reference roles by their id`。

- [ ] **Step 3: 最小实现** — 修改 `src/guidance.ts` 的 `renderRolesGuidance`：

```ts
  const lines: string[] = [
    'Subagent Director roles — delegate one of these role-bound subagents when the task matches its description. Each role may bind a model; when it does, the subagent runs on that model route.',
    'Reference roles by their id (shown in the Delegate line), never by display name; when the user names a role by its display name, map it to that id.',
  ];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/guidance.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/guidance.ts test/guidance.test.ts
git commit -m "feat: 角色指引明确按 id 引用，不要用显示名"
```

### Task 3: README 与全量验证

**Files:**
- Modify: `README.md`（角色模板小节补充显示名解析说明）

- [ ] **Step 1: 更新 README** — 在「角色模板」小节末尾追加：

```markdown
`role` 参数支持用角色 id 或显示名引用：未命中 id 时会按 `displayName` 精确匹配
（多个同名角色取定义顺序第一个并提示）；建议始终用 id，见系统提示中的 Delegate 行。
```

- [ ] **Step 2: 全量验证**

Run: `npm test` → 全部 PASS；`npm run typecheck` → PASS；`npm run build` → 成功。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: 角色显示名解析说明"
```

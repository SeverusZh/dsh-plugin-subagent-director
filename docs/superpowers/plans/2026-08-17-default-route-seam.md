# 默认模型兜底（Default Route Seam）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件配置的 `defaultProvider`/`defaultModel` 对一切未显式指定模型的子代理启动自动生效（包括内置 `subagent`/`subagent_fork` 工具），实现"无感生效"。

**Architecture:** 在 `ctx.subagents.start` 与 `ctx.subagents.startContinuable` 两个入口上包一层 seam：当请求没有携带显式 `agentOptions` 时，把 settings 里的默认 provider/model 注入请求。纯规则放 `src/default-route.ts`，用可注入的 `isRoutable` 谓词保持可测；包装层返回 disposer，通过 `ctx.effect` 注册，插件卸载时恢复原方法。

**Tech Stack:** TypeScript、Cordis、@deepseek-ai/dsh-subagent、@deepseek-ai/dsh-agent、vitest。

## Global Constraints

- 不顶替内置工具名、不改角色指引、不动 `maxDepth`/persona/toolFilter 语义、不处理 `defaultReasoningEffort`。
- 显式 `agentOptions`（含部分字段）一律不被覆盖。
- 默认 provider 不可路由时回退继承，绝不抛错。
- 未配置默认模型时行为与现在完全一致（零侵入）。
- 新代码沿用仓库现有风格：ESM、`type` 导入、`.js` 后缀、纯函数优先、vitest `test/**/*.test.ts`。

---

### Task 1: `resolveSeamAgentOptions` 纯规则

**Files:**
- Create: `src/default-route.ts`
- Test: `test/default-route.test.ts`

**Interfaces:**
- Consumes: `SubagentDirectorSettings`（来自 `src/route-resolver.ts`）、`AgentOptions`（来自 `@deepseek-ai/dsh-agent`）。
- Produces:
  ```ts
  export function resolveSeamAgentOptions(input: {
    agentOptions?: AgentOptions;
    settings: SubagentDirectorSettings;
    isRoutable?: (provider: string) => boolean;
  }): Pick<AgentOptions, 'provider' | 'model'> | undefined;
  ```

- [ ] **Step 1: 写失败测试** — 在 `test/default-route.test.ts` 写入以下用例（先只测纯规则）：

```ts
import { describe, it, expect } from 'vitest';
import { resolveSeamAgentOptions } from '../src/default-route.js';

const defaults = { defaultProvider: 'opencode-go', defaultModel: 'mimo-v2.5' };

describe('resolveSeamAgentOptions', () => {
  it('不注入：请求已带显式 provider 和 model', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { provider: 'x', model: 'y' }, settings: defaults })).toBeUndefined();
  });

  it('不注入：请求带部分 agentOptions（只有 provider）', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { provider: 'x' }, settings: defaults })).toBeUndefined();
  });

  it('不注入：请求带部分 agentOptions（只有 model）', () => {
    expect(resolveSeamAgentOptions({ agentOptions: { model: 'y' }, settings: defaults })).toBeUndefined();
  });

  it('注入：无 agentOptions 且默认 provider/model 齐全', () => {
    expect(resolveSeamAgentOptions({ settings: defaults })).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('不注入：默认 provider 缺失', () => {
    expect(resolveSeamAgentOptions({ settings: { defaultModel: 'mimo-v2.5' } })).toBeUndefined();
  });

  it('不注入：默认 model 缺失', () => {
    expect(resolveSeamAgentOptions({ settings: { defaultProvider: 'opencode-go' } })).toBeUndefined();
  });

  it('不注入：默认 provider 不可路由', () => {
    expect(resolveSeamAgentOptions({ settings: defaults, isRoutable: () => false })).toBeUndefined();
  });

  it('注入：无 llm 服务（无法判断可路由性）时视为可路由', () => {
    expect(resolveSeamAgentOptions({ settings: defaults })).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/default-route.test.ts`
Expected: FAIL — `Cannot find module '../src/default-route.js'`（模块不存在）。

- [ ] **Step 3: 最小实现** — 创建 `src/default-route.ts`：

```ts
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { SubagentDirectorSettings } from './route-resolver.js';

export interface SeamResolveInput {
  agentOptions?: AgentOptions;
  settings: SubagentDirectorSettings;
  isRoutable?: (provider: string) => boolean;
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === '';
}

export function resolveSeamAgentOptions(input: SeamResolveInput): Pick<AgentOptions, 'provider' | 'model'> | undefined {
  const { agentOptions, settings, isRoutable } = input;
  if (agentOptions !== undefined && (agentOptions.provider !== undefined || agentOptions.model !== undefined)) {
    return undefined;
  }
  const provider = settings.defaultProvider;
  const model = settings.defaultModel;
  if (isEmpty(provider) || isEmpty(model)) return undefined;
  if (isRoutable !== undefined && !isRoutable(provider!)) return undefined;
  return { provider, model };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/default-route.test.ts`
Expected: PASS（8 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/default-route.ts test/default-route.test.ts
git commit -m "feat: 默认模型兜底——resolveSeamAgentOptions 纯规则"
```

### Task 2: `applyDefaultRouteSeam` 包装层

**Files:**
- Modify: `src/default-route.ts`
- Modify: `test/default-route.test.ts`

**Interfaces:**
- Consumes: `resolveSeamAgentOptions`（Task 1）、`SubagentStartRequest`/`ContinuableStartSpec`/`SubagentRun`/`ContinuableStart`（`@deepseek-ai/dsh-subagent`）。
- Produces:
  ```ts
  export interface SubagentsSeam {
    start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
    startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>;
  }
  export interface DefaultRouteSeamContext {
    get(name: string): unknown;
    logger: { info(message: string): void; warn(message: string): void };
    subagents: SubagentsSeam;
  }
  export function applyDefaultRouteSeam(
    ctx: DefaultRouteSeamContext,
    getSettings: () => SubagentDirectorSettings,
  ): () => void;
  ```

- [ ] **Step 1: 写失败测试** — 在 `test/default-route.test.ts` 追加：

```ts
import { applyDefaultRouteSeam } from '../src/default-route.js';

function makeHarness() {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const subagents = {
    start: async (name: string, request: unknown) => {
      calls.push({ kind: 'start', payload: { name, request } });
      return { id: 'run-1' };
    },
    startContinuable: async (spec: unknown) => {
      calls.push({ kind: 'startContinuable', payload: spec });
      return { childId: 'child-1' };
    },
  };
  const ctx = {
    subagents,
    get: (name: string) =>
      name === 'llm' ? { listProviders: () => [{ id: 'opencode-go' }] } : undefined,
    logger: { info: () => {}, warn: () => {} },
  };
  return { calls, subagents, ctx };
}

function baseRequest() {
  return { prompt: [], parent: {} as never, signal: new AbortController().signal };
}

describe('applyDefaultRouteSeam', () => {
  it('start：注入默认模型并透传', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.start('spawn', baseRequest());
    const call = h.calls[0].payload as { name: string; request: { agentOptions?: unknown } };
    expect(call.name).toBe('spawn');
    expect(call.request.agentOptions).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('start：显式 agentOptions 不被覆盖', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.start('spawn', { ...baseRequest(), agentOptions: { provider: 'x', model: 'y' } });
    const call = h.calls[0].payload as { request: { agentOptions?: unknown } };
    expect(call.request.agentOptions).toEqual({ provider: 'x', model: 'y' });
  });

  it('startContinuable：注入默认模型并透传', async () => {
    const h = makeHarness();
    applyDefaultRouteSeam(h.ctx as never, () => defaults);
    await h.subagents.startContinuable({
      provider: 'fork',
      label: 'job',
      request: baseRequest(),
      signal: new AbortController().signal,
    });
    const spec = h.calls[0].payload as { request: { agentOptions?: unknown } };
    expect(spec.request.agentOptions).toEqual({ provider: 'opencode-go', model: 'mimo-v2.5' });
  });

  it('dispose 恢复原始方法', async () => {
    const h = makeHarness();
    const originalStart = h.subagents.start;
    const originalContinuable = h.subagents.startContinuable;
    const dispose = applyDefaultRouteSeam(h.ctx as never, () => defaults);
    expect(h.subagents.start).not.toBe(originalStart);
    dispose();
    expect(h.subagents.start).toBe(originalStart);
    expect(h.subagents.startContinuable).toBe(originalContinuable);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/default-route.test.ts`
Expected: FAIL — `applyDefaultRouteSeam is not a function`。

- [ ] **Step 3: 最小实现** — 在 `src/default-route.ts` 追加：

```ts
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent';

export interface SubagentsSeam {
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
  startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>;
}

export interface DefaultRouteSeamContext {
  get(name: string): unknown;
  logger: { info(message: string): void; warn(message: string): void };
  subagents: SubagentsSeam;
}

function makeIsRoutable(ctx: DefaultRouteSeamContext): ((provider: string) => boolean) | undefined {
  const llm = ctx.get('llm') as { listProviders(): Array<{ id: string }> } | undefined;
  if (llm === undefined) return undefined;
  return (provider: string) => llm.listProviders().some((entry) => entry.id === provider);
}

export function applyDefaultRouteSeam(
  ctx: DefaultRouteSeamContext,
  getSettings: () => SubagentDirectorSettings,
): () => void {
  const subagents = ctx.subagents;
  const originalStart = subagents.start.bind(subagents);
  const originalStartContinuable = subagents.startContinuable.bind(subagents);
  const isRoutable = makeIsRoutable(ctx);

  const resolve = (request: SubagentStartRequest) =>
    resolveSeamAgentOptions({ agentOptions: request.agentOptions, settings: getSettings(), isRoutable });

  subagents.start = (name, request) => {
    const agentOptions = resolve(request);
    if (agentOptions !== undefined) {
      ctx.logger.info(
        `[subagent-director] default route seam: applying ${agentOptions.provider}/${agentOptions.model} to ${name} subagent`,
      );
      return originalStart(name, { ...request, agentOptions });
    }
    return originalStart(name, request);
  };

  subagents.startContinuable = (spec) => {
    const agentOptions = resolve(spec.request);
    if (agentOptions !== undefined) {
      ctx.logger.info(
        `[subagent-director] default route seam: applying ${agentOptions.provider}/${agentOptions.model} to continuable subagent`,
      );
      return originalStartContinuable({ ...spec, request: { ...spec.request, agentOptions } });
    }
    return originalStartContinuable(spec);
  };

  return () => {
    subagents.start = originalStart;
    subagents.startContinuable = originalStartContinuable;
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/default-route.test.ts`
Expected: PASS（Task 1 的 8 个 + Task 2 的 4 个）。

- [ ] **Step 5: 提交**

```bash
git add src/default-route.ts test/default-route.test.ts
git commit -m "feat: 默认模型兜底——applyDefaultRouteSeam 包装层"
```

### Task 3: 接入 `apply()` 与配置开关

**Files:**
- Modify: `src/index.ts`（`apply()` 内接线）
- Modify: `src/config.ts`（`DirectorConfig` + `Config` schema）
- Modify: `test/default-route.test.ts`（追加配置默认值用例）

**Interfaces:**
- Consumes: `applyDefaultRouteSeam`（Task 2）、`DirectorConfig`。
- Produces: 配置字段 `applyDefaultRoute?: boolean`（schemastery 默认 `true`）。

- [ ] **Step 1: 写失败测试** — 在 `test/default-route.test.ts` 追加：

```ts
import { Config } from '../src/config.js';

describe('Config', () => {
  it('applyDefaultRoute 默认开启', () => {
    expect(Config.validate({}).applyDefaultRoute).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/default-route.test.ts`
Expected: FAIL — `applyDefaultRoute` 不存在（`Config.validate({}).applyDefaultRoute` 为 `undefined`）。

- [ ] **Step 3: 最小实现**

`src/config.ts` — 在 `DirectorConfig` 接口与 `Config` schema 中追加：

```ts
  /**
   * 是否把 settings 里的默认 provider/model 应用到所有未显式指定模型的
   * 子代理启动（含内置 subagent/subagent_fork）。默认 true；未配置默认
   * 模型时为空操作。false 时仅 subagent_role 的解析链生效。
   */
  applyDefaultRoute?: boolean;
```

```ts
  applyDefaultRoute: z.boolean().default(true),
```

`src/index.ts` — 在 `const getSettings = ...` 之后追加：

```ts
  // ---- default route seam ------------------------------------------------
  // 把 settings 里的默认 provider/model 应用到一切未显式指定模型的子代理
  // 启动（内置 subagent/subagent_fork 等），实现"无感生效"；卸载时由
  // ctx.effect 恢复被包装的原方法。
  if (config.applyDefaultRoute !== false) {
    ctx.effect(() => applyDefaultRouteSeam(ctx, getSettings), 'subagent-director:default-route-seam');
  }
```

并在文件顶部 import：

```ts
import { applyDefaultRouteSeam } from './default-route.js';
```

- [ ] **Step 4: 跑测试与类型检查确认通过**

Run: `npm test -- test/default-route.test.ts`
Expected: PASS（13 个用例）。

Run: `npm run typecheck`
Expected: PASS，无错误。

- [ ] **Step 5: 提交**

```bash
git add src/config.ts src/index.ts test/default-route.test.ts
git commit -m "feat: 默认模型兜底——接入 apply() 与 applyDefaultRoute 配置开关"
```

### Task 4: 文档与全量验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README**

在「特性」列表追加：

```markdown
- **默认模型兜底** —— 配置 `defaultProvider`/`defaultModel` 后，即使模型调用内置
  `subagent`/`subagent_fork` 工具，未显式指定模型的子代理也会自动使用该模型
  （`applyDefaultRoute`，默认开启；未配置默认模型时为零侵入空操作）；
```

在「配置（cordis.patch.yml，可选）」的 config 示例中追加：

```yaml
    applyDefaultRoute: true      # 默认 true：把默认模型应用到所有未显式指定模型的子代理
```

更新 FAQ「未配置任何角色时行为如何」：

```markdown
未配置任何角色且未配置默认模型时与未安装本插件完全一致（零侵入）。配置了
`defaultProvider`/`defaultModel` 且未关闭 `applyDefaultRoute` 时，所有未显式
指定模型的子代理（含内置工具发起的）都会使用该默认模型。
```

- [ ] **Step 2: 全量验证**

Run: `npm test`
Expected: 全部 PASS（含原有 129 用例 + 新增 13 用例）。

Run: `npm run typecheck`
Expected: PASS。

Run: `npm run build`
Expected: 构建成功（`lib/` 更新）。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: 默认模型兜底特性说明与 applyDefaultRoute 配置文档"
```

### Task 5: 回归检查（可选但推荐）

- [ ] **Step 1: 核对会话级效果**

重启 DSH 后发起一次内置 `subagent` 委派，确认子代理 `subagent/descriptor` 的
`agentProvider`/`agentModel` 等于配置的默认值（沿用本次诊断的解帧脚本）。

- [ ] **Step 2: 收尾确认**

`git status` 干净；`git log --oneline -5` 展示 4 个新提交。

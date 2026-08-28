# 关闭 continuable 子代理 + 可观测性打通 + 空 toolFilter 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三件事一次交付：
1. **Issue #1（功能请求）**：新增模型可见工具 `close_subagent(subagent_id)`（主代理可结束子代理可持续状态）；子代理会话页面（header action 区）新增"终止可持续状态"按钮（用户侧手动释放）。
2. **可观测性（README 标注"暂不可用"）**：打通真实数据链路——DSH 运行时不在 assistant 消息上填充 `provenance`/`requestConfig`（已实测验证），改从会话 `request/header` 事件读取实际运行的 provider/model，让 composer.dock 读数真实可用。
3. **Issue #2（bug）**：未配置 toolFilter 的角色经 dsh-settings 物化为 `{allow:[],deny:[]}` 后清空子代理工具（tools=0）。修复为空 toolFilter 视为未配置。

**Architecture:**
- Host 侧新增 `close_subagent` 工具（不依赖 transport provider，直接 `ctx.subagents.drainContinuableChildren`，与 `dsh-tool-subagent-control` 的全局工具同哲学）。
- 复用自发布 `/subagent-director` webServer 桥（src/remote.ts）新增两个端点：`subagentClose`（按 parentSessionId 定位 live Agent 后 drain）与 `subagentModel`（按 sessionId 读 `request/header` 事件的 config）。
- Client 侧：`conversation.session.header.actions` 新增"终止可持续状态"按钮（标准 kit 的 `useSession`/`sessionId`）；`conversation.composer.dock` 的 SubagentModelDock 增加 RPC 数据源（快照内 provenance 快速路径保留，缺失时 RPC 查询）。
- Issue #2：`route-resolver.ts` 用 `hasToolFilter`（allow/deny 至少一个非空）判定；`settings.ts` schema 让空对象不物化。

**Tech Stack:** TypeScript、vitest、React 18、rolldown（client bundle）。

**Baseline/Authority Refs:**
- GitHub issue #1（用户预定方案：UI 按钮 + 主代理工具）+ issue #1 评论（仓库作者：新增 `close_subagent(subagent_id)`，内部调 `drainContinuableChildren`，peer 下限提到含 drain 的版本）。
- GitHub issue #2（根因链与建议修复）。
- DSH 核心（实测）：
  - `ctx.subagents.drainContinuableChildren(parent, childIds)` 存在于 `dsh-subagent@0.1.0-rc.8`（仓库 node_modules 已装）与 `0.1.1-rc.2`（本机 DSH）；要求 parent 是精确 live Agent，非直接子代理抛 `UNAUTHORIZED`，非驻留目标是 no-op。
  - `ctx.agents.get(sessionId)` 按 id 查 live Agent（dsh-agent lib/types/index.d.ts:349）。
  - `request/header` 会话事件携带 `data.header.config.{provider,model}`（dsh-agent-loop 实测），`ctx.sessionQuery.readSession(sessionId)` 返回完整事件日志（live-preferred）。
  - client slot 契约（dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts）：`conversation.session.header.actions` owner 为空、标准 kit 提供 `useSession`/`sessionId`/`useProjection`（dsh-client-runtime slots.d.ts）；`conversation.composer.dock` owner 为 `InputZone { session, input }`。
  - `ConversationSnapshot.subagent.address = { parentSessionId, childSessionId, mode }`（mode: 'one-shot' | 'continuable'）。
  - 实测 `assistant/message` 事件不携带 provider/model；`AssistantMessageNode.provenance/requestConfig` 在 rc.2/rc.8 无运行时填充（grep 全包无构造点 + 真实会话日志验证）。

**Compatibility Boundary:**
- 现有 `subagent_role` 参数/输出 schema、四级回退链、默认模型 seam、settings 命名空间 wire 形状均不变。
- 桥的新端点只增不改：`settingsView`/`settingsMutate` 行为逐字节不变；未知端点仍抛 500。
- `close_subagent` 与 UI 按钮仅在目标为调用者/地址的**直接** continuable 子代理时释放；普通/one-shot 会话按钮不显示；工具对非驻留目标是 no-op（与核心语义一致）。
- Client 插件保持 `inject = ['slots','locale','connection','remote']` 不变。
- peer 依赖：`@deepseek-ai/dsh-subagent` 下限从 `^0.1.0-rc.6` 提到 `^0.1.0-rc.8`（drain API 存在的最低已确认线）；其余包不变。

**TDD Route:**
- Mode: off
- Decision: skipped（无显式 strict 要求）
- Strict authority: not applicable
- Test posture: 纯函数单测先行 + 后置回归（vitest 全量 + build）
- Reason: 项目测试风格为"纯逻辑抽函数 + 单元测试"（见现有 150 用例），不引入 RED/GREEN 仪式。
- Verification: `npm test`（150+ 新用例全绿）、`npm run build`、`npm run typecheck`。

---

### Task 1: `resolveRoute` 过滤空 toolFilter（Issue #2 根因 1/2）

**Files:**
- Modify: `src/route-resolver.ts`（导出 `hasToolFilter` 并在 role 层判定处使用）
- Test: `test/route-resolver.test.ts`

**Why:** 未配置 toolFilter 的角色经 dsh-settings 物化为 `{allow:[],deny:[]}`，`role.toolFilter !== undefined` 误判为已配置 → 空 filter 写入 request → `tools.restrict({allow:[],deny:[]})` 清空子代理全部工具（tools=0，"只执行一步"假象）。

**Change Necessity:** 行为 bug，必须改代码；最小边界是 route-resolver 的 role 层判定 + settings schema（Task 2）。

**Interfaces:**
- Consumes: `resolveRoute(input)` 签名不变。
- Produces: 新导出 `hasToolFilter(f?: RouteToolFilter): boolean`；`RouteResult.toolFilter` 仅在 allow/deny 至少一个非空时出现。

**Verification:** `npx vitest run test/route-resolver.test.ts`；全量 `npm test`。

- [ ] **Step 1: 写失败测试** — 在 `test/route-resolver.test.ts` 追加：

```ts
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
```

- [ ] **Step 2: 实现** — `src/route-resolver.ts`：

```ts
/** Whether a tool filter actually restricts anything (empty allow/deny = unset). */
export function hasToolFilter(filter: RouteToolFilter | undefined): boolean {
  return filter !== undefined && ((filter.allow?.length ?? 0) > 0 || (filter.deny?.length ?? 0) > 0);
}
```

第 216 行改为：

```ts
...(role !== undefined && hasToolFilter(role.toolFilter) ? { toolFilter: role.toolFilter } : {}),
```

- [ ] **Step 3: 验证** — `npx vitest run test/route-resolver.test.ts` 全绿（新增 4 用例通过，原有用例不变）。

---

### Task 2: `RoleTemplateSchema.toolFilter` 不物化空对象（Issue #2 根因 2/2）

**Files:**
- Modify: `src/settings.ts`
- Test: `test/settings-schema.test.ts`

**Why:** dsh-settings 解析时把缺失的 `toolFilter` 物化为 `{allow:[],deny:[]}`（issue #2 实测 `SettingsSchema({roles:{x:{displayName:'X'}}})` → `roles.x.toolFilter = {allow:[],deny:[]}`）。Task 1 已做运行时防御；此任务在 schema 层让未配置字段不物化，双保险并贴合用户建议。

**Verification:** `npx vitest run test/settings-schema.test.ts`。

- [ ] **Step 1: 写失败测试** — 先读 `test/settings-schema.test.ts` 现有风格，追加：

```ts
it('role without toolFilter does not materialize an empty toolFilter object (issue #2)', () => {
  const resolved = SettingsSchema({ roles: { observer: { displayName: '观察者', description: '测试' } } });
  expect(resolved.roles.observer.toolFilter).toBeUndefined();
});
```

- [ ] **Step 2: 实现** — `src/settings.ts`：

```ts
toolFilter: z
  .object({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  })
  .optional(),
```

- [ ] **Step 3: 验证** — `npx vitest run test/settings-schema.test.ts` 全绿。若 schemastery 对 `.optional()` 仍物化空对象，改用 `z.object({...}).default(undefined)` 并在此记录实际行为。

---

### Task 3: `close_subagent` 模型可见工具（Issue #1 方案 2）

**Files:**
- Create: `src/close-tool.ts`
- Modify: `src/index.ts`（注册 + 导出）
- Test: `test/close-tool.test.ts`（新增）

**Why:** 主代理需要主动释放"已完成但仍驻留"的 continuable 子代理；核心已有 `drainContinuableChildren` 但没有模型可见工具（issue #1）。

**Change Necessity:** 新能力必须新增代码路径；最小边界是一个独立工具模块 + 主条目注册（与 provider 无关，apply 时直接注册，dsh-tool-subagent-control 同哲学：无条件注册，非 continuable 环境是安全 no-op）。

**Interfaces:**
- 工具名：`close_subagent`（固定名，与 issue 建议一致）。
- 参数：`subagent_id: string`（required，描述引用 `send_message` 返回的 durable id）。
- 输出：`{ closed: boolean }`；render：`closed subagent <id>`。
- execute：`parent = exec.agent`（必填校验）；`await ctx.subagents.drainContinuableChildren(parent, [SessionId(subagent_id)])`；抛错透传（含核心 `UNAUTHORIZED` 消息）。drain 对非驻留目标 no-op → 仍返回 `{closed:true}`（描述中说明语义）。
- 导出：`createCloseSubagentTool`、`CLOSE_SUBAGENT_TOOL_NAME`、schema/参数/输出构造纯函数供测试。

**Verification:** `npx vitest run test/close-tool.test.ts`；`npm run typecheck`。

- [ ] **Step 1: 实现 `src/close-tool.ts`** — 完整代码：

```ts
/**
 * close_subagent — release one resident continuable subagent (issue #1).
 *
 * Model-facing counterpart of dsh-tool-subagent-control's send_message /
 * interrupt_agent: the calling agent (exec.agent) authorizes release of its
 * OWN direct continuable child through ctx.subagents.drainContinuableChildren,
 * which throws UNAUTHORIZED when the target is not a direct child of the
 * caller and treats absent/non-resident targets as a no-op. The tool is
 * registered unconditionally (like the control tools); on a deployment
 * without continuable children it is a safe no-op.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';

/** Stable tool name (fixed, mirroring send_message / interrupt_agent). */
export const CLOSE_SUBAGENT_TOOL_NAME = 'close_subagent';

const ERROR_PREFIX = 'subagent-director:';

/** Model-facing arguments of close_subagent. */
export interface CloseSubagentArgs {
  /** Durable child id returned by a continuable delegation (subagent_role). */
  subagent_id: string;
}

/** Parameter schema (pure, exposed for tests). */
export function createCloseSubagentParameters(): ParameterSchemaSpec {
  return {
    subagent_id: {
      type: 'string',
      required: true,
      description:
        'The durable subagent id returned when the background subagent was started (continuable mode). Releases the resident child so the parent no longer holds its handle.',
    },
  };
}

/** Output schema (pure, exposed for tests). */
export function createCloseSubagentOutputSchema(): ValueSchemaSpec {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      closed: { type: 'boolean', required: true },
    },
  };
}

/** Create the close_subagent ToolDefinition bound to one context. */
export function createCloseSubagentTool(options: { ctx: Context }) {
  const { ctx } = options;
  return defineTool({
    name: CLOSE_SUBAGENT_TOOL_NAME,
    description:
      'Close/release one resident continuable subagent by its durable id: the continuation manager stops holding its AgentHandle, freeing memory and session context. The target must be a direct child of the calling agent; a non-resident or already-finished target is an accepted no-op. Pairs with send_message (continue) and interrupt_agent (stop one turn) to complete the lifecycle.',
    parameters: createCloseSubagentParameters(),
    output: {
      schema: createCloseSubagentOutputSchema(),
      render: (args, _value) => [{ type: 'text', text: `closed subagent ${args.subagent_id}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args: CloseSubagentArgs, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error(`${ERROR_PREFIX} close_subagent requires a calling agent (exec.agent was undefined)`);
      await ctx.subagents.drainContinuableChildren(parent, [SessionId(args.subagent_id)]);
      return { closed: true };
    },
  });
}
```

- [ ] **Step 2: 注册与导出** — `src/index.ts`：
  - 顶部 `import { createCloseSubagentTool, CLOSE_SUBAGENT_TOOL_NAME } from './close-tool.js';`
  - `apply` 中（在 `applyGuidance` 之后、delegation mount 逻辑之前）：

```ts
  // close_subagent is provider-independent (drain is a global subagents
  // operation), so it registers at mount time like the control tools.
  const disposeClose = ctx.tools.register(createCloseSubagentTool({ ctx }));
  ctx.effect(() => disposeClose, 'subagent-director: close_subagent tool');
```

  - 导出区追加：`export { CLOSE_SUBAGENT_TOOL_NAME, createCloseSubagentTool } from './close-tool.js';`

- [ ] **Step 3: 测试 `test/close-tool.test.ts`** — 断言参数 schema（`subagent_id` required string）、输出 schema（`closed` required boolean）、工具名/描述关键字；用假 `ctx`（`{ subagents: { drainContinuableChildren: vi.fn() } }`）执行 execute：调用参数为 `[parent, [SessionId(id)]]`；`exec.agent` 缺失时抛错。参考 `test/tool-schema.test.ts` 的纯断言风格。

- [ ] **Step 4: 验证** — `npx vitest run test/close-tool.test.ts` + `npm run typecheck`。

---

### Task 4: 桥接通道扩展 `subagentClose` / `subagentModel` 端点

**Files:**
- Modify: `src/bridge-contract.ts`（端点常量 + 请求/响应类型）
- Modify: `src/remote.ts`（端点处理：drain 与 request/header 查询 + 错误映射）
- Modify: `src/bridge-entry.ts`（inject 增加 `agents`、`subagents`）
- Test: `test/remote-bridge.test.ts`（扩展）

**Why:** UI 按钮与可观测性读数需要 Client→Host 调用；现有 `/subagent-director` 桥已有 webServer 前缀路由与 RPC 信封，扩展成本最低、不碰 apiproxy 白名单。

**Change Necessity:** 新端点属于新代码路径（桥 handler 的 dispatch 分支 + 纯辅助函数）。

**Interfaces:**
- `SUBAGENT_DIRECTOR_RPC_CLOSE = 'subagentClose'`：payload `{ parentSessionId: string, childSessionId: string }` → `RpcResult<{ closed: true }>`；错误码：`subagent-parent-not-live`（parent agent 不在线）、`subagent-close-rejected`（drain 抛错，透传 message）。
- `SUBAGENT_DIRECTOR_RPC_MODEL = 'subagentModel'`：payload `{ sessionId: string }` → `RpcResult<{ found: true; provider: string; model: string } | { found: false }>`；错误码 `subagent-model-unavailable`（sessionQuery 服务缺失）。
- 纯辅助函数（可单测）：
  - `latestRequestHeaderModel(events: readonly unknown[]): { provider: string; model: string } | undefined` — 从后往前找 `type === 'request/header'` 的事件，读 `data.header.config.provider/model`（字符串非空）。
  - `drainChild(parent: unknown, childId: string, drain: (p, ids) => Promise<void>)` 薄封装（错误映射）。
- bridge-entry inject：`['webServer', 'settings', 'agents', 'subagents']`（agents/subagents 是 dsh-base 级服务，web profile 必在；headless 因无 webServer 不激活，无影响）。

**Verification:** `npx vitest run test/remote-bridge.test.ts`；`npm run typecheck`。

- [ ] **Step 1: `bridge-contract.ts`** 追加：

```ts
/** Endpoint that releases one resident continuable child of a live parent. */
export const SUBAGENT_DIRECTOR_RPC_CLOSE = 'subagentClose';
/** Endpoint that returns the actual provider/model of one child session. */
export const SUBAGENT_DIRECTOR_RPC_MODEL = 'subagentModel';

/** Request payload for the subagentClose bridge endpoint. */
export interface DirectorCloseRequest {
  parentSessionId: string;
  childSessionId: string;
}

/** Request payload for the subagentModel bridge endpoint. */
export interface DirectorModelRequest {
  sessionId: string;
}

/** Successful subagentModel bridge response. */
export type DirectorModelSuccess = { found: true; provider: string; model: string } | { found: false };
```

- [ ] **Step 2: `remote.ts`** 追加纯辅助 + dispatch 分支：
  - `latestRequestHeaderModel`（实现见 Interfaces）。
  - `dispatchBridgeEndpoint` 增加两个分支；`subagentClose` 分支：

```ts
if (endpoint === SUBAGENT_DIRECTOR_RPC_CLOSE) {
  const request = payload as DirectorCloseRequest | null;
  if (request === null || typeof request.parentSessionId !== 'string' || typeof request.childSessionId !== 'string') {
    return { ok: false, error: { code: 'bad-request', message: 'subagentClose: expected { parentSessionId, childSessionId }', details: {} } };
  }
  const parent = ctx.get('agents')?.get(SessionId(request.parentSessionId));
  if (parent === undefined) {
    return { ok: false, error: { code: 'subagent-parent-not-live', message: 'parent agent ' + request.parentSessionId + ' is not live; its continuable children are released with it', details: {} } };
  }
  try {
    await ctx.get('subagents')!.drainContinuableChildren(parent, [SessionId(request.childSessionId)]);
  } catch (error) {
    return { ok: false, error: { code: 'subagent-close-rejected', message: error instanceof Error ? error.message : String(error), details: {} } };
  }
  return { ok: true, value: { closed: true as const } };
}
```

  注意：`installDirectorRemoteBridge(ctx)` 目前签名 `(ctx)`，handler 闭包内拿 `ctx`；`dispatchBridgeEndpoint` 需要接收 `ctx` 或注入的 `agents/subagents`。**实现时把 `dispatchBridgeEndpoint` 改为接收一个 `BridgeDeps { settings, agents?, subagents?, sessionQuery? }` 结构**，保持纯函数可测；`installDirectorRemoteBridge` 用 `ctx.get('agents')` / `ctx.get('subagents')` / `ctx.get('sessionQuery')` 组装 deps（保持 lazy 获取，兼容 headless 与桥缺失场景；agents/subagents 同时加入 bridge-entry inject 保证解析序）。
  - `subagentModel` 分支：`sessionQuery.readSession(SessionId(sessionId))` → `latestRequestHeaderModel(log.events)` → `{found:true,...}` 或 `{found:false}`；sessionQuery 缺失 → `{ok:false, error:{code:'subagent-model-unavailable',...}}`。
- [ ] **Step 3: `bridge-entry.ts`**：`inject = ['webServer', 'settings', 'agents', 'subagents']`。
- [ ] **Step 4: 测试扩展** `test/remote-bridge.test.ts`：
  - `latestRequestHeaderModel`：找到最后一条 request/header 的 config；无事件/无 config/非字符串 → undefined。
  - `subagentClose` 纯路径：parent 在线（假 agents.get）+ drain 被调且参数正确；parent 不在线 → `subagent-parent-not-live`；drain 抛错 → `subagent-close-rejected`。
  - `subagentModel` 纯路径：sessionQuery 返回带 request/header 的日志 → `{found:true}`；无 → `{found:false}`；sessionQuery 缺失 → 错误。
- [ ] **Step 5: 验证** — `npx vitest run test/remote-bridge.test.ts` + `npm run typecheck`。

---

### Task 5: 可观测性 dock 打通（composer.dock 真实读数）

**Files:**
- Modify: `src/client/SubagentModelDock.tsx`（RPC 数据源 + 状态）
- Modify: `src/client/index.ts`（dock 注册加 `inject` 提供 `rpc`）
- Modify: `src/client/locales.ts`（新增 key：`modelQueryFailed`）
- Test: `test/subagent-model.test.ts`（扩展：RPC 结果归并纯逻辑）

**Why:** 快照内 `provenance/requestConfig` 在 rc.2/rc.8 从不填充（实测），dock 永远显示降级文案。改从 Host 的 `request/header` 事件查询实际 provider/model。

**Change Necessity:** 数据链路不通，必须新增 RPC 查询路径；保留纯逻辑快速路径（核心未来填充后零成本生效）。

**Interfaces:**
- 新纯函数（subagent-model.ts）：`mergeModelLookup(local: SubagentModelLookup, remote: SubagentModelLookup): SubagentModelLookup` — local `found:true` 优先，否则 remote；两者都 `found:false` → `{found:false}`。
- dock 组件逻辑：
  - `isAddressedSubagent(session)` 为假 → 渲染 null（不变）。
  - `latestSubagentModel(session)` found → 直接显示（不变，零 RPC）。
  - 否则：若 `session.subagent.address.mode === 'continuable'`（或任何 addressed 子代理）→ 发起 RPC `subagentModel({ sessionId: address.childSessionId })`；结果缓存到 ref（按 sessionId），成功后显示 `provider/model`；失败显示 `modelQueryFailed` 短文案（或保持 `modelNotRecorded`）。
  - 用 `useState`/`useEffect`（React 18，无 CSS pipeline）；`useEffect` deps：`session?.sessionId` + 快照中最后 assistant seq（`session.nodes` 尾部的 seq）——新 assistant 消息后重查（幂等：命中缓存直接显示）。
- 注册：`ctx.slots.inject('conversation.composer.dock', ...)` 的 register 加 `inject: () => ({ rpc: connection.rpc })`；组件 props 类型加 `SubagentModelDockInjected`。

**Verification:** `npx vitest run test/subagent-model.test.ts`；`npm run build`（client bundle 编译通过）。

- [ ] **Step 1: 纯逻辑** — `src/client/subagent-model.ts` 追加 `mergeModelLookup`；`test/subagent-model.test.ts` 补 3 用例（local 优先、remote 兜底、双 not-found）。
- [ ] **Step 2: 组件改造** — `SubagentModelDock.tsx`（完整代码见实现；核心：RPC 查询 + 缓存 + 加载/失败态）。
- [ ] **Step 3: 注册 inject** — `src/client/index.ts`。
- [ ] **Step 4: locales** — 新增 `modelQueryFailed`（en: "Subagent model unavailable" / zh: "暂时无法获取子代理模型"）；`SubagentDirectorKey` 加 key。
- [ ] **Step 5: 验证** — `npm run build` + `npm test`。

---

### Task 6: 子代理页面"终止可持续状态"按钮（header.actions）

**Files:**
- Create: `src/client/SubagentCloseAction.tsx`
- Modify: `src/client/index.ts`（注册 `conversation.session.header.actions`）
- Modify: `src/client/locales.ts`（按钮/状态/错误文案）
- Test: `test/subagent-close-action.test.ts`（新增，纯逻辑部分）

**Why:** 用户预定方案 1：子代理页面可手动终止可持续状态。`conversation.session.header.actions` 是官方 additive per-session 操作座位（owner 空，标准 kit 提供 `useSession`/`sessionId`），只在"当前会话是 continuable 子代理"时显示按钮。

**Change Necessity:** 新 UI 能力，必须新增组件 + 注册 + RPC 调用。

**Interfaces:**
- 纯判断（组件内/可测）：`isContinuableChild(snapshot): boolean` — `snapshot.subagent?.address.mode === 'continuable'`（放 subagent-model.ts 或新 close-logic.ts，可单测）。
- 组件 `SubagentCloseAction`：
  - props：`PropsRuntime<'conversation.session.header.actions'>`（含 `useSession`/`sessionId`）+ `PropsLocale` + inject `{ rpc }`。
  - `useSession()` → snapshot；`isContinuableChild` 为假 → 渲染 null（普通会话/one-shot 子代理无按钮）。
  - 按钮（danger 风格，复用 ui.ts token）：点击 → 确认（`window.confirm` 不可用？browser 环境可用）→ RPC `subagentClose({ parentSessionId: address.parentSessionId, childSessionId: address.childSessionId })` → 成功：按钮转 disabled + 文案 `closedSubagent`；失败：显示错误文案 `closeFailed`（含 message）。
  - 会话切换后状态重置（`sessionId` 变化）。
- 注册：`ctx.slots.inject('conversation.session.header.actions', ...)`，id `subagent-director-close`，order 20，`inject: () => ({ rpc: connection.rpc })`。

**Verification:** `npm run build`；`npm test`。

- [ ] **Step 1: 纯判断 + 测试** — `src/client/subagent-model.ts` 追加 `isContinuableChild`；测试补用例（mode continuable → true；one-shot → false；subagent null → false）。
- [ ] **Step 2: 组件** — `src/client/SubagentCloseAction.tsx`（完整实现，样式复用 ui.ts token）。
- [ ] **Step 3: 注册 + locales** — `src/client/index.ts` + `locales.ts`（新增：`closeContinuable` / `closingContinuable` / `closedSubagent` / `closeFailed`，中英双语）。
- [ ] **Step 4: 验证** — `npm run build` + `npm test`。

---

### Task 7: 文档与发布元数据

**Files:**
- Modify: `README.md`（特性列表：可观测性移除"暂不可用"标注并描述真实读数；新增 close_subagent 工具与 UI 按钮说明；FAQ/快速开始若有相关段落同步）
- Modify: `CHANGELOG.md`（0.3.0 条目）
- Modify: `package.json`（version 0.3.0；`@deepseek-ai/dsh-subagent` peer 下限 `^0.1.0-rc.8`）

**Verification:** `npm install`（peer 解析仍为已装 rc.8，无 diff 或仅 lock 微调）→ `npm test` + `npm run build` + `npm run typecheck`。

- [ ] **Step 1**: README 更新（中文特性段 + English 段若存在同步）。
- [ ] **Step 2**: CHANGELOG 0.3.0 条目（三个功能点 + issue #1/#2 引用）。
- [ ] **Step 3**: package.json 版本与 peer 下限；`npm install --cache .npm-cache` 后检查 lock 一致。
- [ ] **Step 4**: 全量验证：`npm test`、`npm run typecheck`、`npm run build`。

---

### Task 8: 集成验证（探针优先，减少重启）

**Files:**
- 无源码改动；验证脚本/动态插件临时使用。
- Test: 无（验证性工作）。

**Why:** 用户要求尽量用 Cordis Plugin 探针测试调试、减少重启；最终交付前用探针验证工具注册与桥端点行为。

**Verification:**
- [ ] **Step 1: 单元/构建门** — `npm test`（全绿）、`npm run typecheck`、`npm run build`（lib/ 产物生成，client bundle 含新组件）。
- [ ] **Step 2: 动态插件探针（Host）** — 用 cordis_define 定义临时探针插件：注册 `close_subagent`（复用编译产物 `lib/close-tool.js` 的 `createCloseSubagentTool`），用 Tool.listTools 探针确认工具 schema 出现在模型可见列表；`ctx.subagents.drainContinuableChildren` 对"非直接子代理 id"的行为（预期 UNAUTHORIZED 或 no-op）用真实 ctx 验证一次并记录。
- [ ] **Step 3: 桥端点探针** — 用 curl/动态插件对 `subagentModel` 查询当前会话自身（本会话日志含 `request/header`）→ 应返回 `{found:true, provider:'ollama-pro', model:'deepseek-v4-flash:0731'}`；`subagentClose` 对不存在的 parent → `subagent-parent-not-live`。
- [ ] **Step 4: 可选项（最终 GUI 验证，唯一一次重启）** — `dsh plugin --profile web add link:<绝对路径>` 后重启验证按钮与读数；若环境不允许重启，Step 3 的探针证据作为替代并明确说明。

---

**Risks / Rollback:**
- 核心版本差异：drain API 语义在 0.1.0-rc.8 与 0.1.1-rc.2 一致（实测两者都有实现）；peer 下限提到 rc.8 后，rc.6 环境安装会因 peer 冲突被 npm 提示——这是预期兼容边界（issue 作者已认可）。
- `request/header` 读取依赖事件日志；冷会话（persistence 缺失）可能读不到 → 降级 `{found:false}` 文案，不报错。
- schemastery `.optional()` 物化行为若与预期不符（Task 2 Step 3 记录），改用 `.default(undefined)`——两者都在 Task 内闭环，不扩散。
- UI 按钮对 one-shot/普通会话不可见（isContinuableChild 门控），零侵入。

**Retirement:**
- 不引入新 owner/fallback：`close_subagent` 是 dsh-tool-subagent-control 同类的独立工具；桥端点复用既有通道；可观测性保留快照内快速路径（核心未来填充 provenance 后自然优先），RPC 查询作为兼容数据源，无重复 owner。

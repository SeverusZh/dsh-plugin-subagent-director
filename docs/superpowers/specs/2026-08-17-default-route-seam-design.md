# 默认模型兜底（Default Route Seam）设计

> 日期：2026-08-17 · 状态：已批准 · 关联插件：dsh-plugin-subagent-director v0.1.0

## 背景与问题

插件当前只在模型主动调用 `subagent_role` 工具时才会把配置的 `defaultProvider` /
`defaultModel` 应用到子代理。实际会话中模型几乎总是选择内置的 `subagent` /
`subagent_fork` 工具（描述更醒目，且系统提示引导使用内置工具），导致：

- 插件配置的默认模型从未生效，子代理一直继承父代理模型；
- 用户"配了默认模型但没用上"。

## 目标与成功标准

只要 settings 的 `subagent-director` 命名空间配置了 `defaultProvider` +
`defaultModel`，**任何**未显式指定模型的子代理启动（无论由哪个工具发起：
内置 `subagent`、`subagent_fork`、插件的 `subagent_role`、workflow/ralph 等间接路径）
都会自动落在该模型上。模型行为不需要改变，也不需要修改 profile 配置。

成功标准：
1. 内置工具启动的子代理，其 `subagent/descriptor` 中 `agentProvider`/`agentModel`
   等于配置的默认值（而不是父模型）。
2. 显式指定模型（`subagent_role` 传 provider/model，或角色绑定）时不被覆盖。
3. 默认模型不可路由时回退继承，不抛错、不打断子代理启动。
4. 未配置默认模型时行为与现在完全一致（零侵入）。

## 注入规则（纯函数 `resolveSeamAgentOptions`）

输入：`request.agentOptions`（可能 undefined）、settings、可选的 `llm` 服务。
输出：要注入的 `agentOptions` 或 `undefined`。

| 条件 | 行为 |
|---|---|
| `agentOptions` 已带完整 provider+model | 不注入（显式优先） |
| `agentOptions` 存在但只有部分字段 | 不注入（尊重调用方） |
| `agentOptions` 为 undefined，且默认 provider/model 均非空字符串 | 注入 `{ provider, model }` |
| 默认 provider 或 model 缺一/为空 | 不注入，info 日志 |
| 默认 provider 不可路由（`llm.listProviders()` 不含它） | 不注入，warn 日志，回退继承 |

不可路由时不抛错：该 seam 是"尽力而为的默认值"，不能因为默认配置无效而打挂
内置委派；严格的 `fallbackOnInvalid` 报错语义只属于 `subagent_role` 的显式路径。

## 实现位置

### 新模块 `src/default-route.ts`

- `resolveSeamAgentOptions(request: { agentOptions?: AgentOptions }, settings: SubagentDirectorSettings, ctx: Context): AgentOptions | undefined`
  —— 纯规则 + 可路由性校验（`ctx.get('llm')` 不存在时视为可路由，沿用
  `delegation-tool.ts` 中 `isProviderRoutable` 的语义）。
- `applyDefaultRouteSeam(ctx: Context, getSettings: () => SubagentDirectorSettings): () => void`
  —— 包装 `ctx.subagents.start(name, request)` 与
  `ctx.subagents.startContinuable(spec)`：
  - `start`：`originalStart(name, { ...request, agentOptions: resolved ?? request.agentOptions })`
  - `startContinuable`：`originalStartContinuable({ ...spec, request: { ...spec.request, agentOptions: resolved ?? spec.request.agentOptions } })`
  - 返回 disposer，恢复被替换的原方法。

### `src/index.ts`

- 在 `apply()` 中调用 `applyDefaultRouteSeam(ctx, getSettings)`，持有返回的 disposer，
  在插件卸载时执行（与现有 `disposeTool` 生命周期一致，通过 `ctx.on('dispose', ...)` 或
  Cordis effect 注册）。

### `src/config.ts`

- 新增 `applyDefaultRoute?: boolean`，schemastery 默认 `true`。文档说明：
  未配置默认模型时注入为空操作；不需要该行为可显式关闭。

## 生效范围（预期副作用）

所有经 `ctx.subagents.start / startContinuable` 启动且未指定模型的子代理都会使用默认
模型，包括 workflow/ralph 等内部路径。这是"无感生效"的预期结果，README 中写明。

## 测试（vitest，沿用现有纯函数测试风格）

新增 `test/default-route.test.ts`：
1. 显式完整 `agentOptions` → 不注入；
2. 部分 `agentOptions` → 不注入；
3. 无 `agentOptions` + 默认齐全 → 注入 `{ provider, model }`；
4. 默认缺一 → 不注入；
5. 默认 provider 不可路由 → 不注入（回退继承）；
6. 无 `llm` 服务 → 视为可路由，注入；
7. 包装层：fake `ctx.subagents`，验证 start/startContinuable 注入并透传、disposer
   恢复原方法。

## 范围之外（YAGNI）

- 不顶替内置工具名（路线图 v0.3）；
- 不修改角色指引（无角色时注入提示）；
- 不动 `maxDepth` / persona / toolFilter 语义；
- 不处理 `defaultReasoningEffort`（AgentOptions 不承载该字段，保持现状）。

## 风险与边界

- 包装共享服务 `ctx.subagents`：仅在插件生命周期内生效，dispose 必须恢复原方法；
- 与其它插件同时包装该服务的顺序问题：本插件幂等，恢复后不残留；
- 默认模型不可路由：回退继承并 warn，绝不抛错。

# Changelog

本项目的所有显著变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更

- **设置页开头说明补充模型选择约束（beta.2）**：`sectionIntro` 增加一行
  「只能选择插件-插件配置-Subagent池里的提供商-模型」（中英双语），设置页打开
  即明确可选 provider/model 仅来自官方 Subagent 插件配置的模型池。

### 修复

- **客户端半 alpha.4/alpha.5 兼容性修复（beta.1）**：移除全部 7 处对 rc 时代
  `@deepseek-ai/dsh-client-runtime/client` 的引用（该包 npm 最新仅 0.1.1-rc.2，
  alpha.4/alpha.5 宿主均不携带，客户端 bundle 的运行时 `require` 在浏览器加载即
  失败，设置页/模型读数/关闭按钮整体不可用）：
  - `createSnapshotStore`/`SnapshotStore` 改从 `@deepseek-ai/dsh-client-store`
    导入（alpha 运行时，宿主 web bundle 虚拟模块）；
  - `ClientContext` 改为 cordis `Context`（官方 alpha 客户端模式），`ctx.slots` /
    `ctx.remote` / `ctx.uiConversation` 等 Context 增强经 `dsh-client-ui-renderer` /
    `dsh-api-remotes` / `dsh-client-ui-conversation` 的类型导入引入；
  - 会话类型改从 alpha 包导入：`SessionSnapshot`（`dsh-api-session-controller`）、
    `ConversationNode`/`AssistantMessageNode`/`AssistantProvenanceView`
    （`dsh-client-ui-conversation`）、`ChatSnapshot`（`dsh-client-ui-chat`）、
    `SessionListState`（`dsh-api-session-controller`）；
  - **composer.dock 读数适配 alpha.4 会话架构**：dock 槽位不再经 owner props 提供
    session（渲染时传空 `{}`），改为消费框架标准会话套件（`useSession`/`sessionId`），
    转录节点改从当前会话 chat 视图快照的 `legacy.nodes` 读取（`uiConversation`
    绑定 → `chat` target，惰性解析，设置页不依赖会话 UI）；RPC 兜底查询保留；
  - 移除过时的 `conversation.composer.dock` / `conversation.session.header.actions`
    SlotMap 增强（alpha.4 由 ui-conversation 声明，重复声明会类型冲突）；
  - `package.json` peer/dev 依赖移除 `dsh-client-runtime`，新增
    `dsh-client-store`、`dsh-client-ui-conversation`、`dsh-client-ui-chat`、
    `dsh-api-session-controller`、`dsh-client-ui-session`、`dsh-client-ui-renderer`、
    `dsh-api-remotes`（均 `^0.1.2-alpha.4`，同时覆盖 alpha.4/alpha.5 宿主）。

### 测试

- 新增 `client-compat.test.ts` 兼容性守卫：扫描 `src/client` 与 `package.json`，
  任何 `dsh-client-runtime` 残留引用即失败（本次 bug 的回归测试）；
- `subagent-model.test.ts` 更新为 alpha.4 形状（`SessionSnapshot.subagent` 地址、
  chat 视图 legacy 节点切片、`SubagentAddress` 的 continuable/one-shot 判别）；
- 新增 `client-apply-probe.test.ts` 真实 cordis 探针：客户端半在 alpha.4 形状
  服务（slots/locale/remote/connection）上挂载，设置页/dock/关闭按钮均注册，
  dock 注入面携带 `useChatSnapshot`，且设置页不依赖 `uiConversation` 存在。

### 变更

- **alpha.4 兼容性移植（Host 半）**：`dsh-settings` 服务 API 升级——移除的
  `settingsNamespace()` / `installSettingsSection()` 改为普通 kebab-case 命名空间
  字面量 + `ctx.settings.installSection(owner, ns, schema, entry, hooks)`（与官方
  `subagent-model-selection` 消费方同款模式）；`JsonValue` 改从
  `@deepseek-ai/dsh-util-values` 导入（`dsh-tools` 不再导出）；`AgentOptions` 现携带
  `reasoningEffort?: ReasoningEffortId`，`reasoningEffort` 由「仅告知」改为正式注入
  `agentOptions`（可单独提供，路由变更时清除继承的 route 专属 effort）；
- **移除 `applyDefaultRoute` 默认路由补丁缝**（避免与官方 dsh-tool-subagent 双重写
  模型路由）：删除 `src/default-route.ts` 及其对 `ctx.subagents.start/startContinuable`
  的 monkey-patch，`DirectorConfig` 与 Config schema 同步移除 `applyDefaultRoute`；
  插件不再向任何子代理启动注入默认模型；
- **选择收敛到官方授权列表**：`resolveRoute` 新增 `allowedRoutes` 约束——显式
  provider/model 必须成对且位于 `subagent-model-selection.allowedModels`（未授权为
  `subagent-director:` 硬错误）；角色/默认层未授权路由被丢弃（回退继承）并告警，
  角色 persona/toolFilter 仍生效；新增 `isRouteAllowed` 纯函数与
  `readModelSelection`（执行期经 `settings.get` 读取官方命名空间，缺失/异常时优雅
  降级为无约束并提示未配置授权列表）。

### 测试

- `route-resolver.test.ts` 新增授权列表约束与 effort 注入用例（36 项）；
- 新增 `alpha4-probe.test.ts` 真实 cordis 探针：a) 插件挂载不包装
  `ctx.subagents.start`（证明补丁缝已移除）；b) `subagent-director` 命名空间经
  `installSection` 注册且委派解析读取 `subagent-model-selection`；c) 委派执行路径对
  未授权显式路由拒绝、对授权路由把 `agentOptions`（含 effort）透传给
  `subagents.start`；删除 `default-route.test.ts`。

### 兼容性

- 桥接契约（`SUBAGENT_DIRECTOR_RPC_VIEW` / `_MUTATE` / `_CLOSE` / `_MODEL` / `_TOOLS`
  端点与载荷）不变；`installDirectorSettings` 等导出签名保持；`RpcError.sessionId`
  品牌冲突（宿主 apiproxy 嵌套的 `dsh-session` 副本）在边界处收敛为最小转型。

## [0.4.0] - 2026-08-31

### 新增

- **纯编排模式（`/orchestrate`）**（PR #3，@WinterSold1er）：`/orchestrate on|off` 命令（无参数默认 on），开启后注入「纯编排者」系统提示——主代理只允许通过 `subagent_role` 委派、禁止亲自读/写/执行，角色清单从 `subagent-director.roles` 动态渲染（无硬编码 role id），未配置角色时提示先配置；`sessionProjections` 服务缺失时命令返回明确错误而非假装成功；
- **纯编排模式改为按轮自动检测（类似 `/using aegis`）**：不再需要规定 on/off——消息开头声明 `/orchestrate`（无参数），或用自然语言写「使用orchestrate模式」（含「请使用 orchestrate 模式」「use orchestrate mode」等变体），该轮会话即自动进入纯编排模式；未声明时保持普通模式。系统提示段按轮判定：先扫描当前轮首条用户消息（`user/message` 事件）与最近一次 `orchestrate` 命令的 `command/run` 事件（以 `turn/start` 为轮次边界），投影仅作向后兼容兜底；
- **`/orchestrate <任务>` 直接编排该任务**：声明与任务同一条消息即可生效——任意任务文本（如 `/orchestrate 分析上周A股走势`）会被 handler 视为「编排该任务」，经 `agent.followup(createUserMessage(...))` 排入下一轮并唤醒模型。

### 修复

- **真实 cordis 探针发现的隐性 bug**（issue #5）：cordis 的 `ctx.effect(fn)` 契约是「立即执行 fn、以返回值为 disposer」，原先包在 effect 里的 `fiber.dispose()` 清理块会把 `/orchestrate` 命令与 projection 的 `ctx.inject` 子 fiber **在创建瞬间卸载**——真实宿主上命令从未注册成功过（既有测试全基于 fake，未覆盖该契约）；子 fiber 本就随父 fiber 生命周期自动卸载，清理块已移除，并由新增的真实 cordis 探针测试永久钉住；
- **开发/测试环境对齐真实宿主 0.1.1 线**（issue #5）：devDeps 与 peer ranges 由 `0.1.0-rc.6/rc.8` 升至 `^0.1.1-rc.2`（新增 `dsh-session-projection` peer）；projection 注册改用真实类型契约（`SessionEventMap` / `SessionProjectionStateMap` / `SessionProjectionMap` 声明合并 + 类型化 `register`），契约形状漂移现在在 typecheck 期暴露，而不是运行期被 `snapshot()` 静默跳过；
- 顶层 `inject` 移除 `'commands'`（非 dsh-base 装配上主条目会永久 PENDING、核心委派功能全失效）；命令 handler 增加 `invocation.agent.session` 可选链守卫；
- 移除未使用的 `@deepseek-ai/dsh-client-schema-form` 依赖（源码零引用，且其 0.1.0 线 peer 链与 0.1.1 线冲突）；
- **「对话什么都不返回」**：`/orchestrate on` 后模型被「纯编排者」提示束缚，但 `subagent-director.roles` 未配置任何角色 → 无法委派、禁止亲自动手 → 对话无输出。现在未配置角色时不再注入束缚性的纯编排框架，而是注入一段简短「不可用提示」，指示模型明确告知用户需要先配置角色、并继续以普通模式处理请求——模型必然给出有意义的回复；
- **「不清楚是否已开启」**：`/orchestrate`（无参数）从「粘性 on」改为「本轮 on」（不写粘性事件，由 `command/run` 扫描按轮生效），命令反馈明确说明按轮/持久语义；`/orchestrate on` 保留为显式持久模式（向后兼容），`/orchestrate off` 退出持久模式；
- **`/orchestrate <任务>` 无响应**：commands 服务会整体消费斜杠命令行，任务文本到不了模型、命令返回错误 → 对话无输出。现在任意任务文本会被 handler 视为「编排该任务」：经 `agent.followup(createUserMessage(...))` 排入下一轮并唤醒模型，`command/run` 扫描（任务参数 → on）使该轮注入编排提示；
- **按轮检测被上下文注入事件击穿**（实测「分析上周A股走势」会话未编排）：宿主会在用户消息之后把 runtime context / system-reminder / memos_context 作为**独立的 `user/message` 事件**追加进日志，导致「最新用户消息」「命令位于上一条与当前用户消息之间」的判定全部失效（命令被视为过期、声明消息被注入事件掩盖）。修复：检测改用 **`turn/start` 轮次边界**——消息检测取当前轮**首条**用户消息（忽略注入事件），命令扫描要求命令位于「上一轮最后一条用户消息之后、本轮 `turn/start` 之前」；无 turn 事件时回退旧逻辑。

### 兼容性

- `orchestrate/change` 事件类型注册与投影注册保留（旧会话日志加载兼容 + 客户端 wire 视图）；`renderOrchestratorPrompt` / `renderOrchestratorRoles` / `buildOrchestratorFrame` 公共 API 不变；新增导出 `detectOrchestrateRequest`、`renderOrchestratorUnavailableNotice`。

### 测试

- 单元/集成测试由 197 增至 253：`detectOrchestrateRequest` 检测单测（斜杠/任务文本/自然语言/反例）、按轮段判定接线测试（用户消息声明、`command/run` 区间扫描、任务参数扫描、无角色不可用提示、投影兜底）、命令语义测试（无参数按轮不写事件、任务文本 followup 排队、on 持久、off 退出），以及真实 cordis `Context` + 真实 `SessionProjectionRegistry` 集成探针（无 commands 服务时主条目正常激活、核心服务缺失时保持 PENDING、commands 后到时命令经真实 `ctx.inject` 子 fiber 响应式注册、projection 经真实 `snapshot()` 驱动 on→off 折叠、按轮与任务文本探针）。

### 已知取舍

- 用过 `/orchestrate` 的会话在未挂载本插件的 boot（卸载后、其他 profile）中无法加载：上游暂无第三方事件注册 / `ignorable` 写入 API，已在 README FAQ 与 issue #6 记录。

## [0.3.0] - 2026-08-29

### 新增

- **`close_subagent` 模型可见工具**：主代理可按需释放驻留的 continuable
  子代理（内部调用 DSH 核心 `drainContinuableChildren`，与
  `send_message`/`interrupt_agent` 构成完整生命周期闭环；非驻留目标是安全
  no-op）——[issue #1](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/1)；
- **子代理会话页「终止可持续状态」按钮**：打开 continuable 子代理会话时，
  会话标题操作区显示释放按钮（确认后经 `/subagent-director` 桥释放该子代理，
  父代理不在线时给出明确提示）；
- **可观测性打通**：composer 下方实际运行供应商/模型读数不再依赖尚未填充的
  assistant provenance 字段，改为读取子代理会话的 `request/header` 记录
  （`subagentModel` 桥端点），快照内已有 provenance 时仍走零请求快速路径，
  读不到时优雅降级——移除 README「暂不可用」标注；
- **角色「工具集」编辑**：角色编辑/添加卡片支持可视化配置 `toolFilter.allow`
  ——搜索过滤、全选/全不选（仅作用于过滤结果）、已选计数、收起展开、
  可滚动列表（`toolCatalog` 桥端点枚举完整 agent 视图，含 bash/read/write
  等基础工具，实测 88 个）。

### 修复

- 未配置 `toolFilter` 的角色被 dsh-settings 物化为 `{allow:[],deny:[]}` 后
  清空子代理全部工具（tools=0、「只执行一步」假象）：空 filter 视为未配置，
  schema 层不再物化空对象（`hasToolFilter` + `.default(undefined)`）——
  [issue #2](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/2)；
- `toolCatalog` 原先只枚举全局注册表（56 个），遗漏 preset 层的
  bash/read/write/grep 等基础工具：改经 `agent.ctx.get('tools').schemas(agent)`
  枚举完整 agent 视图（88 个）。

### 兼容性

- `@deepseek-ai/dsh-subagent` peer 依赖下限提升至 `^0.1.0-rc.8`
  （`drainContinuableChildren` 所在版本线）。

### 测试

- 单元测试由 150 增至 197：空 toolFilter 语义、close_subagent 工具、
  桥接 `subagentClose`/`subagentModel`/`toolCatalog` 端点、可观测性数据源
  合并、工具集纯逻辑（过滤/全选/集合代数）。

### 文档

- README：新增「释放可持续子代理」「工具集」特性、更新可观测性描述（中英
  双语）；CHANGELOG 0.3.0 汇总 beta.1–beta.4 的全部变更。

[0.3.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.3.0

## [0.2.0] - 2026-08-17

### 新增

- **默认模型兜底**：在 `ctx.subagents.start/startContinuable` 层注入默认
  provider/model，对内置 `subagent`/`subagent_fork` 发起的子代理同样生效
  （`applyDefaultRoute`，默认开启；未配置默认模型时零侵入）；
- **配置热更新**：settings.yaml / 设置面板改动即时生效，无需重启；
- **角色按显示名引用**：`role` 参数未命中 id 时按 `displayName` 精确匹配，
  多个同名角色取定义顺序第一个并提示；
- **角色指引强化**：系统提示明确要求按 id 引用角色（Delegate 行），不要用显示名。

### 修复

- 设置快照只在插件挂载时读取一次、运行中修改配置不生效的问题（`onChange` 现在会
  重新读取来源并刷新快照）；
- 默认路由 seam 卸载时恢复原始方法的引用（保留未绑定引用，dispose 幂等）。

### 测试

- 单元测试由 129 增至 150：默认模型兜底、显示名解析、指引渲染、设置快照热更新。

### 文档

- README：默认模型兜底、配置热更新、角色显示名引用、推荐默认角色示例；
- 新增设计文档与实现计划（`docs/superpowers/`）。

## [0.1.0] - 2026-08-14

首个公开发布版本。

### 新增

- 四级模型路由解析链（单次调用参数 > 角色绑定 > 插件默认 > 继承主代理），字段级覆盖、未配置零侵入；
- `subagent_role` 模型可见委派工具：`role`/`provider`/`model`/`reasoningEffort` 可选参数，前景/one-shot 后台/continuable 后台三种执行路线；
- 角色模板：命名角色携带职责描述、persona 与可选模型绑定，写入 settings 命名空间 `subagent-director`；
- 主代理角色清单指引（系统提示段落，无角色时不注入）；
- 设置界面「子代理导演」：默认模型配置 + 角色卡片增删改（中英双语）；
- 子代理实际运行模型读数（composer dock，零额外请求）；
- 设置命名空间桥接条目 `subagent-director-bridge`：自注册 `/subagent-director` HTTP 路由，绕开 Web API 的 settings 白名单限制；
- 129 个单元测试（路由解析、schema 校验、桥接信封、client 纯逻辑）。

### 文档

- README（中英双语）：安装、配置示例、角色模板、FAQ；
- MIT License。

[0.1.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.1.0
[0.2.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.2.0

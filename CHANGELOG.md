# Changelog

本项目的所有显著变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.4.0-beta.2] - 2026-08-31

### 新增

- **纯编排模式改为按轮自动检测（类似 `/using aegis`）**：不再需要规定 on/off——消息开头声明 `/orchestrate`（无参数），或用自然语言写「使用orchestrate模式」（含「请使用 orchestrate 模式」「use orchestrate mode」等变体），该轮会话即自动进入纯编排模式；未声明时保持普通模式。系统提示段按轮判定：先扫描当前用户消息（`user/message` 事件）与最近一次 `orchestrate` 命令的 `command/run` 事件（位于上一条与当前用户消息之间），投影仅作向后兼容兜底。

### 修复

- **「对话什么都不返回」**：`/orchestrate on` 后模型被「纯编排者」提示束缚，但 `subagent-director.roles` 未配置任何角色 → 无法委派、禁止亲自动手 → 对话无输出。现在未配置角色时不再注入束缚性的纯编排框架，而是注入一段简短「不可用提示」，指示模型明确告知用户需要先配置角色、并继续以普通模式处理请求——模型必然给出有意义的回复；
- **「不清楚是否已开启」**：`/orchestrate`（无参数）从「粘性 on」改为「本轮 on」（不写粘性事件，由 `command/run` 扫描按轮生效），命令反馈明确说明按轮/持久语义；`/orchestrate on` 保留为显式持久模式（向后兼容），`/orchestrate off` 退出持久模式；
- **`/orchestrate <任务>` 无响应**：commands 服务会整体消费斜杠命令行，任务文本到不了模型、命令返回错误 → 对话无输出。现在任意任务文本（如 `/orchestrate 分析上周A股走势`）会被 handler 视为「编排该任务」：经 `agent.followup(createUserMessage(...))` 排入下一轮并唤醒模型，`command/run` 扫描（任务参数 → on）使该轮注入编排提示——声明与任务同一条消息即可生效。

### 兼容性

- `orchestrate/change` 事件类型注册与投影注册保留（旧会话日志加载兼容 + 客户端 wire 视图）；`renderOrchestratorPrompt` / `renderOrchestratorRoles` / `buildOrchestratorFrame` 公共 API 不变；新增导出 `detectOrchestrateRequest`、`renderOrchestratorUnavailableNotice`。

### 测试

- 单元/集成测试由 233 增至 253：`detectOrchestrateRequest` 检测单测（斜杠/任务文本/自然语言/反例）、按轮段判定接线测试（用户消息声明、`command/run` 区间扫描、任务参数扫描、无角色不可用提示、投影兜底）、命令语义测试（无参数按轮不写事件、任务文本 followup 排队、on 持久、off 退出），以及真实 cordis + 真实 `SessionProjectionRegistry` 的按轮与任务文本探针测试。

## [0.4.0-beta.1] - 2026-08-30

### 新增

- **纯编排模式（`/orchestrate`）**（PR #3，@WinterSold1er）：`/orchestrate on|off` 命令（无参数默认 on），开启后注入「纯编排者」系统提示——主代理只允许通过 `subagent_role` 委派、禁止亲自读/写/执行，角色清单从 `subagent-director.roles` 动态渲染（无硬编码 role id），未配置角色时提示先配置；`sessionProjections` 服务缺失时命令返回明确错误而非假装成功。

### 修复

- **真实 cordis 探针发现的隐性 bug**（issue #5）：cordis 的 `ctx.effect(fn)` 契约是「立即执行 fn、以返回值为 disposer」，原先包在 effect 里的 `fiber.dispose()` 清理块会把 `/orchestrate` 命令与 projection 的 `ctx.inject` 子 fiber **在创建瞬间卸载**——真实宿主上命令从未注册成功过（既有测试全基于 fake，未覆盖该契约）；子 fiber 本就随父 fiber 生命周期自动卸载，清理块已移除，并由新增的真实 cordis 探针测试永久钉住；
- **开发/测试环境对齐真实宿主 0.1.1 线**（issue #5）：devDeps 与 peer ranges 由 `0.1.0-rc.6/rc.8` 升至 `^0.1.1-rc.2`（新增 `dsh-session-projection` peer）；projection 注册改用真实类型契约（`SessionEventMap` / `SessionProjectionStateMap` / `SessionProjectionMap` 声明合并 + 类型化 `register`），契约形状漂移现在在 typecheck 期暴露，而不是运行期被 `snapshot()` 静默跳过；
- 顶层 `inject` 移除 `'commands'`（非 dsh-base 装配上主条目会永久 PENDING、核心委派功能全失效）；命令 handler 增加 `invocation.agent.session` 可选链守卫；
- 移除未使用的 `@deepseek-ai/dsh-client-schema-form` 依赖（源码零引用，且其 0.1.0 线 peer 链与 0.1.1 线冲突）。

### 测试

- 单元/集成测试由 197 增至 233：`/orchestrate` 功能与接线用例、handler 守卫用例，以及**真实 cordis `Context` + 真实 `SessionProjectionRegistry` 集成探针**（无 commands 服务时主条目正常激活、核心服务缺失时保持 PENDING、commands 后到时命令经真实 `ctx.inject` 子 fiber 响应式注册、projection 经真实 `snapshot()` 驱动 on→off 折叠）。

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

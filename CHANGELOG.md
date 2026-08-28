# Changelog

本项目的所有显著变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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

<div align="center">

# 🎬 Subagent Director（子代理导演）

**为 DeepSeek Harness 的 subagent 指定 LLM 供应商与模型，并用「角色模板」规划主代理与子代理的分工**

[![npm version](https://img.shields.io/npm/v/dsh-plugin-subagent-director?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-plugin-subagent-director)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-subagent-director?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-plugin-subagent-director)
[![license](https://img.shields.io/npm/l/dsh-plugin-subagent-director?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js)](package.json)
[![GitHub release](https://img.shields.io/github/v/release/SeverusZh/dsh-plugin-subagent-director?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-plugin-subagent-director/releases)
[![GitHub stars](https://img.shields.io/github/stars/SeverusZh/dsh-plugin-subagent-director?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-plugin-subagent-director)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.1%20%2F%20rc.2-blue?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

**Subagent Director** 是一个 out-of-tree 的 DeepSeek Harness 插件，用于为 subagent 指定 LLM 供应商与模型，并通过「角色模板」规划主代理与子代理的分工。

---

## ✨ 功能特性 / Features

- **供应商与模型选择** —— 为 subagent 配置默认 LLM 供应商（route）与模型；每次委派也可以由模型显式指定 `provider` / `model`；
- **受控的模型选择** —— provider/model 只从官方 `subagent-model-selection` 授权列表
  （`allowedModels`）中选择：显式传入未授权路由为硬错误，角色/默认层未授权路由被
  丢弃并回退继承（不与官方 dsh-tool-subagent 双重写模型路由）；
- **配置热更新** —— settings.yaml / 插件配置页的改动即时生效，无需重启；
- **角色按显示名引用** —— `role` 参数未命中 id 时按 `displayName` 精确匹配（重名
  取定义顺序第一个并提示），模型按显示名也能命中模板；
- **角色模板** —— 定义「代码审查员」「翻译员」等角色：职责描述（给主代理看）+ 可选 Agent Preset（persona/工具组合）+ 可选模型绑定；
- **四级回退链** —— 单次调用参数 > 角色绑定 > 插件默认 > 继承主代理（未配置时零侵入）；
- **主代理指引** —— 系统提示自动注入角色清单，主代理知道何时委派给谁；
- **配置界面** —— 插件详情页内可视化配置（插件列表 → dsh-plugin-subagent-director；默认模型 + 角色卡片增删改）；设置面板不再承载本插件配置；
- **continuable 后台** —— 返回可续聊子代理 id，配合 send_message 持续委派；
- **释放可持续子代理** —— 模型可见工具 `close_subagent(subagent_id)` 与子代理会话
  页的「终止可持续状态」按钮，主动释放已完成但仍驻留的 continuable 子代理
  （内部调用 DSH 核心 `drainChildren`）；
- **可观测性** —— 打开子代理会话时，composer 下方显示其实际运行的供应商/模型
  （从会话 `request/header` 记录读取真实路由；读不到时优雅降级）；

## 📦 安装 / Install

### 安装

```bash
dsh plugin --profile <name> add dsh-plugin-subagent-director
```

或本地开发时以 `dsh plugin --profile <name> add link:<绝对路径>` 挂载本地 checkout
（配置示例见下）。

### 安装注意事项

- 推荐直接 `dsh plugin --profile <name> add dsh-plugin-subagent-director`（npm
  发布版已包含构建产物，peer 依赖由 DSH 的 `$DSH_HOME/profiles/node_modules`
  fallback 提供，开箱即用）。
- 本地 `link:` 开发时：git 仓库不包含 `lib/`（已被 .gitignore），挂载前需先
  `npm install && npm run build`；且 checkout 需位于 `$DSH_HOME/profiles/` 下
  （或仓库自带 node_modules），否则 `@deepseek-ai/*` peer 依赖会报
  `ERR_MODULE_NOT_FOUND`。

## 🚀 快速开始 / Quick Start

对话中委派（主代理会看到角色清单指引，自动选择工具与角色）：

```text
subagent_role({ role: "translator", prompt: "把 README.md 翻译成英文" })
subagent_role({ role: "code-reviewer", model: "deepseek-chat", prompt: "..." })  # 临时覆盖模型
```

`role` 参数支持用角色 id 或显示名引用：未命中 id 时会按 `displayName` 精确匹配
（多个同名角色取定义顺序第一个并提示）；建议始终用 id，见系统提示中的 Delegate 行。

> **`subagent_role` 与内置 `subagent` 是两个不同的工具。** 本插件注册的是
> `subagent_role`（工具名由 `toolName` 配置，默认 `subagent_role`）；DSH 基础
> bundle 另有内置的 `subagent` / `subagent_fork`，两者在同一次请求的工具清单里
> **并存**。只有走 `subagent_role` 才会应用角色绑定的 `agentPreset`（persona/工具由 preset 承载）；模型改用
> 内置 `subagent` 时这两项不生效（模型选择由官方 dsh-tool-subagent 的
> `modelSelectionSettings` 负责）。
> 因此需要角色语义时，请在提示里明确要求调用 `subagent_role`。

## ⚙️ 配置 / Configuration

`dsh plugin add` 会通过插件包自带的 `cordis.patch.yml` 自动挂载主条目与桥接条目
（`subagent-director` / `subagent-director-bridge`，桥接条目用于把设置命名空间
暴露给 Web UI），**不需要**手动 `insert`。需要覆盖默认配置时按 id 覆盖主条目：

```yaml
- id: subagent-director
  name: dsh-plugin-subagent-director
  config:
    subagentProvider: spawn      # 传输：spawn（无父上下文）/ fork（继承父历史）
    toolName: subagent_role      # 本插件注册的模型可见工具名（不是内置 subagent）
    enableRunInBackground: true
    backgroundMode: one-shot     # one-shot 或 continuable
    maxDepth: 3
```

> 注意：不要再用 `- insert:` 添加这两个条目，否则启动会报
> `duplicate loader entry id`。

## 🎭 角色模板 / Role Templates

settings 命名空间 `subagent-director`。角色可以不绑定 provider/model（继承全局
默认模型），也可以按需绑定。推荐默认角色（含委派指引与可选 Agent Preset；
DSH 0.2.1 的 persona/toolFilter 由 Agent Preset 承载，下面示例假定已创建同名 preset）：

```yaml
subagent-director:
  defaultProvider: anthropic
  defaultModel: mythos-10
  defaultReasoningEffort: max
  roles:
    code-reviewer:
      displayName: 代码审查员
      description: 审查代码质量、安全、可维护性与测试覆盖，输出结构化评审意见（问题清单 + 严重级别 + 修改建议），适合在提交/合并前独立复核改动
      agentPreset: code-reviewer
    architect:
      displayName: 架构师
      description: 设计系统架构、模块边界与数据流，评估技术选型与演进路线，把模糊需求拆成可落地的设计方案
      agentPreset: architect
    test-engineer:
      displayName: 测试工程师
      description: 编写与评审测试用例，识别边界条件与异常路径，设计单元/集成测试策略
      agentPreset: test-engineer
    docs-writer:
      displayName: 文档工程师
      description: 撰写与润色技术文档、README、API 说明与变更日志，统一术语与结构
      agentPreset: docs-writer
    researcher:
      displayName: 研究分析员
      description: 检索资料、整理证据、做数据探索与可行性分析，输出带来源与不确定性的结论
      agentPreset: researcher
    translator:
      displayName: 翻译员
      description: 中英互译技术文档、代码注释与沟通内容，保留术语准确性与语气
      agentPreset: translator
```

## 🎼 纯编排模式 / Orchestrate Mode

```text
/orchestrate 分析上周A股走势   # 本轮开启并直接编排该任务（推荐用法）
/orchestrate                  # 本轮开启（按轮生效，无需 on/off）
/orchestrate on               # 持久开启（直到 /orchestrate off）
/orchestrate off              # 退出持久模式
```

在消息开头声明 `/orchestrate`（可后接任务文本，如 `/orchestrate 分析上周A股走势`），
或用自然语言写「使用orchestrate模式」（含「请使用 orchestrate 模式」「use
orchestrate mode」等变体），该轮会话即自动进入纯编排模式——类似 `/using aegis`
的按轮声明式用法，无需记忆开关状态；未声明时保持普通模式。`/orchestrate <任务>`
会把任务文本排入下一轮并唤醒模型，该轮以纯编排模式处理任务。开启后注入一段
「纯编排者」系统提示：主代理只允许通过委派工具派活，角色清单从当前
`subagent-director.roles` 动态渲染（无硬编码 role id）。**未配置角色时**不会注入
束缚性的纯编排框架，而是注入一段简短提示，让模型明确告知需要先配置角色并继续
以普通模式处理请求（避免「对话无输出」）。该模式依赖宿主的 `commands` 与
`sessionProjections` 服务：标准 profile（dsh-base）都会提供二者；
`sessionProjections` 缺失时命令返回明确错误而不是假装成功，`commands` 缺失时
命令不注册，插件其余功能不受影响。

## 🧭 与官方子代理选择器的适配 / Official Subagent Selector Adaptation

DSH alpha.4 起，官方内置 subagent 的模型选择收敛到 `subagent-model-selection` 设置段（`allowedModels` 授权列表）。本插件 v0.5.0 完全适配该机制：

- **只从授权列表选择** —— `route-resolver` 把 provider/model 约束在官方
  `subagent-model-selection.allowedModels` 内：显式传入未授权路由为**硬错误**；
  插件默认层 / 角色绑定层的未授权路由被**丢弃并回退继承主代理**；
- **不再双重写模型路由** —— 移除 rc 时代的 `applyDefaultRoute` 补丁缝，插件与
  官方选择器不会各自覆盖同一条路由（设置面板可选的 provider/model 即官方
  「插件-插件配置-Subagent池」里的选项）；
- **客户端半同步移植** —— 移除 rc 时代对 `@deepseek-ai/dsh-client-runtime/client`
  （`dsh-client-runtime` 包）的全部引用（alpha.4/alpha.5 宿主均不携带该包），dock 读数改读 alpha.4 会话
  `request/header` 记录，配置页在 alpha.4/alpha.5 宿主均可正常加载。

## 📖 术语 / Glossary

- **subagentProvider（传输）**：`spawn` / `fork` / `acp`——子代理跑在哪条传输链路上；
- **provider（LLM route）**：`deepseek-official`、pi-ai route——模型请求实际发给哪个供应商。

两者是**两套命名空间**，配置时不要混淆。

## 🧩 兼容性 / Compatibility

DSH 0.2.1 起兼容门禁优先读取 `engines.dsh`。本插件声明 **`engines.dsh: ">=0.2.1-rc.1"`**，全部 `@deepseek-ai/dsh-*` peer 也收敛到 `>=0.2.1-rc.1`：

| DSH 版本 | 状态 |
| --- | --- |
| 0.2.1-rc.1 | ✅ typecheck / 297 测试 / 构建 / 门禁 |
| 0.2.1-rc.2 | ✅ 兼容门禁通过 |

> 只列出**实际跑过**的版本；未实测的不列。

v0.6.0-beta.1 支持 DSH **0.2.1-rc.1+**。DSH 0.2.1 把子代理接缝统一为 `startActivation` / `drainChildren`，并移除了逐请求的 persona/toolFilter；本版按官方方向把 persona 与工具组合迁移到 **Agent Preset**，角色模板新增 `agentPreset` 字段。**破坏性**：不再兼容 0.1.x / 0.2.0-rc.1，旧宿主请继续使用 **0.5.6**。

## 🛠️ 开发 / Develop

```bash
npm install
npm test          # vitest（253 用例）
npm run typecheck
npm run build     # host(tsc) + client(rolldown bundle)
```

## ❓ FAQ

**为什么需要两个插件条目？**
DSH 的 Web API 只向白名单内的 settings 命名空间开放读写。本插件通过自注册的 `/subagent-director` HTTP 路由桥接自己的命名空间，而该路由依赖的 webServer 服务只能经 cordis `inject` 获取，因此拆成独立的 `subagent-director-bridge` 条目（无 Web 的 headless 场景它会自动不激活，主条目不受影响）。

**未配置任何角色时行为如何？**
未配置任何角色且未配置默认模型时与未安装本插件完全一致（零侵入）。配置了
`defaultProvider`/`defaultModel` 时：若官方 `subagent-model-selection` 已启用并有
`allowedModels` 授权列表，默认路由仅在该列表内才生效（否则被丢弃并回退继承）；若
未配置授权列表，则保留插件默认行为并给出警告提示。

**用过 `/orchestrate` 的会话，卸载插件后还能打开吗？**
不能。`/orchestrate` 会在会话日志写入 `orchestrate/change` 事件，而宿主的持久化
加载校验遇到「未知且未标记 ignorable」的事件类型时会拒绝加载整个日志（避免误解
日志语义）。插件挂载时会动态注册该事件类型，正常使用不受影响；但在未挂载本插件
的环境（卸载后、其他 profile）中，这些会话将无法打开。上游暂未提供第三方事件
类型的官方注册或 `ignorable` 写入 API，此为已知取舍，详见
[issue #6](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/6)。

**新供应商/API 会自动出现吗？**
会。配置页订阅了供应商与设置变更事件，在 Models 页新增供应商/API key 后，下拉列表自动刷新，无需重启。

## 📄 许可证 / License

[MIT](./LICENSE) © Subagent Director contributors

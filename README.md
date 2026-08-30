# 🎬 Subagent Director（子代理导演）

> 为 DeepSeek Harness 的 subagent 指定 LLM 供应商与模型，并用「角色模板」规划主代理与子代理的分工。

<p align="center">
  <img alt="npm version" src="https://img.shields.io/npm/v/dsh-plugin-subagent-director?label=npm">
  <img alt="license" src="https://img.shields.io/npm/l/dsh-plugin-subagent-director">
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6-blue">
  <img alt="Awesome DSH Plugin" src="https://awesome-dsh-plugin.com/badge.svg">
</p>

[English](#english) · [特性](#特性) · [快速开始](#快速开始) · [角色模板](#角色模板) · [术语](#术语) · [开发](#开发) · [FAQ](#faq)

---

## 特性

- **供应商与模型选择** —— 为 subagent 配置默认 LLM 供应商（route）与模型；每次委派也可以由模型显式指定；
- **默认模型兜底** —— 配置 `defaultProvider`/`defaultModel` 后，即使模型调用内置
  `subagent`/`subagent_fork` 工具，未显式指定模型的子代理也会自动使用该模型
  （`applyDefaultRoute`，默认开启；未配置默认模型时为零侵入空操作）；
- **配置热更新** —— settings.yaml / 设置面板的改动即时生效，无需重启；
- **角色按显示名引用** —— `role` 参数未命中 id 时按 `displayName` 精确匹配（重名
  取定义顺序第一个并提示），模型按显示名也能命中模板；
- **角色模板** —— 定义「代码审查员」「翻译员」等角色：职责描述（给主代理看）+ persona（注入子代理）+ 可选模型绑定；
- **四级回退链** —— 单次调用参数 > 角色绑定 > 插件默认 > 继承主代理（未配置时零侵入）；
- **主代理指引** —— 系统提示自动注入角色清单，主代理知道何时委派给谁；
- **设置界面** —— DSH 设置面板内可视化配置（默认模型 + 角色卡片增删改）；
- **continuable 后台** —— 返回可续聊子代理 id，配合 send_message 持续委派；
- **释放可持续子代理** —— 模型可见工具 `close_subagent(subagent_id)` 与子代理会话
  页的「终止可持续状态」按钮，主动释放已完成但仍驻留的 continuable 子代理
  （内部调用 DSH 核心 `drainContinuableChildren`）；
- **可观测性** —— 打开子代理会话时，composer 下方显示其实际运行的供应商/模型
  （从会话 `request/header` 记录读取真实路由；读不到时优雅降级）；

## 快速开始

### 安装

```bash
dsh plugin --profile <name> add dsh-plugin-subagent-director
```

或本地开发时以 `dsh plugin --profile <name> add link:<绝对路径>` 挂载本地 checkout
（配置示例见下）。

### 配置（cordis.patch.yml，可选）

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
    applyDefaultRoute: true      # 默认 true：把默认模型应用到所有未显式指定模型的子代理
```

> 注意：不要再用 `- insert:` 添加这两个条目，否则启动会报
> `duplicate loader entry id`。

### 安装注意事项

- 推荐直接 `dsh plugin --profile <name> add dsh-plugin-subagent-director`（npm
  发布版已包含构建产物，peer 依赖由 DSH 的 `$DSH_HOME/profiles/node_modules`
  fallback 提供，开箱即用）。
- 本地 `link:` 开发时：git 仓库不包含 `lib/`（已被 .gitignore），挂载前需先
  `npm install && npm run build`；且 checkout 需位于 `$DSH_HOME/profiles/` 下
  （或仓库自带 node_modules），否则 `@deepseek-ai/*` peer 依赖会报
  `ERR_MODULE_NOT_FOUND`。

### 角色模板（设置界面或 settings.yaml）

settings 命名空间 `subagent-director`。角色可以不绑定 provider/model（继承全局
默认模型），也可以按需绑定。推荐默认角色（含委派指引与 persona）：

```yaml
subagent-director:
  defaultProvider: opencode-go
  defaultModel: minimax-m2.7
  defaultReasoningEffort: low
  roles:
    code-reviewer:
      displayName: 代码审查员
      description: 审查代码质量、安全、可维护性与测试覆盖，输出结构化评审意见（问题清单 + 严重级别 + 修改建议），适合在提交/合并前独立复核改动
      persona: 你是严谨的代码审查员。先给结论再给证据，区分阻塞项与建议项；逐条指出问题并给出可操作的修改建议，语气客观直接，不吹捧也不刻薄。
    architect:
      displayName: 架构师
      description: 设计系统架构、模块边界与数据流，评估技术选型与演进路线，把模糊需求拆成可落地的设计方案
      persona: 你是资深架构师。先澄清约束（规模、性能、团队、时间），再权衡取舍；输出带理由的决策，明确边界、扩展点与风险，避免过度设计。
    test-engineer:
      displayName: 测试工程师
      description: 编写与评审测试用例，识别边界条件与异常路径，设计单元/集成测试策略
      persona: 你是细致的测试工程师。以发现缺陷为目标，覆盖正常、边界与异常路径；每个用例说明验证什么、断言什么，报告按严重度排序。
    docs-writer:
      displayName: 文档工程师
      description: 撰写与润色技术文档、README、API 说明与变更日志，统一术语与结构
      persona: 你是技术文档工程师。语言准确简洁、结构清晰、面向读者；不臆造内容，术语全文统一，示例可运行可验证。
    researcher:
      displayName: 研究分析员
      description: 检索资料、整理证据、做数据探索与可行性分析，输出带来源与不确定性的结论
      persona: 你是严谨的研究分析员。优先一手来源，区分事实与推断；结论注明依据、时效与不确定性，不夸大不臆测。
    translator:
      displayName: 翻译员
      description: 中英互译技术文档、代码注释与沟通内容，保留术语准确性与语气
      persona: 你是专业翻译。术语统一、句式自然、保留原文意图；专有名词与技术缩写保持原文，拿不准的术语标注出来。
```

### 使用

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
> **并存**。只有走 `subagent_role` 才会应用角色 persona 与 `toolFilter`；模型改用
> 内置 `subagent` 时这两项不生效（`applyDefaultRoute` 开启时默认模型仍会生效）。
> 因此需要角色语义时，请在提示里明确要求调用 `subagent_role`。

### 纯编排模式（`/orchestrate`）

```text
/orchestrate        # 本轮开启（按轮生效，无需 on/off）
/orchestrate on     # 持久开启（直到 /orchestrate off）
/orchestrate off    # 退出持久模式
```

在消息开头声明 `/orchestrate`，或用自然语言写「使用orchestrate模式」（含
「请使用 orchestrate 模式」「use orchestrate mode」等变体），该轮会话即自动
进入纯编排模式——类似 `/using aegis` 的按轮声明式用法，无需记忆开关状态；
未声明时保持普通模式。开启后注入一段「纯编排者」系统提示：主代理只允许通过
委派工具派活，角色清单从当前 `subagent-director.roles` 动态渲染（无硬编码
role id）。**未配置角色时**不会注入束缚性的纯编排框架，而是注入一段简短提示，
让模型明确告知需要先配置角色并继续以普通模式处理请求（避免「对话无输出」）。
该模式依赖宿主的 `commands` 与 `sessionProjections` 服务：标准 profile
（dsh-base）都会提供二者；`sessionProjections` 缺失时命令返回明确错误而不是假装
成功，`commands` 缺失时命令不注册，插件其余功能不受影响。

## 术语

- **subagentProvider（传输）**：`spawn` / `fork` / `acp`——子代理跑在哪条传输链路上；
- **provider（LLM route）**：`deepseek-official`、pi-ai route——模型请求实际发给哪个供应商。

两者是**两套命名空间**，配置时不要混淆。

## 开发

```bash
npm install
npm test          # vitest（249 用例）
npm run typecheck
npm run build     # host(tsc) + client(rolldown bundle)
```

## FAQ

**为什么需要两个插件条目？**
DSH 的 Web API 只向白名单内的 settings 命名空间开放读写。本插件通过自注册的 `/subagent-director` HTTP 路由桥接自己的命名空间，而该路由依赖的 webServer 服务只能经 cordis `inject` 获取，因此拆成独立的 `subagent-director-bridge` 条目（无 Web 的 headless 场景它会自动不激活，主条目不受影响）。

**未配置任何角色时行为如何？**
未配置任何角色且未配置默认模型时与未安装本插件完全一致（零侵入）。配置了
`defaultProvider`/`defaultModel` 且未关闭 `applyDefaultRoute` 时，所有未显式
指定模型的子代理（含内置工具发起的）都会使用该默认模型。

**用过 `/orchestrate` 的会话，卸载插件后还能打开吗？**
不能。`/orchestrate` 会在会话日志写入 `orchestrate/change` 事件，而宿主的持久化
加载校验遇到「未知且未标记 ignorable」的事件类型时会拒绝加载整个日志（避免误解
日志语义）。插件挂载时会动态注册该事件类型，正常使用不受影响；但在未挂载本插件
的环境（卸载后、其他 profile）中，这些会话将无法打开。上游暂未提供第三方事件
类型的官方注册或 `ignorable` 写入 API，此为已知取舍，详见
[issue #6](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/6)。

**新供应商/API 会自动出现吗？**
会。设置页订阅了供应商与设置变更事件，在 Models 页新增供应商/API key 后，下拉列表自动刷新，无需重启。

## License

[MIT](./LICENSE) © Subagent Director contributors

---

## English

**Subagent Director** is an out-of-tree DeepSeek Harness plugin that lets you choose an LLM provider and model for subagents, and plan main-agent/subagent responsibilities through role templates.

- **Provider/model selection** — a configurable default route plus optional per-call `provider`/`model` arguments on the `subagent_role` tool;
- **Role templates** — named roles carrying a description, a persona, and an optional model binding;
- **Four-layer resolution** — call args > role binding > plugin default > inherit from the parent agent (zero intrusion when unconfigured);
- **Settings UI** — manage defaults and role cards in the DSH settings panel;
- **Continuable background** — durable subagent ids with send_message follow-ups;
- **Release continuable children** — a model-facing `close_subagent(subagent_id)` tool plus a "Release subagent" button in the subagent session header, freeing resident children through the core `drainContinuableChildren` API;
- **Observability** — the addressed subagent’s actual provider/model shown under the composer, read from the session’s `request/header` records (graceful degradation when no run is recorded yet).

**Install** — `dsh plugin --profile <name> add dsh-plugin-subagent-director` mounts the main and bridge entries automatically from the package's bundle patch (`cordis.patch.yml`); optionally override the main entry's config in your profile's cordis.patch.yml (see the Chinese section above). License: MIT.

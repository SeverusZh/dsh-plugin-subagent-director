# 🎬 Subagent Director（子代理导演）

> 为 DeepSeek Harness 的 subagent 指定 LLM 供应商与模型，并用「角色模板」规划主代理与子代理的分工。

<p align="center">
  <img alt="npm version" src="https://img.shields.io/npm/v/dsh-plugin-subagent-director?label=npm">
  <img alt="license" src="https://img.shields.io/npm/l/dsh-plugin-subagent-director">
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.x-blue">
</p>

[English](#english) · [特性](#特性) · [快速开始](#快速开始) · [角色模板](#角色模板) · [术语](#术语) · [开发](#开发) · [路线图](#路线图) · [FAQ](#faq)

---

## 特性

- **供应商与模型选择** —— 为 subagent 配置默认 LLM 供应商（route）与模型；每次委派也可以由模型显式指定；
- **角色模板** —— 定义「代码审查员」「翻译员」等角色：职责描述（给主代理看）+ persona（注入子代理）+ 可选模型绑定；
- **四级回退链** —— 单次调用参数 > 角色绑定 > 插件默认 > 继承主代理（未配置时零侵入）；
- **主代理指引** —— 系统提示自动注入角色清单，主代理知道何时委派给谁；
- **设置界面** —— DSH 设置面板内可视化配置（默认模型 + 角色卡片增删改）；
- **continuable 后台** —— 返回可续聊子代理 id，配合 send_message 持续委派；
- **可观测性** —— 打开子代理会话时，composer 下方显示其实际运行的供应商/模型。⚠️ 该功能暂不可用，正在开发中；

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
    toolName: subagent_role      # 模型可见工具名
    enableRunInBackground: true
    backgroundMode: one-shot     # one-shot 或 continuable
    maxDepth: 3
```

> 注意：不要再用 `- insert:` 添加这两个条目，否则启动会报
> `duplicate loader entry id`。

### 角色模板（设置界面或 settings.yaml）

settings 命名空间 `subagent-director`：

```yaml
subagent-director:
  defaultRole: code-reviewer
  fallbackOnInvalid: true
  roles:
    code-reviewer:
      displayName: 代码审查员
      description: 审查代码质量、安全与可维护性，输出结构化评审意见
      persona: 你是严谨的代码审查员，逐条指出问题并给出修改建议
      provider: deepseek-official
      model: deepseek-reasoner
    translator:
      displayName: 翻译员
      description: 在中文与英文之间翻译技术文档
      provider: <pi-ai-route>
      model: qwen2.5-7b
```

### 使用

对话中委派（主代理会看到角色清单指引，自动选择工具与角色）：

```text
subagent_role({ role: "translator", prompt: "把 README.md 翻译成英文" })
subagent_role({ role: "code-reviewer", model: "deepseek-chat", prompt: "..." })  # 临时覆盖模型
```

## 术语

- **subagentProvider（传输）**：`spawn` / `fork` / `acp`——子代理跑在哪条传输链路上；
- **provider（LLM route）**：`deepseek-official`、pi-ai route——模型请求实际发给哪个供应商。

两者是**两套命名空间**，配置时不要混淆。

## 开发

```bash
npm install
npm test          # vitest（129 用例）
npm run typecheck
npm run build     # host(tsc) + client(rolldown bundle)
```

## 路线图

- v0.2：子代理目录内直接展示实际模型；composer 快捷选择「本次委派模型」；
- v0.3：顶替内置 subagent 工具名（无感升级）；对 workflow/ralph 的默认模型兜底；
- 欢迎通过 Issue / PR 提出想法。

## FAQ

**为什么需要两个插件条目？**
DSH 的 Web API 只向白名单内的 settings 命名空间开放读写。本插件通过自注册的 `/subagent-director` HTTP 路由桥接自己的命名空间，而该路由依赖的 webServer 服务只能经 cordis `inject` 获取，因此拆成独立的 `subagent-director-bridge` 条目（无 Web 的 headless 场景它会自动不激活，主条目不受影响）。

**未配置任何角色时行为如何？**
与未安装本插件时完全一致：subagent 继承主代理模型，零侵入。

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
- **Observability** — the addressed subagent’s actual provider/model shown under the composer. ⚠️ Not yet available — under development.

**Install** — `dsh plugin --profile <name> add dsh-plugin-subagent-director` mounts the main and bridge entries automatically from the package's bundle patch (`cordis.patch.yml`); optionally override the main entry's config in your profile's cordis.patch.yml (see the Chinese section above). License: MIT.

<div align="center">

# 🎬 Subagent Director（子代理导演）

**Assign an LLM provider and model to DeepSeek Harness subagents, and plan the main-agent / subagent division of labor with role templates**

[![npm version](https://img.shields.io/npm/v/dsh-plugin-subagent-director?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-plugin-subagent-director)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-subagent-director?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-plugin-subagent-director)
[![license](https://img.shields.io/npm/l/dsh-plugin-subagent-director?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js)](package.json)
[![GitHub release](https://img.shields.io/github/v/release/SeverusZh/dsh-plugin-subagent-director?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-plugin-subagent-director/releases)
[![GitHub stars](https://img.shields.io/github/stars/SeverusZh/dsh-plugin-subagent-director?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-plugin-subagent-director)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.1%20%2F%20rc.2-blue?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

**Subagent Director** is an out-of-tree DeepSeek Harness plugin that lets you choose an LLM provider and model for subagents, and plan main-agent / subagent responsibilities through role templates.

---

## ✨ 功能特性 / Features

- **Provider/model selection** — a configurable default LLM provider (route) and model for subagents; each delegation can also specify `provider` / `model` explicitly from the model side;
- **Controlled model selection** — provider/model are chosen only from the official `subagent-model-selection` allowlist (`allowedModels`): an explicitly passed unauthorized route is a hard error, while unauthorized routes at the plugin-default / role-binding layer are dropped and fall back to inheritance (no double-writing of model routes with the official dsh-tool-subagent);
- **Hot configuration reload** — changes in settings.yaml / the plugin config page take effect immediately, no restart needed;
- **Roles referenced by display name** — when the `role` argument misses an id it is matched exactly by `displayName` (the first of duplicates in definition order is used, with a notice); models can also be matched by display name;
- **Role templates** — define roles such as "code reviewer" and "translator": a responsibility description (shown to the main agent) + an optional Agent Preset (persona/tool composition) + an optional model binding;
- **Four-layer fallback chain** — per-call args > role binding > plugin default > inherit from the parent agent (zero intrusion when unconfigured);
- **Main-agent guidance** — the system prompt auto-injects the role list, so the main agent knows when to delegate to whom;
- **Config UI** — visual configuration inside the plugin detail page (plugin list → dsh-plugin-subagent-director; default models + add/edit/remove role cards); the settings panel no longer hosts this plugin's configuration;
- **Continuable background** — returns a durable subagent id for ongoing delegation with send_message;
- **Release continuable children** — a model-facing `close_subagent(subagent_id)` tool plus a "terminate continuable state" button on the subagent session page, actively releasing completed but still-resident continuable subagents (internally calling DSH core's `drainChildren`);
- **Observability** — when a subagent session is opened, its actual provider/model is shown below the composer (the real route is read from the session's `request/header` records; graceful degradation when unavailable);

## 📦 安装 / Install

### Install

```bash
dsh plugin --profile <name> add dsh-plugin-subagent-director
```

Or, for local development, mount a local checkout with `dsh plugin --profile <name> add link:<absolute path>`
(see the configuration example below).

### Installation notes

- Prefer `dsh plugin --profile <name> add dsh-plugin-subagent-director` directly (the npm
  release already includes the build output; peer dependencies are provided by DSH's
  `$DSH_HOME/profiles/node_modules` fallback, so it works out of the box).
- For local `link:` development: the git repo does not contain `lib/` (it is .gitignore'd),
  so run `npm install && npm run build` before mounting; and the checkout must live under
  `$DSH_HOME/profiles/` (or the repo must carry its own node_modules), otherwise the
  `@deepseek-ai/*` peer dependencies fail with `ERR_MODULE_NOT_FOUND`.

## 🚀 快速开始 / Quick Start

Delegating in a conversation (the main agent sees the role-list guidance and picks the tool and role automatically):

```text
subagent_role({ role: "translator", prompt: "把 README.md 翻译成英文" })
subagent_role({ role: "code-reviewer", model: "deepseek-chat", prompt: "..." })  # 临时覆盖模型
```

The `role` argument accepts a role id or a display name: when it misses an id it is matched
exactly by `displayName` (the first of same-named roles in definition order is used, with a
notice); using ids is recommended, see the Delegate line in the system prompt.

> **`subagent_role` and the built-in `subagent` are two different tools.** This plugin
> registers `subagent_role` (the tool name comes from the `toolName` config, `subagent_role`
> by default); the DSH base bundle also ships the built-in `subagent` / `subagent_fork`, and
> both appear **side by side** in the tool list of the same request. Only calls through
> `subagent_role` applies the role-bound `agentPreset` (persona/tools live inside the preset); switching the model to the built-in
> `subagent` disables both (model selection is handled by the official dsh-tool-subagent's
> `modelSelectionSettings`).
> So when role semantics are needed, explicitly ask in the prompt to call `subagent_role`.

## ⚙️ 配置 / Configuration

`dsh plugin add` auto-mounts the main and bridge entries (via the `cordis.patch.yml` shipped
with the package — `subagent-director` / `subagent-director-bridge`; the bridge entry exposes
the settings namespace to the Web UI), so you do **not** `insert` them manually. To override
the default configuration, override the main entry by id:

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

> Note: do not add these two entries with `- insert:` again, or startup fails with
> `duplicate loader entry id`.

## 🎭 角色模板 / Role Templates

Settings namespace `subagent-director`. Roles may leave provider/model unbound (inheriting the
global default model) or bind them as needed. Recommended default roles (with delegation
guidance and an optional Agent Preset; DSH 0.2.1 owns persona/tool composition in the preset, and the examples assume presets with these ids exist):

```yaml
subagent-director:
  defaultProvider: opencode-go
  defaultModel: minimax-m2.7
  defaultReasoningEffort: low
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

Declare `/orchestrate` at the start of a message (optionally followed by the task text, e.g.
`/orchestrate 分析上周A股走势`), or write "use orchestrate mode" in natural language (including
variants such as "请使用 orchestrate 模式" and "use orchestrate mode"), and that turn
automatically enters pure-orchestration mode — a per-turn declarative usage similar to
`/using aegis`, with no need to remember a toggle state; without the declaration, normal mode
is kept. `/orchestrate <task>` queues the task text into the next turn and wakes the model,
which handles the task in pure-orchestration mode. Once enabled, a "pure orchestrator" system
prompt is injected: the main agent may only hand out work through delegation tools, and the
role list is rendered dynamically from the current `subagent-director.roles` (no hard-coded
role ids). **When no roles are configured**, the binding pure-orchestration framework is not
injected; instead a short prompt tells the model to state that roles must be configured first
and to continue handling the request in normal mode (avoiding "no output in the conversation").
This mode depends on the host's `commands` and `sessionProjections` services: standard profiles
(dsh-base) provide both; when `sessionProjections` is missing the command returns an explicit
error instead of pretending to succeed, and when `commands` is missing the command is simply
not registered and the rest of the plugin is unaffected.

## 🧭 与官方子代理选择器的适配 / Official Subagent Selector Adaptation

Since DSH alpha.4, the built-in subagent's model selection converges on the official `subagent-model-selection` settings section (the `allowedModels` allowlist). This plugin v0.5.0 fully adapts to that mechanism:

- **Select only from the allowlist** — `route-resolver` constrains provider/model to the
  official `subagent-model-selection.allowedModels`: an explicitly passed unauthorized route is
  a **hard error**; unauthorized routes at the plugin-default / role-binding layer are
  **dropped and fall back to inherit from the main agent**;
- **No more double-writing of model routes** — the rc-era `applyDefaultRoute` patch seam is
  removed, so the plugin and the official selector never overwrite the same route
  (the provider/model selectable in the settings panel are exactly the options in the official
  "Plugins → plugin config → Subagent pool");
- **Client half migrated in step** — all rc-era references to
  `@deepseek-ai/dsh-client-runtime/client` (the `dsh-client-runtime` package) are removed
  (neither the alpha.4 nor alpha.5 host carries that package); the dock reading now reads the
  alpha.4 session `request/header` records, and the config page loads normally on both alpha.4
  and alpha.5 hosts.

## 📖 术语 / Glossary

- **subagentProvider (transport)**: `spawn` / `fork` / `acp` — which transport link the subagent runs on;
- **provider (LLM route)**: `deepseek-official`, pi-ai route — which provider the model request is actually sent to.

These are **two separate namespaces**; do not confuse them when configuring.

## 🧩 兼容性 / Compatibility

Since DSH 0.2.1 the compatibility gate prefers `engines.dsh`. This plugin declares **`engines.dsh: ">=0.2.1-rc.1"`**, and every `@deepseek-ai/dsh-*` peer is likewise `>=0.2.1-rc.1`:

| DSH version | Status |
| --- | --- |
| 0.2.1-rc.1 | ✅ typecheck / 297 tests / build / gate |
| 0.2.1-rc.2 | ✅ gate |

> Only versions that were **actually run** are listed; untested versions are omitted.

v0.6.0-beta.1 targets DSH **0.2.1-rc.1+**. DSH 0.2.1 unified the subagent seam on `startActivation` / `drainChildren` and removed per-request persona/toolFilter; this release migrates persona/tool composition to an independent Agent Preset and adds an `agentPreset` field to role templates. **Breaking**: no longer compatible with 0.1.x / 0.2.0-rc.1; use **0.5.6** on older hosts.

## 🛠️ 开发 / Develop

```bash
npm install
npm test          # vitest（253 用例）
npm run typecheck
npm run build     # host(tsc) + client(rolldown bundle)
```

## ❓ FAQ

**Why are two plugin entries needed?**
DSH's Web API only opens read/write to a whitelisted set of settings namespaces. This plugin bridges its own namespace through a self-registered `/subagent-director` HTTP route, and the webServer service that route depends on can only be obtained via cordis `inject`, so it is split into a separate `subagent-director-bridge` entry (in a headless environment without Web it simply does not activate, and the main entry is unaffected).

**What happens when no roles are configured?**
With no roles and no default model configured it behaves exactly as if the plugin were not installed (zero intrusion). With `defaultProvider`/`defaultModel` configured: if the official `subagent-model-selection` is enabled and has an `allowedModels` allowlist, the default route takes effect only within that list (otherwise it is dropped and falls back to inheritance); if no allowlist is configured, the plugin's default behavior is kept and a warning is shown.

**Can a session that used `/orchestrate` still be opened after uninstalling the plugin?**
No. `/orchestrate` writes an `orchestrate/change` event into the session log, and the host's persistence-load validation rejects loading the entire log when it meets an event type that is "unknown and not marked ignorable" (to avoid misreading the log's semantics). The plugin registers that event type dynamically when mounted, so normal use is unaffected; but in an environment where this plugin is not mounted (after uninstall, or another profile) these sessions cannot be opened. Upstream does not yet provide an official registration API or an `ignorable` write API for third-party event types — a known trade-off, see [issue #6](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/6).

**Do new providers/APIs appear automatically?**
Yes. The config page subscribes to provider and settings change events; after you add a provider/API key on the Models page, the dropdown refreshes automatically, with no restart.

## 📄 许可证 / License

[MIT](./LICENSE) © Subagent Director contributors

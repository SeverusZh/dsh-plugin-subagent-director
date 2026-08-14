# Subagent Director（子代理导演）

> dsh-plugin-subagent-director — 为 DeepSeek Harness（DSH）的 subagent 指定 LLM 供应商与模型，并以"角色模板"规划主 agent 与子代理的分工。

[English](#english) · [中文](#中文)

---

## 中文

### 这是什么

Subagent Director 是一个 DSH 树外插件。默认情况下，DSH 的 subagent 会继承主 agent 的模型，且 `subagent` 工具无法在调用时指定模型。本插件提供：

- **供应商/模型选择**：为 subagent 配置默认的 LLM 供应商（route）与模型名，或在每次委派时由模型显式指定；
- **角色模板**：定义"代码审查员""翻译员"等角色（职责描述 + persona + 可选绑定模型），把"主 agent 规划、子代理执行"的分工固化下来；
- **四级回退链**：单次调用参数 > 角色绑定 > 插件默认 > 继承父 agent（未配置时零侵入）；
- **主 agent 指引**：向主 agent 注入角色清单，告诉它何时委派给哪个角色。

### 安装

将插件安装到你的 profile（以 web profile 为例）：

```text
dsh plugin --profile web add dsh-plugin-subagent-director
```

或本地开发时以 file: 路径挂载（profile 的 package.json 或 cordis.patch.yml）。

### 最小配置（cordis.patch.yml）

```yaml
plugins:
  subagent-director:
    subagentProvider: spawn      # 传输 provider：spawn（无父上下文）/ fork（继承父历史）
    toolName: subagent_role      # 模型可见工具名
    enableRunInBackground: true
    backgroundMode: one-shot
    maxDepth: 3
```

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
      provider: pi-ai-profile-name   # 某个 pi-ai route
      model: qwen2.5-7b
```

### 使用

对话中委派：

```text
主 agent 看到角色清单后，会调用：
subagent_role({ role: "translator", prompt: "把 README.md 翻译成英文" })

临时覆盖模型（单次调用优先）：
subagent_role({ role: "code-reviewer", model: "deepseek-chat", prompt: "..." })
```

### 术语（重要）

- **subagentProvider（传输）**：`spawn`/`fork`/`acp`——子代理跑在哪条传输链路上；
- **provider（LLM route）**：`deepseek-official`、pi-ai route——模型请求实际发给哪个供应商。
两者是**两套命名空间**，配置时不要混淆。

### 人工冒烟验证

1. `npm run build` 产出 lib/；
2. 将本插件挂载进 web profile 并重启；
3. 发起一次带 `provider/model` 或 `role` 的委派；
4. 解码子代理会话日志核对实际模型（tools/decompress-session.cjs 可按 zstd 帧解码 session.jsonl.zstd，过滤 provider/model 相关行）：
```text
node tools/decompress-session.cjs "<DSH_HOME>/sessions/<workspace>/<childSessionId>/session.jsonl.zstd"
```
   确认子代理日志中 request/context 的 provider/model 与配置一致。

### 开发

```text
npm install
npm test          # vitest：37 用例
npm run typecheck # tsc --noEmit
npm run build     # 产出 lib/
```

### 路线图

- M1 ✅：Host 核心（设置 schema、四级路由解析、subagent_role 工具、主 agent 指引，含真实端到端验证）；
- M2 ✅：设置界面（settings.section UI：默认模型 + 角色卡片，client bundle 加载验证通过）；
- M3a ✅：continuable 后台模式（send_message 续聊 + 结算通知语义）；
- M3b（进行中）：toolFilter 注入、结果可观测性（UI 显示子代理实际模型）；
- M4（规划中）：顶替内置 subagent 工具、对 workflow/ralph 的默认模型兜底。

### 许可

MIT。版权归 Subagent Director contributors。上游依赖 `@deepseek-ai/*`（peerDependencies，由使用方 profile 提供，本包不捆绑）。

### GitHub / 发布

- 源码：<https://github.com/SeverusZh/dsh-plugin-subagent-director>（GitHub 仓库建仓后生效）
- Issues：<https://github.com/SeverusZh/dsh-plugin-subagent-director/issues>
- npm：`dsh-plugin-subagent-director` @ `0.1.0`（npm publish 后生效）
- 变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

---

## English

**Subagent Director** is an out-of-tree DeepSeek Harness plugin that lets you choose an LLM provider and model for subagents, and plan main-agent/subagent responsibilities through role templates.

- **Provider/model selection** — a configurable default route plus optional per-call `provider`/`model` arguments on the `subagent_role` tool;
- **Role templates** — named roles carrying a description, a persona, and an optional model binding;
- **Four-layer resolution** — call args > role binding > plugin default > inherit from the parent agent (zero intrusion when unconfigured);
- **Main-agent guidance** — a system-prompt section listing roles and when to delegate to each.

See the Chinese section above for install, configuration, usage, and verification.

### Publish

- **Source / Homepage**: <https://github.com/SeverusZh/dsh-plugin-subagent-director> (repo becomes live once created)
- **Issues**: <https://github.com/SeverusZh/dsh-plugin-subagent-director/issues>
- **npm**: `dsh-plugin-subagent-director` @ `0.1.0` (live after `npm publish`)
- **Changelog**: see [CHANGELOG.md](./CHANGELOG.md)
- **License**: MIT — Copyright (c) 2026 Subagent Director contributors.

---

详细需求与设计见《需求文档.md》与《技术设计方案.md》。
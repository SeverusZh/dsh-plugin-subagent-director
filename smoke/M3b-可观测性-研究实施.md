# M3b 可观测性研究·实施记录（Subagent Director）

工作目录：E:\MyProjectCollection\Plugins\dsh-subagents-options
只读参考：E:\DeepSeekHarness（node_modules/@deepseek-ai 为实际包源码）
范围红线：不碰 profiles\web、共享配置、package.json、README；只写 src/client/*、test/*、smoke/M3b-*.md。

---

## 第 1 步 · 数据可得性（实证结论）

### 1.1 subagents wire 视图（dsh-host-apiproxy）
- subagents.d.ts:12-29 → SubagentListEntry（catalog/list 的 wire 行）仅含 kind.id.activity.hasChildren 以及 mode + label。
  不含 agentProvider / agentModel。
- subagents.d.ts:48-51 → SubagentCatalog = { entries, parentAvailable }；history() 返回 events + projections?。

### 1.2 subagent 投影单位（dsh-subagent）
- projection-types.d.ts:24-43 → SubagentIdentityProjection 只折叠 { mode, label, seq }；44-58 → SessionProjectionMap 只注册 subagent 与 subagentTiming。无 provider/model。
- projection.d.ts:30-46 → identity 折叠 = 仅 mode/label（last-wins）。
- list-children.d.ts:28-29 → 注释明示 never expose model-hidden descriptor content（列表故意隐藏模型信息）。
- descriptor.d.ts:68-75 → continuable 描述符（子代理会话日志内 subagent/descriptor 事件）确实含 agentProvider/agentModel，但只存在于子代理自己的会话记录，不进列表/catalog/投影 wire 视图。

### 1.3 session-summary / session-query
- sessions.d.ts:173-218 → SessionSummary 含 agentPreset/origin/projections，不含 provider/model。
- sessions.d.ts:61-64 → HistoryEntry.event: SessionEvent（原始事件）；history 返回的原始事件里含 request/header（dsh-session types.d.ts:191-200 EpochHeader.config: LlmCallConfig{provider,model}）与 request/context（types.d.ts:201-209 RequestContext{provider,model}）——模型信息在子代理转写文本中可得，但需读日志，不在零 RPC 的列表/catalog 视图。

### 1.4 客户端打开子代理后可零 RPC 拿到实际使用的 provider/model
- dsh-client-runtime conversation.d.ts:367-395 → ConversationSnapshot.subagent（地址；父在线与否）。
- conversation.d.ts:374 → nodes: readonly ConversationNode[]（legacy 兼容字段）。
- conversation.d.ts:79-96 → AssistantMessageNode.provenance: AssistantProvenanceView{provider,model}（行 24-27、94）与 requestConfig: AssistantRequestConfig{provider,model}（行 13-22、95）。
  ⇒ 子代理会话一旦打开，转写快照里每条助手消息都可能带 provenance/requestConfig，这就是真实的实际模型来源，无需额外 RPC。

### 数据可得性小结
| 视图 | provider/model | 说明 |
| catalog/list wire（SubagentListEntry） | 无 | model-hidden |
| subagent 投影（subagent/subagentTiming） | 无 | 仅 mode/label/duration |
| SessionSummary（agentPreset/origin/projections） | 无 | — |
| 子代理转写（history 的 request/header、子代理描述符） | 有（需读日志） | request/context、subagent/descriptor.agentProvider/agentModel |
| 客户端已打开子代理的会话快照（AssistantMessageNode.provenance/requestConfig） | 有（零 RPC） | 本次采用 |

---

## 第 2 步 · UI 插入点（实证结论）

官方 catalog 树在 dsh-client-ui-subagent 内：
- client.js:689-695 → ctx.slots.inject(conversation.session.header.actions, {id:subagent-catalog, order:10} … SubagentCatalogAction)。
- client.js:170-341（CatalogRows）→ 行内容由单个组件内部决定：secondary=[summary.title, mode, activity]，metrics=[token, duration]。无按行 slot / 无可注入的行贡献点。
  ⇒ 无法经 ctx.slots.inject 扩入官方 catalog 的行显示。

槽位模型（ui-slots index.d.ts）：
- conversation.session.header.actions 为 list 槽（slots.d.ts:57-61），可叠加多插件，但官方行渲染是内部实现，行内容不可扩展。
- conversation.composer 为 chain 槽（slots.d.ts:154-158），单选赢家，无法把模型提示直接叠加到官方 SubagentReadOnlyComposer（client.js:696-701）。
- conversation.composer.dock 为 list 槽（slots.d.ts:203-207）：composer 卡下方的横带，环境读数座；owner=InputZone{session,input}。
  ⇒ 次优方案：在 dock 加一条只读读数，当当前会话是已寻址的子代理时显示其实际运行的 provider/model；不可得时降级文案。
  该槽是 list、独立于 composer chain 赢家，叠加安全，符合计划「点击子代理后在只读 composer 区域顶部显示模型提示」的最小可用形态。

取舍（写入设计偏离）：
- 首选「在 catalog 行上直接显示 provider/model」不可行（数据在 wire 视图不可得，且官方行渲染不可扩展）→ 改走 composer.dock 读数。
- 不主动拉历史取 request/header：打开的会话快照已足够（零 RPC、如实）。

---

## 第 3 步 · 实施决策
1) 纯逻辑（可单测）：src/client/subagent-model.ts
   - latestSubagentModel(snapshot) → 从 ConversationSnapshot.nodes 里最后一条 kind===assistant 且带 provenance/requestConfig 的节点提取 { provider, model }。
   - modelReadout(...) → 生成展示文案（provider/model 或降级文案），含纯格式化函数。
2) client 组件：src/client/SubagentModelDock.tsx —— 注册 conversation.composer.dock（list）。
3) src/client/index.ts：声明 augment SlotMap[conversation.composer.dock]（本地编译视图；运行期由 ui-conversation 声明）并 ctx.slots.inject 注册。
4) locales 增密钥；test/subagent-model.test.ts 覆盖。toolFilter 补测见独立小节。

# EvidenceBundleDraft — 2026-08-28

## 单元/构建证据（fresh，提交前最后运行）
- `npm test`：13 文件 178 用例全绿（基线 150 → +28）
  - test/route-resolver.test.ts 22、settings-schema.test.ts 17、toolfilter-capability 10、close-tool.test.ts 6（新）、remote-bridge.test.ts 24、subagent-model.test.ts 21 等
- `npm run typecheck`：干净（tsc --noEmit 无错误）
- `npm run build`：tsc + rolldown client bundle 成功（lib/client/index.js 1788 行 60964B）

## 集成证据（Cordis 探针，真实 DSH 运行时）
- Tool.listTools：动态注册的 `close_subagent`、`director_probe` 出现在模型可见工具列表（spill 文件 1635/1651 行）
- 探针枚举 6 个 live agents 对非驻留子代理（内置工具产物 8f0df599）执行 drain → 全部 resolved（no-op 语义符合核心文档 "Absent targets are accepted no-ops"；内置工具子代理完成后即非驻留 [ready]）
- 端到端闭环（.probe-e2e.txt，已清理）：
  - `startContinuable` 创建真实 continuable 子代理 fb94b478（descriptor mode: continuable, provider: spawn, parentSession: session-8223e8ec）
  - 子代理完成（回复 OK）
  - `drainContinuableChildren(parent, [childId])` → **resolved**
  - list_agents：fb94b478 由驻留变为 [ready]（handle 已释放，仅存储）
- 真实会话日志：`assistant/message` 无 provider/model；`request/header` 携带 `data.header.config.provider/model`（ollama-pro/deepseek-v4-flash:0731）——可观测性数据源验证

## 覆盖范围
- 直接目标：issue#1 两个方案、issue#2 根因修复、可观测性数据链路
- 未覆盖：GUI 浏览器渲染（dock 读数与按钮的实际显示）——需安装插件并重启 profile 验证（用户要求减少重启，以探针证据 + slot 契约类型核实替代）；已明确为残余风险

## 提交
- fb14490 on main；工作区干净（除 docs/superpowers 新文件已提交）

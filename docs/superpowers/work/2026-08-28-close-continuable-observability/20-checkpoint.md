# TodoCheckpointDraft — 2026-08-28

- 已完成：调研；计划；Task1-2（issue#2 空 toolFilter，49 用例）；Task3（close_subagent 工具，6 用例）；Task4（桥 subagentClose/subagentModel，24 用例）；Task5（dock RPC 数据源，21 用例）；Task6（header 终止按钮）；Task7（README/CHANGELOG/0.3.0/peer rc.8）。
- 活跃切片：Task8 集成验证（探针）。
- 已收集证据：
  - `npm test` 13 文件 178 用例全绿；`npm run typecheck` 干净；`npm run build` 生成 client bundle（1788 行）。
  - Tool.listTools：`close_subagent`（1635 行）、`director_probe`（1651 行）在模型可见列表。
  - 真实会话日志：`assistant/message` 无 provider/model；`request/header` 带 `data.header.config.provider/model`（ollama-pro/deepseek-v4-flash:0731）。
- 阻塞：无。
- 下一步：等待探针子代理（8f0df599）完成 → list_agents 确认驻留 → close_subagent 释放 → list_agents 确认消失 → 收尾（undefine 探针插件、git 提交、最终汇报）。

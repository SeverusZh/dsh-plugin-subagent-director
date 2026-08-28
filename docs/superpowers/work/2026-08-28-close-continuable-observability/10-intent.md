# TaskIntentDraft — 关闭 continuable 子代理 + 可观测性打通 + 空 toolFilter 修复

- 请求方：用户（2026-08-28），GitHub issue #1/#2 + 可观测性 README 标注。
- 目标：issue#1 两个预定方案（UI 终止按钮 + 主代理 close_subagent 工具）；issue#2 空 toolFilter bug 修复；可观测性功能调研并开发打通。
- 范围：dsh-plugin-subagent-director 仓库（本 checkout），不含 DSH 核心修改。
- 非目标：不改 DSH 核心/其他插件；不强制推送 GitHub（交付本地提交，推送由用户决定）。
- 风险提示：drain API 依赖 dsh-subagent>=0.1.0-rc.8；provenance 字段在 rc.2/rc.8 无运行时填充（已实测）。
- 基线：仓库 150 测试全绿；main 分支 c5c18c8。

## BaselineReadSetHint
- GitHub issue #1（body + 作者评论）+ issue #2（body 根因链）
- README.md 特性段（可观测性标注位置）
- DSH 核心：dsh-subagent drain API、dsh-agent agents.get、dsh-session-query readSession、client slot 契约（slots.d.ts）、真实会话日志（request/header 事件）

## ImpactStatementDraft
- src/route-resolver.ts、src/settings.ts：空 toolFilter 判定（行为修复）
- src/close-tool.ts（新）、src/index.ts：close_subagent 工具
- src/bridge-contract.ts、src/remote.ts、src/bridge-entry.ts：桥端点扩展
- src/client/*：dock RPC 数据源 + header.actions 按钮 + locales
- README/CHANGELOG/package.json：文档与版本

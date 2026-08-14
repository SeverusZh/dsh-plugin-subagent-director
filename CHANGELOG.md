# 更新日志（Changelog）

本项目的所有显著变更都会记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本（Semantic Versioning）](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-08-14

首个正式版本：围绕「让每个 subagent 可指定 LLM 供应商/模型，并以角色模板规划主 agent 与子代理分工」的目标，完成 Host 核心、设置界面与后台模式三大部分。

### 立项（docs）

- 编写需求文档 v0.2 与技术设计方案 v0.1，完成 Subagent Director 项目立项（docs 提交）。

### M1 — Host 核心（feat / fix）

#### 新增

- **settings 模块**：新增 settings 命名空间 `subagent-director` 与 schema 单测（30 用例全绿，typecheck 通过）。
- **subagent_role 委派工具**：实现 `subagent_role` 工具、角色指引与插件装配；支持四级回退链（单次调用参数 > 角色绑定 > 插件默认 > 继承父 agent），37 用例全绿，build 通过。
- **主 agent 指引**：向主 agent 注入角色清单，告知何时委派给哪个角色。

#### 修复

- **装载崩溃**：修复 `inject` 缺失 `'tools'` 导致的装配崩溃（`cannot get property \"tools\" without inject`）；补上 `'tools'` 注入。
- **端到端复验**：smoke 冒烟验证通过——子代理实际运行于 `deepseek-v4-flash` 路由，证明模型路由生效。

### M2 — 设置界面（feat）

- **客户端插件**：新增设置界面 client 插件，包含 store + 组件 + 多语言 i18n + rolldown client bundle（默认模型 + 角色卡片），60 用例全绿。
- **加载验证**：client 插件在 DSH web 界面中真实加载验证通过。

### M3a — continuable 后台模式（feat）

- **continuable 后台模式**：支持 `send_message` 续聊 + 结算通知语义；总用例数至 73 全绿。
- **文档**：补充 client 插件真实加载验证记录。

[0.1.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.1.0

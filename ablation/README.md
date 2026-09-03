# dsh-plugin-subagent-director 消融实验

基线：`dev-slim` @ deb31c2 (0.5.0-beta.2)，原测试套件 20 文件 / 278 测试全部通过（`npx vitest run`）。

## 模块清单（消融点）

| ID | 模块 | 消融方式 | 变体文件 |
|---|---|---|---|
| M1 | delegation 工具（subagent_role 注册） | code：移除 `mount()` 中 `createDelegationTool` 注册 | `variants/M1.patch` |
| M2 | close_subagent 工具 | code：移除 `ctx.tools.register(createCloseSubagentTool)` | `variants/M2.patch` |
| M3 | 角色指引 guidance | code：移除 `applyGuidance` 调用 | `variants/M3.patch` |
| M4 | 编排 orchestrate | code：移除 `applyOrchestrate` 调用 | `variants/M4.patch` |
| M5 | 设置快照/面板 settings | code：移除 `createSettingsSnapshot`/`installDirectorSettings` | `variants/M5.patch` |
| M6 | 模型路由 route-resolver | code：移除 delegation-tool 内 `resolveRoute` 使用（stub 替换） | `variants/M6.patch` |
| M7 | bridge-entry（webServer 设置桥） | 静态验证：独立插件条目（不 import 主条目），消融=不挂载该条目 | —（无 patch） |
| M8 | 客户端 UI（lib/client/） | 静态验证：client 独立构建（scripts/build-client.mjs），主条目不依赖 client 产物 | —（无 patch） |

## 消融设计

- **code 变体（M1–M6）**：`variants/<ID>.patch` 为 git 风格 diff（修改 `lib/index.js` 或
  `lib/delegation-tool.js`）。注意：本仓库 `lib/` 在 `.gitignore` 中（未跟踪），`git diff`/`git checkout`
  无法直接使用，patch 由 `ablation/variants/_pristine/` 中的原始副本经 `diff -u` 生成；
  恢复采用 `git apply -R` + 原始副本兜底（见 `run.mjs`）。
- **静态变体（M7/M8）**：无 patch，探针直接做源码级/运行时独立性验证。
- **探针 `probe.mjs`**：真实 Cordis Context 挂载主条目（stub 与 `test/alpha4-probe.test.ts` 同构：
  tools/subagents/llm/settings 四服务），断言：
  - `loadOk`：apply 不抛错；
  - 负向（ablationEffective）：被消融模块功能消失（工具未注册 / section 未注册 / 命令未注册 /
    路由解析消失 / 命名空间未注册）；
  - 正向（corePass）：保留模块仍可用（另一工具注册、delegation execute 正常）。
- **运行**：`node ablation/run.mjs` → 逐变体 apply patch → 探针 → 恢复 → 汇总 `results.json`。

## 结果摘要

| 变体 | loadOk | pass | 关键观察 |
|---|---|---|---|
| M1 | ✅ | ✅ | subagent_role 未注册；close_subagent 保留 |
| M2 | ✅ | ✅ | close_subagent 未注册；subagent_role 保留 |
| M3 | ✅ | ✅ | roles 指引 section 未注册；两个工具保留 |
| M4 | ✅ | ✅ | /orchestrate 命令未注册；两个工具保留 |
| M5 | ❌ | ❌ | **加载失败**：`getSettings is not defined`（见下） |
| M6 | ✅ | ✅ | agentOptions 不再透传（路由解析消失）；工具本身可用 |
| M7 | ✅ | ✅ | bridge-entry 独立条目；主条目无 webServer 依赖 |
| M8 | ✅ | ✅ | 主条目不 import client；client bundle 为浏览器产物 |

**M5 分析**：`applyGuidance`/`applyOrchestrate` 直接引用 `getSettings` 变量，移除快照后
`const getSettings = settingsSnapshot.get` 一并消失 → apply 时 ReferenceError。设置快照是
主条目的**硬加载依赖**（其余模块均可独立消融）；即便绕过加载错误，delegation execute 也依赖
`getSettings()`，会继续级联失败。设置面板（installDirectorSettings → 命名空间注册）本身是软依赖
（无 settings 服务时跳过），但快照是硬依赖。

## 原测试套件在 code 消融下的反应（M1 示例）

> 注意：vitest 套件直接测试 `src/`（TypeScript 源），而消融 patch 作用于编译产物 `lib/`，
> 因此套件反应验证使用 `variants/M1-src.patch`（对 `src/index.ts` 做等价消融，src/ 由 git 跟踪）。

应用 `variants/M1-src.patch` 后 `npx vitest run`：

- 失败 6/278：`test/alpha4-probe.test.ts` 全部 6 个用例（依赖 subagent_role 注册/执行）→ **消融生效**；
- 通过 272/278：其余 19 个文件（route-resolver、envelope、settings、orchestrate、client、bridge 等）→ **核心保留**。

## 复现

```bash
node ablation/run.mjs          # 全变体消融 → results.json
node ablation/probe.mjs M1     # 单变体（需先 git apply variants/M1.patch）
```

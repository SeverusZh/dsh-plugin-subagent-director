# dsh-plugin-subagent-director 消融实验报告

基线：`dev-slim` @ deb31c2 (0.5.0-beta.2) · 原测试套件 20 文件 / 278 测试通过 · 消融探针 7/8 通过（M5 为有效负结果）

## 结果总览

| 变体 | 类型 | 消融目标 | loadOk | 结果 | 关键观察 |
|---|---|---|---|---|---|
| M1 | code | delegation 工具（subagent_role 注册） | ✅ | ✅ | subagent_role 未注册；close_subagent 保留 |
| M2 | code | close_subagent 工具 | ✅ | ✅ | close_subagent 未注册；subagent_role 保留 |
| M3 | code | 角色指引 guidance | ✅ | ✅ | roles 指引 section 未注册；两个工具保留 |
| M4 | code | 编排 orchestrate | ✅ | ✅ | /orchestrate 命令未注册；两个工具保留 |
| M5 | code | 设置快照/面板 settings | ❌ | ❌ | **加载失败**：`getSettings is not defined`（见结论 2） |
| M6 | code | 模型路由 route-resolver | ✅ | ✅ | agentOptions 不再透传（路由解析消失）；工具本身可用 |
| M7 | 静态 | bridge-entry（webServer 设置桥） | ✅ | ✅ | 独立插件条目，不 import 主条目；主条目无 webServer 依赖 |
| M8 | 静态 | 客户端 UI（lib/client/） | ✅ | ✅ | 主条目不 import client；client bundle 为浏览器产物（Node 中 ReferenceError） |

## 原测试套件在 code 消融下的反应（M1 示例）

> 说明：vitest 套件直接测试 `src/`（TypeScript 源），而消融 patch 作用于编译产物
> `lib/`，因此套件反应验证使用 `variants/M1-src.patch`（对 `src/index.ts` 做等价消融）。

应用 `variants/M1-src.patch`（移除 `mount()` 中 `createDelegationTool` 注册）后 `npx vitest run`：

- **失败 6/278**：`test/alpha4-probe.test.ts` 全部 6 个用例——均依赖 subagent_role 的注册/执行
  （seam removal 断言、settings 咨询、授权列表约束 4 例）→ **消融生效**；
- **通过 272/278**：其余 19 个文件全部通过——route-resolver / envelope / settings / orchestrate /
  close-tool / client / bridge 等模块不依赖 delegation 注册 → **核心保留**。

## 结论

1. **模块独立性高**：M1/M2/M3/M4/M6 五个功能模块均可独立消融（code），互不级联破坏；
   消融后插件正常加载，保留模块（另一工具注册、delegation execute）功能完好。
2. **设置快照是硬加载依赖（M5 唯一负结果）**：`applyGuidance`/`applyOrchestrate` 直接引用
   `getSettings` 变量，移除 `createSettingsSnapshot` 后 apply 即抛 `ReferenceError`，插件无法加载。
   即便绕过加载错误，delegation execute 也调用 `getSettings()` 继续级联失败。设置**面板**
   （installDirectorSettings → 命名空间注册）本身是软依赖（无 settings 服务时跳过），但**快照**
   是主条目的硬依赖——settings 模块不可独立消融。
3. **route-resolver 独立性**：M6 消融后 delegation 工具仍可执行（foreground 正常返回），仅路由
   解析/授权列表约束消失；route-resolver 为纯函数模块，不依赖主条目。
4. **bridge-entry 与 client 均为独立交付物**：bridge-entry 是独立插件条目（inject webServer，
   不 import 主条目），不挂载它不影响主条目；client 由 `scripts/build-client.mjs` 独立构建为
   浏览器 bundle（Node 中不可加载），主条目零依赖。
5. **测试套件与编译产物解耦**：套件测 `src/`，消融 patch 作用于 `lib/`——lib 级消融不影响
   套件结果，需 src 级等价消融才能观察套件反应（M1 示例：6 失败 / 272 通过）。

## 复现

```bash
node ablation/run.mjs          # 全变体消融 → ablation/results.json
git apply ablation/variants/M1-src.patch && npx vitest run && git checkout -- src/index.ts
```

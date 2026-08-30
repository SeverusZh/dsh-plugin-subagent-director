# Subagent Director x Blue 联调草案

> 状态：协作草案（P0）。本文用于与 Subagent Director 作者确认集成方向，不代表
> Blue 原生 UI 或插件契约已经定稿。

## 目标与边界

这次集成优先验证 Subagent Director 的 Host 领域能力能否作为普通 Harness 插件在
Blue 中运行，并提供可重复的本地安装、回归和手工验收路径。当前不修改 Blue，也不
引入 `@dsh-blue/*` 依赖；Blue 仍在独立演进，插件 API 的 P5+ 能力稳定后再决定原生
TUI surface、manifest 和 marketplace 的最终形态。

验证基线：

- Subagent Director：`585fd090969b9b33dd91971f98127837ae1779b4`
  （`0.4.0-beta.1`，本分支从该提交开始）；
- Blue：`1b080a6f517020e4a1af78be684c1074e049d5e1`；
- DeepSeek Harness：`0.1.1-rc.2`。

## 结论

项目的核心设计适合接入 Blue。角色解析、路由回退、默认 subagent route、设置热更新、
工具注册和 `/orchestrate` 都位于 Host/Cordis 层，没有与 React 设置页强耦合。将 Web
bridge 临时禁用后，已经在隔离 Blue profile 中确认：Blue 能正常启动和退出，
`/orchestrate on` 可执行，`close_subagent` 能进入工具目录。

原版的唯一 P0 启动阻塞是 bridge 把 `webServer` 声明成 loader entry 的必需依赖。
Blue 是 headless/TUI host，不提供该服务，于是 Harness 启动审计报告：

```text
dsh: 1 entry did not activate
dsh-plugin-subagent-director/bridge: pending (waiting for service: webServer)
```

本分支将 bridge entry 改成正常激活，再由 Cordis child fiber 动态等待
`webServer`。因此 headless profile 不再留下 pending loader entry；Web profile 中
route 仍会在服务出现时挂载，并随服务或插件卸载自动清理。

## 兼容与适配矩阵

| 能力 | 当前状态 | Blue 集成判断 |
| --- | --- | --- |
| Host 主条目 | 已兼容 | `tools`、`settings`、`llm`、`subagents` 均走 Harness 公共服务 |
| `subagent_role` | 已兼容 | 可被模型调用，角色 persona、route 和 tool filter 在 Host 层生效 |
| 默认 route | 已兼容 | `applyDefaultRoute` 能覆盖未显式选模型的内置 subagent 调用 |
| `close_subagent` | 已兼容 | 已进入 Blue 工具目录；依赖官方 subagent/agent 服务 |
| `/orchestrate` | 基本兼容 | 命令与 projection 可运行，但会话可移植性仍有上游限制 |
| 设置热更新 | 已兼容 | 可直接编辑 profile 的 `settings.yaml`，无需重启 |
| Web bridge | 本分支修复 P0 | loader headless-safe；只让 route child fiber 等待 `webServer` |
| React 设置页 | 尚未适配 | Blue 是 TUI，不能复用 DSH Web 的 React slots/settings surface |
| Blue `/settings` | 尚未适配 | 当前不会自动渲染第三方 namespace 的角色 CRUD |
| Agents pane | 尚未适配 | 当前事实模型只识别 `subagent` / `subagent_fork`，不会识别可配置的 `subagent_role` |
| 模型 dock / close action | 尚未适配 | Web client slot 不会自动迁移到 Blue TUI，需要独立 surface 或扩展点 |
| Blue manifest / marketplace | 暂缓 | 等 Blue 插件契约继续稳定，避免提前绑定 P5+ API |

## 本地安装与测试

以下命令使用一个隔离 profile，不修改 Blue 源码。两个 source 变量必须是绝对路径；
本地 checkout 需要先构建，并保留自己的 `node_modules` 以解析 peer dependencies。

```bash
export BLUE_SOURCE=/absolute/path/to/blue
export DIRECTOR_SOURCE=/absolute/path/to/dsh-plugin-subagent-director
export BLUE_TEST_PROFILE=blue-director-dev

npm --prefix "$DIRECTOR_SOURCE" ci
npm --prefix "$DIRECTOR_SOURCE" run build

PROFILE="$BLUE_TEST_PROFILE" \
DSH_BIN="$(command -v dsh)" \
bash "$BLUE_SOURCE/script/install-dev.sh"

dsh plugin --profile "$BLUE_TEST_PROFILE" add "link:$DIRECTOR_SOURCE"
dsh --profile "$BLUE_TEST_PROFILE"
```

`install-dev.sh` 只负责把当前 Blue checkout 安装到指定 profile；随后 `link:` 安装
Subagent Director 自己的 bundle patch。重复联调时，在代码改动后重新执行插件的
`build`，再重启该 profile；bundle patch 变更时应重新执行 `dsh plugin add`。

### 自动回归

在 Subagent Director checkout 中运行：

```bash
npm test
npm run typecheck
npm run build
```

新增的真实 Cordis 测试会验证 bridge entry 在没有 `webServer` 时已经 ACTIVE，
服务稍后出现时 route 能注册，服务或插件卸载时 route disposer 会执行。

### 手工验收

1. 启动时不出现 `pending (waiting for service: webServer)` 或
   `entry did not activate`。
2. 在 `/tools` 中确认 `subagent_role` 和 `close_subagent` 可见。
3. 分别执行 `/orchestrate on` 和 `/orchestrate off`，确认返回成功。
4. 在 profile 的 `settings.yaml` 中配置至少一个角色，让模型通过
   `subagent_role` 完成一次真实委派。
5. 运行期间修改该角色的 persona 或 route，再次委派，确认无需重启即可生效。
6. 用 `/quit` 退出，再恢复刚才的普通会话，确认 session 基本流程正常。

建议测试配置：

```yaml
subagent-director:
  roles:
    reviewer:
      displayName: Reviewer
      description: Review a change and return prioritized findings
      persona: Review rigorously. Lead with findings and cite concrete evidence.
```

## 针对 Blue 仍需完成的适配

### 1. 配置 surface

Host namespace 和热更新已经可用，但 Blue 用户目前只能手动编辑 `settings.yaml`。
后续应基于 Blue 的稳定插件 surface 提供默认 provider/model、角色 CRUD、persona 与
tool filter 编辑。这里应复用 Subagent Director 的 schema/领域逻辑，不复制一套配置
状态，也不能假设 Web React 组件可以直接运行在 TUI。

### 2. Subagent 可观测性

Blue 当前 agents pane 在事实提取层硬编码识别 `subagent` 和 `subagent_fork`。
`subagent_role` 的工具名又允许配置，因此简单把第三个名字写入 Blue 仍不够通用。
更合适的方向是由插件声明/发布 delegation activity，或由 Blue 提供可扩展的事实与
pane surface。这样角色名、任务、运行状态、实际 provider/model 和 close action 都能
由插件按自己的语义呈现。

### 3. Web 专属交互

现有 React client 提供角色设置、实际模型 dock 和关闭 continuable subagent 的按钮。
这些能力依赖 DSH Web 的 slots、connection 和 remote bridge，不会因为 Host 插件安装
而自动出现在 Blue。Blue 侧需要等价的 TUI 交互，但 Host API 应继续复用现有
settings/subagent/session seams，避免建立第二套业务协议。

### 4. `/orchestrate` 会话可移植性

命令会写入自定义 `orchestrate/change` 事件。没有安装插件的 profile 无法识别该事件，
可能拒绝加载相应会话；这不是 Blue 专属问题。建议等待 Harness 提供第三方事件注册或
ignorable 事件的正式 API，再把它视为跨 profile 可移植能力。在此之前，测试时不要用
重要会话验证卸载流程。

### 5. 打包与生态元数据

当前 Harness bundle 已足以用 `dsh plugin add link:...` 联调。Blue 原生 manifest、
能力声明、兼容版本和 marketplace 信息应在相关契约稳定后补充；当前分支不添加
Blue 私有依赖，也不要求 Blue 仓库为该插件增加特例。

## 希望与作者确认

1. 是否认可把 bridge 改为“entry 正常激活 + child fiber 动态 attach Web”的生命周期
   语义，并作为上游通用 headless 修复？
2. Blue 的配置 surface 是否应该完整复刻角色 CRUD，还是先以 settings 文件和只读状态
   为主，等真实使用反馈后再扩展？
3. Subagent Director 的 activity 是否适合拥有独立 pane/surface，而不是让 Blue 将
   可配置工具名硬编码为内置 subagent？
4. `/orchestrate` 的跨 profile 会话可移植性是否同意记录为 Harness 上游能力等待项？

我们的倾向是保持作者现有领域边界：Subagent Director 继续拥有角色、路由与编排语义，
Blue 只提供稳定的 TUI surface 和宿主能力，不在 Blue 内复制插件逻辑。

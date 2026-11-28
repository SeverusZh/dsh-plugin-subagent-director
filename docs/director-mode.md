# Director Mode

Director Mode 是 0.8.5 引入的 Agent Preset。它不是命令，也不是工具：在会话预设中选择
「导演模式」后，主代理与子代理的工具面由该预设组成与宿主白名单守卫共同决定。

## 主代理

- 只保留编排工具：`subagent_role`、`subagent_card_search`、`subagent_card_get`、`subagent_card_create`、`close_subagent`、
  `list_agents` / `send_message` / `wait_agent`、`ask_user_question` 与 Agent Teams
  任务板；另允许 `session_send_message` 做跨会话编排；
- 预设不挂载 bash、文件读写/搜索、技能、workflow 或内置 subagent；宿主侧按白名单收窄工具目录，
  并在执行层按当前会话预设拦截所有非编排工具，包括动态挂载的 MCP 工具；
- `subagent_role` 在 Director agent scope 内覆盖为 `role` 必填，预设切换时自动挂载/
  卸载；旧 `roles` 不参与 Director 委派；
- 不做实际工作，也不在子代理失败后接手其任务；失败时重写卡片或提示词重试、通过团队
  重派，或带证据向用户报告。

## 角色卡

- 每个子代理都必须由角色卡唤起；Director 会话中的 `subagent_role` 要求 `role` 必填；
- 先调用 `subagent_card_search` 检索（必要时 `subagent_card_get` 读全文），优先复用或恢复已有卡片；没有匹配卡片时才调用 `subagent_card_create` 创建，再用返回的 id 委派；
- 普通卡片未绑定 `agentPreset` 时，子代理默认运行在 `standard` 工作预设；内置 `director` 卡显式绑定 `director` 预设；
- 内置卡 `director` 只在 Director 会话的 guidance 与 role 解析中可见，不进入设置
  面板、导出或同 id 覆盖。

## Agent Teams

新的 Director 根会话默认开启 Agent Teams。多子代理任务应使用共享任务板：

- 新建根会话默认开启，已有显式选择则保留；离开 Director 后保留当前选择；
- 为任务写清 subject、description、验收标准与 write scope；
- 用 `send_message` 唤起或推进 owner，用 `wait_agent` 等待必需成员；
- 主代理在给出最终答复前收齐必需成员的结果。

## 配置

```yaml
- id: subagent-director
  name: dsh-plugin-subagent-director
  config:
    directorProvider: spawn       # 需支持独立 Agent Preset；fork 不可用
    directorWorkerPreset: standard
    directorTeamDefault: true
```

## 兼容

- 宿主缺少 `agentPresets` 服务时不会注册 Director 预设，插件其余功能照常；
- 旧会话日志中的 `orchestrate/change` 事件不会阻止加载；
- 0.8.5 不再提供 `/orchestrate`、编排投影或编排提示词。

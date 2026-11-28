# Changelog

本项目的所有显著变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.9.0 - 2026-11-28

### 新增

- **插件清单本地化** — `locale/en.json` 与 `locale/zh.json` 改为宿主解析的
  `meta.title` / `meta.description` 结构；插件管理器显示「子代理导演」与中文介绍，
  bridge 子条目通过 `./bridge/locale/*.json` 复用同一份文案。
- **插件图标** — 仓库根新增 36×36 透明单色 `icon.svg`（中心节点向三个子节点委派），
  声明 `icon`、`exports["./icon"]` 与 `files` 条目；主条目与 bridge 子条目都可解析图标。
- **页面头图标** — 插件页标题前新增与清单图标同语义的 currentColor 内联 SVG。
- **头像符号选择器** — 卡片编辑器把自由 emoji 输入改为「使用名称首字母」加 16 个固定符号
  网格；集合外的历史值显示为「当前自定义值」并可一键替换。新增共享 `CardAvatar` 组件，
  编辑器预览与卡片瓦片视觉一致；未选择时保存为 `undefined`，走名称首字母回退。
- **卡片库状态** — 每张卡显示使用中/关闭池/已停用、使用次数与最近使用时间；工具栏新增
  状态筛选与权重/最近使用/名称排序，其中「关闭池」筛选只显示进入关闭池且仍启用的卡片，
  已停用卡片归入「已停用」；新增「永不入池」开关（走 `cardBatch` 的 `pin`/`unpin`，
  不刷新 `updatedAt`），关闭池卡片可一键恢复。
- **检索能力文档** — README 补充权重、关闭池与 `subagent_card_search` /
  `subagent_card_get` 的用户可见行为。

### 变更

- **文案收口** — 强调色名称、复制卡后缀、推理强度占位符与客户端兜底错误全部接入中英
  词典；新增 24 个键，两字典各 256 键并保持键集一致。
- **客户端快照** — 新增 `usage`；卡片库默认按权重展示，关闭池只影响提示词与检索的默认
  可见性，显式按 id 委派仍然可用。
- **错误兜底** — 设置页的卡片存储错误与桥接调用失败统一显示本地化兜底文案；卡库快照
  与迁移结果中的宿主英文诊断不再进入页面文案。

### 修复

- **英文错误直出** — 卡片存储错误态不再渲染宿主 `message`，迁移未清除旧配置时不再拼接
  宿主 `clearError`；两种情况都只显示本地化文案。
- **关闭池状态滞后** — 页面获得焦点或恢复可见时刷新卡库快照，常开页面每分钟重算一次时间
  边界；无 `window` 的环境不注册任何监听。
- **选择模式误选** — 「永不入池」开关的点击与键盘事件不再冒泡到卡片选中区，勾选或取消
  pin 不会改变卡片选中态。

### 兼容

- 旧版顶层 `title` / `description` 的 locale 文件不再被宿主读取，需要迁移到 `meta`；
  本插件自带文件已完成迁移。
- 卡片 `emoji` 仍接受任意不超过 16 字符的历史值，后端不做枚举校验。
- 0.9.0 之前创建的 `local` 卡没有使用记录，按 `createdAt` 计算空闲：创建超过 30 天且
  使用不超过 1 次的卡片进入关闭池，超过 90 天的一律进入；卡片不会被删除，显式按 id
  委派一次即恢复，也可在设置页设为永不入池。
- 版本升至 0.9.0，依赖与运行时行为不变。

## 0.8.5 - 2026-11-27

### 新增

- **Director Mode Agent Preset** — 纯编排模式重做为会话预设 `director`。主代理只保留
  `subagent_role`、`subagent_card_create`、`close_subagent`、`list_agents` /
  `send_message` / `wait_agent`、`ask_user_question`、Agent Teams 任务板与压缩能力，
  不挂载 bash、文件读写/搜索、技能、workflow 或内置 subagent；预设由宿主
  `agentPresets` 注册，缺失时插件其余功能照常。
- **内置导演角色卡** — 代码内置 id `director` 的角色卡，只在 Director 会话的 guidance
  与 role 解析中出现；不写入存储、不进设置面板、不参与导出，保留 id 不可被同 id 卡片
  覆盖。
- **角色卡创建工具** — Director 会话新增 `subagent_card_create`：没有匹配卡片时先建卡，
  再以返回的 id 委派；未绑定工作预设的卡片默认回退 `standard`。
- **Agent Teams 默认开启** — 新的 Director 根会话在首步前自动开启 Agent Teams；已有
  显式选择则保留，离开 Director 后保留当前 Team 选择，用户可自行关闭。
- **预设切换同步** — 空白会话切入/切出 Director 时同步挂载/卸载 `role` 必填的
  `subagent_role` 覆盖与工作工具限制；离开后不残留限制。
- **工具白名单** — 宿主侧按当前会话预设收窄工具目录，并在执行层拦截非编排工具，
  包括动态 MCP 工具。
- **委派指引拆分** — 角色卡新增 `avoidGuidance`，设置面板拆为「推荐委派 / 不推荐委派」
  两个输入区，guidance 同时渲染两段。
- **本地化完善** — 预设菜单显示「导演模式」及中文描述；插件清单新增
  `locale/{en,zh}.json` 以本地化插件标题与介绍；设置页残余的 advisory 占位文案接入
  中英词典。

### 变更

- **纯编排模式退役** — 删除 `/orchestrate` 命令、`orchestrate` 投影、编排提示词与相关
  测试；不提供兼容命令。
- **卡片格式 version 2** — 新增可选 `avoidGuidance` 与 `builtin` source；版本 1 的
  导入仍被接受。
- **委派工具** — Director 会话中 `role` 必填；角色卡不存在或卡存储不可用时 fail
  closed；旧 `roles` 不再参与 Director 委派；卡片未绑定 `agentPreset` 时使用
  `directorWorkerPreset`。
- **内置卡优先级** — 内置 `director` 优先于存量同 id 卡片；存量同 id 卡在启动时自动重命名（保留数据），旧角色迁移不会占用保留 id。
- **配置字段** — 新增 `directorProvider`、`directorWorkerPreset`、`directorTeamDefault`。
- **包描述与文档** — 新增 `docs/director-mode.md`，包描述同步 Director Mode。

### 修复

- **Director 委派上下文** — agent scope 的 card-required `subagent_role` 使用 host entry
  的注入上下文执行，避免真实 DSH 中 `cannot get property "subagents" without inject`；
  真实宿主探针已覆盖建卡与前台委派。

### 兼容

- 旧会话日志中的 `orchestrate/change` 事件不会阻止会话加载；0.8.5 不再写入或读取该事件。
- `agentPresets` / `agentTeams` 缺失时相关能力降级，插件不因此阻塞加载。

## 0.8.0 - 2026-11-27

### 新增

- **角色卡** — 每张卡打包名称、模型绑定、固定系统提示词、persona、委派指引、标签、
  可选 Agent Preset 与启停状态；`subagent_role` 的 `role` 参数现在指向角色卡 id，
  旧的显示名匹配仍保留。
- **固定角色提示词** — 委派时预留子会话 id，并在该会话的系统提示词中注入卡片快照；
  运行中的子代理保持启动时的提示词，编辑卡片不会改写它。非本地传输无法预留
  子会话 id 时，提示词会附加到任务文本并给出警告。
- **独立文件存储** — 角色卡移出插件公共配置，保存到 DSH 存储域
  `subagent_director`，采用 per-record JSON：每张卡一个
  `<storage-root>/subagent_director/cards/<id>.json` 文档；默认卡 id 存在该域
  的 global 槽位。
- **导入导出与批量** — 支持单卡、集合、数组与裸卡片对象的 JSON 导入，冲突策略为
  跳过、覆盖或保留两者；支持选择导出、全量导出、批量启用/停用/删除。
- **旧角色迁移** — 一键把配置中的 `roles` 转为角色卡，保留默认角色、persona、模型
  绑定与 Agent Preset；旧工具集信息写入备注。迁移后可直接清除旧配置字段。
- **设置界面重构** — 插件详情页改为角色卡库：搜索、全部/启用/停用筛选、排序、
  批量选择、卡片编辑器、导入对话框、迁移确认、默认模型面板；采用统一设计令牌、
  响应式布局、亮暗主题、焦点环与减少动画支持。
- **真实宿主探针** — 新增真实 storage-domain per-record 持久化探针、真实
  `SystemPrompt` 组装探针与主插件集成探针，验证文件落盘、子会话级提示词注入与
  卡片服务挂载。

### 变更

- **角色模板退役** — 新 UI 不再编辑 `roles`；配置中的 `roles` / `defaultRole`
  仅作为迁移来源。未迁移的旧角色仍可被委派解析，避免升级后不可用。
- **默认角色** — 默认角色卡存于卡片域，优先于旧 `defaultRole`；删除或停用默认卡
  会自动清除默认引用。
- **依赖** — 新增 `@deepseek-ai/dsh-storage-domain` peer/dev 依赖；开发测试另用
  `@deepseek-ai/dsh-storage-json`。
- **版本** — 插件版本提升到 `0.8.0`；DSH 兼容下限仍为 `>=0.2.2-rc.2`。

### 修复

- 清理角色提示词绑定时不再让清理失败覆盖委派结果；`close_subagent` 释放可持续
  子代理时同步移除其卡片提示词绑定。

## 0.7.0 - 2026-11-26

### 修复

- **DSH 0.2.2+ 委派必崩（#19）**：DSH 0.2.2-rc.2 起 `SubagentActivationSpec`
  把 `prompt` / `parent` / `agentPreset` / `maxDepth` 扁平化到 spec 顶层，删除
  了 `request` 包装。前台 caller 与后台 parent 两处 `startActivation` 改为展开
  整份 request，修复 `Cannot read properties of undefined (reading 'id')`，并让
  Agent Preset、maxDepth 与模型路由重新生效。
- **close_subagent 在 0.2.2+ 不可用**：`drainChildren` 已从宿主移除。
  `startActivation` 返回的 `SubagentActivation` 是唯一公开的单子代理关闭凭证；
  插件现在保留自己启动的每个 continuable activation，`close_subagent` 与 Web
  会话页释放按钮按 child id dispose 对应 activation，并校验直接父代理。
  `agent/disposed` 会同步清理已由宿主回收的收据，避免长期驻留泄漏。释放只覆盖
  当前进程与当前 activation；`send_message` 冷恢复会创建新的、不再由本插件跟踪的
  activation。
- **真实宿主契约测试**：新增测试直接调用安装的 `SubagentRuntime.startActivation`，
  覆盖旧的 `request` 形状被拒绝、扁平形状保留 prompt/parent/preset/maxDepth。
  旧测试只 mock 了删除后的契约，因而无法发现这次漂移。
- **依赖对齐**：`@deepseek-ai/cordis` 对齐到 `~4.2.0-alpha.1`，
  `@deepseek-ai/schemastery` 对齐到 `3.20.0-alpha.1`，`zod` 对齐到 `4.6.6`；
  devDependencies 固定到 `0.2.3-alpha.2`。

### 变更

- **兼容下限收紧**：`engines.dsh` 改为 `>=0.2.2-rc.2`，`dshReleases` 记录
  `0.2.2-rc.5` 与 `0.2.3-alpha.2`。`dshReleases` 不参与宿主运行时门禁，真正
  阻止旧宿主加载的是 `engines.dsh`。
- **close_subagent 语义收窄**：宿主不再提供按 id 关闭任意 direct child 的公开
  API；工具只释放本插件进程内启动并保留 receipt 的 continuable 子代理。
  主机重启、插件重载或由其他工具启动的子代理会返回 `subagent-not-tracked`，
  而不是静默假装关闭。

### 破坏性

- 不再支持 DSH `0.2.1-rc.x` 与 `0.2.2-rc.1`；请停留在插件 `0.6.0`。

## 0.6.0 - 2026-11-04

### 新增

- **反向代理部署支持**：桥接的 Host 围栏可用白名单放行，解决反向代理下用域名访问时面板误报「服务器未提供设置桥接通道」。默认行为不变，仍只认回环。
- **白名单可写入 config.yaml**：新增 `trustedHosts` 配置项，环境变量 `DSH_SUBAGENT_DIRECTOR_TRUSTED_HOSTS` 保留兼容。

### 维护

- CI 固定 Actions 到完整 commit SHA，补充 `engines.node`，新增生产依赖审计门禁。

## 0.6.0-beta.2 - 2026-10-19

### 新增

- **设置界面视觉重做**：按 DSH 官方设计语言重做插件详情页配置区、composer 下方的模型只读行与会话头部的释放按钮。统一使用官方主题令牌（表面 / 文本 / 边框 / 状态色 / 焦点环），字号收敛到 11 / 12 / 13 / 14 阶梯，间距与圆角对齐 8pt 体系；亮色与暗色主题一致，层级靠字号、字重、颜色与间距表达。
- **统一组件样式**：默认模型卡、角色模板卡片、内联编辑表单、工具集选择器、主 / 次 / 危险按钮、输入框、状态 chip 与内联错误提示共用一套样式；补齐 `:focus-visible` 焦点环与克制的 hover / disabled 过渡，移除硬编码颜色。
- **可维护性**：新增一份随插件卸载清理的样式表，交互态由真实 CSS 规则表达，组件统一引用主题令牌与 class。

### 文档

- README / README.en.md 同步 0.6.0-beta.2 与界面说明；全部 Markdown 标题去除括号并精简。

## 0.6.0-beta.1 - 2026-10-17

### 兼容性：适配 DSH 0.2.1-rc.1 / rc.2

- **子代理接缝迁移**：DSH 0.2.1 将 `ctx.subagents.start()` /
  `startContinuable()` 合并为统一的 `ctx.subagents.startActivation(spec)`，
  并把 `drainContinuableChildren()` 更名为 `drainChildren()`。前台委派改用
  `delivery: 'caller'`（等待 `activation.result` 并按 stop-reason 报错），
  后台委派改用 `delivery: 'parent'`（立即返回持久化 child id，由运行时投递结果）；
  不再依赖 `dsh-jobs` / `dsh-tool-jobs`。本改动基于 @shudingbo 的 PR #12，
  并在最新 rc 上完成复核、修复与测试。
- **persona/toolFilter 迁移到 Agent Preset**：0.2.1-rc.1 从
  `SubagentStartRequest` / `SubagentCapabilities` 移除了 `persona` 与
  `toolFilter`（官方 `dsh-tool-subagent` 也会对这两个配置项硬报错），角色
  persona 与工具集改由独立 Agent Preset 统一承载。角色模板新增
  `agentPreset` 字段并在配置页提供输入框；旧的 `persona` / `toolFilter` 仍保留
  在设置文档中以免破坏已有数据，但不再发送到子代理接缝，委派时会给出迁移警告。
  选择 Agent Preset 需要非继承型 provider（如 `spawn`）；`fork` 等继承型
  provider 会得到明确错误。
- **依赖与门禁**：全部 `@deepseek-ai/dsh-*` peer 提升为
  `>=0.2.1-rc.1`，devDependencies 固定到 `0.2.1-rc.1`；新增
  `engines.dsh: ">=0.2.1-rc.1"`（DSH 0.2.1 起优先按该字段判定兼容性）。
  `zod` 固定为 `4.4.3`，与 DSH 内部 `dsh-session-projection` 的固定版本一致，
  避免 4.6.x 与 4.4.x 的 ZodType 身份不兼容。
  `dsh.compatibility.dshReleases` 收敛为 `0.2.1-rc.1` / `0.2.1-rc.2`。
- **验证**：`npm run typecheck`、`npm test`（20 文件 / 297 用例）、
  `npm run build`（host + client bundle）全部通过；新增 real-cordis 探针断言
  `agentPreset` 透传且 persona/toolFilter 不再进入请求体。
- **破坏性**：本版本不再兼容 DSH 0.1.x / 0.2.0-rc.1，旧宿主请继续使用
  `0.5.6`。角色中已有的 persona/toolFilter 需要迁移到 DSH Agent Preset，
  再在角色里填写 preset id。

## 0.5.6 - 2026-10-10

### 修复

- **one-shot 后台委派的 `owner` 传成 Agent 对象（#10）**：`jobs.start({ owner })` 期望
  父代理的 **SessionId 字符串**，插件此前传入整个父 Agent 对象；内核 `resolveOwner()`
  以 `agents.get(session)` 按 SessionId 查找活跃代理，对象键查不到即抛
  `session "[object Object]" has no live agent (background job owner must be live)`。
  现改为 `owner: parent.id`（与内核自带 `subagent` 工具一致），并新增回归测试
  `test/delegation-owner.test.ts`：断言传入的 `owner` 为字符串 id（把该行还原为对象后
  测试立即失败）。仅影响 `backgroundMode: 'one-shot'` + `run_in_background` 路径；
  continuable 与前台路径不受影响。

## 0.5.5 - 2026-09-29

### 兼容性

- **适配 DSH 0.2.0-rc.1**：`@deepseek-ai/dsh-*` 的 `peerDependencies` 范围由
  `^0.1.7-rc.1` 放宽为无上限的 `>=0.1.7-rc.1`（共 19 个 `dsh-*` 包）。DSH 0.2.0-rc.1
  新增插件兼容性门禁，对所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 做
  `includePrerelease` 的 semver 校验：旧范围 `^0.1.7-rc.1` 不匹配 0.2.0-rc.1，会导致
  整个 bundle 被跳过（`skipping profile bundle`）；`>=0.1.7-rc.1` 同时满足 0.1.7-rc.2
  与 0.2.0-rc.1。`@deepseek-ai/cordis` 不参与门禁，范围未变。
- 本机 **0.2.0-rc.1** 真实装载验证通过（插件正常加载、零错误，无门禁跳过告警）；
  兼容矩阵 `dsh.compatibility.dshReleases` 新增 `"0.2.0-rc.1": "compatible"`，
  README 徽章与兼容性声明同步更新。

## 0.5.4 - 2026-09-27

### 变更：配置移到插件详情页并退役 settings.section

- **移除 `settings.section` 注册**：DSH 设置面板不再承载本插件的配置。
- **新增 `plugins.bundle.config` 注册**（key = npm 包名 `dsh-plugin-subagent-director`）：
  默认模型行 + 角色卡片渲染在「插件列表 → dsh-plugin-subagent-director」页面的
  **描述与组件行之间**。该 keyed slot 只在注册了等于包名的 key 时由插件管理页渲染
  （`configured = ledger.bundles.has(pkg.name)`，见 `dsh-client-ui-plugin-manager`），
  没有原生兜底表单；bundle 页可能含多个条目，故页面不传宿主 `form`，store 继续自持
  其 bridge 与草稿生命周期。`view === 'summary'` 返回 null。
- **类型契约**：按官方 README 的做法，`import type { PluginConfigViewProps }` 从
  `@deepseek-ai/dsh-client-ui-plugin-manager/client` 合并 `SlotMap` 增强（**仅类型**，
  运行时不引入该包）；因此新增 devDependency
  `@deepseek-ai/dsh-client-ui-plugin-manager@0.1.7-rc.1`（与本仓库树内 dsh 包同版本，
  避免 rc.1/rc.2 混装）。
- README 中「DSH 设置面板内可视化配置」等入口描述同步更新。
- 不涉及 inject 变更（本插件不读取任何 `ctx.remote.*` 命名空间）。

## 0.5.3 - 2026-09-25

### 兼容：适配 DSH 0.1.7-rc.2

- 在本机 **0.1.7-rc.2** 上真实装载运行通过：全部入口激活、零错误、无 pending；
  设置读写（`settingsView` / `settingsMutate` 乐观锁）实测往返成功。
  `dsh.compatibility.dshReleases` 新增 `"0.1.7-rc.2": "compatible"`；README 徽章与
  兼容性说明同步。
- 0.1.7-rc.1 → rc.2 的官方 `@deepseek-ai/dsh-*` 公开 API 无移除、无改名（增量新增）。
  `dsh-subagent` 移除了对 `dsh-session-projection-cache` 的 peer 依赖并调整了后代
  列举语义（`listDescendants` / `listChildren`）——本插件不使用这些接口，无需适配。

### 加固：悬空 `defaultRole` 改为「读时告警」，恢复等价安全性

0.5.2 迁移到 DSH 0.1.7-rc.1 时，`defaultRole` 指向不存在 role 的跨字段约束无法用
schemastery 表达，写入时不再被拒绝——配置错误不再被主动暴露。本次把该防护从
「写时拒绝」改为「读时告警」，覆盖所有消费者，且不破坏 fail-safe：

- **读时检测**（`src/settings.ts`）：新增纯函数 `settingsWarnings(settings)` /
  `danglingDefaultRoleWarning(settings)`；唯一读取入口 `readDirectorSettings(config,
  warnings?)` 增加可选告警收集器，悬空时推入告警。**悬空值原样返回，不静默改写**用户
  配置（写错的值仍是用户写下的那个，便于更正）。不悬空/空值时返回 `[]`，无新噪音。
- **告警可见（日志）**（`src/index.ts`）：所有消费者共用的 `getSettings` 读取点把
  告警经 `ctx.logger.warn` 输出；按告警集合签名去重，持续悬空只告警一次，修好后清空、
  再次写错会重新告警。
- **告警可见（settingsView）**（`src/remote.ts` / `src/bridge-contract.ts`）：桥的
  `settingsView` 响应新增可选 `warnings: string[]`（由同一 `settingsWarnings` 计算），
  非悬空时省略该字段，响应形状保持不变。
- **保留**：`validateDirectorSettings` 与路由解析器既有的「警告 + 跳过绑定」行为均不变。

### Beta 说明

- 测试版 `0.5.3-beta.0`（`--tag beta`）的内容——设置子系统迁移至 `SettingsForms`
  （`0.5.2` 条目）与本条加固——随本版一并正式发布。

## 0.5.2 - 2026-09-24

### 兼容：设置子系统迁移至 DSH 0.1.7-rc.1 的 `SettingsForms`

DSH 0.1.7 移除了 `@deepseek-ai/dsh-settings` 的 `SettingsProvider.installSection`
（默认导出改为 `SettingsForms`），本插件原设置子系统因此在新版抛
`TypeError: ctx.settings.installSection is not a function` 而无法激活。本次按官方新模型重写：

- **设置声明 → 插件 Config schema**：`src/config.ts` 的 `Config` 现由「组合字段
  （普通，重启生效）」+ `src/settings.ts` 的 `SettingsFields`（设置字段，全部
  `.volatile()` 热更）合并而成。只有 volatile 字段进入宿主设置表单（`volatileForm`），
  故设置页内容不变；条目 id `subagent-director` 即 `describe()`/`mutate()` 的 ns。
- **设置读取 → `config.<field>.get()`**（`readDirectorSettings`）：快照实时跟随
  loader 的就地更新，设置面板改动即时生效、无需重启。
- **页面策略 → `settings.configure({ auto:false }, fiber)`**
  （`installDirectorSettingsPage`）：插件自带 Web 设置页，`auto:false` 避免宿主重复生成。
- **字段级写时校验下移到 schema**：旧 `installSection` 的 `validate` 钩子（kebab-case
  role id、非空 displayName/description、非空 provider）无法在新写路径表达，改为在
  `RoleTemplateSchema` / `SettingsFields` 中声明（role id 用 dict 的 key schema 校验；
  displayName/description 用 `required().pattern(/\S/)`），由 configEditor 在写回时校验
  Config schema 而拒绝非法写入。**保留限制**：`defaultRole` 指向不存在 role 的跨字段
  约束无法用 schemastery 表达，0.1.7 下不再于写入时拒绝；运行期路由解析器已对该情形
  警告并跳过绑定（`validateDirectorSettings` 仍保留该检查供显式调用/测试）。
- **官方 allowlist 读取改写**：0.1.7 无 `settings.get(ns)`，`directorCatalogOk` 与
  `readModelSelection` 改由 `settings.describe()` 的 `subagent-model-selection-settings`
  描述符读取（新增 `readNamespaceValue`）。
- **自发布设置桥与客户端协议不变**：`describe / mutate / writable /
  SettingsConflictError` 方法面在 `SettingsForms` 中不变，`/subagent-director` 的
  `settingsView` / `settingsMutate` 端点形状与乐观锁语义无需改动。

### 兼容：连带修复 0.1.7 客户端 API 漂移

依赖升到 0.1.7-rc.1 后 `tsc` 暴露两处客户端类型破坏，随本次一并最小适配：

- `AssistantProvenanceView` → `AssistantProviderMetadataView`，
  `assistant.provenance` → `assistant.providerMetadata`（形状不变）。
- `SessionListState` 移除 `current`（`settings.section` 的 owner props 仅 `close`）：
  移除设置页中已失效的 current-session 选择器；工具目录改由宿主全局注册表枚举
  （**已知回归**：角色工具集编辑器的「按当前会话枚举 agent 作用域工具」不再生效）。

### 兼容性

- `peerDependencies` 的 `@deepseek-ai/dsh*` 下限提升至 `^0.1.7-rc.1`（`dsh-host-apiproxy`
  历史例外保持 `^0.1.1-rc.2`）；`@deepseek-ai/cordis` 下限提至 `^4.0.4`（`Volatile` 类型导出）。
- devDependencies 补齐 0.1.7 `dsh-tools` 的新 peer（`dsh-sandbox` / `dsh-sandbox-policy` /
  `dsh-ptc-runtime` / `dsh-user-approval` / `dsh-invariants`）以便离线跑测试。
- `dsh.compatibility.dshReleases` 增列 `0.1.7-rc.1: compatible`。

### 测试

- `test/alpha4-probe.test.ts` 重写至 0.1.7：经真实 cordis 的 Config schema 挂载、
  断言 `configure({auto:false})`、经 `describe()` 读取官方 allowlist。
- `test/settings-schema.test.ts` 更新为 volatile 读取与 schema 级写入拒绝；
  删除 `test/settings-snapshot.test.ts`（`createSettingsSnapshot` 已随旧模型移除）。
- `npm test` 277/277 通过；`npm run typecheck` 与 `npm run build` 通过。

## 0.5.1 - 2026-09-22

### 变更

- **新增 `dsh.compatibility` 声明**（DSH STORE 上架契约）：`dsh` 字段下新增
  `compatibility`（保留原 `bundle` / `client`），逐版本声明兼容矩阵——`dshReleases`
  中 `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.6-alpha.2` 均为 `compatible`（三版本均已在本机
  真实装载运行，插件正常加载、零错误）；未实测的版本不声明（扫描时按 `unknown` 处理）。
- **`node` 范围判定为 `>=20`**：本仓库 `package.json` 未声明 `engines`、README 亦无 Node
  要求。判定依据——`tsconfig.json` 的 `target`/`lib` 均为 `ES2023`（完整 ES2023 内建能力
  对应 Node 20 的 V8），CI 在 Node 22 上执行 typecheck/test/build，且同作者的
  `dsh-yolo-mode` / `dsh-notify-windows` 均声明 `>=20`。代码中未使用 `Symbol.dispose`
  等 Node 20 独占 API，故此处为声明性的支持下限，而非编译期硬约束。

### 测试

- `npm run typecheck`、`npm test`、`npm run build` 全部通过（与 CI 步骤一致）。

## 0.5.0 - 2026-09-04

### 变更

- **设置页开头说明补充模型选择约束（beta.2）**：`sectionIntro` 增加一行
  「只能选择插件-插件配置-Subagent池里的提供商-模型」（中英双语），设置页打开
  即明确可选 provider/model 仅来自官方 Subagent 插件配置的模型池。

### 修复

- **客户端半 alpha.4/alpha.5 兼容性修复（beta.1）**：移除全部 7 处对 rc 时代
  `@deepseek-ai/dsh-client-runtime/client` 的引用（该包 npm 最新仅 0.1.1-rc.2，
  alpha.4/alpha.5 宿主均不携带，客户端 bundle 的运行时 `require` 在浏览器加载即
  失败，设置页/模型读数/关闭按钮整体不可用）：
  - `createSnapshotStore`/`SnapshotStore` 改从 `@deepseek-ai/dsh-client-store`
    导入（alpha 运行时，宿主 web bundle 虚拟模块）；
  - `ClientContext` 改为 cordis `Context`（官方 alpha 客户端模式），`ctx.slots` /
    `ctx.remote` / `ctx.uiConversation` 等 Context 增强经 `dsh-client-ui-renderer` /
    `dsh-api-remotes` / `dsh-client-ui-conversation` 的类型导入引入；
  - 会话类型改从 alpha 包导入：`SessionSnapshot`（`dsh-api-session-controller`）、
    `ConversationNode`/`AssistantMessageNode`/`AssistantProvenanceView`
    （`dsh-client-ui-conversation`）、`ChatSnapshot`（`dsh-client-ui-chat`）、
    `SessionListState`（`dsh-api-session-controller`）；
  - **composer.dock 读数适配 alpha.4 会话架构**：dock 槽位不再经 owner props 提供
    session（渲染时传空 `{}`），改为消费框架标准会话套件（`useSession`/`sessionId`），
    转录节点改从当前会话 chat 视图快照的 `legacy.nodes` 读取（`uiConversation`
    绑定 → `chat` target，惰性解析，设置页不依赖会话 UI）；RPC 兜底查询保留；
  - 移除过时的 `conversation.composer.dock` / `conversation.session.header.actions`
    SlotMap 增强（alpha.4 由 ui-conversation 声明，重复声明会类型冲突）；
  - `package.json` peer/dev 依赖移除 `dsh-client-runtime`，新增
    `dsh-client-store`、`dsh-client-ui-conversation`、`dsh-client-ui-chat`、
    `dsh-api-session-controller`、`dsh-client-ui-session`、`dsh-client-ui-renderer`、
    `dsh-api-remotes`（均 `^0.1.2-alpha.4`，同时覆盖 alpha.4/alpha.5 宿主）。

### 测试

- 新增 `client-compat.test.ts` 兼容性守卫：扫描 `src/client` 与 `package.json`，
  任何 `dsh-client-runtime` 残留引用即失败（本次 bug 的回归测试）；
- `subagent-model.test.ts` 更新为 alpha.4 形状（`SessionSnapshot.subagent` 地址、
  chat 视图 legacy 节点切片、`SubagentAddress` 的 continuable/one-shot 判别）；
- 新增 `client-apply-probe.test.ts` 真实 cordis 探针：客户端半在 alpha.4 形状
  服务（slots/locale/remote/connection）上挂载，设置页/dock/关闭按钮均注册，
  dock 注入面携带 `useChatSnapshot`，且设置页不依赖 `uiConversation` 存在。

### 变更

- **alpha.4 兼容性移植（Host 半）**：`dsh-settings` 服务 API 升级——移除的
  `settingsNamespace()` / `installSettingsSection()` 改为普通 kebab-case 命名空间
  字面量 + `ctx.settings.installSection(owner, ns, schema, entry, hooks)`（与官方
  `subagent-model-selection` 消费方同款模式）；`JsonValue` 改从
  `@deepseek-ai/dsh-util-values` 导入（`dsh-tools` 不再导出）；`AgentOptions` 现携带
  `reasoningEffort?: ReasoningEffortId`，`reasoningEffort` 由「仅告知」改为正式注入
  `agentOptions`（可单独提供，路由变更时清除继承的 route 专属 effort）；
- **移除 `applyDefaultRoute` 默认路由补丁缝**（避免与官方 dsh-tool-subagent 双重写
  模型路由）：删除 `src/default-route.ts` 及其对 `ctx.subagents.start/startContinuable`
  的 monkey-patch，`DirectorConfig` 与 Config schema 同步移除 `applyDefaultRoute`；
  插件不再向任何子代理启动注入默认模型；
- **选择收敛到官方授权列表**：`resolveRoute` 新增 `allowedRoutes` 约束——显式
  provider/model 必须成对且位于 `subagent-model-selection.allowedModels`（未授权为
  `subagent-director:` 硬错误）；角色/默认层未授权路由被丢弃（回退继承）并告警，
  角色 persona/toolFilter 仍生效；新增 `isRouteAllowed` 纯函数与
  `readModelSelection`（执行期经 `settings.get` 读取官方命名空间，缺失/异常时优雅
  降级为无约束并提示未配置授权列表）。

### 测试

- `route-resolver.test.ts` 新增授权列表约束与 effort 注入用例（36 项）；
- 新增 `alpha4-probe.test.ts` 真实 cordis 探针：a) 插件挂载不包装
  `ctx.subagents.start`（证明补丁缝已移除）；b) `subagent-director` 命名空间经
  `installSection` 注册且委派解析读取 `subagent-model-selection`；c) 委派执行路径对
  未授权显式路由拒绝、对授权路由把 `agentOptions`（含 effort）透传给
  `subagents.start`；删除 `default-route.test.ts`。

### 兼容性

- 桥接契约（`SUBAGENT_DIRECTOR_RPC_VIEW` / `_MUTATE` / `_CLOSE` / `_MODEL` / `_TOOLS`
  端点与载荷）不变；`installDirectorSettings` 等导出签名保持；`RpcError.sessionId`
  品牌冲突（宿主 apiproxy 嵌套的 `dsh-session` 副本）在边界处收敛为最小转型。

## 0.4.0 - 2026-08-31

### 新增

- **纯编排模式（`/orchestrate`）**（PR #3，@WinterSold1er）：`/orchestrate on|off` 命令（无参数默认 on），开启后注入「纯编排者」系统提示——主代理只允许通过 `subagent_role` 委派、禁止亲自读/写/执行，角色清单从 `subagent-director.roles` 动态渲染（无硬编码 role id），未配置角色时提示先配置；`sessionProjections` 服务缺失时命令返回明确错误而非假装成功；
- **纯编排模式改为按轮自动检测（类似 `/using aegis`）**：不再需要规定 on/off——消息开头声明 `/orchestrate`（无参数），或用自然语言写「使用orchestrate模式」（含「请使用 orchestrate 模式」「use orchestrate mode」等变体），该轮会话即自动进入纯编排模式；未声明时保持普通模式。系统提示段按轮判定：先扫描当前轮首条用户消息（`user/message` 事件）与最近一次 `orchestrate` 命令的 `command/run` 事件（以 `turn/start` 为轮次边界），投影仅作向后兼容兜底；
- **`/orchestrate <任务>` 直接编排该任务**：声明与任务同一条消息即可生效——任意任务文本（如 `/orchestrate 分析上周A股走势`）会被 handler 视为「编排该任务」，经 `agent.followup(createUserMessage(...))` 排入下一轮并唤醒模型。

### 修复

- **真实 cordis 探针发现的隐性 bug**（issue #5）：cordis 的 `ctx.effect(fn)` 契约是「立即执行 fn、以返回值为 disposer」，原先包在 effect 里的 `fiber.dispose()` 清理块会把 `/orchestrate` 命令与 projection 的 `ctx.inject` 子 fiber **在创建瞬间卸载**——真实宿主上命令从未注册成功过（既有测试全基于 fake，未覆盖该契约）；子 fiber 本就随父 fiber 生命周期自动卸载，清理块已移除，并由新增的真实 cordis 探针测试永久钉住；
- **开发/测试环境对齐真实宿主 0.1.1 线**（issue #5）：devDeps 与 peer ranges 由 `0.1.0-rc.6/rc.8` 升至 `^0.1.1-rc.2`（新增 `dsh-session-projection` peer）；projection 注册改用真实类型契约（`SessionEventMap` / `SessionProjectionStateMap` / `SessionProjectionMap` 声明合并 + 类型化 `register`），契约形状漂移现在在 typecheck 期暴露，而不是运行期被 `snapshot()` 静默跳过；
- 顶层 `inject` 移除 `'commands'`（非 dsh-base 装配上主条目会永久 PENDING、核心委派功能全失效）；命令 handler 增加 `invocation.agent.session` 可选链守卫；
- 移除未使用的 `@deepseek-ai/dsh-client-schema-form` 依赖（源码零引用，且其 0.1.0 线 peer 链与 0.1.1 线冲突）；
- **「对话什么都不返回」**：`/orchestrate on` 后模型被「纯编排者」提示束缚，但 `subagent-director.roles` 未配置任何角色 → 无法委派、禁止亲自动手 → 对话无输出。现在未配置角色时不再注入束缚性的纯编排框架，而是注入一段简短「不可用提示」，指示模型明确告知用户需要先配置角色、并继续以普通模式处理请求——模型必然给出有意义的回复；
- **「不清楚是否已开启」**：`/orchestrate`（无参数）从「粘性 on」改为「本轮 on」（不写粘性事件，由 `command/run` 扫描按轮生效），命令反馈明确说明按轮/持久语义；`/orchestrate on` 保留为显式持久模式（向后兼容），`/orchestrate off` 退出持久模式；
- **`/orchestrate <任务>` 无响应**：commands 服务会整体消费斜杠命令行，任务文本到不了模型、命令返回错误 → 对话无输出。现在任意任务文本会被 handler 视为「编排该任务」：经 `agent.followup(createUserMessage(...))` 排入下一轮并唤醒模型，`command/run` 扫描（任务参数 → on）使该轮注入编排提示；
- **按轮检测被上下文注入事件击穿**（实测「分析上周A股走势」会话未编排）：宿主会在用户消息之后把 runtime context / system-reminder / memos_context 作为**独立的 `user/message` 事件**追加进日志，导致「最新用户消息」「命令位于上一条与当前用户消息之间」的判定全部失效（命令被视为过期、声明消息被注入事件掩盖）。修复：检测改用 **`turn/start` 轮次边界**——消息检测取当前轮**首条**用户消息（忽略注入事件），命令扫描要求命令位于「上一轮最后一条用户消息之后、本轮 `turn/start` 之前」；无 turn 事件时回退旧逻辑。

### 兼容性

- `orchestrate/change` 事件类型注册与投影注册保留（旧会话日志加载兼容 + 客户端 wire 视图）；`renderOrchestratorPrompt` / `renderOrchestratorRoles` / `buildOrchestratorFrame` 公共 API 不变；新增导出 `detectOrchestrateRequest`、`renderOrchestratorUnavailableNotice`。

### 测试

- 单元/集成测试由 197 增至 253：`detectOrchestrateRequest` 检测单测（斜杠/任务文本/自然语言/反例）、按轮段判定接线测试（用户消息声明、`command/run` 区间扫描、任务参数扫描、无角色不可用提示、投影兜底）、命令语义测试（无参数按轮不写事件、任务文本 followup 排队、on 持久、off 退出），以及真实 cordis `Context` + 真实 `SessionProjectionRegistry` 集成探针（无 commands 服务时主条目正常激活、核心服务缺失时保持 PENDING、commands 后到时命令经真实 `ctx.inject` 子 fiber 响应式注册、projection 经真实 `snapshot()` 驱动 on→off 折叠、按轮与任务文本探针）。

### 已知取舍

- 用过 `/orchestrate` 的会话在未挂载本插件的 boot（卸载后、其他 profile）中无法加载：上游暂无第三方事件注册 / `ignorable` 写入 API，已在 README FAQ 与 issue #6 记录。

## 0.3.0 - 2026-08-29

### 新增

- **`close_subagent` 模型可见工具**：主代理可按需释放驻留的 continuable
  子代理（内部调用 DSH 核心 `drainContinuableChildren`，与
  `send_message`/`interrupt_agent` 构成完整生命周期闭环；非驻留目标是安全
  no-op）——[issue #1](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/1)；
- **子代理会话页「终止可持续状态」按钮**：打开 continuable 子代理会话时，
  会话标题操作区显示释放按钮（确认后经 `/subagent-director` 桥释放该子代理，
  父代理不在线时给出明确提示）；
- **可观测性打通**：composer 下方实际运行供应商/模型读数不再依赖尚未填充的
  assistant provenance 字段，改为读取子代理会话的 `request/header` 记录
  （`subagentModel` 桥端点），快照内已有 provenance 时仍走零请求快速路径，
  读不到时优雅降级——移除 README「暂不可用」标注；
- **角色「工具集」编辑**：角色编辑/添加卡片支持可视化配置 `toolFilter.allow`
  ——搜索过滤、全选/全不选（仅作用于过滤结果）、已选计数、收起展开、
  可滚动列表（`toolCatalog` 桥端点枚举完整 agent 视图，含 bash/read/write
  等基础工具，实测 88 个）。

### 修复

- 未配置 `toolFilter` 的角色被 dsh-settings 物化为 `{allow:[],deny:[]}` 后
  清空子代理全部工具（tools=0、「只执行一步」假象）：空 filter 视为未配置，
  schema 层不再物化空对象（`hasToolFilter` + `.default(undefined)`）——
  [issue #2](https://github.com/SeverusZh/dsh-plugin-subagent-director/issues/2)；
- `toolCatalog` 原先只枚举全局注册表（56 个），遗漏 preset 层的
  bash/read/write/grep 等基础工具：改经 `agent.ctx.get('tools').schemas(agent)`
  枚举完整 agent 视图（88 个）。

### 兼容性

- `@deepseek-ai/dsh-subagent` peer 依赖下限提升至 `^0.1.0-rc.8`
  （`drainContinuableChildren` 所在版本线）。

### 测试

- 单元测试由 150 增至 197：空 toolFilter 语义、close_subagent 工具、
  桥接 `subagentClose`/`subagentModel`/`toolCatalog` 端点、可观测性数据源
  合并、工具集纯逻辑（过滤/全选/集合代数）。

### 文档

- README：新增「释放可持续子代理」「工具集」特性、更新可观测性描述（中英
  双语）；CHANGELOG 0.3.0 汇总 beta.1–beta.4 的全部变更。

[0.3.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.3.0

## 0.2.0 - 2026-08-17

### 新增

- **默认模型兜底**：在 `ctx.subagents.start/startContinuable` 层注入默认
  provider/model，对内置 `subagent`/`subagent_fork` 发起的子代理同样生效
  （`applyDefaultRoute`，默认开启；未配置默认模型时零侵入）；
- **配置热更新**：settings.yaml / 设置面板改动即时生效，无需重启；
- **角色按显示名引用**：`role` 参数未命中 id 时按 `displayName` 精确匹配，
  多个同名角色取定义顺序第一个并提示；
- **角色指引强化**：系统提示明确要求按 id 引用角色（Delegate 行），不要用显示名。

### 修复

- 设置快照只在插件挂载时读取一次、运行中修改配置不生效的问题（`onChange` 现在会
  重新读取来源并刷新快照）；
- 默认路由 seam 卸载时恢复原始方法的引用（保留未绑定引用，dispose 幂等）。

### 测试

- 单元测试由 129 增至 150：默认模型兜底、显示名解析、指引渲染、设置快照热更新。

### 文档

- README：默认模型兜底、配置热更新、角色显示名引用、推荐默认角色示例；
- 新增设计文档与实现计划（`docs/superpowers/`）。

## 0.1.0 - 2026-08-14

首个公开发布版本。

### 新增

- 四级模型路由解析链（单次调用参数 > 角色绑定 > 插件默认 > 继承主代理），字段级覆盖、未配置零侵入；
- `subagent_role` 模型可见委派工具：`role`/`provider`/`model`/`reasoningEffort` 可选参数，前景/one-shot 后台/continuable 后台三种执行路线；
- 角色模板：命名角色携带职责描述、persona 与可选模型绑定，写入 settings 命名空间 `subagent-director`；
- 主代理角色清单指引（系统提示段落，无角色时不注入）；
- 设置界面「子代理导演」：默认模型配置 + 角色卡片增删改（中英双语）；
- 子代理实际运行模型读数（composer dock，零额外请求）；
- 设置命名空间桥接条目 `subagent-director-bridge`：自注册 `/subagent-director` HTTP 路由，绕开 Web API 的 settings 白名单限制；
- 129 个单元测试（路由解析、schema 校验、桥接信封、client 纯逻辑）。

### 文档

- README（中英双语）：安装、配置示例、角色模板、FAQ；
- MIT License。

[0.1.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.1.0
[0.2.0]: https://github.com/SeverusZh/dsh-plugin-subagent-director/releases/tag/v0.2.0

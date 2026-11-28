# 角色卡

角色卡是 Subagent Director 的独立委派单元。它把主代理可见的委派指引、子代理运行时的
固定角色提示词与可选模型路由打包在一起，并以每卡一个 JSON 文档的方式保存。

## 存储

- 存储设施：DSH `storageDomain`，域名为 `subagent_director`，布局为 `per-record`；
- 卡片文件：`<storage-root>/subagent_director/cards/<id>.json`；
- 文件内容为存储域包装：`{ "version": 1, "record": <角色卡> }`；该 version 是存储域记录版本，与导出格式 version 2 独立；
- 默认卡 id：同一域的 global 槽位，不写入插件公共配置；
- 使用统计：`<storage-root>/subagent_director/usage/<id>.json`，每个文件为 `{ "version": 1, "record": { "uses": 1, "lastUsedAt": "..." } }`；该 version 同样是存储域记录版本；
- 旧版 `roles` / `defaultRole`：仅作为迁移来源保留；迁移后可从配置中清除。Director Mode 的委派只接受角色卡，旧 `roles` 需先迁移。

## 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | kebab-case，作为委派 `role` 与存储键 |
| `name` | 是 | 展示名称，也用于旧版显示名匹配 |
| `delegationGuidance` | 是 | 给主代理看的推荐委派场景 |
| `avoidGuidance` | 否 | 给主代理看的不推荐委派场景 |
| `systemPrompt` | 否 | 注入子代理会话的固定系统提示词 |
| `persona` | 否 | 追加在系统提示词之后的身份与风格文本 |
| `model` | 否 | `{ provider, model, reasoningEffort }`；留空继承 |
| `agentPreset` | 否 | DSH Agent Preset id，用于工具组合 |
| `tags` | 否 | 搜索与筛选标签 |
| `emoji` / `accent` | 否 | 卡片展示 |
| `notes` | 否 | 仅供人阅读，不发送给模型 |
| `enabled` | 否 | 默认 true；停用卡不参与委派 |
| `neverClose` | 否 | 默认 false；为 true 时永不进入关闭池，由设置页的「永不入池」开关维护 |
| `source` | 否 | `local` / `import` / `legacy`；`builtin` 仅供代码内置卡 |
| `createdAt` / `updatedAt` | 否 | ISO-8601，由 Host 维护 |

## 导入导出

导出使用可移植集合信封：

```json
{
  "kind": "subagent-director/character-card-collection",
  "version": 2,
  "exportedAt": "2026-11-27T00:00:00.000Z",
  "cards": []
}
```

版本 1 的集合与单卡仍可导入；新导出使用版本 2。

导入接受集合信封、单卡信封 `{ "kind": "subagent-director/character-card", "card": ... }`、
裸卡片对象或上述任意形式的数组。id 冲突策略为 `skip`、`overwrite`、`duplicate`。

## 内置导演卡

Director Mode 内置一张 id 为 `director` 的角色卡：

- 只在该预设的会话中进入 guidance 与 `subagent_role` 解析；
- 不写入存储，不出现在设置面板或导出结果中；
- id 与 `source: builtin` 为保留值，导入或编辑同 id 卡片会被拒绝；0.8.0 遗留的同 id 存储卡在启动时自动重命名并保留；
- 默认绑定 `director` 预设，作为可继续向下委派的导演层；普通卡片未绑定预设时才回退 `standard`；
- 卡片的推荐/不推荐指引同时参与主代理提示词。

## 运行语义

- 委派时先按卡片 id 或名称解析卡片，再走「单次调用 > 卡片绑定 > 插件默认 > 继承」的
  模型回退链；
- 有固定提示词时，委派工具在启动子代理前预留子会话 id，并写入提示词绑定；系统提示词
  段 `subagent-director:character-card` 仅对该子会话渲染卡片快照；
- 前台委派在结束后释放绑定；可持续子代理保留绑定，供后续 `send_message` 继续使用；
- 编辑卡片不会改写已运行子代理的提示词快照；
- 不支持预留子会话 id 的外部传输会把提示词附加到任务文本，并给出警告。

## 旧角色迁移

| 旧 `roles` 字段 | 角色卡字段 |
| --- | --- |
| `displayName` | `name` |
| `description` | `delegationGuidance` |
| `persona` | `persona` |
| `provider` / `model` / `reasoningEffort` | `model` |
| `agentPreset` | `agentPreset` |
| `toolFilter` | 写入 `notes`，不再发送给子代理 |

迁移是幂等的：已存在的卡片 id 会跳过。`defaultRole` 在迁移时若指向被迁移的角色，且当前
没有默认卡，会提升为默认卡。

## 使用统计

- 记录点：前台委派成功、后台委派成功、建卡成功各记录一次；委派或建卡失败不计；
- 统计写入是尽力而为的旁路：存储不可用或写入失败只记录告警，不会让委派或建卡失败；
- 写入按顺序串行化，多次并发委派不会丢失计数；
- 删除卡片会同时删除它的统计记录；
- 设置页快照的 `usage` 字段为 `Record<string, { uses: number; lastUsedAt: string }>`，没有统计的卡片视为从未使用；
- 旧卡片没有统计记录时按「未使用」处理，不会因此被立即关闭。

## 权重与关闭池

权重公式：

```
score = 1.6 * ln(1 + uses) + 0.5 ^ (idleDays / 30)
idleDays = (now - (lastUsedAt ?? createdAt)) / 一天
```

- `now` 由调用方注入，`src/card-weight.ts` 内部不读系统时间；
- 关闭池判定优先看豁免：内置导演卡、默认卡、`neverClose` 卡片、`source` 非 `local` 的卡片一律豁免；
- 非豁免卡满足任一条件即进入关闭池：空闲达到 90 天；或使用次数不超过 1 且空闲达到 30 天；
- 状态三态为 `exempt`、`active`、`closed`，排序为权重降序、名称升序；
- 关闭池只影响提示词与检索的默认可见性：显式用卡片 id 委派仍然可用，一次成功委派会刷新
  `lastUsedAt` 并让卡片自动回到使用中；
- 「永不入池」开关只写入 `neverClose`，不刷新 `updatedAt`；
- 设置页按使用中/关闭池/已停用展示每张卡，列出使用次数与最近使用时间，支持按状态筛选与
  按权重/最近使用/名称排序；关闭池卡片可直接打开「永不入池」开关恢复。

## 导演检索工具

Director Mode 额外注册两个工具，只有导演主代理可见，且在白名单内：

- `subagent_card_search`：参数 `query`、`tags`、`includeClosed`、`limit`。`query` 大小写不敏感地匹配
  名称、id、标签、推荐/不推荐指引与备注；`tags` 取 AND；`limit` 默认 8、上限 25。默认不返回关闭池，
  `includeClosed: true` 时关闭池卡片排在活跃卡片之后。每行包含 id、名称、状态、权重、使用次数、
  最近使用时间、标签、模型以及前 160 字的推荐指引；
- `subagent_card_get`：按卡片 id 或精确名称返回完整字段与统计状态，包括推荐/不推荐指引、固定系统
  提示词、persona、备注、标签、模型路由、Agent Preset、`enabled` 与 `neverClose`。

导演契约要求先检索再决定：先 `subagent_card_search`，需要全文时 `subagent_card_get`，能复用或
恢复已有卡片就不新建；只有在没有匹配卡片时才调用 `subagent_card_create`。

## 提示词预算

主代理提示词不再整库塞入，规则如下：

- 只渲染权重最高的 12 张活跃卡片，内置导演卡始终在列；
- 关闭池卡片默认不出现在提示词里；
- 单张卡片的推荐与不推荐指引各截断到 720 字，截断处标注可调用 `subagent_card_get` 读取全文；
- 段落总字符上限 12000，超出时按权重舍弃靠后的卡片并明确告知省略数量与检索方式；
- 头部给出库总数、本次列出数量、关闭池数量，并说明 `subagent_card_search` 与 `subagent_card_get` 的用法。

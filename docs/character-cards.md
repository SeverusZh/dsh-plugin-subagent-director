# 角色卡

角色卡是 Subagent Director 的独立委派单元。它把主代理可见的委派指引、子代理运行时的
固定角色提示词与可选模型路由打包在一起，并以每卡一个 JSON 文档的方式保存。

## 存储

- 存储设施：DSH `storageDomain`，域名为 `subagent_director`，布局为 `per-record`；
- 卡片文件：`<storage-root>/subagent_director/cards/<id>.json`；
- 文件内容为存储域包装：`{ "version": 1, "record": <角色卡> }`；
- 默认卡 id：同一域的 global 槽位，不写入插件公共配置；
- 旧版 `roles` / `defaultRole`：仅作为迁移来源保留；迁移后可从配置中清除。

## 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | kebab-case，作为委派 `role` 与存储键 |
| `name` | 是 | 展示名称，也用于旧版显示名匹配 |
| `delegationGuidance` | 是 | 给主代理看的委派指引 |
| `systemPrompt` | 否 | 注入子代理会话的固定系统提示词 |
| `persona` | 否 | 追加在系统提示词之后的身份与风格文本 |
| `model` | 否 | `{ provider, model, reasoningEffort }`；留空继承 |
| `agentPreset` | 否 | DSH Agent Preset id，用于工具组合 |
| `tags` | 否 | 搜索与筛选标签 |
| `emoji` / `accent` | 否 | 卡片展示 |
| `notes` | 否 | 仅供人阅读，不发送给模型 |
| `enabled` | 否 | 默认 true；停用卡不参与委派 |
| `source` | 否 | `local` / `import` / `legacy` |
| `createdAt` / `updatedAt` | 否 | ISO-8601，由 Host 维护 |

## 导入导出

导出使用可移植集合信封：

```json
{
  "kind": "subagent-director/character-card-collection",
  "version": 1,
  "exportedAt": "2026-11-27T00:00:00.000Z",
  "cards": []
}
```

导入接受集合信封、单卡信封 `{ "kind": "subagent-director/character-card", "card": ... }`、
裸卡片对象或上述任意形式的数组。id 冲突策略为 `skip`、`overwrite`、`duplicate`。

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

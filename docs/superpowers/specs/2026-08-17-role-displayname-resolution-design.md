# 角色按显示名解析 + 指引强化（Role DisplayName Resolution）设计

> 日期：2026-08-17 · 状态：已批准（方案 A）· 关联：dsh-plugin-subagent-director v0.1.0

## 背景与问题

真实会话中模型常把角色的**显示名**当成 `role` 参数传入（例如配置 key 为 `role`、
显示名为"基础开发工程师"，模型却传 `role: "基础开发工程师"`），导致角色绑定
（persona/provider/model）被跳过，子代理退回默认/继承模型。同时系统提示里的
角色清单没有明确告诉模型"按 id 传参"。

## 目标与成功标准

1. `role` 参数先精确匹配角色 id；未命中时按 `displayName` 精确匹配并生效
   （persona/provider/model/toolFilter 照常解析，`roleId` 返回真实 key）。
2. 多个角色共享同一 displayName 时，按定义顺序取第一个并告警。
3. 精确 id 优先于任何 displayName 匹配。
4. 系统提示角色清单明确指示"按 id 引用角色，不要用显示名"。
5. 完全匹配不到时维持现有行为（告警 + 跳过绑定，退回默认/继承）。

## 行为规则

### route-resolver.ts `resolveRoute`

`roleIdRaw` 解析顺序（保持四级回退链不变，仅角色绑定层内部增强）：
1. `roles[roleIdRaw]` 精确 key 命中 → 直接使用；
2. 未命中 → 遍历 `roles`，找 `displayName === roleIdRaw` 的第一个，使用其真实
   key 作为 `resolvedRoleId`，并在 warnings 追加一条提示
   （"不是 id，已按显示名解析到 id X，建议直接用 id 传参"）；
3. 第 2 步发现多个同 displayName 的角色 → 追加告警（使用第一个）；
4. 仍未命中 → 维持现有"does not exist"告警 + 跳过绑定。

### guidance.ts `renderRolesGuidance`

- 角色清单首行追加一句：按 id 引用角色（见 Delegate 行），不要用显示名；用户按
  显示名提到角色时，映射到对应 id。
- 每行 Delegate 保持 `subagent_role({ role: "<id>", prompt: "..." })` 不变。

## 实现位置与测试

- `src/route-resolver.ts`：角色查找逻辑；
- `src/guidance.ts`：首行指引文案；
- `test/route-resolver.test.ts`：displayName 命中 / 重名取首个并告警 / 精确 id
  优先 / 未命中维持原行为；
- 新增 `test/guidance.test.ts`：渲染结果包含 id 引用说明、无角色时为空。

## 范围之外（YAGNI）

- 不做大小写/模糊（拼音、编辑距离）匹配；
- 不顶替内置工具名（方案 B 另行设计）；
- 不改默认模型兜底 seam 与 config。

## 风险

- 重名 displayName 解析不确定性 → 以"首个 + 告警"限定并提示；
- 提示文案为英文（与现有系统提示一致）。

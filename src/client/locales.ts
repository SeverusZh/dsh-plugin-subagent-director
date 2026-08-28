/**
 * Bilingual dictionaries for the Subagent Director settings namespace.
 * The key union (SubagentDirectorKey) is the compile-time contract: both
 * locales must carry every key, so a one-sided edit is a type error before it
 * ever reaches the runtime's bilingual balance check.
 */

/** Keys for the settings.subagentDirector namespace (bilingual, enforced). */
export type SubagentDirectorKey =
  | 'nav'
  | 'sectionIntro'
  | 'defaultsHeading'
  | 'defaultsHint'
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultReasoningEffort'
  | 'restoreDefaults'
  | 'provider'
  | 'model'
  | 'reasoningEffort'
  | 'persona'
  | 'rolesHeading'
  | 'rolesHint'
  | 'addRole'
  | 'emptyRoles'
  | 'roleId'
  | 'roleDisplayName'
  | 'roleDescription'
  | 'rolePersona'
  | 'setDefaultRole'
  | 'defaultRoleBadge'
  | 'deleteRole'
  | 'confirmDeleteRole'
  | 'removeRoleDone'
  | 'addedRole'
  | 'roleUpdated'
  | 'conflict'
  | 'rejected'
  | 'fatal'
  | 'loadError'
  | 'readonly'
  | 'save'
  | 'cancel'
  | 'edit'
  | 'retry'
  | 'fallbackOnInvalid'
  | 'roleIdPlaceholder'
  | 'displayNamePlaceholder'
  | 'descriptionPlaceholder'
  | 'personaPlaceholder'
  | 'modelOptional'
  | 'providerMissing'
  | 'toolFilter'
  | 'toolFilterHint'
  | 'toolFilterNone'
  | 'toolFilterEmpty'
  | 'toolFilterSearch'
  | 'toolFilterSelectAll'
  | 'toolFilterDeselectAll'
  | 'toolFilterCount'
  | 'toolFilterExpand'
  | 'toolFilterCollapse'
  | 'toolFilterNoMatch'
  | 'restoreDone'
  | 'invalidRoleId'
  | 'bridgeUnavailable'
  | 'modelRanOn'
  | 'modelNotRecorded'
  | 'modelQueryFailed'
  | 'modelRanOnTitle'
  | 'closeContinuable'
  | 'closeContinuableTitle'
  | 'closingContinuable'
  | 'closedSubagent'
  | 'confirmCloseContinuable'
  | 'closeFailed';

/** English dictionary ($subagentDirector). */
export const en: Record<SubagentDirectorKey, string> = {
  "nav": "Subagent Director",
  "sectionIntro": "Choose the LLM provider and model each subagent uses, and define role templates that bind a model and persona to a delegation.",
  "defaultsHeading": "Default model",
  "defaultsHint": "Used when a call or role does not name a provider/model.",
  "defaultProvider": "Provider",
  "defaultModel": "Model",
  "defaultReasoningEffort": "Reasoning effort",
  "restoreDefaults": "Restore defaults",
  "provider": "Provider",
  "model": "Model",
  "reasoningEffort": "Reasoning effort",
  "persona": "Persona",
  "rolesHeading": "Role templates",
  "rolesHint": "A role binds delegation guidance, a persona, and optionally a provider/model to a subagent.",
  "addRole": "Add role",
  "emptyRoles": "No role templates yet. Add one to start planning subagent responsibilities.",
  "roleId": "Role id",
  "roleDisplayName": "Display name",
  "roleDescription": "Delegation guidance",
  "rolePersona": "Persona",
  "setDefaultRole": "Set as default",
  "defaultRoleBadge": "Default",
  "deleteRole": "Delete",
  "confirmDeleteRole": "Delete role “{id}”? Roles referenced by defaultRole will fall back to the plugin default.",
  "removeRoleDone": "Role removed",
  "addedRole": "Role added",
  "roleUpdated": "Role updated",
  "conflict": "The settings changed on the server. Reloading your edits — please review and retry.",
  "rejected": "The change was rejected by the settings provider.",
  "fatal": "Could not save: {message}",
  "loadError": "Could not load preference settings.",
  "readonly": "Settings are read-only in this deployment.",
  "save": "Save",
  "cancel": "Cancel",
  "edit": "Edit",
  "retry": "Retry",
  "fallbackOnInvalid": "Fall back to the parent agent when a role-bound model is invalid",
  "roleIdPlaceholder": "e.g. code-reviewer",
  "displayNamePlaceholder": "e.g. Code Reviewer",
  "descriptionPlaceholder": "When to delegate to this role and what it should do…",
  "personaPlaceholder": "Optional behavior/identity text injected into the subagent…",
  "modelOptional": "Save the card to apply changes",
  "providerMissing": "No provider selected",
  "toolFilter": "Tool set",
  "toolFilterHint": "Restrict the subagent to these tools. Leave empty to inherit the parent's full tool set.",
  "toolFilterNone": "Inherit parent tools (no restriction)",
  "toolFilterEmpty": "No tools available",
  "toolFilterSearch": "Search tools…",
  "toolFilterSelectAll": "Select all",
  "toolFilterDeselectAll": "Deselect all",
  "toolFilterCount": "Selected {count} / {total}",
  "toolFilterExpand": "Expand",
  "toolFilterCollapse": "Collapse",
  "toolFilterNoMatch": "No tools match the search.",
  "restoreDone": "Defaults restored",
  "invalidRoleId": "Role id must be kebab-case (lowercase letters, digits, single hyphens).",
  "bridgeUnavailable": "The Subagent Director settings bridge is not available on this server. Please update/restart the web application so it installs the /subagent-director channel.",
  "modelRanOn": "Subagent ran on",
  "modelNotRecorded": "Subagent model not recorded yet",
  "modelQueryFailed": "Subagent model unavailable",
  "modelRanOnTitle": "Model route: {model}",
  "closeContinuable": "Release subagent",
  "closeContinuableTitle": "Release this continuable subagent (free its resident handle)",
  "closingContinuable": "Releasing…",
  "closedSubagent": "Released",
  "confirmCloseContinuable": "Release continuable subagent “{id}”? It will stop being resident; you can no longer continue it with send_message.",
  "closeFailed": "Release failed: {message}"
};

/** Chinese dictionary. */
export const zh: Record<SubagentDirectorKey, string> = {
  "nav": "子代理导演",
  "sectionIntro": "为每个子代理选择 LLM 供应商与模型，并以角色模板把模型与 persona 绑定到每次委派。",
  "defaultsHeading": "默认模型",
  "defaultsHint": "当某次调用或角色未指定供应商/模型时使用。",
  "defaultProvider": "供应商",
  "defaultModel": "模型",
  "defaultReasoningEffort": "推理强度",
  "restoreDefaults": "恢复默认",
  "provider": "供应商",
  "model": "模型",
  "reasoningEffort": "推理强度",
  "persona": "人设",
  "rolesHeading": "角色模板",
  "rolesHint": "角色把委派指引、persona 与可选的供应商/模型绑定到子代理。",
  "addRole": "添加角色",
  "emptyRoles": "还没有角色模板。添加一个以开始规划子代理职责。",
  "roleId": "角色 id",
  "roleDisplayName": "显示名称",
  "roleDescription": "委派指引",
  "rolePersona": "人设",
  "setDefaultRole": "设为默认",
  "defaultRoleBadge": "默认",
  "deleteRole": "删除",
  "confirmDeleteRole": "删除角色“{id}”？若 defaultRole 引用了它，将回退到插件默认值。",
  "removeRoleDone": "角色已删除",
  "addedRole": "角色已添加",
  "roleUpdated": "角色已更新",
  "conflict": "服务端设置已变更。已重新加载你的编辑——请复核并重试。",
  "rejected": "更改被设置提供方拒绝。",
  "fatal": "无法保存：{message}",
  "loadError": "无法加载偏好设置。",
  "readonly": "当前部署中设置为只读。",
  "save": "保存",
  "cancel": "取消",
  "edit": "编辑",
  "retry": "重试",
  "fallbackOnInvalid": "当角色绑定的模型无效时回退到父代理",
  "roleIdPlaceholder": "例如 code-reviewer",
  "displayNamePlaceholder": "例如 代码审查员",
  "descriptionPlaceholder": "何时委派给此角色、让其做什么……",
  "personaPlaceholder": "注入子代理的可选行为/身份文案……",
  "modelOptional": "保存卡片以应用更改",
  "providerMissing": "未选择供应商",
  "toolFilter": "工具集",
  "toolFilterHint": "将子代理限制为这些工具。留空则继承父代理的完整工具集。",
  "toolFilterNone": "继承父代理工具（不限制）",
  "toolFilterEmpty": "无可用工具",
  "toolFilterSearch": "搜索工具…",
  "toolFilterSelectAll": "全选",
  "toolFilterDeselectAll": "全不选",
  "toolFilterCount": "已选 {count} / 共 {total}",
  "toolFilterExpand": "展开",
  "toolFilterCollapse": "收起",
  "toolFilterNoMatch": "没有匹配搜索的工具。",
  "restoreDone": "已恢复默认",
  "invalidRoleId": "角色 id 必须为 kebab-case（小写字母、数字、单个连字符）。",
  "bridgeUnavailable": "此服务器尚未提供 Subagent Director 设置桥接通道（/subagent-director）。请重启 Web 应用以安装该通道后再试。",
  "modelRanOn": "子代理实际运行于",
  "modelNotRecorded": "尚未记录到子代理模型",
  "modelQueryFailed": "暂时无法获取子代理模型",
  "modelRanOnTitle": "模型路由：{model}",
  "closeContinuable": "终止可持续状态",
  "closeContinuableTitle": "释放此可持续子代理（解除驻留句柄）",
  "closingContinuable": "正在终止…",
  "closedSubagent": "已终止",
  "confirmCloseContinuable": "终止可持续子代理“{id}”？终止后将不再驻留，无法再用 send_message 继续它。",
  "closeFailed": "终止失败：{message}"
};

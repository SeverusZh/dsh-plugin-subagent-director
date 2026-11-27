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
  | 'loading'
  | 'defaultsHeading'
  | 'defaultsHint'
  | 'noAllowedModels'
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultReasoningEffort'
  | 'restoreDefaults'
  | 'provider'
  | 'model'
  | 'reasoningEffort'
  | 'persona'
  | 'agentPreset'
  | 'agentPresetPlaceholder'
  | 'agentPresetHint'
  | 'legacyRoleFields'
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
  | 'closeFailed'
  | 'pageTitle'
  | 'pageIntro'
  | 'newCard'
  | 'importCards'
  | 'exportAll'
  | 'cardsHeading'
  | 'cardsHint'
  | 'searchCards'
  | 'filterAll'
  | 'filterEnabled'
  | 'filterDisabled'
  | 'sortUpdated'
  | 'sortName'
  | 'emptyCardsTitle'
  | 'emptyCardsBody'
  | 'noSearchResults'
  | 'cardDefault'
  | 'setDefaultCard'
  | 'enabled'
  | 'disabled'
  | 'enableCard'
  | 'disableCard'
  | 'editCard'
  | 'duplicateCard'
  | 'exportCard'
  | 'deleteCard'
  | 'confirmDeleteCard'
  | 'batchSelect'
  | 'batchDone'
  | 'batchSelected'
  | 'selectAll'
  | 'clearSelection'
  | 'batchEnable'
  | 'batchDisable'
  | 'batchExport'
  | 'batchDelete'
  | 'confirmBatchDelete'
  | 'cardEditorNew'
  | 'cardEditorEdit'
  | 'cardIdentity'
  | 'cardName'
  | 'cardId'
  | 'cardIdHint'
  | 'cardIdImmutable'
  | 'cardEmoji'
  | 'cardAccent'
  | 'cardTags'
  | 'cardTagsHint'
  | 'cardModel'
  | 'cardModelHint'
  | 'cardProvider'
  | 'cardModelId'
  | 'cardReasoningEffort'
  | 'cardAgentPreset'
  | 'cardAgentPresetHint'
  | 'cardPrompts'
  | 'cardSystemPrompt'
  | 'cardSystemPromptHint'
  | 'cardPersona'
  | 'cardPersonaHint'
  | 'cardGuidance'
  | 'cardGuidanceRecommended'
  | 'cardGuidanceHint'
  | 'cardAvoidGuidance'
  | 'cardAvoidGuidanceHint'
  | 'cardAvoidPrefix'
  | 'cardNotes'
  | 'cardNotesHint'
  | 'cardEnabled'
  | 'cardEnabledHint'
  | 'cardAdvanced'
  | 'cardCreate'
  | 'cardSave'
  | 'cardCancel'
  | 'cardDirtyConfirm'
  | 'cardInvalidId'
  | 'cardNameRequired'
  | 'cardGuidanceRequired'
  | 'cardModelPair'
  | 'cardDuplicateId'
  | 'cardSaved'
  | 'cardDeleted'
  | 'importTitle'
  | 'importBody'
  | 'importDrop'
  | 'importBrowse'
  | 'importPaste'
  | 'importPasteHint'
  | 'importStrategy'
  | 'importSkip'
  | 'importOverwrite'
  | 'importDuplicate'
  | 'importSkipHint'
  | 'importOverwriteHint'
  | 'importDuplicateHint'
  | 'importRun'
  | 'importPreview'
  | 'importInvalid'
  | 'importResult'
  | 'importNoCards'
  | 'importParseError'
  | 'importFileTooLarge'
  | 'exportDone'
  | 'exportFailed'
  | 'download'
  | 'copyJson'
  | 'copied'
  | 'copyFailed'
  | 'storageReady'
  | 'storageUnavailable'
  | 'storageError'
  | 'storageHint'
  | 'legacyBanner'
  | 'legacyBannerBody'
  | 'legacyMigrate'
  | 'legacyClear'
  | 'legacyClearHint'
  | 'legacyResult'
  | 'legacyNone'
  | 'legacyFailed'
  | 'statCards'
  | 'statEnabled'
  | 'statDefault'
  | 'statModel'
  | 'defaultModelPanel'
  | 'defaultModelPanelHint'
  | 'defaultSaved'
  | 'cardPromptChip'
  | 'cardNoPrompt'
  | 'cardTagsNone'
  | 'closeDialog'
  | 'confirm'
  | 'migrateTitle'
  | 'migrateBody'
  | 'migrateConfirm'
  | 'migrateClearLabel'
  | 'migrateDone'
  | 'migrateSkipped'
  | 'migrateFailedCount'
  | 'cardCount'
  | 'noAllowedModelsShort'
  | 'readonlyCardStorage'
  | 'loadCardsError'
  | 'retryCards'
  | 'cardDefaultHint'
  | 'modelInherited'
  | 'importHintFiles'
  | 'importSummary'
  | 'exportSummary'
  | 'cardPromptLength'
  | 'cardGuidanceLength'
  | 'cardNotesLength'
  | 'selected'
  | 'deselect'
  | 'moreActions'
  | 'searchEmpty'
  | 'clearSearch'
  | 'filterCards'
  | 'sortCards'
  | 'cardEditorHint';

/** English dictionary ($subagentDirector). */
export const en: Record<SubagentDirectorKey, string> = {
  "nav": "Subagent Director",
  "loading": "Loading…",
  "sectionIntro": "Choose the LLM provider and model each subagent uses, and define role templates that bind a model and persona to a delegation. Only providers/models from the Subagent pool in plugin config (Plugins \u2192 Plugin Config \u2192 Subagent) can be selected.",
  "defaultsHeading": "Default model",
  "defaultsHint": "Used when a call or role does not name a provider/model.",
  "noAllowedModels": "No authorized models yet. Select models in the official Subagent model-selection list (plugin settings \u2192 Subagent); picks here are limited to that list.",
  "defaultProvider": "Provider",
  "defaultModel": "Model",
  "defaultReasoningEffort": "Reasoning effort",
  "restoreDefaults": "Restore defaults",
  "provider": "Provider",
  "model": "Model",
  "reasoningEffort": "Reasoning effort",
  "persona": "Persona",
  "agentPreset": "Agent Preset",
  "agentPresetPlaceholder": "e.g. reviewer",
  "agentPresetHint": "DSH 0.2.1 owns persona and tool composition inside an Agent Preset. Leave empty to inherit the parent preset; spawn-like providers only.",
  "legacyRoleFields": "Legacy persona/tool filter stored but not applied on DSH 0.2.1.",
  "rolesHeading": "Role templates",
  "rolesHint": "A role binds delegation guidance and optionally an Agent Preset or provider/model to a subagent.",
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
  "closeContinuableTitle": "Release this Subagent Director child (free its resident handle); children started by other tools are not tracked",
  "closingContinuable": "Releasing…",
  "closedSubagent": "Released",
  "confirmCloseContinuable": "Release Subagent Director child “{id}”? Only children started by this plugin in this process are tracked. A later send_message may cold-resume the session, but that new activation is not tracked here.",
  "closeFailed": "Release failed: {message}",
  "pageTitle": "Character cards",
  "pageIntro": "Package delegation guidance, a fixed system prompt, persona, and an optional model route into one reusable card.",
  "newCard": "New card",
  "importCards": "Import",
  "exportAll": "Export all",
  "cardsHeading": "Card library",
  "cardsHint": "Cards are stored as individual JSON files, separate from plugin configuration.",
  "searchCards": "Search cards",
  "filterAll": "All",
  "filterEnabled": "Enabled",
  "filterDisabled": "Disabled",
  "sortUpdated": "Recently updated",
  "sortName": "Name",
  "emptyCardsTitle": "No character cards yet",
  "emptyCardsBody": "Create a card or import a portable JSON bundle to give your subagents a stable role.",
  "noSearchResults": "No cards match the current search and filters.",
  "cardDefault": "Default",
  "setDefaultCard": "Set as default",
  "enabled": "Enabled",
  "disabled": "Disabled",
  "enableCard": "Enable",
  "disableCard": "Disable",
  "editCard": "Edit",
  "duplicateCard": "Duplicate",
  "exportCard": "Export",
  "deleteCard": "Delete",
  "confirmDeleteCard": "Delete card “{id}”? This cannot be undone.",
  "batchSelect": "Select",
  "batchDone": "Done",
  "batchSelected": "{count} selected",
  "selectAll": "Select all",
  "clearSelection": "Clear",
  "batchEnable": "Enable",
  "batchDisable": "Disable",
  "batchExport": "Export",
  "batchDelete": "Delete",
  "confirmBatchDelete": "Delete {count} selected cards? This cannot be undone.",
  "cardEditorNew": "New character card",
  "cardEditorEdit": "Edit character card",
  "cardIdentity": "Identity",
  "cardName": "Name",
  "cardId": "Card id",
  "cardIdHint": "Lowercase letters, digits, and single hyphens. Used as the delegation role id.",
  "cardIdImmutable": "The id cannot change after the card is created.",
  "cardEmoji": "Avatar glyph",
  "cardAccent": "Accent",
  "cardTags": "Tags",
  "cardTagsHint": "Comma separated. Used for search and filtering.",
  "cardModel": "Model route",
  "cardModelHint": "Leave empty to inherit the plugin default or the parent model.",
  "cardProvider": "Provider",
  "cardModelId": "Model",
  "cardReasoningEffort": "Reasoning effort",
  "cardAgentPreset": "Agent Preset",
  "cardAgentPresetHint": "Optional DSH preset for tool composition. Leave empty to inherit.",
  "cardPrompts": "Fixed role prompt",
  "cardSystemPrompt": "System prompt",
  "cardSystemPromptHint": "Injected as a system section into this card's child sessions, before tool guidance.",
  "cardPersona": "Persona",
  "cardPersonaHint": "Additional identity and style text appended to the fixed system prompt.",
  "cardGuidance": "Delegation guidance",
  "cardGuidanceRecommended": "Recommended when",
  "cardGuidanceHint": "Shown to the main agent. Explain when delegating to this card is the right choice.",
  "cardAvoidGuidance": "Not recommended when",
  "cardAvoidGuidanceHint": "Shown to the main agent. Explain when this card is the wrong choice and another card or the user should handle it.",
  "cardAvoidPrefix": "Not recommended: ",
  "cardNotes": "Notes",
  "cardNotesHint": "Human-only notes. Never sent to a model.",
  "cardEnabled": "Enabled",
  "cardEnabledHint": "Disabled cards remain stored but are not offered for delegation.",
  "cardAdvanced": "Advanced",
  "cardCreate": "Create card",
  "cardSave": "Save",
  "cardCancel": "Cancel",
  "cardDirtyConfirm": "Discard unsaved changes?",
  "cardInvalidId": "Use lowercase letters, digits, and single hyphens.",
  "cardNameRequired": "A card name is required.",
  "cardGuidanceRequired": "Delegation guidance is required.",
  "cardModelPair": "Choose both a provider and a model, or neither.",
  "cardDuplicateId": "A card with this id already exists.",
  "cardSaved": "Card saved",
  "cardDeleted": "Card deleted",
  "importTitle": "Import character cards",
  "importBody": "Drop JSON files, choose files, or paste a portable card or collection.",
  "importDrop": "Drop JSON files here",
  "importBrowse": "Choose files",
  "importPaste": "Paste JSON",
  "importPasteHint": "Accepts a single card, a card envelope, a collection, or an array.",
  "importStrategy": "When a card id already exists",
  "importSkip": "Skip",
  "importOverwrite": "Overwrite",
  "importDuplicate": "Keep both",
  "importSkipHint": "Leave the existing card untouched.",
  "importOverwriteHint": "Replace the existing card with the imported one.",
  "importDuplicateHint": "Import under a new id derived from the name.",
  "importRun": "Import",
  "importPreview": "{count} card(s) ready to import.",
  "importInvalid": "Some entries are invalid.",
  "importResult": "Imported {imported}, overwritten {overwritten}, skipped {skipped}, duplicates {duplicated}.",
  "importNoCards": "No cards were found in the selected input.",
  "importParseError": "Could not parse the JSON input.",
  "importFileTooLarge": "This file is larger than the import limit.",
  "exportDone": "Export ready.",
  "exportFailed": "Export failed: {message}",
  "download": "Download",
  "copyJson": "Copy JSON",
  "copied": "Copied",
  "copyFailed": "Copy failed",
  "storageReady": "Card storage ready",
  "storageUnavailable": "Card storage unavailable",
  "storageError": "Card storage error",
  "storageHint": "Cards are persisted by the DSH storage domain `subagent_director`, one JSON document per card.",
  "legacyBanner": "Legacy roles detected",
  "legacyBannerBody": "{count} role template(s) still live in the plugin configuration. Migrate them to cards to complete the storage move.",
  "legacyMigrate": "Migrate",
  "legacyClear": "Also clear the legacy fields",
  "legacyClearHint": "Removes `roles` and `defaultRole` from the plugin configuration after a successful migration.",
  "legacyResult": "Migrated {migrated}, skipped {skipped}, failed {failed}.",
  "legacyNone": "No legacy roles remain.",
  "legacyFailed": "Migration failed: {message}",
  "statCards": "Cards",
  "statEnabled": "Enabled",
  "statDefault": "Default",
  "statModel": "Default model",
  "defaultModelPanel": "Default model",
  "defaultModelPanelHint": "Used when a card or call does not bind a provider/model.",
  "defaultSaved": "Default model saved",
  "cardPromptChip": "Prompt",
  "cardNoPrompt": "Inherits baseline prompt",
  "cardTagsNone": "No tags",
  "closeDialog": "Close",
  "confirm": "Confirm",
  "migrateTitle": "Migrate legacy roles",
  "migrateBody": "Convert the role templates stored in the plugin configuration into individual character cards.",
  "migrateConfirm": "Migrate roles",
  "migrateClearLabel": "Clear the legacy settings after migration",
  "migrateDone": "Migration complete.",
  "migrateSkipped": "Skipped {count} role(s) whose ids already exist.",
  "migrateFailedCount": "{count} role(s) could not be migrated.",
  "cardCount": "{count} card(s)",
  "noAllowedModelsShort": "No authorized model routes",
  "readonlyCardStorage": "Configuration writes are read-only in this deployment; character-card storage remains independent.",
  "loadCardsError": "Could not load the card library.",
  "retryCards": "Retry",
  "cardDefaultHint": "The default card is selected when a delegation does not name a role.",
  "modelInherited": "Inherited",
  "importHintFiles": "Each file may contain one card or a collection.",
  "importSummary": "Imported {count} card(s).",
  "exportSummary": "Exported {count} card(s).",
  "cardPromptLength": "{count} characters",
  "cardGuidanceLength": "{count} / {max}",
  "cardNotesLength": "{count} / {max}",
  "selected": "Selected",
  "deselect": "Deselect",
  "moreActions": "More actions",
  "searchEmpty": "Search cards by name, id, tag, or guidance.",
  "clearSearch": "Clear search",
  "filterCards": "Filter cards",
  "sortCards": "Sort cards",
  "cardEditorHint": "Pack the delegation guidance, fixed prompt, persona, and model route for this card."
};

/** Chinese dictionary. */
export const zh: Record<SubagentDirectorKey, string> = {
  "nav": "子代理导演",
  "loading": "加载中…",
  "sectionIntro": "为每个子代理选择 LLM 供应商与模型，并以角色模板把模型与 persona 绑定到每次委派。只能选择插件-插件配置-Subagent池里的提供商-模型。",
  "defaultsHeading": "默认模型",
  "defaultsHint": "当某次调用或角色未指定供应商/模型时使用。",
  "noAllowedModels": "尚未配置已授权的模型。请先在官方 Subagent 模型选择列表（插件设置 → Subagent）中选择模型；此处只能从该列表中选择。",
  "defaultProvider": "供应商",
  "defaultModel": "模型",
  "defaultReasoningEffort": "推理强度",
  "restoreDefaults": "恢复默认",
  "provider": "供应商",
  "model": "模型",
  "reasoningEffort": "推理强度",
  "persona": "人设",
  "agentPreset": "Agent Preset",
  "agentPresetPlaceholder": "例如 reviewer",
  "agentPresetHint": "DSH 0.2.1 由 Agent Preset 统一管理 persona 与工具组合。留空则继承父代理预设；仅支持非继承型供应商（如 spawn）。",
  "legacyRoleFields": "旧版 persona/工具集仍保留，但在 DSH 0.2.1 上不再生效。",
  "rolesHeading": "角色模板",
  "rolesHint": "角色把委派指引与可选的 Agent Preset 或供应商/模型绑定到子代理。",
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
  "closeContinuableTitle": "释放本插件启动的可持续子代理（解除驻留句柄）；其他工具启动的子代理不受跟踪",
  "closingContinuable": "正在终止…",
  "closedSubagent": "已终止",
  "confirmCloseContinuable": "终止本插件启动的可持续子代理“{id}”？只有本插件在当前进程中启动的子代理会被跟踪；之后仍可用 send_message 冷恢复，但新的 activation 不再由此处跟踪。",
  "closeFailed": "终止失败：{message}",
  "pageTitle": "角色卡",
  "pageIntro": "把委派指引、固定系统提示词、persona 与可选的模型路由收进一张可复用的角色卡。",
  "newCard": "新建角色卡",
  "importCards": "导入",
  "exportAll": "导出全部",
  "cardsHeading": "角色卡库",
  "cardsHint": "角色卡以独立 JSON 文件持久化，不再写入插件公共配置。",
  "searchCards": "搜索角色卡",
  "filterAll": "全部",
  "filterEnabled": "已启用",
  "filterDisabled": "已停用",
  "sortUpdated": "最近更新",
  "sortName": "名称",
  "emptyCardsTitle": "还没有角色卡",
  "emptyCardsBody": "新建一张角色卡，或导入可移植的 JSON 集合，让子代理拥有稳定的角色。",
  "noSearchResults": "没有符合当前搜索与筛选条件的角色卡。",
  "cardDefault": "默认",
  "setDefaultCard": "设为默认",
  "enabled": "已启用",
  "disabled": "已停用",
  "enableCard": "启用",
  "disableCard": "停用",
  "editCard": "编辑",
  "duplicateCard": "复制",
  "exportCard": "导出",
  "deleteCard": "删除",
  "confirmDeleteCard": "删除角色卡“{id}”？此操作不可撤销。",
  "batchSelect": "批量选择",
  "batchDone": "完成",
  "batchSelected": "已选 {count} 张",
  "selectAll": "全选",
  "clearSelection": "清除",
  "batchEnable": "启用",
  "batchDisable": "停用",
  "batchExport": "导出",
  "batchDelete": "删除",
  "confirmBatchDelete": "删除选中的 {count} 张角色卡？此操作不可撤销。",
  "cardEditorNew": "新建角色卡",
  "cardEditorEdit": "编辑角色卡",
  "cardIdentity": "身份",
  "cardName": "名称",
  "cardId": "角色卡 id",
  "cardIdHint": "小写字母、数字与单个连字符；同时作为委派 role id。",
  "cardIdImmutable": "创建后不可修改 id。",
  "cardEmoji": "头像符号",
  "cardAccent": "强调色",
  "cardTags": "标签",
  "cardTagsHint": "逗号分隔，用于搜索与筛选。",
  "cardModel": "模型路由",
  "cardModelHint": "留空则继承插件默认模型或父代理模型。",
  "cardProvider": "供应商",
  "cardModelId": "模型",
  "cardReasoningEffort": "推理强度",
  "cardAgentPreset": "Agent Preset",
  "cardAgentPresetHint": "可选的 DSH 预设，用于工具组合；留空则继承。",
  "cardPrompts": "固定角色提示词",
  "cardSystemPrompt": "系统提示词",
  "cardSystemPromptHint": "作为系统提示词段注入此卡片的子代理会话，位于工具指引之前。",
  "cardPersona": "Persona",
  "cardPersonaHint": "附加的身份与风格文本，追加在固定系统提示词之后。",
  "cardGuidance": "委派指引",
  "cardGuidanceRecommended": "推荐委派",
  "cardGuidanceHint": "展示给主代理：什么情况下应委派给这张角色卡。",
  "cardAvoidGuidance": "不推荐委派",
  "cardAvoidGuidanceHint": "展示给主代理：什么情况下不应委派给这张角色卡，应改用其他卡或直接询问用户。",
  "cardAvoidPrefix": "不推荐：",
  "cardNotes": "备注",
  "cardNotesHint": "仅供人阅读，不会发送给模型。",
  "cardEnabled": "启用",
  "cardEnabledHint": "停用的卡片仍会保留，但不会被用于委派。",
  "cardAdvanced": "高级",
  "cardCreate": "创建角色卡",
  "cardSave": "保存",
  "cardCancel": "取消",
  "cardDirtyConfirm": "放弃未保存的修改？",
  "cardInvalidId": "请使用小写字母、数字与单个连字符。",
  "cardNameRequired": "角色卡名称不能为空。",
  "cardGuidanceRequired": "委派指引不能为空。",
  "cardModelPair": "供应商与模型需同时选择，或同时留空。",
  "cardDuplicateId": "该 id 已被其他角色卡使用。",
  "cardSaved": "角色卡已保存",
  "cardDeleted": "角色卡已删除",
  "importTitle": "导入角色卡",
  "importBody": "拖入 JSON 文件、选择文件，或粘贴单张卡片与卡片集合。",
  "importDrop": "将 JSON 文件拖到这里",
  "importBrowse": "选择文件",
  "importPaste": "粘贴 JSON",
  "importPasteHint": "支持单张卡片、卡片信封、集合对象或数组。",
  "importStrategy": "当卡片 id 已存在时",
  "importSkip": "跳过",
  "importOverwrite": "覆盖",
  "importDuplicate": "保留两者",
  "importSkipHint": "保留现有卡片不变。",
  "importOverwriteHint": "用导入内容替换现有卡片。",
  "importDuplicateHint": "按名称派生新的 id 后导入。",
  "importRun": "导入",
  "importPreview": "待导入 {count} 张角色卡。",
  "importInvalid": "部分条目无效。",
  "importResult": "已导入 {imported}，覆盖 {overwritten}，跳过 {skipped}，保留两者 {duplicated}。",
  "importNoCards": "所选输入中没有找到角色卡。",
  "importParseError": "无法解析 JSON 输入。",
  "importFileTooLarge": "文件超过导入上限。",
  "exportDone": "导出已就绪。",
  "exportFailed": "导出失败：{message}",
  "download": "下载",
  "copyJson": "复制 JSON",
  "copied": "已复制",
  "copyFailed": "复制失败",
  "storageReady": "角色卡存储就绪",
  "storageUnavailable": "角色卡存储不可用",
  "storageError": "角色卡存储异常",
  "storageHint": "角色卡由 DSH 存储域 `subagent_director` 持久化，每张卡一个 JSON 文档。",
  "legacyBanner": "检测到旧版角色",
  "legacyBannerBody": "插件配置中仍有 {count} 个角色模板。迁移为角色卡后即可完成存储切换。",
  "legacyMigrate": "迁移",
  "legacyClear": "同时清除旧配置字段",
  "legacyClearHint": "迁移成功后从插件配置中移除 `roles` 与 `defaultRole`。",
  "legacyResult": "已迁移 {migrated}，跳过 {skipped}，失败 {failed}。",
  "legacyNone": "已无旧版角色。",
  "legacyFailed": "迁移失败：{message}",
  "statCards": "角色卡",
  "statEnabled": "已启用",
  "statDefault": "默认卡",
  "statModel": "默认模型",
  "defaultModelPanel": "默认模型",
  "defaultModelPanelHint": "当角色卡或单次调用未绑定供应商/模型时使用。",
  "defaultSaved": "默认模型已保存",
  "cardPromptChip": "提示词",
  "cardNoPrompt": "继承基础提示词",
  "cardTagsNone": "无标签",
  "closeDialog": "关闭",
  "confirm": "确认",
  "migrateTitle": "迁移旧版角色",
  "migrateBody": "把插件配置中的角色模板转换为独立角色卡。",
  "migrateConfirm": "迁移角色",
  "migrateClearLabel": "迁移后清除旧配置",
  "migrateDone": "迁移完成。",
  "migrateSkipped": "跳过 {count} 个 id 已存在的角色。",
  "migrateFailedCount": "{count} 个角色迁移失败。",
  "cardCount": "{count} 张角色卡",
  "noAllowedModelsShort": "没有已授权的模型路由",
  "readonlyCardStorage": "当前部署的配置写入为只读；角色卡存储独立。",
  "loadCardsError": "无法加载角色卡库。",
  "retryCards": "重试",
  "cardDefaultHint": "当委派未指定角色时使用默认卡。",
  "modelInherited": "继承",
  "importHintFiles": "每个文件可以是一张卡或一个集合。",
  "importSummary": "已导入 {count} 张角色卡。",
  "exportSummary": "已导出 {count} 张角色卡。",
  "cardPromptLength": "{count} 个字符",
  "cardGuidanceLength": "{count} / {max}",
  "cardNotesLength": "{count} / {max}",
  "selected": "已选中",
  "deselect": "取消选择",
  "moreActions": "更多操作",
  "searchEmpty": "按名称、id、标签或委派指引搜索角色卡。",
  "clearSearch": "清除搜索",
  "filterCards": "筛选角色卡",
  "sortCards": "角色卡排序",
  "cardEditorHint": "为这张卡打包委派指引、固定提示词、persona 与模型路由。"
};

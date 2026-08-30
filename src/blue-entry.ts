/** Blue Public Beta frontend for Subagent Director. */

import type { Context } from '@deepseek-ai/cordis';
import type {
  BlueJson,
  BluePluginApiV1,
  BluePluginHost,
  BluePublicOverlayHandle,
  BlueRefreshRegistration,
  BlueResult,
  BlueUiEvent,
  BlueUiNode,
  BlueUserGesture,
} from '@dsh-blue/blue-api';
import type { BluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1';

import {
  type DirectorActivityEntry,
  type DirectorActivityProjection,
  type DirectorRuntimeSnapshot,
  type SubagentDirectorHost,
} from './blue-contract.js';
import type { RoleTemplate } from './route-resolver.js';

export const name = 'subagent-director-blue';
export const inject: readonly string[] = [];

const PLUGIN_ID = 'dsh-plugin-subagent-director';
const PANE_ID = 'director.activity';
const NEW_ROLE_TAB = 'director.role.new';
const SAVE_ACTION = '保存';
const CLOSE_ACTION = '关闭';

const manifest: BluePluginManifestV1 = {
  $schema: 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json',
  schemaVersion: 1,
  id: PLUGIN_ID,
  entry: './blue',
  api: '^1.0.0-beta.1',
  compatibility: {
    blue: '0.1.1-rc.2',
    harness: '>=0.1.1-rc.2 <0.2.0',
    node: '^22.19.0 || >=24.0.0',
  },
  capabilities: {
    required: [
      { name: 'panes', version: '^1.0.0', resources: { placements: ['right'] } },
    ],
    optional: [
      { name: 'commands', version: '^1.0.0', resources: { names: ['director'] } },
      { name: 'overlays', version: '^1.0.0' },
      { name: 'notifications.publish', version: '^1.0.0' },
      { name: 'session.read', version: '^1.0.0', resources: { fields: ['identity', 'status', 'model'] } },
    ],
  },
};

interface FrontendState {
  sessionId?: string;
  sessionStatus?: string;
  sessionModel?: string;
  orchestrate: 'on' | 'off';
  activity: DirectorActivityProjection;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function formString(values: BlueJson, key: string): string {
  const value = asObject(values)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function fields(rows: Array<{ label: string; value: string; tone?: 'muted' | 'accent' | 'success' | 'warning' | 'danger' }>): BlueUiNode {
  return {
    kind: 'fields',
    rows: rows.map((row) => ({
      label: row.label,
      value: [{ text: row.value, ...(row.tone === undefined ? {} : { tone: row.tone }) }],
    })),
  };
}

function runtime(ctx: Context): SubagentDirectorHost | undefined {
  return ctx.get('subagentDirectorHost') as SubagentDirectorHost | undefined;
}

function runtimeSnapshot(ctx: Context): DirectorRuntimeSnapshot | undefined {
  try {
    return runtime(ctx)?.snapshot();
  } catch {
    return undefined;
  }
}

function activityTone(status: DirectorActivityEntry['status']): 'muted' | 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'failed') return 'danger';
  if (status === 'completed') return 'success';
  if (status === 'delegated') return 'accent';
  return 'warning';
}

function activityStatusLabel(status: DirectorActivityEntry['status']): string {
  if (status === 'pending') return '等待中';
  if (status === 'delegated') return '已委派';
  if (status === 'completed') return '已完成';
  return '失败';
}

function sessionStatusLabel(status: string | undefined): string {
  if (status === 'running') return '运行中';
  if (status === 'waiting') return '等待中';
  if (status === 'failed') return '失败';
  return '空闲';
}

function backgroundModeLabel(mode: DirectorRuntimeSnapshot['backgroundMode'] | undefined): string {
  if (mode === 'continuable') return '可持续会话';
  if (mode === 'one-shot') return '单次任务';
  return '不可用';
}

function transportLabel(transport: string): string {
  if (transport === 'spawn') return '独立启动';
  if (transport === 'fork') return '继承上下文';
  if (transport === 'acp') return 'ACP';
  return transport;
}

function paneView(ctx: Context, state: FrontendState): BlueUiNode {
  const snapshot = runtimeSnapshot(ctx);
  const activity = [...state.activity.entries].reverse().slice(0, 8);
  const activityView: BlueUiNode = activity.length === 0
    ? { kind: 'empty', title: '暂无委派活动' }
    : fields(activity.map((entry) => ({
        label: entry.description,
        value: [activityStatusLabel(entry.status), entry.roleId, entry.model].filter(Boolean).join(' / '),
        tone: activityTone(entry.status),
      })));

  return {
    kind: 'surface',
    chrome: 'lane',
    title: '子代理编排器',
    subtitle: snapshot === undefined ? '宿主服务不可用' : `${snapshot.toolName} · ${transportLabel(snapshot.transport)}`,
    badges: [{ text: '编排中', tone: 'accent', emphasis: 'strong' }],
    padding: 1,
    child: {
      kind: 'stack',
      direction: 'column',
      gap: 1,
      children: [
        { node: fields([
          { label: '会话', value: state.sessionId === undefined ? '不可用' : state.sessionId.slice(-8), tone: 'muted' },
          { label: '代理状态', value: sessionStatusLabel(state.sessionStatus) },
          { label: '委派模式', value: backgroundModeLabel(snapshot?.backgroundMode) },
          { label: '模型', value: state.sessionModel ?? '继承默认值', tone: 'muted' },
          { label: '角色数', value: String(Object.keys(snapshot?.settings.roles ?? {}).length) },
        ]) },
        { node: { kind: 'divider', label: '委派活动' } },
        { node: { kind: 'scroll', child: activityView, scrollbar: true } },
      ],
    },
  };
}

function publish(api: BluePluginApiV1, content: string, tone: 'success' | 'danger' = 'success'): void {
  api.notifications?.publish({
    id: `director.notice.${String(Date.now())}`,
    tone,
    view: { kind: 'text', content },
  });
}

function registerCleanup(ctx: Context, registration: BlueResult<{ dispose(): void }>): void {
  if (registration.ok) ctx.effect(() => () => registration.value.dispose());
}

function mountBlue(ctx: Context, host: BluePluginHost): void {
  const opened = host.open(ctx, manifest);
  if (!opened.ok) {
    ctx.logger.warn(`[subagent-director-blue] Blue 前端未获准挂载：${opened.code}: ${opened.message}`);
    return;
  }

  const api = opened.value.api;
  const state: FrontendState = {
    orchestrate: 'off',
    activity: { version: 1, entries: [] },
  };
  let pane: BlueRefreshRegistration & { setHidden(hidden: boolean): BlueResult } | undefined;
  let overlay: BluePublicOverlayHandle | undefined;

  const syncHost = (): void => {
    const service = runtime(ctx);
    if (service === undefined) {
      state.activity = { version: 1, entries: [] };
      state.orchestrate = 'off';
      return;
    }
    try {
      const activity = service.activity(state.sessionId);
      if (state.sessionId === undefined && activity.sessionId !== undefined) state.sessionId = activity.sessionId;
      state.activity = activity;
      const orchestrate = service.orchestrate(state.sessionId);
      if (state.sessionId === undefined && orchestrate.sessionId !== undefined) state.sessionId = orchestrate.sessionId;
      state.orchestrate = orchestrate.mode;
    } catch {
      state.activity = { version: 1, entries: [] };
      state.orchestrate = 'off';
    }
  };

  const refresh = (): void => {
    syncHost();
    pane?.setHidden(state.orchestrate !== 'on');
    pane?.refresh();
    overlay?.refresh();
  };

  const closeOverlay = (): void => {
    overlay?.close();
    overlay = undefined;
  };

  const openRoleManager = (gesture: BlueUserGesture | undefined): BlueResult => {
    if (api.overlays === undefined) {
      return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'Blue 浮层能力不可用。' };
    }
    if (gesture === undefined) {
      return { ok: false, code: 'BLUE_ACTION_REJECTED', message: '打开角色管理需要由用户操作触发。' };
    }

    const initialRoles = runtimeSnapshot(ctx)?.settings.roles ?? {};
    let activeTab = Object.keys(initialRoles)[0] ?? NEW_ROLE_TAB;
    let error: string | undefined;
    const request = {
      id: 'director.role-manager',
      title: '子代理角色管理',
      capturing: true,
      dismissible: true,
      anchor: 'center' as const,
      width: '80%' as const,
      minWidth: 36,
      maxHeight: '70%' as const,
      render: (): BlueUiNode => {
        const roles = runtimeSnapshot(ctx)?.settings.roles ?? {};
        if (activeTab !== NEW_ROLE_TAB && roles[activeTab] === undefined) activeTab = Object.keys(roles)[0] ?? NEW_ROLE_TAB;
        const existing = activeTab === NEW_ROLE_TAB ? undefined : roles[activeTab];
        const tabs = [
          ...Object.entries(roles).map(([id, role]) => ({ id, label: role.displayName || id })),
          { id: NEW_ROLE_TAB, label: '+ 新建角色' },
        ];
        return {
          kind: 'stack',
          direction: 'column',
          gap: 1,
          children: [
            {
              node: { kind: 'tabs', id: 'director.role-tabs', activeId: activeTab, items: tabs },
              minSize: 1,
              shrink: 0,
            },
            ...(error === undefined ? [] : [{ node: { kind: 'text' as const, content: error, tone: 'danger' as const } }]),
            { node: { kind: 'scroll', scrollbar: true, child: {
              kind: 'stack', direction: 'column', gap: 1, children: [
                { node: { kind: 'form', id: 'director.role-form', submitActionId: SAVE_ACTION, cancelActionId: CLOSE_ACTION, fields: [
                  { kind: 'input', id: 'id', label: '角色 ID', value: existing === undefined ? '' : activeTab, placeholder: 'code-reviewer', disabled: existing !== undefined },
                  { kind: 'input', id: 'displayName', label: '显示名称', value: existing?.displayName ?? '' },
                  { kind: 'textarea', id: 'description', label: '委派说明', value: existing?.description ?? '' },
                  { kind: 'textarea', id: 'persona', label: '角色设定', value: existing?.persona ?? '' },
                  { kind: 'input', id: 'provider', label: '模型供应商', value: existing?.provider ?? '', placeholder: '继承默认值' },
                  { kind: 'input', id: 'model', label: '模型', value: existing?.model ?? '', placeholder: '继承默认值' },
                  { kind: 'input', id: 'reasoningEffort', label: '推理强度', value: existing?.reasoningEffort ?? '', placeholder: '继承默认值' },
                ] } },
                ...(existing === undefined ? [] : [{ node: { kind: 'actions' as const, id: 'director.role-delete-actions', items: [
                  { id: 'director.role.delete', label: '删除', intent: 'danger' as const, confirm: `确定删除角色“${existing.displayName || activeTab}”吗？` },
                ] } }]),
              ],
            } } },
          ],
        };
      },
      onEvent: async (event: BlueUiEvent): Promise<BlueResult> => {
        if (event.kind === 'dismiss' || (event.kind === 'activate' && event.controlId === CLOSE_ACTION)) {
          closeOverlay();
          return { ok: true, value: undefined };
        }
        if (event.kind === 'tab-change' && event.controlId === 'director.role-tabs') {
          const roles = runtimeSnapshot(ctx)?.settings.roles ?? {};
          if (event.tabId === NEW_ROLE_TAB || roles[event.tabId] !== undefined) activeTab = event.tabId;
          error = undefined;
          overlay?.refresh();
          return { ok: true, value: undefined };
        }

        const service = runtime(ctx);
        if (service === undefined) {
          return { ok: false, code: 'BLUE_OWNER_UNAVAILABLE', message: '子代理编排器宿主服务不可用。' };
        }
        if (event.kind === 'activate' && event.controlId === 'director.role.delete' && activeTab !== NEW_ROLE_TAB) {
          const deleted = activeTab;
          try {
            await service.deleteRole(deleted);
            const roles = runtimeSnapshot(ctx)?.settings.roles ?? {};
            activeTab = Object.keys(roles).find((id) => id !== deleted) ?? NEW_ROLE_TAB;
            error = undefined;
            publish(api, `已删除角色“${deleted}”。`);
            refresh();
            return { ok: true, value: undefined };
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
            publish(api, error, 'danger');
            overlay?.refresh();
            return { ok: false, code: 'BLUE_ACTION_REJECTED', message: error };
          }
        }
        if (event.kind !== 'submit' || event.controlId !== 'director.role-form') return { ok: true, value: undefined };

        const existing = activeTab === NEW_ROLE_TAB
          ? undefined
          : runtimeSnapshot(ctx)?.settings.roles?.[activeTab];
        const nextId = existing === undefined ? formString(event.values, 'id') : activeTab;
        const displayName = formString(event.values, 'displayName');
        const description = formString(event.values, 'description');
        if (nextId.length === 0 || displayName.length === 0 || description.length === 0) {
          error = '角色 ID、显示名称和委派说明均为必填项。';
          overlay?.refresh();
          return { ok: false, code: 'BLUE_ACTION_REJECTED', message: error };
        }
        const optional = (key: string): string | undefined => formString(event.values, key) || undefined;
        const role: RoleTemplate = {
          displayName,
          description,
          ...(optional('persona') === undefined ? {} : { persona: optional('persona') }),
          ...(optional('provider') === undefined ? {} : { provider: optional('provider') }),
          ...(optional('model') === undefined ? {} : { model: optional('model') }),
          ...(optional('reasoningEffort') === undefined ? {} : { reasoningEffort: optional('reasoningEffort') }),
          ...(existing?.toolFilter === undefined ? {} : { toolFilter: existing.toolFilter }),
        };
        try {
          await service.saveRole(nextId, role);
          activeTab = nextId;
          error = undefined;
          publish(api, `已保存角色“${nextId}”。`);
          refresh();
          return { ok: true, value: undefined };
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
          publish(api, error, 'danger');
          overlay?.refresh();
          return { ok: false, code: 'BLUE_ACTION_REJECTED', message: error };
        }
      },
    };

    closeOverlay();
    const result = api.overlays.open(request, { userGesture: gesture });
    if (result.ok) overlay = result.value;
    return result.ok ? { ok: true, value: undefined } : result;
  };

  if (api.session !== undefined) {
    const updateSession = (result = api.session!.current()): void => {
      if (!result.ok || result.value === null) {
        state.sessionId = undefined;
        state.sessionStatus = undefined;
        state.sessionModel = undefined;
      } else {
        state.sessionId = result.value.id;
        state.sessionStatus = result.value.status;
        state.sessionModel = result.value.model === undefined
          ? undefined
          : [result.value.model.provider, result.value.model.id].filter(Boolean).join('/');
      }
    };
    updateSession();
    registerCleanup(ctx, api.session.subscribe((result) => {
      updateSession(result);
      refresh();
    }));
  }

  const paneResult = api.panes!.register({
    id: PANE_ID,
    title: '编排器',
    placement: 'right',
    size: { min: 24, preferred: 34, max: 48 },
    narrow: 'bottom',
    render: () => paneView(ctx, state),
  });
  if (!paneResult.ok) return;
  pane = paneResult.value;
  refresh();

  if (api.commands !== undefined) {
    registerCleanup(ctx, api.commands.register({
      id: 'director',
      label: '管理子代理角色',
      execute: async (_args, options) => openRoleManager(options?.userGesture),
    }));
  }

  // The Blue row can activate before the main Director row has finished
  // providing its Host service. Subscribe reactively so that late service
  // arrival still wires orchestrate/activity updates into pane refreshes.
  ctx.inject(['subagentDirectorHost'], (hostCtx: Context) => {
    const service = runtime(hostCtx);
    if (service === undefined) return;
    hostCtx.effect(() => service.watch(refresh));
    refresh();
  });
}

/** Wait for Blue without making it a required dependency of Web/headless hosts. */
export function apply(ctx: Context): void {
  let mounted = false;
  const mount = (scope: Context): void => {
    if (mounted) return;
    const host = scope.get('bluePluginHost') as BluePluginHost | undefined;
    if (host === undefined) return;
    mounted = true;
    mountBlue(scope, host);
  };
  mount(ctx);
  if (!mounted) ctx.inject(['bluePluginHost'], mount);
}

/** Real-Cordis lifecycle coverage for the optional Blue frontend entry. */
import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';

import { apply, inject, name } from '../src/blue-entry.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));
const registration = () => ({
  disposed: false,
  dispose() {},
  refresh: () => ({ ok: true, value: undefined }),
  setHidden: () => ({ ok: true, value: undefined }),
});

describe('real cordis probe - optional Blue frontend lifecycle', () => {
  it('activates without Blue, mounts once, and keeps the read-only pane hidden while orchestrate is off', async () => {
    const ctx = new Context();
    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();
    expect(entry.store).toBeDefined();

    let opens = 0;
    const panes: Array<{ render(): unknown }> = [];
    const hidden: boolean[] = [];
    ctx.provide('bluePluginHost', {
      open: () => {
        opens += 1;
        const api = {
          panes: {
            register: (pane: { render(): unknown }) => {
              panes.push(pane);
              return { ok: true, value: { ...registration(), setHidden(value: boolean) { hidden.push(value); return { ok: true, value: undefined }; } } };
            },
            list: () => [],
          },
        };
        return { ok: true, value: { api, ...api, grants: [], unavailableOptional: [] } };
      },
    });
    await settle();
    await settle();

    expect(opens).toBe(1);
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({ id: 'director.activity', placement: 'right', narrow: 'bottom' });
    expect(hidden.at(-1)).toBe(true);
    expect(panes[0]!.render()).toMatchObject({ kind: 'surface', title: '子代理编排器' });

    await entry.dispose();
  });

  it('shows Host-owned activity only while orchestrate is on and exposes no pane controls', async () => {
    const ctx = new Context();
    let mode: 'on' | 'off' = 'on';
    let notify = (): void => {};
    ctx.provide('subagentDirectorHost', {
      snapshot: () => ({ settings: { roles: {} }, toolName: 'subagent_role', transport: 'spawn', backgroundMode: 'one-shot' }),
      activity: () => ({
        version: 1,
        sessionId: 'session-1',
        entries: [{
          callId: 'call-1',
          description: 'Review patch',
          roleId: 'code-reviewer',
          status: 'completed',
          mode: 'foreground',
          targetId: 'run-1',
          startedAt: 1,
          updatedAt: 2,
        }],
      }),
      orchestrate: () => ({ mode, sessionId: 'session-1' }),
      watch: (listener: () => void) => { notify = listener; return () => {}; },
      saveRole: async () => {},
      deleteRole: async () => {},
    });
    const panes: Array<{ render(): unknown }> = [];
    const hidden: boolean[] = [];
    let sessionReads = 0;
    ctx.provide('bluePluginHost', {
      open: () => {
        const api = {
          panes: {
            register: (pane: { render(): unknown }) => {
              panes.push(pane);
              return { ok: true, value: { ...registration(), setHidden(value: boolean) { hidden.push(value); return { ok: true, value: undefined }; } } };
            },
            list: () => [],
          },
          session: {
            current: () => {
              sessionReads += 1;
              return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'owner gap' };
            },
            subscribe: (listener: (result: unknown) => void) => {
              listener({ ok: true, value: { revision: 1, sessionEpoch: 1, id: 'session-1', cwd: '/tmp', status: 'idle', mode: 'normal' } });
              return { ok: true, value: { disposed: false, dispose() {} } };
            },
          },
        };
        return { ok: true, value: { api, ...api, grants: [], unavailableOptional: [] } };
      },
    });
    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();

    expect(panes).toHaveLength(1);
    expect(sessionReads).toBe(1);
    expect(hidden.at(-1)).toBe(false);
    const rendered = JSON.stringify(panes[0]!.render());
    expect(rendered).toContain('Review patch');
    expect(rendered).toContain('已完成');
    expect(rendered).toContain('委派活动');
    expect(rendered).not.toContain('No delegation activity');
    expect(rendered).not.toContain('"kind":"tabs"');
    expect(rendered).not.toContain('"kind":"actions"');
    expect(rendered).not.toContain('"kind":"list"');

    mode = 'off';
    notify();
    expect(hidden.at(-1)).toBe(true);
    await entry.dispose();
  });

  it('subscribes when the Director Host service arrives after the Blue frontend', async () => {
    const ctx = new Context();
    const hidden: boolean[] = [];
    ctx.provide('bluePluginHost', {
      open: () => {
        const api = {
          panes: {
            register: () => ({
              ok: true,
              value: {
                ...registration(),
                setHidden(value: boolean) {
                  hidden.push(value);
                  return { ok: true, value: undefined };
                },
              },
            }),
            list: () => [],
          },
        };
        return { ok: true, value: { api, ...api, grants: [], unavailableOptional: [] } };
      },
    });
    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();
    expect(hidden.at(-1)).toBe(true);

    let mode: 'on' | 'off' = 'off';
    let notify = (): void => {};
    const removeHost = ctx.provide('subagentDirectorHost', {
      snapshot: () => ({ settings: { roles: {} }, toolName: 'subagent_role', transport: 'spawn', backgroundMode: 'one-shot' }),
      activity: () => ({ version: 1, sessionId: 'session-1', entries: [] }),
      orchestrate: () => ({ mode, sessionId: 'session-1' }),
      watch: (listener: () => void) => { notify = listener; return () => {}; },
      saveRole: async () => {},
      deleteRole: async () => {},
    });
    await settle();
    expect(hidden.at(-1)).toBe(true);

    mode = 'on';
    notify();
    expect(hidden.at(-1)).toBe(false);

    removeHost();
    await entry.dispose();
  });

  it('opens one tabbed role manager command and persists add/delete actions', async () => {
    const ctx = new Context();
    const roles: Record<string, any> = {
      reviewer: { displayName: '代码审查员', description: '审查代码变更' },
      researcher: { displayName: '研究分析员', description: '研究指定问题' },
    };
    const saveRole = vi.fn(async (id: string, role: unknown) => { roles[id] = role; });
    const deleteRole = vi.fn(async (id: string) => { delete roles[id]; });
    ctx.provide('subagentDirectorHost', {
      snapshot: () => ({ settings: { roles }, toolName: 'subagent_role', transport: 'spawn', backgroundMode: 'one-shot' }),
      activity: () => ({ version: 1, entries: [] }),
      orchestrate: () => ({ mode: 'off' }),
      watch: () => () => {},
      saveRole,
      deleteRole,
    });

    const commands: Array<{ id: string; label: string; execute(args: string[], options?: unknown): Promise<unknown> }> = [];
    let overlayRequest: { title: string; render(): unknown; onEvent(event: unknown): Promise<unknown> } | undefined;
    ctx.provide('bluePluginHost', {
      open: () => {
        const api = {
          panes: {
            register: () => ({ ok: true, value: registration() }),
            list: () => [],
          },
          commands: {
            register: (command: { id: string; label: string; execute(args: string[], options?: unknown): Promise<unknown> }) => {
              commands.push(command);
              return { ok: true, value: { disposed: false, dispose() {} } };
            },
          },
          overlays: {
            open: (request: { title: string; render(): unknown; onEvent(event: unknown): Promise<unknown> }) => {
              overlayRequest = request;
              return { ok: true, value: { disposed: false, closed: false, dispose() {}, close() {}, refresh: () => ({ ok: true, value: undefined }) } };
            },
          },
        };
        return { ok: true, value: { api, ...api, grants: [], unavailableOptional: [] } };
      },
    });

    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();
    expect(commands.map((command) => command.id)).toEqual(['director']);
    expect(commands[0]!.label).toBe('管理子代理角色');
    await commands[0]!.execute([], { userGesture: {} });
    expect(overlayRequest).toBeDefined();
    expect(overlayRequest!.title).toBe('子代理角色管理');
    let rendered = JSON.stringify(overlayRequest!.render());
    expect(rendered).toContain('director.role-tabs');
    expect(rendered).toContain('代码审查员');
    expect(rendered).toContain('研究分析员');
    expect(rendered).toContain('+ 新建角色');
    expect(rendered).toContain('director.role-form');
    expect(rendered).toContain('显示名称');
    expect(rendered).toContain('委派说明');
    expect(rendered).toContain('角色设定');
    expect(rendered).toContain('模型供应商');
    expect(rendered).toContain('推理强度');
    expect(rendered).toContain('保存');
    expect(rendered).toContain('关闭');
    expect(rendered).toContain('删除');
    expect(rendered).not.toContain('Display name');
    expect(rendered).not.toContain('Delegation guidance');
    expect(rendered).toContain('"minSize":1');
    expect(rendered).toContain('"shrink":0');

    await overlayRequest!.onEvent({ kind: 'tab-change', controlId: 'director.role-tabs', tabId: 'director.role.new' });
    await overlayRequest!.onEvent({
      kind: 'submit',
      controlId: 'director.role-form',
      values: { id: 'writer', displayName: '文档工程师', description: '编写技术文档', persona: '', provider: '', model: '', reasoningEffort: '' },
    });
    expect(saveRole).toHaveBeenCalledWith('writer', expect.objectContaining({ displayName: '文档工程师', description: '编写技术文档' }));
    rendered = JSON.stringify(overlayRequest!.render());
    expect(rendered).toContain('文档工程师');

    await overlayRequest!.onEvent({ kind: 'activate', controlId: 'director.role.delete' });
    expect(deleteRole).toHaveBeenCalledWith('writer');
    expect(roles.writer).toBeUndefined();
    await entry.dispose();
  });
});

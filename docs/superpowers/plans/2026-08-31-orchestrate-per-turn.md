# 纯编排模式（/orchestrate）改为按轮自动检测（per-turn auto-detection）

## Goal

修复 0.4.0 纯编排模式的两个问题，并把用法改为类似 `/using aegis` 的按轮声明式：

1. **修复「对话什么都不返回」**：`/orchestrate on` 后模型被「纯编排者」系统提示束缚，但
   `subagent-director.roles` 未配置任何角色 → 无法委派、禁止亲自动手 → 对话无输出。
2. **修复「不清楚是否已开启」**：粘性模式无可见状态；改为按轮检测后，用户声明即生效、不声明即普通模式。
3. **新用法（不再需要 on/off）**：
   - 消息开头声明 `/orchestrate`（无参数）→ 该轮会话使用纯编排模式；
   - 自然语言「使用orchestrate模式」（含合理变体）→ 该轮会话使用纯编排模式；
   - `/orchestrate on` 保留为显式持久模式（向后兼容）；`/orchestrate off` 退出持久模式。

## Architecture

### 现状（0.4.0-beta.1，探针已确认）

- `/orchestrate on|off` 命令（无参数默认 on）→ handler 向会话日志 append `orchestrate/change` 事件；
- `sessionProjections` 投影折叠该事件为每会话 `mode: 'on'|'off'`（粘性）；
- `systemPrompt.section('orchestrate-mode')` 的 text provider 在每次装配时读投影快照：
  mode=on → 注入完整「纯编排者」提示（含动态角色清单）；mode=off → 返回 ''。
- 根因链（探针证据）：当前会话投影 mode=on（粘性），`subagent-director.roles` 为空 →
  注入的提示含「You are a PURE ORCHESTRATOR… NEVER read/write/execute」+「No Subagent Director
  roles are configured yet」→ 模型既不能委派（无角色）又不许亲自动手 → 无输出。

### 新设计

**核心：系统提示段 text provider 按轮检测，投影降级为向后兼容兜底。**

决策顺序（每次装配，即每模型步）：

1. 从会话日志取**当前轮用户消息**（最新 `user/message` 事件的 text 块拼接）：
   - `detectOrchestrateRequest(text)` 返回 `'on'` → 注入编排提示（或不可用提示）；
   - 返回 `'off'` → 返回 ''（显式退出本轮）。
2. 扫描**最近一次 `command/run`（name='orchestrate'）**是否发生在「上一条用户消息之后、当前用户消息之前」：
   - args 为空或 `on` → 注入（斜杠路径按轮生效）；
   - args 为 `off` → 返回 ''。
3. **投影兜底（向后兼容）**：以上均未命中时读投影快照，mode=on → 注入（旧粘性会话保持行为）。

**无角色处理（修复「什么都不返回」）**：判定为 on 但 `settings.roles` 为空时，**不注入完整
纯编排者框架**（那是束缚模型的元凶），改为注入一段简短「不可用提示」，指示模型告知用户
需要先配置角色、然后以普通模式继续处理请求 → 模型必然给出有意义的回复。

**命令语义**：
- `/orchestrate`（无参数）→ 按轮开启：**不 append 粘性事件**，返回「on for this turn」反馈；
  本轮由 `command/run` 扫描命中。
- `/orchestrate on` → 持久开启（append 事件，向后兼容），反馈注明「persistent until /orchestrate off」。
- `/orchestrate off` → 持久关闭（append 事件）。
- 非法参数 → 错误，并提示正确用法（先 /orchestrate 再发任务，或消息开头写「使用orchestrate模式」）。

**检测模式（纯函数 `detectOrchestrateRequest`，大小写不敏感）**：
- 斜杠：`^\/orchestrate(?:\s+(\S+))?` → 无参/`on` → 'on'；`off` → 'off'；其他 → undefined。
- 自然语言（要求出现在消息开头，允许礼貌前缀，避免「什么是orchestrate模式」误触发）：
  - `^(请|麻烦|麻烦你|帮我|请帮我|我想|我要)?\s*使用\s*orchestrate\s*(模式|mode)`
  - `^use\s+orchestrate\s+mode`

## Tech Stack

- TypeScript（`src/orchestrate.ts`），vitest 测试，`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、
  `@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-system-prompt` 契约。
- 部署：`npm run build`（tsc + build-client）→ 复制 `lib/` 到
  `/home/admin/.dsh/profiles/web/node_modules/dsh-plugin-subagent-director/` → 重启 harness（唯一一次重启）。

## Baseline / Authority Refs

- 源码基线：`pr3-research/repo` @ 0.4.0-beta.1（git clean，commit 585fd09）。
- 现有测试基线：`test/orchestrate.test.ts`（渲染器单测）、`test/orchestrate-wiring.test.ts`（接线集成）、
  `test/orchestrate-cordis.test.ts`（真实 cordis 探针）。
- 运行时证据：动态 Cordis 探针 `oprb-1`（命令已注册、投影 mode=on、段已注入、无角色）。
- 宿主契约：`dsh-commands`（`command/run` 事件携带 `{name, args}`）、`dsh-session`（`user/message`
  事件 data 为 `UserMessage`，text 块在 `content[].text`）、`dsh-system-prompt`（`PromptSection.text`
  接收 `AssembleContext`，运行时含 `agent.session`）。

## Compatibility Boundary

- `orchestrate/change` 事件类型注册**必须保留**（旧会话日志加载兼容，README FAQ issue #6）。
- 投影注册**保留**（向后兼容兜底 + 客户端 wire 视图），但不再是唯一判定源。
- `/orchestrate on|off` 命令**保留**（on=持久、off=退出），仅无参数语义从「粘性 on」改为「按轮 on」。
- `renderOrchestratorPrompt` / `renderOrchestratorRoles` / `buildOrchestratorFrame` 公共 API 不变。
- 新增导出：`detectOrchestrateRequest`、`renderOrchestratorUnavailableNotice`。

## TDD Route

```text
TDD Route:
- Mode: auto
- Decision: strict
- Strict authority: explicit user request（「按照标准测试驱动开发模式推进」）
- Test posture: strict RED test（先写失败测试，再实现）
- Reason: 行为契约变更（命令语义、段判定、无角色处理）+ 跨模块（handler/段/投影/测试）
- Verification: vitest 全量回归 + 真实 cordis 探针测试 + 部署后动态探针验证
```

## Verification

- `npm test`（vitest run）全量通过，输出无警告。
- `npm run typecheck` 通过。
- 部署后动态 Cordis 探针（`oprb-1` 更新版）验证：当前会话投影仍 on（粘性兜底）时，
  段解析为「不可用提示」而非完整框架；无声明消息 → 段为空。
- 手动验收路径（用户侧）：
  1. 消息开头写「使用orchestrate模式帮我分析X」→ 该轮为纯编排模式；
  2. 先发 `/orchestrate` 再发任务 → 仅下一轮为纯编排模式；
  3. 无声明消息 → 普通模式；
  4. `/orchestrate on` → 持久；`/orchestrate off` → 退出；
  5. 未配置角色时声明 → 模型明确告知需先配置角色并继续处理请求（不再无输出）。

## Files

| 文件 | 动作 |
| --- | --- |
| `src/orchestrate.ts` | 修改：新增检测纯函数/日志扫描助手/不可用提示；改段判定与命令 handler |
| `test/orchestrate.test.ts` | 修改：新增 `detectOrchestrateRequest` 单测 |
| `test/orchestrate-wiring.test.ts` | 修改：fake 事件加 seq；新增按轮检测/无角色/命令语义测试；更新旧无参数测试 |
| `test/orchestrate-cordis.test.ts` | 修改：新增 systemPrompt stub 捕获段；新增按轮探针测试 |
| `README.md` | 修改：更新纯编排模式章节 |
| `CHANGELOG.md` | 修改：新增 0.4.0-beta.2 条目 |

## Tasks

### Task 1 — RED：`detectOrchestrateRequest` 单测

**Files**: `test/orchestrate.test.ts`（修改）

在 `test/orchestrate.test.ts` 追加：

```ts
import { detectOrchestrateRequest } from '../src/orchestrate.js';

describe('detectOrchestrateRequest', () => {
  it('returns on for a bare /orchestrate at the start', () => {
    expect(detectOrchestrateRequest('/orchestrate')).toBe('on');
    expect(detectOrchestrateRequest('  /orchestrate')).toBe('on');
  });
  it('returns on for /orchestrate on (case-insensitive)', () => {
    expect(detectOrchestrateRequest('/orchestrate on')).toBe('on');
    expect(detectOrchestrateRequest('/orchestrate ON')).toBe('on');
  });
  it('returns off for /orchestrate off', () => {
    expect(detectOrchestrateRequest('/orchestrate off')).toBe('off');
  });
  it('returns undefined for invalid slash args', () => {
    expect(detectOrchestrateRequest('/orchestrate maybe')).toBeUndefined();
  });
  it('returns on for 使用orchestrate模式 at the start', () => {
    expect(detectOrchestrateRequest('使用orchestrate模式帮我分析这个项目')).toBe('on');
    expect(detectOrchestrateRequest('请使用 orchestrate 模式分析')).toBe('on');
    expect(detectOrchestrateRequest('我想使用orchestrate模式')).toBe('on');
  });
  it('returns on for use orchestrate mode', () => {
    expect(detectOrchestrateRequest('use orchestrate mode to analyze this')).toBe('on');
  });
  it('returns undefined for questions about orchestrate mode', () => {
    expect(detectOrchestrateRequest('什么是orchestrate模式')).toBeUndefined();
    expect(detectOrchestrateRequest('帮我解释一下使用orchestrate模式的好处')).toBeUndefined();
  });
  it('returns undefined for unrelated text', () => {
    expect(detectOrchestrateRequest('帮我分析这个项目')).toBeUndefined();
  });
});
```

**Verify RED**: `npx vitest run test/orchestrate.test.ts` → `detectOrchestrateRequest` 不存在，测试失败（import 错误）。

### Task 2 — GREEN：实现 `detectOrchestrateRequest` 与不可用提示

**Files**: `src/orchestrate.ts`（修改）

在 `ORCHESTRATE_VALID_MODES` 之后新增：

```ts
/** Per-turn orchestrate request parsed from one user message. */
export type OrchestrateRequest = 'on' | 'off' | undefined;

/**
 * Detect whether a user message requests pure-orchestrator mode for this turn.
 * Slash form: `/orchestrate` (no args or `on` → on; `off` → off; other → undefined).
 * Natural-language form (case-insensitive, anchored at the start with an
 * optional politeness prefix so questions like 什么是orchestrate模式 do not
 * false-positive): 使用orchestrate模式 / 使用 orchestrate mode / use orchestrate mode.
 */
export function detectOrchestrateRequest(text: string): OrchestrateRequest {
  const trimmed = text.trimStart();
  const slash = trimmed.match(/^\/orchestrate(?:\s+(\S+))?/i);
  if (slash) {
    const arg = (slash[1] ?? '').trim().toLowerCase();
    if (arg === '' || arg === 'on') return 'on';
    if (arg === 'off') return 'off';
    return undefined;
  }
  if (/^(请|麻烦|麻烦你|帮我|请帮我|我想|我要)?\s*使用\s*orchestrate\s*(模式|mode)/i.test(trimmed)) return 'on';
  if (/^use\s+orchestrate\s+mode/i.test(trimmed)) return 'on';
  return undefined;
}

/**
 * Short notice injected instead of the pure-orchestrator frame when the mode
 * is on but no roles are configured: the model must inform the user and
 * continue in normal mode — never sit paralyzed (the "returns nothing" bug).
 */
export function renderOrchestratorUnavailableNotice(toolName: string): string {
  return (
    `Orchestrator mode is active, but no subagent-director roles are configured (subagent-director.roles is empty), so you cannot delegate work via \`${toolName}\`. ` +
    `Inform the user that orchestrator mode requires roles to be configured first, then handle their request in normal mode.`
  );
}
```

**Verify GREEN**: `npx vitest run test/orchestrate.test.ts` → 全部通过。

### Task 3 — RED：接线测试（按轮检测 + 无角色 + 命令语义）

**Files**: `test/orchestrate-wiring.test.ts`（修改）

1. fake `appendEvent` 增加 seq（与真实 Session 一致）：

```ts
appendEvent(sessionArg: any, type: string, data: any) {
  sessionArg.events = sessionArg.events || [];
  sessionArg.events.push({ type, data, seq: sessionArg.events.length });
},
```

2. 更新旧测试「defaults to on with no args and appends the event」为按轮语义：

```ts
it('no-args /orchestrate is per-turn: success, no sticky event appended', () => {
  const { ctx, registeredCommands } = makeFakeCtx();
  applyOrchestrate(ctx, getSettings, toolName);
  const handler = registeredCommands[0].handler;
  const appended: any[] = [];
  const res = handler({
    rawInput: '',
    agent: { session: { append: (t: string, d: any) => appended.push([t, d]) } },
  });
  expect(res.kind).toBe('success');
  expect(res.text).toContain('on for this turn');
  expect(appended).toEqual([]);
});
```

3. 新增 describe 块：

```ts
describe('applyOrchestrate — per-turn detection', () => {
  it('injects when the current user message says 使用orchestrate模式', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '使用orchestrate模式帮我分析' }] });
    expect(fake.registeredSections[0].text({ agent: { session } })).toContain('PURE ORCHESTRATOR');
  });

  it('does not inject when the current user message is unrelated and projection is off', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '帮我分析这个项目' }] });
    expect(fake.registeredSections[0].text({ agent: { session } })).toBe('');
  });

  it('injects when /orchestrate command/run happened between the previous and current user message', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '旧消息' }] });
    fake.sessionProjections.appendEvent(session, 'command/run', { name: 'orchestrate', args: '' });
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '帮我分析' }] });
    expect(fake.registeredSections[0].text({ agent: { session } })).toContain('PURE ORCHESTRATOR');
  });

  it('does not inject when the orchestrate command/run predates the previous user message', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'command/run', { name: 'orchestrate', args: '' });
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '旧消息' }] });
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '新消息' }] });
    expect(fake.registeredSections[0].text({ agent: { session } })).toBe('');
  });

  it('injects the unavailable notice instead of the pure-orchestrator frame when no roles are configured', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, () => ({}), toolName);
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '使用orchestrate模式帮我分析' }] });
    const text = fake.registeredSections[0].text({ agent: { session } });
    expect(text).not.toContain('PURE ORCHESTRATOR');
    expect(text).toContain('no subagent-director roles are configured');
  });

  it('still injects via the sticky projection when nothing is declared this turn (backward compat)', () => {
    const fake = makeFakeCtx();
    applyOrchestrate(fake.ctx, getSettings, toolName);
    fake.state.mode = 'on';
    const session = { id: 's1', events: [] };
    fake.sessionProjections.appendEvent(session, 'user/message', { content: [{ type: 'text', text: '帮我分析' }] });
    expect(fake.registeredSections[0].text({ agent: { session } })).toContain('PURE ORCHESTRATOR');
  });
});
```

4. 新增命令语义测试：

```ts
it('/orchestrate on appends the sticky event and reports persistent mode', () => {
  const { ctx, registeredCommands } = makeFakeCtx();
  applyOrchestrate(ctx, getSettings, toolName);
  const handler = registeredCommands[0].handler;
  const appended: any[] = [];
  const res = handler({ rawInput: 'on', agent: { session: { append: (t: string, d: any) => appended.push([t, d]) } } });
  expect(res.kind).toBe('success');
  expect(res.text).toContain('persistent');
  expect(appended).toEqual([[ORCHESTRATE_EVENT_TYPE, { mode: 'on' }]]);
});
```

**Verify RED**: `npx vitest run test/orchestrate-wiring.test.ts` → 新测试失败（旧实现：无参数 append on 事件、段不读日志、无角色时注入完整框架）。

### Task 4 — GREEN：实现段判定与命令语义

**Files**: `src/orchestrate.ts`（修改）

1. 新增日志扫描助手（模块内私有）：

```ts
/** Latest user/message text from a session log, or undefined when absent. */
function latestUserMessageText(session: any): string | undefined {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || ev.type !== 'user/message') continue;
    const blocks = ev.data?.content;
    if (!Array.isArray(blocks)) return '';
    let text = '';
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') text += b.text;
    }
    return text;
  }
  return undefined;
}

/**
 * Per-turn slash path: an `orchestrate` command/run that happened AFTER the
 * previous user message and BEFORE the current one marks THIS turn. Returns
 * 'on' | 'off' | undefined.
 */
function recentOrchestrateCommandRun(session: any): OrchestrateRequest {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  let lastUserSeq = -1;
  let cmdSeq = -1;
  let cmdArgs: string | undefined;
  for (const ev of events) {
    if (!ev) continue;
    if (ev.type === 'user/message' && typeof ev.seq === 'number') lastUserSeq = ev.seq;
    if (ev.type === 'command/run' && ev.data?.name === 'orchestrate' && typeof ev.seq === 'number') {
      cmdSeq = ev.seq;
      cmdArgs = ev.data.args;
    }
  }
  if (cmdSeq < 0 || cmdSeq <= lastUserSeq) return undefined;
  const arg = (cmdArgs ?? '').trim().toLowerCase();
  if (arg === '' || arg === 'on') return 'on';
  if (arg === 'off') return 'off';
  return undefined;
}

/** Full prompt when roles exist, else the short unavailable notice. */
function renderOrchestratorSection(settings: SubagentDirectorSettings, toolName: string): string {
  const roles = settings.roles ?? {};
  const hasRoles = Object.values(roles).some((role) => role !== undefined);
  if (!hasRoles) return renderOrchestratorUnavailableNotice(toolName);
  return renderOrchestratorPrompt(settings, toolName);
}
```

2. 段 text provider：在投影快照逻辑**之前**插入按轮检测（sessionCandidates 循环内）：

```ts
// Per-turn detection: the current user message or a just-run /orchestrate
// command decides THIS turn; the sticky projection below is only the
// backward-compat fallback.
for (const candidate of sessionCandidates) {
  const msgText = latestUserMessageText(candidate);
  if (msgText !== undefined) {
    const req = detectOrchestrateRequest(msgText);
    if (req === 'on') return renderOrchestratorSection(getSettings(), toolName);
    if (req === 'off') return '';
  }
  const cmdReq = recentOrchestrateCommandRun(candidate);
  if (cmdReq === 'on') return renderOrchestratorSection(getSettings(), toolName);
  if (cmdReq === 'off') return '';
}
```

3. 投影兜底末尾：`return renderOrchestratorPrompt(getSettings(), toolName);` 改为
   `return renderOrchestratorSection(getSettings(), toolName);`。

4. 命令 handler 改为：

```ts
handler: (invocation: any) => {
  const raw = (invocation.rawInput || '').trim().toLowerCase();
  const mode = raw || 'on';
  if (!ORCHESTRATE_VALID_MODES.includes(mode as OrchestrateMode)) {
    return {
      kind: 'error',
      text:
        `Invalid: "${invocation.rawInput}". Valid: on|off. To orchestrate one turn, type /orchestrate first and then send your task, or start your message with 使用orchestrate模式.`,
    };
  }
  if (projections === undefined) {
    missing();
    return {
      kind: 'error',
      text:
        `Orchestrator mode "${mode}" was NOT applied: the sessionProjections service is missing on this host, so /orchestrate has no effect and the orchestrator prompt will not inject. ` +
        `Provide the dsh-session-projection sessionProjections service to enable orchestrator mode.`,
    };
  }
  const session = invocation?.agent?.session;
  if (session === undefined || typeof session.append !== 'function') {
    return {
      kind: 'error',
      text:
        `Orchestrator mode "${mode}" was NOT applied: this command invocation carries no agent session to append the mode change to.`,
    };
  }
  if (mode === 'on' && raw === '') {
    // Per-turn: no sticky event. The section detects this command/run and
    // orchestrates the NEXT user-message turn only.
    return {
      kind: 'success',
      text:
        'Orchestrator mode: on for this turn. Declare /orchestrate at the start of your message (or say 使用orchestrate模式) to enable it per turn; use /orchestrate on to keep it on until /orchestrate off.',
    };
  }
  session.append(ORCHESTRATE_EVENT_TYPE, { mode });
  return {
    kind: 'success',
    text: mode === 'off' ? 'Orchestrator mode: off' : 'Orchestrator mode: on (persistent until /orchestrate off)',
  };
},
```

5. 命令 description 更新：

```ts
description:
  'Enter pure-orchestrator mode for this turn — declare /orchestrate at the start of your message, or say 使用orchestrate模式. No args = this turn; on = persistent until off.',
input: { hint: 'on|off (no args = this turn)' },
```

6. `src/index.ts` 导出新增：`detectOrchestrateRequest`、`renderOrchestratorUnavailableNotice`。

**Verify GREEN**: `npx vitest run test/orchestrate-wiring.test.ts test/orchestrate.test.ts` → 全部通过。

### Task 5 — RED/GREEN：真实 cordis 探针测试

**Files**: `test/orchestrate-cordis.test.ts`（修改）

1. `loadEntry` 增加 systemPrompt stub 捕获段：

```ts
function loadEntry(ctx: Context, toolsRegister: (def: unknown) => () => void, sections: any[] = []): void {
  provideCoreStubs(ctx, toolsRegister);
  ctx.provide('systemPrompt', {
    section: (def: any) => {
      sections.push(def);
      return () => {};
    },
  });
  void ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
}
```

2. 新增探针测试（RED）：

```ts
it('no-args /orchestrate is per-turn: no sticky event; section injects via command/run', async () => {
  const ctx = new Context();
  const registry = new SessionProjectionRegistry(ctx);
  const commands: Array<{ name: string; handler: (invocation: any) => any }> = [];
  const sections: any[] = [];
  loadEntry(ctx, () => () => {}, sections);
  await settle();
  ctx.provide('commands', {
    register: (def: { name: string; handler: (invocation: any) => any }) => {
      commands.push(def);
      return () => {};
    },
  });
  await settle();
  await settle();
  const orchestrate = commands.find((c) => c.name === 'orchestrate');
  expect(orchestrate).toBeDefined();
  expect(sections.length).toBeGreaterThan(0);
  const section = sections.find((s) => s.name === 'orchestrate-mode');
  expect(section).toBeDefined();

  const session: any = {
    seq: 0,
    events: [] as Array<{ type: string; data: any; seq: number; time: number }>,
    append(type: string, data: any) {
      const event = { type, data, seq: this.events.length, time: Date.now() };
      this.events.push(event);
      this.seq = this.events.length;
      ctx.emit('session/event', this, event);
    },
  };
  // /orchestrate (no args): per-turn, no sticky event.
  expect(orchestrate!.handler({ rawInput: '', agent: { session } }).kind).toBe('success');
  expect(registry.snapshot(session).values[ORCHESTRATE_PROJECTION_KEY]).toEqual({ mode: 'off' });
  // The next user message is orchestrated via the command/run scan.
  session.append('user/message', { content: [{ type: 'text', text: '帮我分析' }] });
  const text = section.text({ agent: { session } });
  expect(text).toContain('PURE ORCHESTRATOR');
  // A later unrelated message is NOT orchestrated (per-turn).
  session.append('user/message', { content: [{ type: 'text', text: '再来一个' }] });
  expect(section.text({ agent: { session } })).toBe('');
});
```

**Verify RED**: `npx vitest run test/orchestrate-cordis.test.ts` → 新测试失败（旧实现无参数 append on 事件、段不读日志）。

**Verify GREEN**: 实现已在 Task 4 完成 → 重跑通过。

### Task 6 — 全量回归 + typecheck

```bash
cd /home/admin/ProjectCollection/ProblemFix/pr3-research/repo
npm test
npm run typecheck
```

**Verify**: 全部通过、输出无警告。

### Task 7 — 文档

**Files**: `README.md`、`CHANGELOG.md`（修改）

README 纯编排模式章节改为：

```text
### 纯编排模式（`/orchestrate`）

```text
/orchestrate        # 本轮开启（按轮生效，无需 on/off）
/orchestrate on     # 持久开启（直到 /orchestrate off）
/orchestrate off    # 退出持久模式
```

在消息开头声明 `/orchestrate`，或用自然语言写「使用orchestrate模式」（含
「请使用 orchestrate 模式」「use orchestrate mode」等变体），该轮会话即自动
进入纯编排模式——类似 `/using aegis` 的按轮声明式用法，无需记忆开关状态。
未声明时保持普通模式。开启后注入一段「纯编排者」系统提示：主代理只允许通过
委派工具派活，角色清单从当前 `subagent-director.roles` 动态渲染（无硬编码
role id）。**未配置角色时**不会注入束缚性的纯编排框架，而是注入一段简短提示，
让模型明确告知需要先配置角色并继续以普通模式处理请求（避免「对话无输出」）。
该模式依赖宿主的 `commands` 与 `sessionProjections` 服务：标准 profile
（dsh-base）都会提供二者；`sessionProjections` 缺失时命令返回明确错误而不是假装
成功，`commands` 缺失时命令不注册，插件其余功能不受影响。
```

CHANGELOG 新增 `## [0.4.0-beta.2] - 2026-08-31` 条目（新增/修复/兼容性）。

### Task 8 — 构建与部署（唯一一次重启）

```bash
cd /home/admin/ProjectCollection/ProblemFix/pr3-research/repo
npm run build
cp -r lib /home/admin/.dsh/profiles/web/node_modules/dsh-plugin-subagent-director/
cp package.json CHANGELOG.md README.md /home/admin/.dsh/profiles/web/node_modules/dsh-plugin-subagent-director/
```

重启 harness 后，用更新后的动态探针验证运行时行为（当前会话粘性 on → 段解析为
不可用提示；无声明 → 段为空）。

## Risks

| 风险 | 缓解 |
| --- | --- |
| 自然语言误触发（如「解释一下使用orchestrate模式的好处」） | 模式锚定消息开头 + 礼貌前缀白名单；测试钉住反例 |
| 旧粘性会话行为变化 | 投影兜底保留；无角色时注入不可用提示（模型会明确告知状态） |
| `command/run` 扫描依赖事件 seq | 真实 Session 事件均带 seq；fake 同步补 seq；无 seq 时安全降级为 undefined |
| 部署后需重启 | 测试 + 探针先行验证，仅一次重启 |

## Retirement

- 旧「无参数 = 粘性 on」语义：**有意移除**（用户要求按轮），`/orchestrate on` 保留持久路径；
  无参数不再 append 粘性事件。
- 旧「无角色时注入完整框架 + 配置提示」：**替换**为不可用提示；`renderOrchestratorPrompt`
  的空角色分支保留（公共 API，防御性），但段不再走该分支。
- `orchestrate/change` 事件类型注册：**保留**（会话日志加载兼容，issue #6）。

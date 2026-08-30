/**
 * Orchestrate command for Subagent Director (merged from the standalone
 * `orchestrate` plugin).
 *
 * Adds a `/orchestrate on|off` slash command that flips a per-session
 * projection and, when on, injects a pure-orchestrator system-prompt section.
 * The orchestrator delegates exclusively through the subagent-director
 * delegation tool, whose model-facing name is `config.toolName` (default
 * `subagent_role`) and is threaded in here as `toolName`.
 *
 * Naming caveat (observed on a live 0.1.1-rc.x web host): the assembled tool catalog
 * contains BOTH this plugin's `subagent_role` and the base bundle's built-in
 * `subagent` / `subagent_fork`. They are distinct tools, not two names for one
 * wire entry. The prompt below names `toolName` explicitly precisely because a
 * model that reaches for the built-in `subagent` bypasses role persona and role
 * toolFilter.
 *
 * The role list rendered into the prompt is derived dynamically from the live
 * plugin settings (`subagent-director.roles`) — the same source `guidance.ts`
 * reads — so it never hard-codes role ids and stays correct when the operator
 * reconfigures roles. When no roles are configured the prompt tells the user
 * to configure them rather than silently emitting an empty section.
 *
 * Service posture mirrors `guidance.ts`: `commands` and `sessionProjections` are
 * acquired reactively through `ctx.inject` (so the `/orchestrate` command and the
 * projection register as soon as the host service is ready, even if it mounts
 * slightly after `apply`), while `systemPrompt` is still read lazily via
 * `ctx.get`. A host that never provides `sessionProjections` degrades to an
 * honest error from the command handler rather than a silent no-op.
 */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { KNOWN_SESSION_EVENT_TYPES, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';

import type { SubagentDirectorSettings } from './settings.js';

/** Stable system-prompt section name. */
export const ORCHESTRATE_SECTION_NAME = 'orchestrate-mode';

/** Prompt order: sits low (55) so the orchestrator contract is near the top. */
export const ORCHESTRATE_SECTION_ORDER = 55;

/** Per-session projection key holding the orchestrator on/off state. */
export const ORCHESTRATE_PROJECTION_KEY = 'orchestrate';

/** Session event type emitted when the mode changes. */
export const ORCHESTRATE_EVENT_TYPE = 'orchestrate/change';

/** Accepted mode values. */
export const ORCHESTRATE_VALID_MODES = ['on', 'off'] as const;
export type OrchestrateMode = (typeof ORCHESTRATE_VALID_MODES)[number];

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

interface OrchestrateState {
  mode: OrchestrateMode;
}

// Merge the orchestrate unit into the real projection registry maps
// (@deepseek-ai/dsh-session-projection, 0.1.1 line). This restores
// compile-time contract protection: register() below is typed against the
// REAL ProjectionDefinition (stateSchema + wire), so a field-shape drift —
// like the old `schema`+`view` shape vs the 0.1.1 `stateSchema`+`wire`
// contract — fails typecheck instead of silently skipping snapshot().
// Merge the custom event into the session event vocabulary (the plan-mode
// precedent): 'orchestrate/change' becomes a typed member of SessionEventMap,
// so the projection's `apply` below narrows event.data to { mode } at compile
// time instead of reaching through `any`.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'orchestrate/change': { mode: OrchestrateMode };
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** /orchestrate mode state, folded from `orchestrate/change` events. */
    orchestrate: OrchestrateState;
  }
  interface SessionProjectionMap {
    /** Client-visible wire payload of the orchestrate projection unit. */
    orchestrate: { mode: OrchestrateMode };
  }
}

/**
 * Build the data-independent framing of the orchestrator prompt for a given
 * delegation tool name. The role list is appended separately by
 * {@link renderOrchestratorRoles}.
 * @param toolName - the configured model-facing delegation tool name.
 */
export function buildOrchestratorFrame(toolName: string): string {
  return `You are a PURE ORCHESTRATOR. Your only action is to call the \`${toolName}\` tool (provided by the subagent-director plugin) to delegate work. You must NEVER read, write, edit, grep, find, or execute anything yourself.

The subagent-director plugin supplies its role templates from settings (subagent-director.roles) and the guidance section 'subagent-director:roles'. Delegate exactly one task per call:

    ${toolName}({ role: '<role-id>', prompt: '<self-contained task>', description: '<what this delegation produces>' })`;
}

/**
 * Render the role list portion of the orchestrator prompt from the live
 * settings. Returns a "configure roles first" notice when no roles exist so
 * the operator is told what to do instead of receiving a blank contract.
 * @param settings - current resolved settings snapshot.
 * @param toolName - the configured model-facing delegation tool name.
 */
export function renderOrchestratorRoles(settings: SubagentDirectorSettings, toolName: string): string {
  const roles = settings.roles ?? {};
  const entries = Object.entries(roles).filter(([, role]) => role !== undefined);
  if (entries.length === 0) {
    return 'No Subagent Director roles are configured yet. Configure `subagent-director.roles` (settings.yaml or the settings panel) before entering orchestrator mode — the orchestrator can only delegate to defined roles.';
  }

  const lines = [
    `Delegate work by calling the \`${toolName}\` tool with a role id from the list below. Reference roles by their id (shown), never by display name, and never invent a role id that is not listed:`,
  ];
  for (const [id, role] of entries) {
    lines.push(`- ${role.displayName || id}: ${role.description}`);
    lines.push(`    ${toolName}({ role: "${id}", prompt: "..." })`);
  }
  return lines.join('\n');
}

/**
 * Assemble the full orchestrator prompt (framing + dynamic role list).
 * @param settings - current resolved settings snapshot.
 * @param toolName - the configured model-facing delegation tool name.
 */
export function renderOrchestratorPrompt(settings: SubagentDirectorSettings, toolName: string): string {
  return `${buildOrchestratorFrame(toolName)}\n\n${renderOrchestratorRoles(settings, toolName)}\n\nOrchestration rules:
1. Only dispatch. Forbid doing the work yourself.
2. Independent tasks -> dispatch them in parallel (multiple ${toolName} calls in one turn).
3. Dependent / relay tasks -> wait for the prior subagent to finish, then dispatch the next stage.
4. Every subagent prompt must be self-contained: goal, constraints, output format, acceptance criteria. Subagents receive NO parent context.
5. If the user's request names a specific role, dispatch to that role id. If a display name is given, map it to its id. If no role is named, dispatch to the role whose display name indicates coordination (e.g. contains 协调 / Orchestrator / Coordinator); when no such role exists, dispatch to the first configured role and let it decompose and coordinate.
6. Unclear dependencies or missing information -> ask the USER, never guess.
7. For independent fan-out you may set run_in_background: true and collect results later; for relay steps set run_in_background: false so you wait for the result before dispatching the next stage.
8. Finish only when every subagent has completed. Then output a summary report: who produced what, and remaining todos.`;
}

/**
 * Full orchestrator prompt when roles are configured, else the short
 * unavailable notice. The notice (not the paralyzing pure-orchestrator frame)
 * is what prevents the "conversation returns nothing" failure: a model that
 * cannot delegate must be told to inform the user and continue normally.
 * @param settings - current resolved settings snapshot.
 * @param toolName - the configured model-facing delegation tool name.
 */
function renderOrchestratorSection(settings: SubagentDirectorSettings, toolName: string): string {
  const roles = settings.roles ?? {};
  const hasRoles = Object.values(roles).some((role) => role !== undefined);
  if (!hasRoles) return renderOrchestratorUnavailableNotice(toolName);
  return renderOrchestratorPrompt(settings, toolName);
}

/**
 * Latest user/message text from a session log, or undefined when the log has
 * no user message (e.g. assembly before the first message). Text blocks are
 * concatenated in order; non-text blocks are skipped.
 * @param session - a live Session (or a faithful fake with `.events`).
 */
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
 * previous user message and BEFORE the current one marks THIS turn (the
 * command itself is consumed by the commands service and never appears in a
 * user/message event). Returns 'on' | 'off' | undefined.
 * @param session - a live Session (or a faithful fake with `.events`).
 */
function recentOrchestrateCommandRun(session: any): OrchestrateRequest {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  let prevUserSeq = -1;
  let currentUserSeq = -1;
  let cmdSeq = -1;
  let cmdArgs: string | undefined;
  for (const ev of events) {
    if (!ev) continue;
    if (ev.type === 'user/message' && typeof ev.seq === 'number') {
      prevUserSeq = currentUserSeq;
      currentUserSeq = ev.seq;
    }
    if (ev.type === 'command/run' && ev.data?.name === 'orchestrate' && typeof ev.seq === 'number') {
      cmdSeq = ev.seq;
      cmdArgs = ev.data.args;
    }
  }
  // The command must sit strictly between the previous user message and the
  // current one: the user ran /orchestrate, then sent this turn's message.
  if (cmdSeq < 0 || cmdSeq <= prevUserSeq || cmdSeq >= currentUserSeq) return undefined;
  const arg = (cmdArgs ?? '').trim().toLowerCase();
  if (arg === '' || arg === 'on') return 'on';
  if (arg === 'off') return 'off';
  return undefined;
}

/**
 * Wire the `/orchestrate` command, its session projection, and the
 * orchestrator prompt section into the host. Each host-plane service is
 * acquired lazily and guarded, so a missing service degrades to a no-op.
 * @param ctx - plugin context.
 * @param getSettings - returns the current settings snapshot.
 * @param toolName - the configured model-facing delegation tool name.
 */
export function applyOrchestrate(
  ctx: Context,
  getSettings: () => SubagentDirectorSettings,
  toolName: string,
): void {
  // Register our event type on the shared KNOWN set so session logs carrying
  // `orchestrate/change` load in any boot that mounts this plugin.
  // The shared set is a mutable Set at runtime; its exported type is
  // ReadonlySet, so we widen to Set<string> for the add call.
  try {
    (KNOWN_SESSION_EVENT_TYPES as Set<string>).add(ORCHESTRATE_EVENT_TYPE);
  } catch (err) {
    ctx.logger.warn('[orchestrate] could not register event type:', (err as Error)?.message);
  }

  // Resolve sessionProjections *reactively*. At plugin apply time the host
  // may not have mounted the sessionProjections service yet — that is the P0
  // timing root cause: a one-shot `ctx.get` here returned undefined and
  // silently no-op'd the projection registration, so /orchestrate never
  // injected. Instead we register the projection the moment the service becomes
  // available via ctx.inject, and keep `projections` in a closure so the
  // command handler and prompt section observe it once it resolves. If the
  // service is genuinely absent the handler (and the apply-time fallback)
  // surface an honest error instead of a silent no-op.
  let projections: SessionProjectionRegistry | undefined = undefined;

  const missing = (): void =>
    ctx.logger.warn(
      '[orchestrate] sessionProjections service is missing on this host — the /orchestrate command will NOT take effect (no projection registered, orchestrator prompt will not inject). Provide the dsh-session-projection sessionProjections service to enable orchestrator mode.',
    );

  const registerProjection = (sp: SessionProjectionRegistry): void => {
    if (projections !== undefined) return; // idempotent: inject may re-fire
    projections = sp;
    sp.register<'orchestrate', OrchestrateState>({
      key: ORCHESTRATE_PROJECTION_KEY,
      stateVersion: 1,
      // Real @deepseek-ai/dsh-session-projection contract (SessionProjectionRegistry):
      // `stateSchema` validates host state (persisted-cache restore path); a
      // client-visible unit MUST declare `wire: { viewSchema, view }` or
      // `snapshot()` SKIPS it entirely (`if (def.wire === undefined) continue`),
      // so `snapshot().values['orchestrate']` is never populated and the prompt
      // section always reads undefined → no injection. The prior `schema` + bare
      // `view` made this a host-only unit — the actual root cause of the
      // on==off byte-identical system prompts. Fix: declare both correctly.
      stateSchema: z.object({ mode: z.enum(ORCHESTRATE_VALID_MODES) }),
      init: (): OrchestrateState => ({ mode: 'off' }),
      apply: (state: OrchestrateState, event: SessionEvent): OrchestrateState => {
        if (!event || event.type !== ORCHESTRATE_EVENT_TYPE) return state;
        const mode = event.data.mode;
        if (!ORCHESTRATE_VALID_MODES.includes(mode) || state.mode === mode) return state;
        return { mode };
      },
      wire: {
        viewSchema: z.object({ mode: z.enum(ORCHESTRATE_VALID_MODES) }),
        view: (state: OrchestrateState) => ({ mode: state.mode }),
      },
    });
    ctx.logger.info('[orchestrate] host active (command + projection + prompt section)');
  };

  const spNow = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined;
  if (spNow !== undefined) {
    registerProjection(spNow);
  } else {
    // Reactive path: register once the host mounts sessionProjections. The
    // child fiber's callback only runs when the dependency is present, so
    // this also covers the "ready slightly later" case that the one-shot get
    // missed. If the service never appears, the handler below returns an
    // honest error — no silent no-op.
    //
    // The child fiber is owned by this plugin's fiber lifecycle (its
    // registration effect lives on the parent fiber), so it unloads
    // automatically with the plugin. Do NOT wrap it in ctx.effect: cordis
    // effects run their callback immediately and treat the return value as
    // the disposer, so `ctx.effect(() => fiber.dispose())` would unload the
    // child at birth — pinned by the real-cordis probe in
    // test/orchestrate-cordis.test.ts.
    ctx.inject(['sessionProjections'], (injectedCtx: Context) => {
      registerProjection(injectedCtx.get('sessionProjections')!);
    });
  }

  // Register the `/orchestrate` slash command *reactively* through a
  // `ctx.inject` child fiber (the dsh-plan-mode precedent). `commands` is NOT a
  // required entry-inject: standard profiles mount it via dsh-base (so the
  // child fiber activates immediately there), but non-dsh-base assemblies (ACP
  // hosts, UI-less demo spines, custom harnesses) may never provide it, and a
  // required inject would leave the whole main entry PENDING on those hosts —
  // the core delegation features would never load. The child-fiber shape also
  // recovers from a host that mounts `commands` slightly after `apply`. The
  // handler reads `projections` from the closure, so command availability and
  // projection availability are decoupled: the handler still refuses honestly
  // (with a warning) if the projection service never came up.
  // The child fiber is owned by this plugin's fiber lifecycle and unloads
  // with the plugin — never wrap it in ctx.effect (cordis effects run their
  // callback immediately and treat the return value as the disposer, so
  // `ctx.effect(() => fiber.dispose())` would unload the child at birth;
  // pinned by the real-cordis probe in test/orchestrate-cordis.test.ts).
  ctx.inject(['commands'], (injectedCtx: Context) => {
    const commands: any = injectedCtx.get('commands');
    commands.register({
      name: 'orchestrate',
      description:
        'Enter pure-orchestrator mode for this turn — declare /orchestrate at the start of your message, or say 使用orchestrate模式. No args = this turn; on = persistent until off.',
      input: { hint: 'on|off (no args = this turn)' },
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
        // Without sessionProjections the projection is never registered, so
        // /orchestrate cannot take effect. Refuse with an honest message
        // instead of falsely reporting success (P0 silent-degradation fix).
        if (projections === undefined) {
          // Service never became available (truly absent host): refuse with an
          // honest message and warn, instead of falsely reporting success (P0
          // silent-degradation fix).
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
          // Per-turn: no sticky event. The section detects this command/run
          // and orchestrates the NEXT user-message turn only.
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
    });
  });

  const systemPrompt: any = ctx.get('systemPrompt');
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: ORCHESTRATE_SECTION_NAME,
      order: ORCHESTRATE_SECTION_ORDER,
      text: (context: any) => {
        // Root-cause note (P0 render-time silent no-op, sibling of C1):
        // @deepseek-ai/dsh-session-projection's read face keys its per-session
        // watermark cache by the SESSION OBJECT via a WeakMap and folds
        // `session.events` (see cellFor/buildCell in the package's lib/index.js).
        // A snapshot therefore reads the mode ONLY from the live Session object
        // whose `.events` log carries the `orchestrate/change` event that the
        // /orchestrate command appended. If the assembly context hands a
        // DIFFERENT session reference (e.g. a request wrapper instead of the
        // agent's own session), the cell is rebuilt from an empty log and
        // silently returns 'off', dropping the section. We must hand the
        // canonical session object — and try every session reference the
        // context exposes so a stray wrapper reference cannot downgrade us.
        const sessionCandidates: any[] = [];
        if (context?.agent?.session) sessionCandidates.push(context.agent.session);
        if (context?.session && context.session !== context?.agent?.session) {
          sessionCandidates.push(context.session);
        }

        if (sessionCandidates.length === 0) {
          // No resolvable session — cannot read the projection. Warn instead of
          // silently dropping (P0 honest-degradation; do not return '' silently).
          ctx.logger.warn(
            '[orchestrate] system-prompt section invoked without a resolvable session (both context.agent.session and context.session are absent) — orchestrator-mode section skipped. Possible cause: the assembly context shape differs from the dsh-agent AssembleContext contract.',
          );
          return '';
        }
        // P0 missing-service path: the service never mounted. The apply-time
        // missing() already emitted the loud warning, so only the section is
        // skipped here (no per-assembly re-warning).
        if (projections === undefined) return '';

        // Per-turn detection (the /using-aegis-like usage): the current user
        // message or a just-run /orchestrate command decides THIS turn. The
        // sticky projection below is only the backward-compat fallback.
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

        let resolvedMode: OrchestrateMode | undefined;
        let sawError = false;
        for (const candidate of sessionCandidates) {
          try {
            const snap = projections.snapshot(candidate);
            const value = snap?.values?.[ORCHESTRATE_PROJECTION_KEY];
            if (value && typeof value.mode === 'string') {
              const m = value.mode as OrchestrateMode;
              // 'on' wins immediately; otherwise remember the first known value.
              if (m === 'on') {
                resolvedMode = 'on';
                break;
              }
              if (resolvedMode === undefined) resolvedMode = m;
            }
          } catch (err) {
            // Surface instead of silently dropping (D1). The most likely cause
            // is a session-identity mismatch: this candidate is not the object
            // the /orchestrate command wrote the orchestrate/change event to.
            sawError = true;
            ctx.logger.warn(
              '[orchestrate] could not read orchestrator mode from projection for a candidate session (session identity may not match the session /orchestrate on wrote to):',
              (err as Error)?.message,
            );
          }
        }

        if (resolvedMode === undefined) {
          // Could not resolve any mode from any candidate session. Warn with the
          // likely cause; do NOT silently pretend 'off'.
          if (!sawError) {
            ctx.logger.warn(
              '[orchestrate] orchestrator mode could not be resolved from any candidate session — orchestrator-mode section skipped. Possible cause: the assembly context session identity does not match the session the /orchestrate command wrote the orchestrate/change event to (the projection cache is keyed by the live Session object, per @deepseek-ai/dsh-session-projection).',
            );
          }
          return '';
        }
        // Legitimate off: no section, no warning (intended behavior).
        if (resolvedMode === 'off') return '';
        return renderOrchestratorSection(getSettings(), toolName);
      },
    });
  }
}


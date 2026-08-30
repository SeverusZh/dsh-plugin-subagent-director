/**
 * Orchestrate command for Subagent Director (merged from the standalone
 * `orchestrate` plugin).
 *
 * Adds a `/orchestrate on|off` slash command that flips a per-session
 * projection and, when on, injects a pure-orchestrator system-prompt section.
 * The orchestrator delegates exclusively through the subagent-director
 * delegation tool (`subagent_role` by default).
 *
 * The role list rendered into the prompt is derived dynamically from the live
 * plugin settings (`subagent-director.roles`) — the same source `guidance.ts`
 * reads — so it never hard-codes role ids and stays correct when the operator
 * reconfigures roles. When no roles are configured the prompt tells the user
 * to configure them rather than silently emitting an empty section.
 *
 * Service posture mirrors `guidance.ts`: `commands`, `sessionProjections` and
 * `systemPrompt` are optional host-plane rows acquired through `ctx.get` with
 * `undefined` guards, so the wiring no-ops cleanly on surfaces that lack them.
 */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';

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

interface OrchestrateState {
  mode: OrchestrateMode;
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
  let projections: any = undefined;

  const missing = (): void =>
    ctx.logger.warn(
      '[orchestrate] sessionProjections service is missing on this host — the /orchestrate command will NOT take effect (no projection registered, orchestrator prompt will not inject). Provide the dsh-session-projection sessionProjections service to enable orchestrator mode.',
    );

  const registerProjection = (sp: any): void => {
    if (projections !== undefined) return; // idempotent: inject may re-fire
    projections = sp;
    sp.register({
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
      apply: (state: OrchestrateState, event: any): OrchestrateState => {
        if (!event || event.type !== ORCHESTRATE_EVENT_TYPE) return state;
        const mode = event.data && typeof event.data.mode === 'string' ? event.data.mode : '';
        if (!ORCHESTRATE_VALID_MODES.includes(mode as OrchestrateMode) || state.mode === mode) return state;
        return { mode: mode as OrchestrateMode };
      },
      wire: {
        viewSchema: z.object({ mode: z.enum(ORCHESTRATE_VALID_MODES) }),
        view: (state: OrchestrateState) => ({ mode: state.mode }),
      },
    });
    ctx.logger.info('[orchestrate] host active (command + projection + prompt section)');
  };

  const spNow: any = ctx.get('sessionProjections');
  if (spNow !== undefined) {
    registerProjection(spNow);
  } else if (typeof (ctx as any).inject === 'function') {
    // Reactive path: register once the host mounts sessionProjections. The
    // callback only runs when the dependency is present, so this also covers
    // the "ready slightly later" case that the one-shot get missed. If the
    // service never appears, the handler below returns an honest error — no
    // silent no-op.
    const fiber = (ctx as any).inject(['sessionProjections'], (injectedCtx: Context) => {
      registerProjection(injectedCtx.get('sessionProjections'));
    });
    if (fiber && typeof (fiber as any).dispose === 'function') {
      ctx.effect(() => (fiber as any).dispose(), 'subagent-director:orchestrate-projection-inject');
    }
  } else {
    // No reactive mechanism available and the service is absent now: surface
    // the missing service loudly (P0 honest-degradation guard).
    missing();
  }

  const commands: any = ctx.get('commands');
  if (commands !== undefined) {
    commands.register({
      name: 'orchestrate',
      description: 'Enter pure-orchestrator mode — delegate all work to the subagent-director team. No args defaults to "on".',
      input: { hint: 'on|off (no args = on)' },
      handler: (invocation: any) => {
        const mode = (invocation.rawInput || '').trim().toLowerCase() || 'on';
        if (!ORCHESTRATE_VALID_MODES.includes(mode as OrchestrateMode)) {
          return { kind: 'error', text: `Invalid: "${invocation.rawInput}". Valid: on|off` };
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
        invocation.agent.session.append(ORCHESTRATE_EVENT_TYPE, { mode });
        return { kind: 'success', text: mode === 'off' ? 'Orchestrator mode: off' : 'Orchestrator mode: on' };
      },
    });
  }

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
        return renderOrchestratorPrompt(getSettings(), toolName);
      },
    });
  }
}


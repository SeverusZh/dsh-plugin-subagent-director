/**
 * Route resolver - the pure-function core of Subagent Director (design section 6).
 *
 * Resolves which LLM provider/model an agentOptions should carry for one
 * subagent delegation, walking the four-layer fallback chain:
 *
 *   1. call     - explicit arguments on the tool call (per-call override)
 *   2. role     - the role template bound by args.role (or defaultRole)
 *   3. default  - plugin default provider/model from settings
 *   4. inherit  - nothing configured: do NOT inject anything, let the seam
 *                 inherit the parent agent (zero intrusion, AC-3.2)
 *
 * Field resolution is independent: each of provider/model/reasoningEffort is
 * filled by the highest-priority layer that specifies it. persona and
 * toolFilter come ONLY from the role layer.
 *
 * The function is pure, synchronous, and side-effect-free (<1ms) so it is
 * trivially unit-testable and replayable (FR-3.3, NFR-2).
 *
 * NOTE on the layer field: because resolution is field-level independent, one
 * delegation can draw different fields from different layers. layer reports
 * the highest-priority layer that contributed at least one resolved
 * agentOptions field ('inherit' when none did) - a single value kept for
 * observability (section 10), while per-field provenance lives implicitly in
 * the resolved fields.
 *
 * NOTE on reasoningEffort: the DSH AgentOptions shape only carries
 * provider/model/maxTokens (dsh-agent runtime-types). reasoningEffort is
 * therefore surfaced on the result SEPARATELY from agentOptions so a caller
 * can surface/validate it without pretending it belongs on
 * SubagentStartRequest.agentOptions.
 */
import type { AgentOptions } from '@deepseek-ai/dsh-agent';

/** Which layer supplied the resolved agentOptions fields. */
export type RouteLayer = 'call' | 'role' | 'default' | 'inherit';

/** A user-defined role template (design section 5.2). */
export interface RoleTemplate {
  /** Required, non-empty display name. */
  displayName: string;
  /** Required, non-empty delegation guidance shown to the main agent. */
  description: string;
  /** Persona text injected into the subagent (role-layer only). */
  persona?: string;
  /** LLM route provider override (role-layer only). */
  provider?: string;
  /** Model id override (role-layer only). */
  model?: string;
  /** Reasoning effort override (role-layer only; advisory). */
  reasoningEffort?: string;
  /** Tool scoping (role-layer only; requires toolFilter capability at runtime). */
  toolFilter?: { allow?: string[]; deny?: string[] };
}

/** Subagent Director settings namespace (design section 5.2). */
export interface SubagentDirectorSettings {
  /** Default LLM route provider (default-layer). */
  defaultProvider?: string;
  /** Default model id (default-layer). */
  defaultModel?: string;
  /** Default reasoning effort (default-layer; advisory). */
  defaultReasoningEffort?: string;
  /** Id of the role template used when no role is given (default-layer). */
  defaultRole?: string;
  /** Whether an invalid role-bound model falls back to the parent (default true). */
  fallbackOnInvalid?: boolean;
  /** Named role templates. */
  roles?: Record<string, RoleTemplate>;
}

/** Explicit per-call arguments accepted by the subagent_role tool. */
export interface RouteCallArgs {
  role?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

/** The parent agent's options (inherit-layer reference; not injected). */
export interface RouteParent {
  provider?: string;
  model?: string;
}

/** Inputs to a single route resolution. */
export interface RouteInput {
  args?: RouteCallArgs;
  settings: SubagentDirectorSettings;
  parent?: RouteParent;
}

/** A tool scoping restriction mirroring dsh-tools ToolRestriction. */
export interface RouteToolFilter {
  allow?: string[];
  deny?: string[];
}

/** The result of one route resolution. */
export interface RouteResult {
  /** Highest-priority layer that supplied a resolved agentOptions field. */
  layer: RouteLayer;
  /**
   * Resolved provider/model overrides to inject into
   * SubagentStartRequest.agentOptions. Present (non-empty) only when a
   * non-inherit layer configured at least one of these fields; otherwise
   * undefined so the seam inherits the parent (AC-3.2).
   */
  agentOptions?: Pick<AgentOptions, 'provider' | 'model'>;
  /** Resolved reasoning effort (advisory; NOT part of AgentOptions). */
  reasoningEffort?: string;
  /** Resolved role id when a valid role template was bound (role layer). */
  roleId?: string;
  /** Persona contributed by the role layer, when a valid role was bound. */
  persona?: string;
  /** Tool filter contributed by the role layer, when a valid role was bound. */
  toolFilter?: RouteToolFilter;
  /** Human-readable warnings for degraded references (nonexistent role, etc.). */
  warnings: string[];
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === '';
}

/** Core pure resolution logic. */
export function resolveRoute(input: RouteInput): RouteResult {
  const { args = {}, settings, parent } = input;
  const warnings: string[] = [];

  // ---- Layer 1: per-call explicit arguments -------------------------------
  const callProvider = isEmpty(args.provider) ? undefined : args.provider;
  const callModel = isEmpty(args.model) ? undefined : args.model;
  const callEffort = isEmpty(args.reasoningEffort) ? undefined : args.reasoningEffort;

  // ---- Layer 2: role template ----------------------------------------------
  const roles = settings.roles ?? {};
  const explicitRole = isEmpty(args.role) ? undefined : args.role;
  const roleIdRaw = explicitRole ?? settings.defaultRole;

  let role: RoleTemplate | undefined;
  let resolvedRoleId: string | undefined;
  if (roleIdRaw !== undefined) {
    const bound = roles[roleIdRaw];
    if (bound !== undefined) {
      role = bound;
      resolvedRoleId = roleIdRaw;
    } else {
      warnings.push(
        'subagent-director: role "' + roleIdRaw + '" does not exist; its binding (persona/provider/model) is skipped',
      );
    }
  }

  const roleProvider = role === undefined || isEmpty(role.provider) ? undefined : role.provider;
  const roleModel = role === undefined || isEmpty(role.model) ? undefined : role.model;
  const roleEffort =
    role === undefined || isEmpty(role.reasoningEffort) ? undefined : role.reasoningEffort;

  // ---- Layer 3: plugin defaults ----------------------------------------------
  const defaultProvider = isEmpty(settings.defaultProvider) ? undefined : settings.defaultProvider;
  const defaultModel = isEmpty(settings.defaultModel) ? undefined : settings.defaultModel;
  const defaultEffort = isEmpty(settings.defaultReasoningEffort)
    ? undefined
    : settings.defaultReasoningEffort;

  // ---- Field-level resolution: highest-priority layer per field --------------
  const provider = callProvider ?? roleProvider ?? defaultProvider;
  const model = callModel ?? roleModel ?? defaultModel;
  const reasoningEffort = callEffort ?? roleEffort ?? defaultEffort;

  // ---- Build the output -------------------------------------------------------
  const agentOptions: Pick<AgentOptions, 'provider' | 'model'> | undefined =
    provider !== undefined || model !== undefined
      ? {
          ...(provider !== undefined ? { provider } : {}),
          ...(model !== undefined ? { model } : {}),
        }
      : undefined;

  // Determine the dominant (highest-priority) contributing layer for agentOptions.
  let layer: RouteLayer = 'inherit';
  if (provider !== undefined || model !== undefined) {
    if (callProvider !== undefined || callModel !== undefined) {
      layer = 'call';
    } else if (roleProvider !== undefined || roleModel !== undefined) {
      layer = 'role';
    } else {
      layer = 'default';
    }
  }

  return {
    layer,
    ...(agentOptions !== undefined ? { agentOptions } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(resolvedRoleId !== undefined ? { roleId: resolvedRoleId } : {}),
    ...(role !== undefined && !isEmpty(role.persona) ? { persona: role.persona } : {}),
    ...(role !== undefined && role.toolFilter !== undefined ? { toolFilter: role.toolFilter } : {}),
    warnings,
  };
}

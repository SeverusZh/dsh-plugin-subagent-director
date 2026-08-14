/**
 * Pure settings-write logic for the Subagent Director client (no React, no wire
 * calls). Everything here is a function of its inputs so the revision state
 * machine, path-op construction, and conflict handling are unit-testable in a
 * plain node environment without a running host.
 *
 * The persisted section shape mirrors the Host schema (see src/settings.ts):
 *   {
 *     defaultProvider?, defaultModel?, defaultReasoningEffort?,
 *     defaultRole?, fallbackOnInvalid?,
 *     roles?: { [id]: { displayName, description, persona?, provider?,
 *                       model?, reasoningEffort?, toolFilter? } }
 *   }
 */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-host-apiproxy/api';

/** One role as the user edits it in a card (empty string = "clear the field"). */
export interface RoleDraft {
  displayName: string;
  description: string;
  persona?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

/** A persisted role template. */
export interface StoredRole {
  displayName: string;
  description: string;
  persona?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

/** The persisted user-layer section (fields optional). */
export interface StoredSection {
  defaultProvider?: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
  defaultRole?: string;
  fallbackOnInvalid?: boolean;
  roles?: Record<string, StoredRole>;
}

/** Path of the roles map from the section root. */
export const ROLES_PATH = ['roles'] as const;

/** Normalize an optional string: blank/whitespace becomes undefined (removed). */
export function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Blank/whitespace-only check used to decide "clear to undefined". */
export function isBlank(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

/** Kebab-case role ids (mirrors the Host validator in src/settings.ts). */
export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Generate a kebab-case id from a display name; falls back to a prefix + counter. */
export function roleIdFromName(name: string, existing: ReadonlySet<string>, prefix = 'role'): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const candidate = base.length > 0 ? base : prefix;
  if (!existing.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    if (!existing.has(candidate + '-' + i)) return candidate + '-' + i;
  }
  return candidate + '-' + Date.now().toString(36);
}

/**
 * Build the path ops that create or fully replace one role. A single set at the
 * role's root writes every field at once (mutate resolves against the stored
 * section, so intermediate objects materialize).
 */
export function addRoleOps(id: string, role: RoleDraft | StoredRole): SettingsPathOpView[] {
  return [
    {
      op: 'set',
      path: [ROLES_PATH[0], id],
      value: {
        displayName: role.displayName,
        description: role.description,
        ...optional(role.persona) !== undefined ? { persona: optional(role.persona) } : {},
        ...optional(role.provider) !== undefined ? { provider: optional(role.provider) } : {},
        ...optional(role.model) !== undefined ? { model: optional(role.model) } : {},
        ...optional(role.reasoningEffort) !== undefined ? { reasoningEffort: optional(role.reasoningEffort) } : {}
      }
    }
  ];
}

/** Field-by-field set-edits when a value changed from the stored role; unset when cleared. */
function fieldEdit(path: string[], stored: unknown, next: string | undefined): SettingsPathOpView | undefined {
  const store = typeof stored === 'string' ? stored : undefined;
  const normalized = optional(next);
  if (normalized === store) return undefined;
  if (normalized === undefined) return { op: 'unset', path: [...path] } as SettingsPathOpView;
  return { op: 'set', path: [...path], value: normalized } as SettingsPathOpView;
}

/**
 * Diff one role between its stored value and the edited draft. Only changed
 * fields become ops; clearing a field becomes an unset that restores the
 * composition base / removes the user override.
 */
export function updateRoleOps(id: string, before: StoredRole | undefined, draft: RoleDraft): SettingsPathOpView[] {
  const b = before ?? {} as StoredRole;
  const ops: SettingsPathOpView[] = [];
  const push = (op: SettingsPathOpView | undefined) => { if (op) ops.push(op); };
  const base = [ROLES_PATH[0], id];
  push(fieldEdit([...base, 'displayName'], b.displayName, draft.displayName));
  push(fieldEdit([...base, 'description'], b.description, draft.description));
  push(fieldEdit([...base, 'persona'], b.persona, draft.persona));
  push(fieldEdit([...base, 'provider'], b.provider, draft.provider));
  push(fieldEdit([...base, 'model'], b.model, draft.model));
  push(fieldEdit([...base, 'reasoningEffort'], b.reasoningEffort, draft.reasoningEffort));
  return ops;
}

/**
 * Ops to remove one role. When it was the defaultRole, the reference is cleared
 * too so a stale default never points at a removed role.
 */
export function removeRoleOps(id: string, current: Pick<StoredSection, 'defaultRole'>): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = [{ op: 'unset', path: [ROLES_PATH[0], id] } as SettingsPathOpView];
  if (current.defaultRole === id) ops.push({ op: 'unset', path: ['defaultRole'] } as SettingsPathOpView);
  return ops;
}

/** Ops to promote one role to the default. */
export function setDefaultRoleOps(id: string): SettingsPathOpView[] {
  return [{ op: 'set', path: ['defaultRole'], value: id } as SettingsPathOpView];
}

/** Ops for the default-model row: each cleared field is unset, changed fields set. */
export interface DefaultModelEdits {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

export function defaultModelOps(before: StoredSection, edits: DefaultModelEdits): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = [];
  const push = (op: SettingsPathOpView | undefined) => { if (op) ops.push(op); };
  push(fieldEdit(['defaultProvider'], before.defaultProvider, edits.provider));
  push(fieldEdit(['defaultModel'], before.defaultModel, edits.model));
  push(fieldEdit(['defaultReasoningEffort'], before.defaultReasoningEffort, edits.reasoningEffort));
  return ops;
}

/** Ops to clear every default-model field and the defaultRole back to composition defaults. */
export function restoreDefaultsOps(current: StoredSection): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = [];
  if (current.defaultProvider !== undefined) ops.push({ op: 'unset', path: ['defaultProvider'] } as SettingsPathOpView);
  if (current.defaultModel !== undefined) ops.push({ op: 'unset', path: ['defaultModel'] } as SettingsPathOpView);
  if (current.defaultReasoningEffort !== undefined) ops.push({ op: 'unset', path: ['defaultReasoningEffort'] } as SettingsPathOpView);
  if (current.defaultRole !== undefined) ops.push({ op: 'unset', path: ['defaultRole'] } as SettingsPathOpView);
  return ops;
}

/** Whether a section's defaultRole references a role that currently exists. */
export function defaultRoleValid(section: StoredSection): boolean {
  const role = section.defaultRole;
  return role === undefined || (section.roles?.[role] !== undefined);
}

/** Classification of a settings.mutate failure for the UI's conflict handling. */
export type MutationErrorKind = 'conflict' | 'rejected' | 'fatal';

/** Map an RPC error code to a UI outcome; unknown/undefined errors are fatal. */
export function classifyMutateError(code: string | undefined, _message?: string): MutationErrorKind {
  if (code === 'settings-conflict') return 'conflict';
  if (code === 'settings-rejected' || code === 'schema-validation') return 'rejected';
  return 'fatal';
}

/**
 * The revision state machine: after a successful mutate the server returns the
 * next revision; after a conflict the editor must re-read (drop pending edits)
 * and start from the freshly described revision. Collapses cleanly to a pure
 * function for testing.
 */
export interface RevisionState {
  /** Revision the next write must carry as expectedRevision. */
  revision: number;
  /** True once a conflict was observed, so the store knows to reload. */
  conflicted: boolean;
}

/** Advance after a successful write. */
export function advanceRevision(state: RevisionState, serverRevision: number): RevisionState {
  return { revision: serverRevision, conflicted: false };
}

/** Mark a conflict: keep the stale revision (the editor must reload). */
export function markConflict(state: RevisionState): RevisionState {
  return { revision: state.revision, conflicted: true };
}

/** Rebase after a reload picked up the fresh namespace. */
export function adoptRevision(_state: RevisionState, freshRevision: number): RevisionState {
  return { revision: freshRevision, conflicted: false };
}

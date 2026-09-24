/**
 * Settings namespace, schema, and write-time validation for Subagent Director
 * (design section 5.2).
 *
 * This module owns the "subagent-director" settings surface. On DSH 0.1.7 the
 * settings model changed: dsh-settings' default export is now `SettingsForms`,
 * plugin settings are declared by the plugin's own Cordis Config schema, and the
 * profile plugin entry's config is the single storage layer (there is no
 * settings.yaml override layer). Accordingly:
 *
 *  - `SettingsFields` is the schemastery field map for the settings surface,
 *    with every field `.volatile()` so a settings write updates the running
 *    plugin in place without a restart. It is spread into the plugin's Config
 *    schema (see ./config.ts) so the entry id `subagent-director` is the ns
 *    `describe()` / `mutate()` address.
 *  - Cross-field / semantic constraints the schema cannot express are still
 *    documented by `validateDirectorSettings`, but the new write path only
 *    enforces what the schema declares (per-field shape). See the export comment.
 *  - `installDirectorSettingsPage` registers the instance page policy
 *    (`auto:false`) because the plugin ships its own Web settings page.
 *
 * The field map stays permissive where it must be (optional strings, a
 * string-keyed role dict) so an absent section resolves cleanly; per-field
 * semantic requirements the old write validator enforced (non-empty
 * displayName/description, non-blank provider, kebab-case role ids) are now
 * declared in the schema itself and therefore enforced by the settings write
 * path (configEditor validates the Config schema on every write).
 */
import { Context } from '@deepseek-ai/cordis';
import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

import type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';

/** Settings namespace for Subagent Director (design section 0 naming resolution). */
export const SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE = 'subagent-director' as const;

/**
 * The official dsh-tool-subagent settings entry id (also its profile plugin id):
 * the settings ns carrying the authorized subagent model-selection allowlist.
 */
export const SUBAGENT_MODEL_SELECTION_NAMESPACE = 'subagent-model-selection-settings' as const;

export type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';

/** Kebab-case: lowercase alphanumeric segments separated by single hyphens. */
export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A string that must contain at least one non-whitespace character. */
const NON_BLANK = /\S/;

/** Schemastery schema for one role template. displayName/description are
 * required and non-blank; provider (when set) must be non-blank. */
export const RoleTemplateSchema = z.object({
  displayName: z.string().required().pattern(NON_BLANK),
  description: z.string().required().pattern(NON_BLANK),
  persona: z.string(),
  provider: z.string().pattern(NON_BLANK),
  model: z.string(),
  reasoningEffort: z.string(),
  // schemastery has no z.optional/z.undefined; an absent object field would
  // otherwise be materialized as { allow: [], deny: [] }, which the route
  // resolver must treat as unconfigured (issue #2). .default(undefined)
  // leaves an absent toolFilter out of the resolved section entirely; an
  // explicitly-set filter still resolves (empty sub-arrays are tolerated by
  // hasToolFilter at resolution time).
  toolFilter: z
    .object({
      allow: z.array(z.string()),
      deny: z.array(z.string()),
    })
    .default(undefined as never),
});

/**
 * The settings-surface field map. Every field is `.volatile()`: a settings
 * write merges into the profile entry config and the Cordis loader commits the
 * new values into the running references in place (no plugin restart). Role ids
 * are validated as kebab-case by the dict's key schema.
 */
export const SettingsFields = {
  defaultProvider: z.string().volatile(),
  defaultModel: z.string().volatile(),
  defaultReasoningEffort: z.string().volatile(),
  defaultRole: z.string().volatile(),
  fallbackOnInvalid: z.boolean().default(true).volatile(),
  roles: z.dict(RoleTemplateSchema, z.string().pattern(KEBAB_CASE)).volatile(),
};

/**
 * Schemastery schema for the Subagent Director settings surface on its own
 * (settings fields only, no composition fields). The plugin's shipped Config
 * schema is this map spread over the composition fields — see ./config.ts.
 */
export const SettingsSchema = z.object(SettingsFields);

/**
 * The resolved-config handles for the settings fields: each is a stable
 * `Volatile` reference whose `get()` returns the current value. Used as the
 * config parameter type so the plugin reads live values.
 */
export interface DirectorSettingsHandles {
  defaultProvider: Volatile<string | undefined>;
  defaultModel: Volatile<string | undefined>;
  defaultReasoningEffort: Volatile<string | undefined>;
  defaultRole: Volatile<string | undefined>;
  fallbackOnInvalid: Volatile<boolean>;
  roles: Volatile<Record<string, RoleTemplate> | undefined>;
}

/**
 * Project the live Config handles onto the plain settings snapshot consumed by
 * the resolver/guidance. Mirrors the Host schema in src/settings.ts.
 *
 * @param config - the resolved Cordis config carrying the volatile handles.
 * @returns a detached settings snapshot (fresh object each call).
 */
export function readDirectorSettings(config: DirectorSettingsHandles): SubagentDirectorSettings {
  return {
    defaultProvider: config.defaultProvider.get(),
    defaultModel: config.defaultModel.get(),
    defaultReasoningEffort: config.defaultReasoningEffort.get(),
    defaultRole: config.defaultRole.get(),
    fallbackOnInvalid: config.fallbackOnInvalid.get(),
    // Volatile snapshots are deeply readonly; consumers only read settings, so
    // the cast to the mutable-typed interface is safe.
    roles: config.roles.get() as SubagentDirectorSettings['roles'],
  };
}

function isEmpty(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

/** True when the value is a string made only of whitespace. */
function isBlankString(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length === 0;
}

/**
 * Semantic validator for a resolved settings section (design 5.2).
 *
 * On DSH ≤ 0.1.6 this was the settings write-time validator (installSection's
 * `validate` hook): it threw to refuse a write. On 0.1.7 the write path has no
 * custom validate hook — the Config schema is the write gate — so the
 * per-field checks it performed (kebab-case role ids, non-empty
 * displayName/description, non-blank provider) are now declared in
 * {@link RoleTemplateSchema} / {@link SettingsFields} instead.
 *
 * The remaining cross-field check — a `defaultRole` that references no defined
 * role — cannot be expressed in a schemastery schema. It is kept here for
 * callers/tests that want to check it explicitly; the runtime route resolver
 * already tolerates a dangling defaultRole by warning and skipping the binding,
 * so no write is refused for it on 0.1.7.
 *
 * @param value - the resolved section, schema-valid by construction.
 * @throws when the cross-field defaultRole reference is dangling.
 */
export function validateDirectorSettings(value: SubagentDirectorSettings): void {
  const roles = value.roles ?? {};
  for (const [id, role] of Object.entries(roles)) {
    if (!KEBAB_CASE.test(id)) {
      throw new Error(
        'subagent-director: role id "' + id + '" is not kebab-case (lowercase letters, digits and single hyphens)',
      );
    }
    if (isEmpty(role?.displayName)) {
      throw new Error('subagent-director: role "' + id + '" must have a non-empty displayName');
    }
    if (isEmpty(role?.description)) {
      throw new Error('subagent-director: role "' + id + '" must have a non-empty description');
    }
    if (isBlankString(role?.provider)) {
      throw new Error('subagent-director: role "' + id + '" provider must be a non-empty string when set');
    }
  }

  if (!isEmpty(value.defaultRole) && roles[value.defaultRole!] === undefined) {
    throw new Error(
      'subagent-director: defaultRole "' + value.defaultRole + '" does not reference a defined role',
    );
  }

  if (isBlankString(value.defaultProvider)) {
    throw new Error('subagent-director: defaultProvider must be a non-empty string when set');
  }
}

/**
 * Register the plugin instance's settings page policy (DSH 0.1.7
 * `SettingsForms.configure`).
 *
 * The plugin ships its own Web settings page (slot `settings.section`), so
 * `auto:false` disables the Host's auto-generated page for this instance and
 * avoids a duplicate page. The policy is registered into the plugin fiber's
 * effects and removed on unload. `settings` is a required inject for this
 * plugin, so the callback always runs on an active deployment.
 *
 * @param ctx - the plugin fiber's context.
 */
export function installDirectorSettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}

/** Structural face of `@deepseek-ai/dsh-settings`' `SettingsForms` used here. */
export interface SettingsFormsLike {
  describe(options?: { redactSecrets?: boolean }): readonly { ns: string; value?: unknown }[];
}

/**
 * Read one namespace's live (redacted) value from the settings seam's
 * `describe()`. On 0.1.7 there is no `settings.get(ns)`; a namespace's live
 * value is the descriptor's `value` projected from the running plugin config.
 *
 * @param settings - the settings service (structural).
 * @param ns - the profile entry id to read.
 * @returns the redacted live value, or undefined when the ns is not active.
 */
export function readNamespaceValue(settings: SettingsFormsLike | undefined, ns: string): unknown {
  if (settings === undefined) return undefined;
  try {
    const descriptor = settings.describe({ redactSecrets: true }).find((row) => row.ns === ns);
    return descriptor?.value;
  } catch {
    return undefined;
  }
}

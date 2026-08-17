/**
 * Settings namespace, schema, and write-time validation for Subagent Director
 * (design section 5.2).
 *
 * This module owns the "subagent-director" settings namespace. It re-exports
 * the role/settings types from ./route-resolver (single source of truth) and
 * registers them with the canonical optional-settings consumer wiring so a
 * deployment without a settings provider keeps working off its composition
 * config (zero intrusion).
 *
 * Layering (design 5.2): the schemastery schema stays coercive/permissive
 * (all fields optional, roles a string-keyed dict) so an absent section
 * resolves cleanly; cross-field / semantic constraints that the schema cannot
 * express are enforced at WRITE time by validate(), which throws to refuse the
 * write exactly as SettingsRegisterOptions.validate / SettingsSectionHooks.validate
 * demand (dsh-settings/lib/types/index.d.ts:24-48, 307-341).
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import {
  installSettingsSection,
  settingsNamespace,
  type SettingsSectionHooks,
} from '@deepseek-ai/dsh-settings';

import type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';

/** Settings namespace for Subagent Director (design section 0 naming resolution). */
export const SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE = settingsNamespace('subagent-director');

export type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';

/**
 * Live settings snapshot holder.
 *
 * dsh-settings' `installSettingsSection` calls `setSource` exactly once with a
 * source thunk and fires `onChange` on every settings change (settings.yaml
 * hot reload, settings UI writes). The previous wiring captured the value
 * inside setSource and left onChange empty, so edits were only visible after a
 * restart. This helper keeps the source thunk so onChange can re-read it and
 * the snapshot follows live settings.
 */
export interface SettingsSnapshot<T> {
  /** The dsh-settings consumer hooks to pass to installSettingsSection. */
  hooks: SettingsSectionHooks<T>;
  /** The current resolved snapshot (refreshed by onChange). */
  get(): T;
}

export function createSettingsSnapshot<T>(initial: T): SettingsSnapshot<T> {
  let source: (() => T) | undefined;
  let snapshot = initial;
  return {
    hooks: {
      setSource: (current) => {
        source = current;
        snapshot = current();
      },
      onChange: () => {
        if (source !== undefined) snapshot = source();
      },
    },
    get: () => snapshot,
  };
}

/** Kebab-case: lowercase alphanumeric segments separated by single hyphens. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Schemastery schema for one role template. All fields optional so a partial /
 * absent role resolves; semantic requirements are enforced by validate(). */
export const RoleTemplateSchema = z.object({
  displayName: z.string(),
  description: z.string(),
  persona: z.string(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  toolFilter: z.object({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  }),
});

/**
 * Schemastery schema for the Subagent Director settings section. Every field is
 * optional (schemastery object fields are optional by default); roles is a
 * string-keyed dict of RoleTemplateSchema.
 */
export const SettingsSchema = z.object({
  defaultProvider: z.string(),
  defaultModel: z.string(),
  defaultReasoningEffort: z.string(),
  defaultRole: z.string(),
  fallbackOnInvalid: z.boolean().default(true),
  roles: z.dict(RoleTemplateSchema),
});

function isEmpty(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

/** True when the value is a string made only of whitespace. */
function isBlankString(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length === 0;
}

/**
 * Write-time validator for a resolved settings section (design 5.2).
 *
 * Throws to refuse the write that produced value, as the settings seam
 * contract requires. Checks:
 *  - every role key is kebab-case;
 *  - every role's displayName and description are present and non-empty;
 *  - defaultRole, when set, references an existing role key;
 *  - every explicitly-set provider is a non-empty string.
 *
 * @param value - the resolved section, schema-valid by construction.
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
 * Install the Subagent Director settings section through the canonical
 * optional-settings consumer wiring.
 *
 * Mirrors dsh-agent-default-model/lib/index.js's optional pattern: the
 * registration rides the scoped fiber, so a deployment with no settings
 * service simply never mounts it. This helper guards that explicitly for
 * readability and logs a debug line when the service is absent so the gradual
 * fall-back to the composition config is observable.
 *
 * @param ctx - consumer plugin context owning the wiring.
 * @param entry - the consumer's composition-layer config, used as the settings
 *   base while a provider is absent.
 * @param hooks - source sink and change notification (plus optional validate).
 */
export function installDirectorSettings(
  ctx: Context,
  entry: SubagentDirectorSettings,
  hooks: SettingsSectionHooks<SubagentDirectorSettings>,
): void {
  if (ctx.get('settings') === undefined) {
    ctx.logger.debug(
      '[subagent-director] no settings service mounted; using composition config and skipping settings section registration',
    );
    return;
  }
  installSettingsSection(ctx, SUBAGENT_DIRECTOR_SETTINGS_NAMESPACE, SettingsSchema, entry, hooks);
}

/** Convenience exported alias used by tests. */
export { SettingsSchema as SubagentDirectorSettingsSchema };

/**
 * Plugin Config for Subagent Director (the Cordis composition-entry layer).
 *
 * This mirrors the field semantics of `@deepseek-ai/dsh-tool-subagent` (see
 * its `lib/types/index.d.ts`) so the two delegation tools stay behaviourally
 * consistent in the ecosystem.
 *
 * Two provider namespaces live side by side here and MUST NOT be confused
 * (design section 14, risk R2):
 *   - `subagentProvider`: the subagent TRANSPORT provider name handed to
 *     `ctx.subagents.start(...)` (e.g. `spawn`, `fork`, `acp`).
 *   - `agentOptions.provider` / `defaultProvider` (settings): the LLM route
 *     provider that actually serves model requests (e.g. `deepseek-official`,
 *     a pi-ai route). They are unrelated name spaces.
 */
import z from '@deepseek-ai/schemastery';

/**
 * Cordis-layer plugin configuration.
 *
 * All fields are optional so an empty composition entry degrades to the DSH
 * default behaviour (inherit the parent agent's model; one-shot foreground).
 */
export interface DirectorConfig {
  /**
   * The subagent TRANSPORT provider to start runs on. This is the `name`
   * argument of `ctx.subagents.start(name, request)`, NOT an LLM route.
   * Default 'spawn'.
   */
  subagentProvider?: string;

  /**
   * Model-facing tool name for THIS plugin's delegation tool, default
   * 'subagent_role'. Each loaded instance must use a distinct name.
   *
   * Not the same tool as DSH's built-in `subagent` / `subagent_fork`: those are
   * registered by the base bundle and coexist with this one in the same request
   * tool catalog. Only calls that go through this name apply role persona and
   * role `toolFilter`; a model that picks the built-in `subagent` instead gets
   * neither (the default model route still applies when `applyDefaultRoute` is
   * on — see below).
   */
  toolName?: string;

  /** Expose `run_in_background` (default true). Disabled instances omit the argument. */
  enableRunInBackground?: boolean;

  /**
   * Background execution policy (default 'one-shot').
   * 'one-shot' defaults calls to foreground and runs background calls as a
   * plain Task. 'continuable' defaults calls to background via
   * ctx.subagents.startContinuable(), requires the transport provider's
   * prepareContinuable capability, and returns the durable child id for later
   * send_message follow-up (FR-5.3).
   */
  backgroundMode?: 'one-shot' | 'continuable';

  /**
   * Maximum child delegation depth (default 3). A numeric cap requires the
   * provider's `depthLimit` capability. 'provider-managed' sends no cap.
   */
  maxDepth?: number | 'provider-managed';

  /**
   * Whether to apply the settings `defaultProvider`/`defaultModel` to every
   * subagent start that did not carry an explicit agentOptions — including
   * starts initiated by the built-in `subagent`/`subagent_fork` tools (default
   * true). With no default model configured this is a no-op (zero intrusion);
   * set false to keep the defaults limited to `subagent_role`'s resolution
   * chain.
   */
  applyDefaultRoute?: boolean;
}

/** Schemastery schema for {@link DirectorConfig}. */
export const Config = z.object({
  subagentProvider: z.string().default('spawn'),
  toolName: z.string().default('subagent_role'),
  enableRunInBackground: z.boolean().default(true),
  backgroundMode: z.union(['one-shot', 'continuable']).default('one-shot'),
  maxDepth: z
    .union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed')]),
  applyDefaultRoute: z.boolean().default(true),
});

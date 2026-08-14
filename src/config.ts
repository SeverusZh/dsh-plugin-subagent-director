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

  /** Model-facing tool name, default 'subagent_role'. Each loaded instance must use a distinct name. */
  toolName?: string;

  /** Expose `run_in_background` (default true). Disabled instances omit the argument. */
  enableRunInBackground?: boolean;

  /**
   * Background execution policy (default 'one-shot').
   * 'one-shot' defaults calls to foreground and runs background calls as a
   * plain Task. 'continuable' is deferred to M2 and explicitly rejected.
   */
  backgroundMode?: 'one-shot' | 'continuable';

  /**
   * Maximum child delegation depth (default 3). A numeric cap requires the
   * provider's `depthLimit` capability. 'provider-managed' sends no cap.
   */
  maxDepth?: number | 'provider-managed';
}

/** Schemastery schema for {@link DirectorConfig}. */
export const Config = z.object({
  subagentProvider: z.string().default('spawn'),
  toolName: z.string().default('subagent_role'),
  enableRunInBackground: z.boolean().default(true),
  backgroundMode: z.union(['one-shot', 'continuable']).default('one-shot'),
  maxDepth: z
    .union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed')]),
});

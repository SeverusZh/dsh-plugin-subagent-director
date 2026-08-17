/**
 * Default route seam (design: 默认模型兜底).
 *
 * Makes the plugin's configured `defaultProvider`/`defaultModel` apply to ANY
 * subagent start that did not carry an explicit `agentOptions` — including
 * starts initiated by the built-in `subagent` / `subagent_fork` tools, not just
 * the plugin's own `subagent_role`. This closes the gap where the model picks
 * the built-in tool and the configured defaults never take effect.
 *
 * Layering: explicit `agentOptions` (even partial) always wins; the seam is a
 * best-effort default. An un-routable default provider falls back to
 * inheritance and never throws, so a bad default cannot break built-in
 * delegation; the strict `fallbackOnInvalid` error semantics remain the
 * property of `subagent_role`'s explicit path (route-resolver.ts).
 */
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { SubagentDirectorSettings } from './route-resolver.js';

export interface SeamResolveInput {
  agentOptions?: AgentOptions;
  settings: SubagentDirectorSettings;
  isRoutable?: (provider: string) => boolean;
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === '';
}

export function resolveSeamAgentOptions(input: SeamResolveInput): Pick<AgentOptions, 'provider' | 'model'> | undefined {
  const { agentOptions, settings, isRoutable } = input;
  if (agentOptions !== undefined && (agentOptions.provider !== undefined || agentOptions.model !== undefined)) {
    return undefined;
  }
  const provider = settings.defaultProvider;
  const model = settings.defaultModel;
  if (isEmpty(provider) || isEmpty(model)) return undefined;
  if (isRoutable !== undefined && !isRoutable(provider!)) return undefined;
  return { provider, model };
}

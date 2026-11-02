/**
 * Subagent Director — optional settings bridge plugin entry.
 *
 * This is a SEPARATE loader entry from the main `subagent-director` plugin
 * because the Host web server service is only reachable through cordis
 * `inject` — tree-external plugins cannot see it through `ctx.get()`
 * (verified: dsh-client-connection itself declares `inject = ["webServer"]`,
 * dsh-client-connection/lib/index.js:479, and a third-party plugin probing
 * ctx.get("webServer") never registers its routes).
 *
 * Load this entry in Web profiles alongside the main entry to enable the
 * "/subagent-director" settings bridge that bypasses the apiproxy
 * exposedNamespaces() allowlist. In headless profiles this entry simply never
 * activates (cordis inject waits for webServer, which is absent), so the main
 * entry keeps working there unchanged.
 *
 * Profile patch example (cordis.patch.yml):
 *   - insert:
 *       - id: subagent-director-bridge
 *         name: dsh-plugin-subagent-director/bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

import { installDirectorRemoteBridge } from './remote.js';

/** Cordis plugin name for the bridge entry. */
export const name = 'subagent-director-bridge';

/** Composition config of the standalone bridge entry. */
export interface BridgeConfig {
  /** Reverse-proxy Host allowlist for the settings bridge. */
  readonly trustedHosts?: readonly string[];
}

/**
 * Bridge-entry Config: a Host allowlist that exempts a reverse-proxied
 * deployment from the loopback fence. Independent from the main entry's Config
 * because this is a separate loader entry (`subagent-director-bridge`).
 */
export const Config = z.object({
  trustedHosts: z
    .array(z.string())
    .default([])
    .description(
      'Reverse-proxy Host allowlist for the settings bridge; hostname only, port and case insensitive.',
    ),
});

/** Required services: webServer (route owner), settings (data seam), and the
 * agent/subagent services backing the subagentClose endpoint (drain needs the
 * exact live parent Agent). agents/subagents are dsh-base-level services that
 * every profile mounts; headless profiles never activate this entry because
 * webServer is absent. */
export const inject = ['webServer', 'settings', 'agents', 'subagents'];

/** Register the settings bridge route; dispose on unload. */
export function apply(ctx: Context, config: BridgeConfig = {}): void {
  installDirectorRemoteBridge(ctx, config);
}

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
import { installDirectorRemoteBridge } from './remote.js';

/** Cordis plugin name for the bridge entry. */
export const name = 'subagent-director-bridge';

/** Required services: webServer (route owner), settings (data seam), and the
 * agent/subagent services backing the subagentClose endpoint (drain needs the
 * exact live parent Agent). agents/subagents are dsh-base-level services that
 * every profile mounts; headless profiles never activate this entry because
 * webServer is absent. */
export const inject = ['webServer', 'settings', 'agents', 'subagents'];

/** Register the settings bridge route; dispose on unload. */
export function apply(ctx: Context): void {
  installDirectorRemoteBridge(ctx);
}

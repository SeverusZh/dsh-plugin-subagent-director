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
 * Load this entry alongside the main entry to enable the
 * "/subagent-director" settings bridge that bypasses the apiproxy
 * exposedNamespaces() allowlist. The entry itself remains active in headless
 * profiles; only its child route fiber waits for the optional webServer.
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

/** Required host services. webServer is intentionally optional: headless
 * profiles must activate this loader entry cleanly instead of leaving it in a
 * PENDING state that fails the host's startup audit. */
export const inject = ['settings', 'agents', 'subagents'];

/** Attach the route whenever a webServer is present. Cordis owns the child
 * fiber, so removing/replacing webServer disposes and re-registers the route,
 * and unloading this entry cleans the child up as well. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx: Context) => {
    installDirectorRemoteBridge(webCtx);
  });
}

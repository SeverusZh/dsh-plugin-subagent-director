/**
 * Client plugin entry for Subagent Director (design section 9).
 *
 * M1 ships the host-side plugin only; the settings UI (settings.section,
 * SnapshotStore, role cards) is M2. This placeholder keeps the package layout
 * stable and the client entry present for DSH's per-environment entry selection.
 */
import type { Context } from '@deepseek-ai/cordis';

/** Client plugin name (an imaginary slot consumer; real name resolves in M2). */
export const name = 'subagent-director';

/** Apply is a no-op placeholder for M1 — the settings UI is implemented in M2. */
export function apply(_ctx: Context): void {
  // Intentionally empty placeholder (design section 9).
}

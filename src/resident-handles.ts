/**
 * Process-local registry of continuable subagent activations started by this
 * plugin. DSH 0.2.2 removed the per-child `drainChildren` API; the only public
 * per-activation teardown capability is the receipt returned by
 * `startActivation`, so close_subagent must retain and dispose that receipt.
 *
 * The registry is shared by the main entry and the settings bridge entry in the
 * same host process. It cannot survive a host restart: after restart a child is
 * cold rather than resident, so close_subagent reports it as untracked.
 */
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent';

/** Outcome of releasing one tracked activation. */
export type ResidentCloseOutcome = 'closed' | 'not-tracked' | 'unauthorized';

/** One activation receipt plus the exact direct parent that created it. */
interface ResidentHandle {
  readonly parentId: string;
  readonly activation: SubagentActivation;
}

const handles = new Map<string, ResidentHandle>();
const closing = new Map<string, Promise<void>>();

/** Retain the activation receipt of one continuable child for later release. */
export function trackResident(parentId: string, activation: SubagentActivation): void {
  handles.set(String(activation.childId), { parentId, activation });
}

/** Drop a receipt whose agent already left the host registry. */
export function forgetResident(childId: string): void {
  handles.delete(childId);
}

/**
 * Release one tracked activation by durable child id.
 *
 * A target started by another plugin or before a host restart is untracked; a
 * target recorded under a different direct parent is unauthorized. The receipt
 * is removed only after disposal succeeds, so a failed teardown can be retried
 * and never turns into a misleading `not-tracked`.
 */
export async function closeResident(parentId: string, childId: string): Promise<ResidentCloseOutcome> {
  const handle = handles.get(childId);
  if (handle === undefined) {
    const pending = closing.get(childId);
    if (pending !== undefined) {
      await pending;
      return 'closed';
    }
    return 'not-tracked';
  }
  if (handle.parentId !== parentId) return 'unauthorized';

  const pending = closing.get(childId);
  if (pending !== undefined) {
    await pending;
    return 'closed';
  }

  const disposal = Promise.resolve().then(() => handle.activation.dispose());
  closing.set(childId, disposal);
  try {
    await disposal;
    handles.delete(childId);
    return 'closed';
  } finally {
    closing.delete(childId);
  }
}

/** Drop every receipt; used by tests and by plugin unload. */
export function clearResidentHandles(): void {
  handles.clear();
  closing.clear();
}

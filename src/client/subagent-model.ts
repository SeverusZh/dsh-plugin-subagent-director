/**
 * Subagent Director — M3b observability pure logic.
 *
 * Extracts the provider/model a subagent actually ran on, straight from an
 * opened subagent conversation with zero extra RPC: each finalized assistant
 * message may carry a reported `provenance` (the adapter-reported
 * provider/model) and the `requestConfig` that was requested. We take the
 * latest assistant message that exposes either, preferring the reported
 * provenance over the requested config, and format a localized readout.
 *
 * On the DSH alpha.4/alpha.5 host line the node list is the chat view's
 * `legacy.nodes` slice (ChatSnapshot.legacy.nodes) and the addressed-subagent
 * guard reads the SessionSnapshot.subagent address — both shapes are the
 * inputs of the pure functions below. Pure and framework-free.
 */

import type {
  AssistantMessageNode,
  AssistantProvenanceView,
  ConversationNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';

/** The durable provider/model identity of one subagent run. */
export interface SubagentModelRef {
  readonly found: true;
  readonly provider: string;
  readonly model: string;
}

/** A transcript has not yet proven which provider/model a subagent used. */
export interface NoSubagentModel {
  readonly found: false;
}

export type SubagentModelLookup = SubagentModelRef | NoSubagentModel;

/**
 * Prefer the latest assistant message's reported provenance; fall back to its
 * requested config. Order walks the node list from the tail so we surface the
 * most recent completed request, which is the meaningful one when a subagent
 * retried or only partially ran. The input is the alpha.4 chat view's legacy
 * node slice (ChatSnapshot.legacy.nodes).
 */
export function latestSubagentModel(
  snapshot: { nodes: readonly ConversationNode[] },
): SubagentModelLookup {
  if (snapshot === null || typeof snapshot !== 'object') {
    return { found: false };
  }
  const nodes: readonly ConversationNode[] | undefined = snapshot.nodes;
  if (!Array.isArray(nodes)) return { found: false };
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node === null || typeof node !== 'object') continue;
    if ((node as { kind?: unknown }).kind !== 'assistant') continue;
    const assistant = node as AssistantMessageNode;
    const ref = provenanceOf(assistant);
    if (ref !== null) return ref;
  }
  return { found: false };
}

/** Resolve the model identity off one assistant message (provenance first). */
export function provenanceOf(
  assistant: AssistantMessageNode,
): SubagentModelRef | null {
  const reported: AssistantProvenanceView | undefined = assistant.provenance;
  if (
    reported !== null &&
    typeof reported === 'object' &&
    typeof reported.provider === 'string' &&
    reported.provider !== '' &&
    typeof reported.model === 'string' &&
    reported.model !== ''
  ) {
    return { found: true, provider: reported.provider, model: reported.model };
  }
  const requested = assistant.requestConfig;
  if (
    requested !== null &&
    typeof requested === 'object' &&
    typeof requested.provider === 'string' &&
    requested.provider !== '' &&
    typeof requested.model === 'string' &&
    requested.model !== ''
  ) {
    return { found: true, provider: requested.provider, model: requested.model };
  }
  return null;
}

/**
 * Whether this conversation is an addressed subagent (a catalog-discovered
 * child) — the surface where the official read-only composer shows and where
 * a model readout is most useful. A null `subagent` on an ordinary session
 * returns false even when nodes carry provenance. Reads the alpha.4
 * SessionSnapshot.subagent address slot.
 */
export function isAddressedSubagent(
  snapshot: Pick<SessionSnapshot, 'subagent'> | null | undefined,
): boolean {
  if (snapshot === null || snapshot === undefined) return false;
  const subagent = snapshot.subagent;
  return subagent !== null && subagent !== undefined;
}

/**
 * Compact provider/model label, e.g. "deepseek/deepseek-v4-flash". The model
 * id can already include a provider prefix; we do not hyphenate or re-quote
 * so the exact route stays readable in one line.
 */
export function formatModelRef(ref: SubagentModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

/**
 * Whether this session is a continuable child (the surface where the
 * "release sustained state" control is meaningful). Reads the catalog
 * address's mode; ordinary sessions and one-shot children are false.
 */
export function isContinuableChild(
  snapshot: Pick<SessionSnapshot, 'subagent'> | null | undefined,
): boolean {
  if (snapshot === null || snapshot === undefined) return false;
  const address = snapshot.subagent?.address;
  return address !== undefined && address !== null && address.mode === 'continuable';
}

/**
 * Merge a local snapshot-derived lookup with a remote (RPC) lookup: the local
 * provenance wins when present (the runtime's own record), otherwise the
 * remote result decides. Kept pure so the dock's data-source preference is
 * unit-testable without a wire.
 */
export function mergeModelLookup(
  local: SubagentModelLookup,
  remote: SubagentModelLookup,
): SubagentModelLookup {
  return local.found ? local : remote;
}

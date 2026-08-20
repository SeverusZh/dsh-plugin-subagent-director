/**
 * uSES bridge: turns any bare observable snapshot source into a selector hook.
 *
 * DSH rc8 removed the `@deepseek-ai/dsh-client-web-react` package (its client
 * store-binding helpers were folded into the core slot kit). This is a local
 * copy of the same `bindSnapshotSelector` contract, implemented against the
 * `react` seed provided by the DSH client module table, so the plugin keeps
 * working on rc8+ without an extra runtime dependency.
 */
import { useSyncExternalStore } from 'react';

/** Selector hook produced by {@link bindSnapshotSelector}. */
export type SnapshotSelectorHook<State> = <Selected>(
  selector: (state: State) => Selected,
) => Selected;

/** Minimal bare observable snapshot source accepted by the binder. */
export interface SnapshotSource<State> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): State;
}

/**
 * Bind a bare observable source (subscribe/getSnapshot) to a selector hook.
 * The selector is applied to the snapshot on every render; identity stores can
 * simply pass `(s) => s`.
 */
export function bindSnapshotSelector<State>(
  store: SnapshotSource<State>,
): SnapshotSelectorHook<State> {
  const subscribe = (listener: () => void) => store.subscribe(listener);
  const getSnapshot = () => store.getSnapshot();
  return function useSelector<Selected>(selector: (state: State) => Selected): Selected {
    const select = selector ?? ((state: State) => state as unknown as Selected);
    return useSyncExternalStore(subscribe, () => select(getSnapshot()));
  };
}

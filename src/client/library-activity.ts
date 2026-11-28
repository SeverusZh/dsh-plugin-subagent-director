/**
 * Activity wiring for the card library: refresh the snapshot when the page
 * regains focus or visibility, and re-read the clock once a minute so the
 * 30/90-day closed-pool boundaries do not freeze while the page stays open.
 *
 * The browser globals are injected so the wiring is testable without a DOM;
 * the React effect only calls this in a browser.
 */

/** Visibility values the activity watcher distinguishes. */
export type ActivityVisibility = 'visible' | 'hidden' | 'prerender';

/** The window surface used by the watcher. */
export interface ActivityWindowLike {
  addEventListener(type: 'focus', listener: () => void): void;
  removeEventListener(type: 'focus', listener: () => void): void;
  setInterval(handler: () => void, timeoutMs: number): number;
  clearInterval(handle: number): void;
}

/** The document surface used by the watcher. */
export interface ActivityDocumentLike {
  readonly visibilityState: ActivityVisibility;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Inputs of {@link watchLibraryActivity}. */
export interface LibraryActivityOptions {
  window: ActivityWindowLike;
  document: ActivityDocumentLike;
  /** Re-read the acknowledged card library. */
  refresh: () => void;
  /** Receive the fresh instant for every minute tick. */
  onTick: (now: number) => void;
  now?: () => number;
  tickIntervalMs?: number;
  refreshThrottleMs?: number;
}

/** Page clock cadence; day-scale boundaries only need a minute. */
export const LIBRARY_TICK_MS = 60_000;

/** Focus and visibilitychange often fire together; coalesce the pair. */
export const LIBRARY_REFRESH_THROTTLE_MS = 1_000;

/**
 * Watch page activity until the returned disposer runs. Refreshes only while
 * the document is visible, at most once per throttle window, and ticks the
 * clock on a fixed interval without polling the host.
 */
export function watchLibraryActivity(options: LibraryActivityOptions): () => void {
  const {
    window: windowLike,
    document: documentLike,
    refresh,
    onTick,
    now = Date.now,
    tickIntervalMs = LIBRARY_TICK_MS,
    refreshThrottleMs = LIBRARY_REFRESH_THROTTLE_MS,
  } = options;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  const refreshIfVisible = (): void => {
    if (documentLike.visibilityState === 'hidden') return;
    const at = now();
    if (at - lastRefresh < refreshThrottleMs) return;
    lastRefresh = at;
    refresh();
  };
  const onVisibilityChange = (): void => {
    if (documentLike.visibilityState === 'visible') refreshIfVisible();
  };
  windowLike.addEventListener('focus', refreshIfVisible);
  documentLike.addEventListener('visibilitychange', onVisibilityChange);
  const timer = windowLike.setInterval(() => onTick(now()), tickIntervalMs);
  return () => {
    windowLike.removeEventListener('focus', refreshIfVisible);
    documentLike.removeEventListener('visibilitychange', onVisibilityChange);
    windowLike.clearInterval(timer);
  };
}

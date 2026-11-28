/**
 * Activity wiring for the card library: refresh on focus/visibility and tick
 * the page clock once a minute. The DOM surfaces are injected fakes, so this
 * runs in the plain node test environment without jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import { LIBRARY_REFRESH_THROTTLE_MS, LIBRARY_TICK_MS, watchLibraryActivity } from '../src/client/library-activity.js';

type Visibility = 'visible' | 'hidden' | 'prerender';

function harness() {
  const focusListeners = new Set<() => void>();
  const visibilityListeners = new Set<() => void>();
  let visibility: Visibility = 'visible';
  let nowMs = 1_000_000;
  let tick: (() => void) | undefined;
  let intervalMs: number | undefined;
  let clearedHandle: number | undefined;
  const refresh = vi.fn();
  const onTick = vi.fn();
  const dispose = watchLibraryActivity({
    window: {
      addEventListener: (type, listener) => { if (type === 'focus') focusListeners.add(listener); },
      removeEventListener: (type, listener) => { if (type === 'focus') focusListeners.delete(listener); },
      setInterval: (handler, ms) => { tick = handler; intervalMs = ms; return 7; },
      clearInterval: (handle) => { clearedHandle = handle; },
    },
    document: {
      get visibilityState() { return visibility; },
      addEventListener: (_type, listener) => { visibilityListeners.add(listener); },
      removeEventListener: (_type, listener) => { visibilityListeners.delete(listener); },
    },
    refresh,
    onTick,
    now: () => nowMs,
  });
  return {
    dispose,
    refresh,
    onTick,
    focusListeners,
    visibilityListeners,
    fireFocus: (): void => { for (const listener of [...focusListeners]) listener(); },
    fireVisibility: (): void => { for (const listener of [...visibilityListeners]) listener(); },
    fireTick: (): void => { tick?.(); },
    setVisibility: (next: Visibility): void => { visibility = next; },
    setNow: (next: number): void => { nowMs = next; },
    get intervalMs(): number | undefined { return intervalMs; },
    get clearedHandle(): number | undefined { return clearedHandle; },
  };
}

describe('library activity watcher', () => {
  it('refreshes on focus while visible and coalesces the focus/visibility pair', () => {
    const h = harness();
    h.fireFocus();
    expect(h.refresh).toHaveBeenCalledTimes(1);

    h.setVisibility('visible');
    h.fireVisibility();
    expect(h.refresh).toHaveBeenCalledTimes(1);

    h.setNow(1_000_000 + LIBRARY_REFRESH_THROTTLE_MS + 1);
    h.fireFocus();
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(h.intervalMs).toBe(LIBRARY_TICK_MS);
    h.dispose();
  });

  it('skips refreshes while the document is hidden', () => {
    const h = harness();
    h.setVisibility('hidden');
    h.fireFocus();
    h.fireVisibility();
    expect(h.refresh).not.toHaveBeenCalled();

    h.setVisibility('visible');
    h.fireVisibility();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('ticks the clock once a minute with the current instant', () => {
    const h = harness();
    expect(h.intervalMs).toBe(LIBRARY_TICK_MS);
    h.setNow(2_500_000);
    h.fireTick();
    expect(h.onTick).toHaveBeenCalledWith(2_500_000);
    h.dispose();
  });

  it('removes both listeners and the interval on dispose', () => {
    const h = harness();
    h.dispose();
    expect(h.focusListeners.size).toBe(0);
    expect(h.visibilityListeners.size).toBe(0);
    expect(h.clearedHandle).toBe(7);
    h.fireFocus();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

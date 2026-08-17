/**
 * Unit tests for the live settings snapshot helper (默认模型兜底 follow-up).
 *
 * dsh-settings' installSettingsSection calls `setSource` exactly once with a
 * source thunk and fires `onChange` on every settings change. The plugin's
 * previous wiring captured the value in setSource and left onChange empty, so
 * settings edits (settings.yaml hot reload / settings UI) were only visible
 * after restart. createSettingsSnapshot keeps the source thunk so onChange can
 * re-read it, making the plugin's defaults live.
 */
import { describe, it, expect } from 'vitest';
import { createSettingsSnapshot } from '../src/settings.js';

describe('createSettingsSnapshot', () => {
  it('captures the initial value from setSource', () => {
    const snap = createSettingsSnapshot<{ model?: string }>({});
    snap.hooks.setSource(() => ({ model: 'mimo-v2.5' }));
    expect(snap.get()).toEqual({ model: 'mimo-v2.5' });
  });

  it('onChange refreshes the snapshot from the live source', () => {
    const snap = createSettingsSnapshot<{ model?: string }>({});
    let current = { model: 'mimo-v2.5' };
    snap.hooks.setSource(() => current);
    current = { model: 'hy3' };
    // 来源已变化但 onChange 尚未触发：快照仍是旧值
    expect(snap.get()).toEqual({ model: 'mimo-v2.5' });
    snap.hooks.onChange();
    expect(snap.get()).toEqual({ model: 'hy3' });
  });

  it('onChange without a source leaves the initial value', () => {
    const snap = createSettingsSnapshot<{ model?: string }>({ model: 'x' });
    snap.hooks.onChange();
    expect(snap.get()).toEqual({ model: 'x' });
  });
});

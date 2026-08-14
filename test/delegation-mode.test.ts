/**
 * Unit tests for the delegation background-mode decision and result renderer
 * (M3a / FR-5.3 continuable support). These are the pure logic pieces extracted
 * from delegation-tool execute so the mode policy is testable without a live
 * DSH context:
 *   - resolveDelegationMode mirrors dsh-tool-subagent's resolveDelegationRun
 *     (background defaults to the configured mode's policy) and also classifies
 *     the execution route (foreground | one-shot | continuable);
 *   - renderDelegationResult mirrors dsh-tool-subagent's output.render text for
 *     the three result shapes (continuable renders the durable child id).
 */
import { describe, it, expect } from 'vitest';
import { resolveDelegationMode, renderDelegationResult } from '../src/delegation-tool.js';

describe('resolveDelegationMode', () => {
  it('one-shot mode defaults to foreground when run_in_background is unset', () => {
    expect(resolveDelegationMode({}, { backgroundEnabled: true, continuable: false })).toEqual({
      runInBackground: false,
      route: 'foreground',
    });
  });

  it('one-shot mode selects the one-shot (Task) background route when run_in_background is true', () => {
    expect(resolveDelegationMode({ run_in_background: true }, { backgroundEnabled: true, continuable: false })).toEqual({
      runInBackground: true,
      route: 'one-shot',
    });
  });

  it('continuable mode defaults to background and selects the continuable route when run_in_background is unset', () => {
    expect(resolveDelegationMode({}, { backgroundEnabled: true, continuable: true })).toEqual({
      runInBackground: true,
      route: 'continuable',
    });
  });

  it('continuable mode respects an explicit run_in_background: false and returns foreground', () => {
    expect(resolveDelegationMode({ run_in_background: false }, { backgroundEnabled: true, continuable: true })).toEqual({
      runInBackground: false,
      route: 'foreground',
    });
  });

  it('rejects a forced background when the flag is disabled', () => {
    expect(() =>
      resolveDelegationMode({ run_in_background: true }, { backgroundEnabled: false, continuable: false }),
    ).toThrow(/run_in_background is disabled/);
  });

  it('returns foreground when the flag is disabled and background was not requested', () => {
    expect(resolveDelegationMode({}, { backgroundEnabled: false, continuable: false })).toEqual({
      runInBackground: false,
      route: 'foreground',
    });
  });
});

describe('renderDelegationResult', () => {
  it('renders a continuable result as "started subagent <id>"', () => {
    expect(renderDelegationResult({ kind: 'continuable', subagentId: 'child-42' }, 'subagent_role')).toBe(
      'started subagent child-42',
    );
  });

  it('renders a one-shot task as "started background <toolName> task <jobId>"', () => {
    expect(renderDelegationResult({ kind: 'background', jobId: 'job-7' }, 'subagent_role')).toBe(
      'started background subagent_role task job-7',
    );
  });

  it('renders a foreground result by joining its text blocks', () => {
    const value = { kind: 'foreground' as const, runId: 'run-1', output: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] };
    expect(renderDelegationResult(value, 'subagent_role')).toBe('hello world');
  });

  it('foreground rendering ignores non-text blocks', () => {
    const value = { kind: 'foreground' as const, runId: 'run-2', output: [{ type: 'tool_use', name: 'x' }, { type: 'text', text: 'only-text' }] };
    expect(renderDelegationResult(value, 'subagent_role')).toBe('only-text');
  });
});

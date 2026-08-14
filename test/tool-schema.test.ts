/**
 * Unit tests for the subagent_role delegation tool schema (design section 11
 * test-plan row: "工具 schema 形状断言").
 * 
 * Asserts the pure schema builders that define the model-visible tool shape:
 * description/prompt required, role/provider/model/reasoningEffort optional,
 * run_in_background appearing mut only while enableRunInBackground is true,
 * and the output being exactly-one-of background/foreground.
 */
import { describe, it, expect } from 'vitest';
import {
  createDelegationParameters,
  createDelegationOutputSchema,
} from '../src/delegation-tool.js';

describe('createDelegationParameters', () => {
  it('requires description and prompt', () => {
    const schema = createDelegationParameters({ enableRunInBackground: true });
    expect(schema.description).toMatchObject({ type: 'string', required: true });
    expect(schema.prompt).toMatchObject({ type: 'string', required: true });
  });

  it('exposes role/provider/model/reasoningEffort as optional (no required)', () => {
    const schema = createDelegationParameters({ enableRunInBackground: true });
    for (const key of ['role', 'provider', 'model', 'reasoningEffort']) {
      expect(schema[key]).toBeDefined();
      expect(schema[key]).toMatchObject({ type: 'string' });
      expect((schema[key] as { required?: true }).required).toBeUndefined();
    }
  });

  it('includes run_in_background when enableRunInBackground is true (default)', () => {
    const on = createDelegationParameters({});
    const explicit = createDelegationParameters({ enableRunInBackground: true });
    expect(on.run_in_background).toEqual({ type: 'boolean' });
    expect(explicit.run_in_background).toEqual({ type: 'boolean' });
  });

  it('omits run_in_background when enableRunInBackground is false', () => {
    const off = createDelegationParameters({ enableRunInBackground: false });
    expect(off.run_in_background).toBeUndefined();
  });
});

describe('createDelegationOutputSchema', () => {
  it('is a oneOf of exactly background and foreground object roots', () => {
    const schema = createDelegationOutputSchema();
    const branches = (schema as { oneOf: unknown[] }).oneOf;
    expect(branches).toHaveLength(2);

    const kinds = branches.map((b) => (b as { properties?: { kind?: { const?: string } } }).properties?.kind?.const);
    expect(kinds).toContain('background');
    expect(kinds).toContain('foreground');
  });

  it('background branch carries a required jobId', () => {
    const schema = createDelegationOutputSchema();
    const bg = (schema as { oneOf: { properties?: Record<string, unknown>; additionalProperties?: boolean }[] }).oneOf.find(
      (b) => (b.properties?.kind as { const?: string } | undefined)?.const === 'background',
    );
    expect(bg).toBeDefined();
    expect(bg?.additionalProperties).toBe(false);
    expect((bg?.properties?.jobId as { required?: true } | undefined)?.required).toBe(true);
  });

  it('foreground branch carries required runId and output array', () => {
    const schema = createDelegationOutputSchema();
    const fg = (schema as { oneOf: { properties?: Record<string, unknown>; additionalProperties?: boolean }[] }).oneOf.find(
      (b) => (b.properties?.kind as { const?: string } | undefined)?.const === 'foreground',
    );
    expect(fg).toBeDefined();
    expect(fg?.additionalProperties).toBe(false);
    expect((fg?.properties?.runId as { required?: true } | undefined)?.required).toBe(true);
    const output = fg?.properties?.output as { type?: string; required?: true; items?: { type?: string } } | undefined;
    expect(output?.type).toBe('array');
    expect(output?.required).toBe(true);
    expect(output?.items).toEqual({ type: 'json' });
  });
});

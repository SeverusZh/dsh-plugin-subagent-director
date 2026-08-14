/**
 * Unit tests for the M3b observability pure logic (src/client/subagent-model.ts).
 *
 * Covers the two pure surfaces that drive the composer.dock readout:
 *   - latestSubagentModel(snapshot): walks the opened transcript's node list
 *     from the tail and returns the last assistant message that proves a
 *     provider/model identity (provenance first, then requestConfig), or
 *     { found: false } when no assistant message records one;
 *   - formatModelRef(ref): the compact provider/model label rendered by the
 *     dock / readout; plus the provenance-preference rules inside provenanceOf.
 *
 * The "有模型 / 无模型 的降级文案" behaviour is exercised through the pure
 * guards the dock relies on: a found ref feeds the formatted label, while a
 * not-found lookup is exactly the condition that surfaces the degradation
 * notice (modelNotRecorded). We assert those pure values here without a React
 * render.
 */
import { describe, it, expect } from 'vitest';
import {
  formatModelRef,
  isAddressedSubagent,
  latestSubagentModel,
  provenanceOf,
  type ConversationNode,
} from '../src/client/subagent-model.js';

/** A minimal assistant node that records provenance. */
function assistant(overrides: Record<string, unknown> = {}): ConversationNode {
  return {
    kind: 'assistant',
    ...(overrides as object),
  } as unknown as ConversationNode;
}

/** A source (user/request) node so the walker skips non-assistant nodes. */
function sourceNode(): ConversationNode {
  return { kind: 'user' } as unknown as ConversationNode;
}

function snapshot(nodes: ConversationNode[]): { nodes: ConversationNode[] } {
  return { nodes };
}

describe('latestSubagentModel', () => {
  it('returns the reported provenance of the latest assistant message', () => {
    const result = latestSubagentModel(
      snapshot([
        assistant({ provenance: { provider: 'deepseek', model: 'older-v1' } }),
        assistant({ provenance: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }),
      ]),
    );
    expect(result).toEqual({ found: true, provider: 'opencode-go', model: 'deepseek-v4-flash' });
  });

  it('returns not-found when no assistant message records a provenance or config', () => {
    const result = latestSubagentModel(
      snapshot([assistant(), assistant({ provenance: null, requestConfig: null })]),
    );
    expect(result).toEqual({ found: false });
  });

  it('prefers the latest of several recorded assistant messages (tail wins)', () => {
    const result = latestSubagentModel(
      snapshot([
        assistant({ provenance: { provider: 'a', model: 'm1' } }),
        sourceNode(),
        assistant({ provenance: { provider: 'b', model: 'm2' } }),
      ]),
    );
    expect(result).toEqual({ found: true, provider: 'b', model: 'm2' });
  });

  it('prefers provenance over requestConfig on the same assistant message', () => {
    const result = latestSubagentModel(
      snapshot([
        assistant({
          provenance: { provider: 'reported-p', model: 'reported-m' },
          requestConfig: { provider: 'requested-p', model: 'requested-m' },
        }),
      ]),
    );
    expect(result).toEqual({ found: true, provider: 'reported-p', model: 'reported-m' });
  });

  it('falls back to requestConfig when provenance is absent', () => {
    const result = latestSubagentModel(
      snapshot([
        assistant({
          requestConfig: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
        }),
      ]),
    );
    expect(result).toEqual({ found: true, provider: 'opencode-go', model: 'deepseek-v4-flash' });
  });

  it('returns not-found for an empty nodes array', () => {
    expect(latestSubagentModel(snapshot([]))).toEqual({ found: false });
  });

  it('returns not-found for a malformed or non-object snapshot', () => {
    expect(latestSubagentModel(null as unknown as { nodes: ConversationNode[] })).toEqual({ found: false });
    expect(latestSubagentModel(undefined as unknown as { nodes: ConversationNode[] })).toEqual({ found: false });
    expect(latestSubagentModel({} as { nodes: ConversationNode[] })).toEqual({ found: false });
  });

  it('skips non-assistant and guard-invalid nodes while walking to the tail', () => {
    const result = latestSubagentModel(
      snapshot([
        assistant({ provenance: { provider: 'early', model: 'model-x' } }),
        sourceNode(),
        { kind: 'unknown' } as unknown as ConversationNode,
        assistant({}),
      ]),
    );
    // only the assistant with provenance is considered; the last assistant (empty) is skipped
    expect(result).toEqual({ found: true, provider: 'early', model: 'model-x' });
  });
});

describe('provenanceOf', () => {
  it('accepts a provenance with provider and model', () => {
    const ref = provenanceOf(assistant({ provenance: { provider: 'p', model: 'm' } }));
    expect(ref).toEqual({ found: true, provider: 'p', model: 'm' });
  });

  it('rejects a provenance with empty provider or model and falls to requestConfig', () => {
    const fromRequest = provenanceOf(
      assistant({
        provenance: { provider: '', model: 'm' },
        requestConfig: { provider: 'rp', model: 'rm' },
      }),
    );
    expect(fromRequest).toEqual({ found: true, provider: 'rp', model: 'rm' });
  });

  it('returns null when neither provenance nor requestConfig records a model', () => {
    expect(provenanceOf(assistant({}))).toBeNull();
    expect(provenanceOf(assistant({ provenance: null, requestConfig: null }))).toBeNull();
  });
});

describe('formatModelRef (有模型 的格式化读out)', () => {
  it('renders a compact provider/model label', () => {
    expect(formatModelRef({ found: true, provider: 'opencode-go', model: 'deepseek-v4-flash' })).toBe(
      'opencode-go/deepseek-v4-flash',
    );
  });

  it('keeps a model id that already carries a provider prefix unquoted', () => {
    expect(formatModelRef({ found: true, provider: 'openai', model: 'openai/gpt-5' })).toBe(
      'openai/openai/gpt-5',
    );
  });
});

describe('isAddressedSubagent (哪个表面才渲染读数)', () => {
  it('is true for a snapshot carrying a subagent address', () => {
    expect(isAddressedSubagent({ subagent: { id: 'child-1' } } as never)).toBe(true);
  });

  it('is false for an ordinary session (no subagent address)', () => {
    expect(isAddressedSubagent({ subagent: null } as never)).toBe(false);
    expect(isAddressedSubagent({} as never)).toBe(false);
    expect(isAddressedSubagent(null)).toBe(false);
    expect(isAddressedSubagent(undefined)).toBe(false);
  });

  it('drives the degradation decision: not-addressed surfaces no readout', () => {
    // Ordinary sessions must not render even when nodes carry provenance.
    const ordinary = { subagent: undefined, nodes: [assistant({ provenance: { provider: 'p', model: 'm' } })] };
    expect(isAddressedSubagent(ordinary as never)).toBe(false);
    // An addressed subagent whose transcript proves no model yields not-found,
    // which is exactly the "尚无模型" degradation path in the dock.
    const addressedEmpty = { subagent: { id: 'child-2' }, nodes: [assistant({})] };
    expect(isAddressedSubagent(addressedEmpty as never)).toBe(true);
    expect(latestSubagentModel(addressedEmpty as never)).toEqual({ found: false });
  });
});

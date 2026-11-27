import { describe, it, expect } from 'vitest';
import { applyCardPromptSection, CARD_PROMPT_SECTION_NAME, CARD_PROMPT_SECTION_ORDER } from '../src/card-prompt.js';

function fakeContext() {
  const sections: Array<{ name: string; order: number; text: string | ((context: { session?: { id: string } }) => string) }> = [];
  return {
    sections,
    ctx: {
      get: (name: string) =>
        name === 'systemPrompt'
          ? {
              section: (definition: { name: string; order: number; text: string | ((context: { session?: { id: string } }) => string) }) => {
                sections.push(definition);
                return () => {};
              },
            }
          : undefined,
    } as never,
  };
}

describe('card prompt section', () => {
  it('registers one section with the card order and renders only the bound child', () => {
    const fake = fakeContext();
    const dispose = applyCardPromptSection(fake.ctx, (sessionId) => (sessionId === 'child-1' ? 'CARD PROMPT' : ''));
    expect(typeof dispose).toBe('function');
    expect(fake.sections).toHaveLength(1);
    expect(fake.sections[0]?.name).toBe(CARD_PROMPT_SECTION_NAME);
    expect(fake.sections[0]?.order).toBe(CARD_PROMPT_SECTION_ORDER);
    const text = fake.sections[0]!.text as (context: { session?: { id: string } }) => string;
    expect(text({ session: { id: 'child-1' } })).toBe('CARD PROMPT');
    expect(text({ session: { id: 'parent' } })).toBe('');
    expect(text({})).toBe('');
  });

  it('degrades to no registration when the prompt service is absent', () => {
    const ctx = { get: () => undefined, inject: () => {} } as never;
    expect(applyCardPromptSection(ctx, () => 'x')).toBeUndefined();
  });
});

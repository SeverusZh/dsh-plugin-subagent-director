import { describe, it, expect } from 'vitest';
import { createCardCreateTool } from '../src/card-tool.js';
import { CardService } from '../src/card-store.js';
import { createCardService } from './card-fixtures.js';

describe('subagent_card_create tool', () => {
  it('creates a card with both guidance sections and a worker preset', async () => {
    const created = createCardService();
    await created.service.ready();
    const tool = createCardCreateTool({ cards: created.service });
    const result = await (tool as { execute: (args: unknown) => Promise<unknown> }).execute({
      name: 'Security Reviewer',
      delegation_guidance: 'Use when a change touches auth.',
      avoid_guidance: 'Do not use for UI copy edits.',
      system_prompt: 'You review security-sensitive changes.',
    });
    expect(result).toEqual({ cardId: 'security-reviewer', name: 'Security Reviewer' });
    expect((tool as unknown as { description: string }).description).not.toContain('unpin');
    const stored = created.service.get('security-reviewer');
    expect(stored?.avoidGuidance).toBe('Do not use for UI copy edits.');
    expect(stored?.agentPreset).toBe('standard');
    expect(stored?.systemPrompt).toContain('security-sensitive');
    expect(created.service.cardUsage('security-reviewer')?.uses).toBe(1);
  });

  it('never derives the reserved built-in id', async () => {
    const created = createCardService();
    await created.service.ready();
    const tool = createCardCreateTool({ cards: created.service });
    const result = await (tool as { execute: (args: unknown) => Promise<unknown> }).execute({
      name: 'Director',
      delegation_guidance: 'Coordinate.',
      system_prompt: 'Coordinate the work.',
    });
    expect((result as { cardId: string }).cardId).not.toBe('director');
  });

  it('honours a configured delegation tool name and worker preset', async () => {
    const created = createCardService();
    await created.service.ready();
    const tool = createCardCreateTool({ cards: created.service, toolName: 'delegate', workerPreset: 'ptc' });
    const result = await (tool as { execute: (args: unknown) => Promise<unknown> }).execute({
      name: 'Code Worker',
      delegation_guidance: 'Use for code.',
      system_prompt: 'Write code.',
    });
    expect(created.service.get((result as { cardId: string }).cardId)?.agentPreset).toBe('ptc');
    expect(
      (tool as unknown as { output: { render: (args: unknown, value: { cardId: string; name: string }) => Array<{ text: string }> } }).output.render(
        {},
        { cardId: 'code-worker', name: 'Code Worker' },
      )[0]?.text,
    ).toContain('delegate');
  });

  it('fails honestly when card storage is unavailable', async () => {
    const offline = new CardService({
      ctx: { logger: { info: () => {}, warn: () => {}, debug: () => {} } } as never,
      getSettings: () => ({}),
    });
    await offline.ready();
    const tool = createCardCreateTool({ cards: offline });
    await expect(
      (tool as { execute: (args: unknown) => Promise<unknown> }).execute({
        name: 'X',
        delegation_guidance: 'Y',
        system_prompt: 'Z',
      }),
    ).rejects.toThrow(/storage is unavailable/);
  });
});
describe('card creation usage statistics', () => {
  it('still creates the card when the usage write fails', async () => {
    const created = createCardService();
    created.memory.failTablePuts.set('usage', new Set(['security-reviewer']));
    await created.service.ready();
    const tool = createCardCreateTool({ cards: created.service });
    const result = await (tool as { execute: (args: unknown) => Promise<unknown> }).execute({
      name: 'Security Reviewer',
      delegation_guidance: 'Use when auth changes.',
      system_prompt: 'Review security.',
    });
    expect(result).toEqual({ cardId: 'security-reviewer', name: 'Security Reviewer' });
    expect(created.service.get('security-reviewer')).toBeDefined();
    expect(created.service.cardUsage('security-reviewer')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  CARD_BUNDLE_KIND,
  CARD_FORMAT_VERSION,
  CARD_IMPORT_ISSUE_CODES,
  CARD_KIND,
  CARD_LIMITS,
  cardIdFromName,
  parseTagInput,
  renderCardPrompt,
} from '../src/card-types.js';
import {
  buildCardBundle,
  cardToRoleTemplate,
  legacyRoleToCard,
  parseCardDraft,
  parseCardImportPayload,
  parseImportedCard,
  validateImportedCard,
} from '../src/card-model.js';

const baseCard = {
  name: 'Code Reviewer',
  delegationGuidance: 'Review a diff for correctness and regressions.',
  systemPrompt: 'You are a terse code reviewer.',
  persona: 'Direct and evidence-driven.',
  model: { provider: 'p', model: 'm', reasoningEffort: 'high' },
  tags: ['review', 'code'],
};

describe('card ids and tag input', () => {
  it('derives unique kebab-case ids and suffixes collisions', () => {
    expect(cardIdFromName('Code Reviewer', new Set())).toBe('code-reviewer');
    expect(cardIdFromName('Code Reviewer', new Set(['code-reviewer']))).toBe('code-reviewer-2');
    expect(cardIdFromName('  ', new Set())).toBe('card');
  });

  it('parses comma separated tags with bounds and de-duplication', () => {
    expect(parseTagInput('a, b，a\n c')).toEqual(['a', 'b', 'c']);
    expect(parseTagInput('x'.repeat(80))[0]).toHaveLength(32);
  });
});

describe('portable card envelope', () => {
  it('unwraps a collection, a single-card envelope, a bare card, and an array', () => {
    expect(parseCardImportPayload({ kind: CARD_BUNDLE_KIND, version: 1, cards: [baseCard, baseCard] }).cards).toHaveLength(2);
    expect(parseCardImportPayload({ kind: CARD_KIND, version: 1, card: baseCard }).cards).toHaveLength(1);
    expect(parseCardImportPayload(baseCard).cards).toHaveLength(1);
    expect(parseCardImportPayload([baseCard, { kind: CARD_KIND, card: baseCard }]).cards).toHaveLength(2);
  });

  it('rejects a future collection format version', () => {
    const parsed = parseCardImportPayload({ kind: CARD_BUNDLE_KIND, version: 99, cards: [baseCard] });
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.issues[0]?.message).toContain('Unsupported card format version');
  });

  it('rejects non-object entries with indexed issues', () => {
    const parsed = parseCardImportPayload([baseCard, 42]);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.issues[0]?.index).toBe(1);
  });

  it('parses and compacts one imported card', () => {
    const parsed = parseImportedCard({ ...baseCard, id: 'code-reviewer', systemPrompt: '  ' }, new Set());
    expect(parsed.issue).toBeUndefined();
    expect(parsed.card?.id).toBe('code-reviewer');
    expect(parsed.card?.systemPrompt).toBeUndefined();
    expect(parsed.card?.enabled).toBe(true);
    expect(parsed.card?.source).toBe('import');
  });

  it('derives an id when the imported card has none', () => {
    const parsed = parseImportedCard(baseCard, new Set());
    expect(parsed.card?.id).toBe('code-reviewer');
  });

  it('rejects a missing name or guidance and reports the field', () => {
    const parsed = parseImportedCard({ ...baseCard, name: '  ' }, new Set());
    expect(parsed.issue).toContain('name');
  });

  it('parses, compacts, and exports the not-recommended guidance', () => {
    const parsed = parseImportedCard(
      { ...baseCard, id: 'code-reviewer', avoidGuidance: '  Do not review design docs.  ' },
      new Set(),
    );
    expect(parsed.card?.avoidGuidance).toBe('Do not review design docs.');
    expect(buildCardBundle([parsed.card!]).cards[0]?.avoidGuidance).toBe('Do not review design docs.');
    expect(parseImportedCard({ ...baseCard, id: 'blank', avoidGuidance: '   ' }, new Set()).card?.avoidGuidance).toBeUndefined();
  });

  it('reserves the built-in card id and source for code-defined cards', () => {
    expect(parseImportedCard({ ...baseCard, id: 'director' }, new Set()).issue).toContain('reserved');
    expect(parseImportedCard({ ...baseCard, id: 'other', source: 'builtin' }, new Set()).issue).toContain('reserved');
  });

  it('round-trips the optional neverClose pin through parse and export', () => {
    const parsed = parseImportedCard({ ...baseCard, id: 'pinned', neverClose: true }, new Set());
    expect(parsed.card?.neverClose).toBe(true);
    expect(buildCardBundle([parsed.card!]).cards[0]?.neverClose).toBe(true);

    const draft = parseCardDraft({ name: 'Unpinned', description: 'Guide.' }, new Set());
    expect(draft.card?.neverClose).toBeUndefined();
  });

  it('accepts a settings draft with a tag string and a description alias', () => {
    const parsed = parseCardDraft(
      {
        name: 'Reviewer',
        description: 'Review work.',
        tags: 'a, b',
        model: { provider: 'p', model: 'm' },
      },
      new Set(),
    );
    expect(parsed.card?.delegationGuidance).toBe('Review work.');
    expect(parsed.card?.tags).toEqual(['a', 'b']);
  });
});

describe('card projection and migration', () => {
  it('projects a card to the resolver role shape without leaking prompts', () => {
    const parsed = parseImportedCard({ ...baseCard, id: 'code-reviewer' }, new Set());
    const role = cardToRoleTemplate(parsed.card!);
    expect(role.displayName).toBe('Code Reviewer');
    expect(role.description).toBe(baseCard.delegationGuidance);
    expect(role.provider).toBe('p');
    expect(role.model).toBe('m');
    expect(role.reasoningEffort).toBe('high');
    expect(role).not.toHaveProperty('systemPrompt');
    expect(role).not.toHaveProperty('persona');
  });

  it('migrates a legacy role and preserves persona and tool-filter context', () => {
    const card = legacyRoleToCard(
      'legacy-role',
      {
        displayName: 'Legacy',
        description: 'Old guidance.',
        persona: 'Old persona.',
        provider: 'p',
        model: 'm',
        toolFilter: { allow: ['bash'] },
      },
      new Set(),
    );
    expect(card.id).toBe('legacy-role');
    expect(card.persona).toBe('Old persona.');
    expect(card.tags).toEqual(['legacy']);
    expect(card.notes).toContain('Legacy tool filter');
    expect(card.source).toBe('legacy');
  });

  it('builds a versioned collection envelope', () => {
    const parsed = parseImportedCard({ ...baseCard, id: 'code-reviewer' }, new Set());
    const bundle = buildCardBundle([parsed.card!], '2026-01-01T00:00:00.000Z');
    expect(bundle.kind).toBe(CARD_BUNDLE_KIND);
    expect(bundle.version).toBe(2);
    expect(bundle.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(bundle.cards).toHaveLength(1);
  });

  it('renders the fixed child prompt from the card text', () => {
    expect(renderCardPrompt({ name: 'X' })).toBe('');
    const text = renderCardPrompt({ name: 'X', systemPrompt: 'S', persona: 'P' });
    expect(text).toContain('Character card: X');
    expect(text).toContain('S');
    expect(text).toContain('Persona:\nP');
  });
});
describe('structured import issues', () => {
  it('codes non-object entries and envelope structure problems', () => {
    const nonObject = parseCardImportPayload([baseCard, 42]);
    expect(nonObject.issues[0]).toMatchObject({ index: 1, code: 'not-an-object' });
    expect(nonObject.issues[0]?.message).toContain('Expected a JSON object');

    const missingCards = parseCardImportPayload({ kind: CARD_BUNDLE_KIND, cards: 42 });
    expect(missingCards.issues[0]).toMatchObject({
      code: 'missing-cards-array',
      field: 'cards',
      path: ['cards'],
    });

    const missingCard = parseCardImportPayload({ kind: CARD_KIND, card: undefined });
    expect(missingCard.issues[0]).toMatchObject({
      code: 'missing-card-object',
      field: 'card',
      path: ['card'],
    });
  });

  it('codes an unsupported format version with interpolation params', () => {
    const parsed = parseCardImportPayload({ kind: CARD_BUNDLE_KIND, version: 99, cards: [baseCard] });
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.issues[0]).toMatchObject({
      code: 'unsupported-format-version',
      field: 'version',
      path: ['version'],
      params: { version: 99, maxVersion: CARD_FORMAT_VERSION },
    });
    expect(parsed.issues[0]?.message).toContain('Unsupported card format version');
  });

  it('codes too many cards with count and max params', () => {
    const many = Array.from({ length: CARD_LIMITS.importCards + 1 }, () => ({ ...baseCard }));
    const parsed = parseCardImportPayload(many);
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.issues[0]).toMatchObject({
      code: 'too-many-cards',
      field: 'cards',
      path: ['cards'],
      params: { count: CARD_LIMITS.importCards + 1, max: CARD_LIMITS.importCards },
    });
    expect(parsed.issues[0]?.message).toContain('Too many cards');
  });

  it('codes field validation failures with field, path, and a reason', () => {
    const missingName = validateImportedCard({ ...baseCard, name: '  ' }, new Set());
    expect(missingName.card).toBeUndefined();
    expect(missingName.issues[0]).toMatchObject({
      code: 'invalid-field',
      field: 'name',
      path: ['name'],
      params: { reason: expect.any(String) },
    });
    expect(missingName.issues[0]?.message).toContain('name');

    const wrongType = validateImportedCard({ ...baseCard, enabled: 'yes' }, new Set());
    expect(wrongType.issues[0]).toMatchObject({ code: 'invalid-field', field: 'enabled', path: ['enabled'] });

    const nested = validateImportedCard({ ...baseCard, model: { model: 42 } }, new Set());
    expect(nested.issues[0]).toMatchObject({ code: 'invalid-field', field: 'model', path: ['model', 'model'] });
  });

  it('reports every invalid field of one card as a separate issue', () => {
    const multiple = validateImportedCard({ id: 'broken' }, new Set());
    expect(multiple.card).toBeUndefined();
    expect(multiple.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ['invalid-field', 'name'],
      ['invalid-field', 'delegationGuidance'],
    ]);
    expect(multiple.issues.every((issue) => issue.id === 'broken')).toBe(true);
  });

  it('codes invalid and reserved ids plus the reserved source', () => {
    const invalidId = validateImportedCard({ ...baseCard, id: 'Bad ID!' }, new Set());
    expect(invalidId.issues[0]).toMatchObject({
      code: 'invalid-card-id',
      field: 'id',
      path: ['id'],
      id: 'Bad ID!',
      params: { id: 'Bad ID!' },
    });

    const reservedId = validateImportedCard({ ...baseCard, id: 'director' }, new Set());
    expect(reservedId.issues[0]).toMatchObject({
      code: 'reserved-card-id',
      field: 'id',
      path: ['id'],
      params: { id: 'director' },
    });
    expect(reservedId.issues[0]?.message).toContain('reserved');

    const reservedSource = validateImportedCard({ ...baseCard, id: 'other', source: 'builtin' }, new Set());
    expect(reservedSource.issues[0]).toMatchObject({
      code: 'reserved-card-source',
      field: 'source',
      path: ['source'],
      params: { source: 'builtin' },
    });
    expect(reservedSource.issues[0]?.message).toContain('reserved');
  });

  it('keeps the legacy single-message projection unchanged', () => {
    expect(parseImportedCard({ ...baseCard, name: '  ' }, new Set()).issue).toContain('name');
    expect(parseImportedCard({ ...baseCard, id: 'director' }, new Set()).issue).toContain('reserved');
  });

  it('publishes the stable code vocabulary, including reserved conflict codes', () => {
    expect(CARD_IMPORT_ISSUE_CODES).toEqual(
      expect.arrayContaining([
        'not-an-object',
        'unsupported-format-version',
        'missing-cards-array',
        'missing-card-object',
        'too-many-cards',
        'invalid-field',
        'invalid-card-id',
        'reserved-card-id',
        'reserved-card-source',
        'card-id-conflict',
        'card-name-conflict',
      ]),
    );
  });
});

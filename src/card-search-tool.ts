/**
 * Director-only card search and detail tools.
 *
 * The prompt no longer carries the whole library: it lists the highest-weight
 * active cards and points at these tools for the rest. subagent_card_search
 * finds cards by free text and tags (closed-pool cards on request) and returns
 * compact rows; subagent_card_get returns one card's full delegation
 * guidance and child prompt. Both are registered behind the Director preset
 * and are on the Director tool allowlist.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

import type { CardService } from './card-store.js';
import type { RankedCard } from './card-weight.js';
import { isCardEnabled, type CharacterCard } from './card-types.js';

/** Model-facing search tool name. */
export const CARD_SEARCH_TOOL_NAME = 'subagent_card_search';

/** Model-facing detail tool name. */
export const CARD_GET_TOOL_NAME = 'subagent_card_get';

/** Default result count when the model omits \`limit\`. */
export const CARD_SEARCH_DEFAULT_LIMIT = 8;

/** Hard result cap so one call cannot flood the context. */
export const CARD_SEARCH_MAX_LIMIT = 25;

/** Characters of \`delegationGuidance\` previewed per search row. */
export const CARD_SEARCH_PREVIEW_LIMIT = 160;

interface SearchRow {
  id: string;
  name: string;
  state: string;
  score: number;
  uses: number;
  lastUsed: string;
  tags: string;
  model: string;
  useWhen: string;
}

function modelLabel(card: CharacterCard): string {
  const provider = card.model?.provider;
  const model = card.model?.model;
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') return provider + '/' + model;
  if (provider !== undefined && provider !== '') return provider;
  return '';
}

function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function preview(text: string, limit: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
}

function normalizedTags(values: readonly string[] | undefined): string[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = value.trim().toLowerCase();
    if (tag.length > 0) seen.add(tag);
  }
  return [...seen];
}

function cardTagSet(card: CharacterCard): Set<string> {
  return new Set((card.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0));
}

function matchesQuery(card: CharacterCard, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [
    card.name,
    card.id,
    ...(card.tags ?? []),
    card.delegationGuidance,
    card.avoidGuidance ?? '',
    card.notes ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

function limitOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CARD_SEARCH_DEFAULT_LIMIT;
  return Math.min(CARD_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function searchRows(entries: readonly RankedCard[], limit: number): SearchRow[] {
  return entries.slice(0, limit).map((entry) => ({
    id: entry.card.id,
    name: entry.card.name,
    state: entry.state,
    score: round(entry.score, 2),
    uses: entry.uses,
    lastUsed: entry.lastUsedAt ?? '',
    tags: (entry.card.tags ?? []).join(','),
    model: modelLabel(entry.card),
    useWhen: preview(entry.card.delegationGuidance, CARD_SEARCH_PREVIEW_LIMIT),
  }));
}

function searchLines(rows: readonly SearchRow[]): string[] {
  return rows.flatMap((row) => [
    '- ' +
      row.name +
      ' [' +
      row.id +
      '] state=' +
      row.state +
      ' score=' +
      String(row.score) +
      ' uses=' +
      String(row.uses) +
      (row.lastUsed.length > 0 ? ' lastUsed=' + row.lastUsed : '') +
      (row.tags.length > 0 ? ' tags=' + row.tags : '') +
      (row.model.length > 0 ? ' model=' + row.model : ''),
    '    Use when: ' + row.useWhen,
  ]);
}

/**
 * Create the Director card search tool.
 * @param options.cards - host card library shared with the delegation tool.
 * @param options.now - instant source; tests inject a fixed clock.
 */
export function createCardSearchTool(options: { cards: CardService; now?: () => number }) {
  const { cards } = options;
  const now = options.now ?? (() => Date.now());
  return defineTool({
    name: CARD_SEARCH_TOOL_NAME,
    description:
      'Search the Director card library before delegating or creating a card. Matches query text case-insensitively against name, id, tags, delegation guidance, avoid guidance, and notes; every requested tag must match. Active and exempt cards come first, closed-pool cards last and only with includeClosed. Returns compact rows with id, name, state, score, use count, last use, tags, model, and the first ' +
      String(CARD_SEARCH_PREVIEW_LIMIT) +
      ' characters of the delegation guidance. After searching, read a candidate with ' +
      CARD_GET_TOOL_NAME +
      '; reuse or unpin an existing card before calling subagent_card_create.',
    parameters: {
      query: {
        type: 'string',
        description: 'Free-text search over the card name, id, tags, delegation guidance, avoid guidance, and notes. Case-insensitive.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags that must all be present on a card. Case-insensitive; combined with AND.',
      },
      includeClosed: {
        type: 'boolean',
        description: 'Include closed-pool cards after the active results. Defaults to false.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum results, 1 through ' + String(CARD_SEARCH_MAX_LIMIT) + '. Defaults to ' + String(CARD_SEARCH_DEFAULT_LIMIT) + '.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                state: { type: 'string', required: true },
                score: { type: 'number', required: true },
                uses: { type: 'integer', required: true },
                lastUsed: { type: 'string', required: true },
                tags: { type: 'string', required: true },
                model: { type: 'string', required: true },
                useWhen: { type: 'string', required: true },
              },
            },
          },
          matched: { type: 'integer', required: true },
          shown: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          closedPool: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const header =
          'subagent_card_search: ' +
          String(value.shown) +
          ' of ' +
          String(value.matched) +
          ' matched card(s) shown; library ' +
          String(value.total) +
          ' card(s), ' +
          String(value.closedPool) +
          ' in the closed pool.';
        const body =
          value.cards.length === 0
            ? ['No character card matched. Refine the query or create a card with subagent_card_create.']
            : searchLines(value.cards);
        const hint =
          value.closedPool > 0 && value.matched === value.shown
            ? ['Closed-pool cards were hidden; pass includeClosed: true to search them.']
            : [];
        return [{ type: 'text', text: [header, ...body, ...hint].join('\n') }];
      },
    },
    async execute(args) {
      await cards.ready();
      const state = cards.status();
      if (state.state !== 'ready') {
        throw new Error(
          'subagent-director: character card storage is ' + state.state + '; cannot search cards until it is available',
        );
      }
      const query = typeof args.query === 'string' ? args.query : '';
      const tags = normalizedTags(args.tags);
      const includeClosed = args.includeClosed === true;
      const limit = limitOf(args.limit);
      const ranked = cards.rankedCards({ includeBuiltIn: true, now: now() }).filter((entry) => isCardEnabled(entry.card));
      const closedPool = ranked.filter((entry) => entry.state === 'closed').length;
      const matched = ranked
        .filter((entry) => (includeClosed || entry.state !== 'closed') && matchesQuery(entry.card, query))
        .filter((entry) => {
          if (tags.length === 0) return true;
          const cardTags = cardTagSet(entry.card);
          return tags.every((tag) => cardTags.has(tag));
        })
        .sort((a, b) => {
          const aClosed = a.state === 'closed' ? 1 : 0;
          const bClosed = b.state === 'closed' ? 1 : 0;
          return (
            aClosed - bClosed ||
            b.score - a.score ||
            a.card.name.localeCompare(b.card.name) ||
            a.card.id.localeCompare(b.card.id)
          );
        });
      const shown = searchRows(matched, limit);
      return {
        cards: shown,
        matched: matched.length,
        shown: shown.length,
        total: ranked.length,
        closedPool,
      };
    },
  });
}

interface GetArguments {
  id: string;
}

/**
 * Create the Director card detail tool.
 * @param options.cards - host card library shared with the delegation tool.
 * @param options.now - instant source; tests inject a fixed clock.
 */
export function createCardGetTool(options: { cards: CardService; now?: () => number }) {
  const { cards } = options;
  const now = options.now ?? (() => Date.now());
  return defineTool({
    name: CARD_GET_TOOL_NAME,
    description:
      'Read one character card by id or exact display name. Returns the full delegation guidance, avoid guidance, child system prompt, persona, notes, tags, model route, Agent Preset, enabled and neverClose flags, plus its state, weight, use count, last use, and idle days. Use it after ' +
      CARD_SEARCH_TOOL_NAME +
      ' to read guidance that the prompt truncated, and before reusing, unpinning, or creating a card.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Card id (preferred) or exact display name.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          state: { type: 'string', required: true },
          enabled: { type: 'boolean', required: true },
          neverClose: { type: 'boolean', required: true },
          score: { type: 'number', required: true },
          uses: { type: 'integer', required: true },
          lastUsedAt: { type: 'string', required: true },
          idleDays: { type: 'number', required: true },
          delegationGuidance: { type: 'string', required: true },
          avoidGuidance: { type: 'string', required: true },
          systemPrompt: { type: 'string', required: true },
          persona: { type: 'string', required: true },
          notes: { type: 'string', required: true },
          tags: { type: 'string', required: true },
          model: { type: 'string', required: true },
          agentPreset: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const lines = [
          value.name + ' [' + value.id + '] state=' + value.state + ' score=' + String(value.score) + ' uses=' + String(value.uses),
          'enabled=' + String(value.enabled) + ' neverClose=' + String(value.neverClose) + (value.lastUsedAt.length > 0 ? ' lastUsed=' + value.lastUsedAt : ''),
          'Use when: ' + value.delegationGuidance,
        ];
        if (value.avoidGuidance.length > 0) lines.push('Do not use when: ' + value.avoidGuidance);
        if (value.systemPrompt.length > 0) lines.push('', 'System prompt:', value.systemPrompt);
        if (value.persona.length > 0) lines.push('', 'Persona:', value.persona);
        if (value.notes.length > 0) lines.push('', 'Notes:', value.notes);
        const meta = [
          value.tags.length > 0 ? 'tags: ' + value.tags : '',
          value.model.length > 0 ? 'model: ' + value.model : '',
          value.agentPreset.length > 0 ? 'agentPreset: ' + value.agentPreset : '',
          value.source.length > 0 ? 'source: ' + value.source : '',
        ].filter((part) => part.length > 0);
        if (meta.length > 0) lines.push('', meta.join('; '));
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args: GetArguments) {
      await cards.ready();
      const state = cards.status();
      if (state.state !== 'ready') {
        throw new Error(
          'subagent-director: character card storage is ' + state.state + '; cannot read cards until it is available',
        );
      }
      const key = args.id.trim();
      if (key.length === 0) throw new Error('subagent-director: subagent_card_get needs a card id or exact display name');
      const ranked = cards.rankedCards({ includeBuiltIn: true, now: now() });
      const entry = ranked.find((candidate) => candidate.card.id === key) ?? ranked.find((candidate) => candidate.card.name === key);
      if (entry === undefined) {
        throw new Error(
          'subagent-director: character card "' + key + '" was not found. Call ' + CARD_SEARCH_TOOL_NAME + ' to find an existing card, or subagent_card_create to create one.',
        );
      }
      const card = entry.card;
      return {
        id: card.id,
        name: card.name,
        state: entry.state,
        enabled: isCardEnabled(card),
        neverClose: card.neverClose === true,
        score: round(entry.score, 2),
        uses: entry.uses,
        lastUsedAt: entry.lastUsedAt ?? '',
        idleDays: round(entry.idleDays, 1),
        delegationGuidance: card.delegationGuidance,
        avoidGuidance: card.avoidGuidance ?? '',
        systemPrompt: card.systemPrompt ?? '',
        persona: card.persona ?? '',
        notes: card.notes ?? '',
        tags: (card.tags ?? []).join(','),
        model: modelLabel(card),
        agentPreset: card.agentPreset ?? '',
        source: card.source ?? '',
      };
    },
  });
}

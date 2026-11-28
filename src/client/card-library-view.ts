/**
 * Pure library projection for the settings page: usage state, filtering, and
 * ordering. Kept out of React so the rules are testable without a DOM, and so
 * the page and the Director prompt rank cards from the same weight module.
 */
import type { CardUsageSnapshot, CharacterCard } from '../card-types.js';
import { isCardEnabled } from '../card-types.js';
import { rankCards, type CardUsageState } from '../card-weight.js';

/** Library filters offered by the page toolbar. */
export const CARD_FILTERS = ['all', 'active', 'closed', 'disabled'] as const;

/** Library orderings offered by the page toolbar. */
export const CARD_SORTS = ['weight', 'recent', 'name'] as const;

/** One library filter token. */
export type CardFilter = (typeof CARD_FILTERS)[number];

/** One library ordering token. */
export type CardSort = (typeof CARD_SORTS)[number];

/** What the library shows for one card: usage state reduced to the page vocabulary. */
export type CardVisibleState = 'active' | 'closed' | 'disabled';

/** One scored library row ready for rendering. */
export interface CardLibraryRow {
  card: CharacterCard;
  score: number;
  uses: number;
  lastUsedAt?: string;
  /** Raw weight state, including the `exempt` case. */
  state: CardUsageState;
  /** State as the page labels it. */
  visibleState: CardVisibleState;
  idleDays: number;
}

/** Inputs of {@link cardLibraryRows}. */
export interface CardLibraryOptions {
  now: number | Date;
  usage: Readonly<Record<string, CardUsageSnapshot | undefined>>;
  defaultCardId?: string;
  filter?: CardFilter;
  sort?: CardSort;
  query?: string;
}

/** Collapse the weight state to the three labels the library shows. */
export function cardVisibleState(card: CharacterCard, state: CardUsageState): CardVisibleState {
  if (!isCardEnabled(card)) return 'disabled';
  return state === 'closed' ? 'closed' : 'active';
}

function matchesQuery(card: CharacterCard, needle: string): boolean {
  if (needle === '') return true;
  const haystack = [
    card.name,
    card.id,
    card.delegationGuidance,
    card.avoidGuidance ?? '',
    card.persona ?? '',
    card.notes ?? '',
    ...(card.tags ?? []),
  ].join('\n').toLowerCase();
  return haystack.includes(needle);
}

function lastUsedMs(row: CardLibraryRow): number {
  if (row.lastUsedAt === undefined) return -1;
  const parsed = Date.parse(row.lastUsedAt);
  return Number.isFinite(parsed) ? parsed : -1;
}

function byName(a: CardLibraryRow, b: CardLibraryRow): number {
  return a.card.name.localeCompare(b.card.name) || a.card.id.localeCompare(b.card.id);
}

/**
 * Score, filter, and order the library. Weight order comes straight from
 * {@link rankCards}; the recent and name orders are stable re-sorts of that
 * projection.
 */
export function cardLibraryRows(cards: readonly CharacterCard[], options: CardLibraryOptions): CardLibraryRow[] {
  const filter = options.filter ?? 'all';
  const sort = options.sort ?? 'weight';
  const needle = (options.query ?? '').trim().toLowerCase();
  const rows = rankCards(cards, {
    now: options.now,
    usage: options.usage,
    ...(options.defaultCardId !== undefined ? { defaultCardId: options.defaultCardId } : {}),
  })
    .map((entry): CardLibraryRow => ({
      card: entry.card,
      score: entry.score,
      uses: entry.uses,
      ...(entry.lastUsedAt !== undefined ? { lastUsedAt: entry.lastUsedAt } : {}),
      state: entry.state,
      visibleState: cardVisibleState(entry.card, entry.state),
      idleDays: entry.idleDays,
    }))
    .filter((row) => filter === 'all' || row.visibleState === filter)
    .filter((row) => matchesQuery(row.card, needle));
  if (sort === 'recent') {
    rows.sort((a, b) => {
      const delta = lastUsedMs(b) - lastUsedMs(a);
      return delta !== 0 ? delta : byName(a, b);
    });
  } else if (sort === 'name') {
    rows.sort(byName);
  }
  return rows;
}

/** Render an ISO timestamp for the usage line; invalid input renders nothing. */
export function formatUsageTime(iso: string): string | undefined {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

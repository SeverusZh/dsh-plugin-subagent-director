/**
 * Character-card weight and closed-pool classification.
 *
 * Pure module: no Host imports, no filesystem access, and no internal clock.
 * Every entry point takes the current instant from the caller, so guidance
 * rendering, the settings page, and the Director search tool all rank from the
 * same `now`. A card's weight grows logarithmically with successful
 * delegations and decays with idleness; idle cards fall out of the rendered
 * prompt into the closed pool until a recorded use or an explicit pin brings
 * them back. Explicit card ids always stay delegatable.
 */
import type { CharacterCard } from './card-types.js';
import { DIRECTOR_CARD_ID } from './director.js';

/** Multiplier on the log-scaled successful-use count. */
export const CARD_SCORE_USE_FACTOR = 1.6;

/** Idle days after which the recency term halves. */
export const CARD_SCORE_IDLE_HALF_LIFE_DAYS = 30;

/** Closed-pool threshold: any card idle this long is closed. */
export const CARD_CLOSED_IDLE_DAYS = 90;

/** Closed-pool threshold for a card used at most once. */
export const CARD_CLOSED_LOW_USE_IDLE_DAYS = 30;

/** Use count at or below which the short idle threshold applies. */
export const CARD_CLOSED_LOW_USE_MAX = 1;

/** Milliseconds in one day, used only for idle-age arithmetic. */
export const MS_PER_DAY = 86_400_000;

/** Three-state card lifecycle shown to the Director and the settings page. */
export type CardUsageState = 'exempt' | 'active' | 'closed';

/** Recorded usage counters for one card. */
export interface CardUsageCounters {
  uses: number;
  lastUsedAt?: string;
}

/** The facts needed to score and classify one card. */
export interface CardWeightFacts {
  card: CharacterCard;
  /** Recorded counters; absent means the card has never been used. */
  usage?: CardUsageCounters;
  /** Instant injected by the caller; never read from the system clock here. */
  now: number | Date;
  /** Whether this card is the stored default card. */
  isDefault?: boolean;
}

/** One scored card entry ordered for listing and prompt assembly. */
export interface RankedCard {
  card: CharacterCard;
  /** Weight; higher means more worth keeping in the prompt. */
  score: number;
  uses: number;
  lastUsedAt?: string;
  /** Days since the last use, falling back to creation time, clamped at 0. */
  idleDays: number;
  state: CardUsageState;
}

/** Inputs for {@link rankCards}. */
export interface RankCardsOptions {
  now: number | Date;
  usage?: Readonly<Record<string, CardUsageCounters | undefined>>;
  defaultCardId?: string;
}

function toEpochMs(value: number | Date): number {
  return typeof value === 'number' ? value : value.getTime();
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Normalize a recorded use count to a non-negative integer. */
export function normalizeUses(usage: CardUsageCounters | undefined): number {
  const uses = usage?.uses ?? 0;
  if (!Number.isFinite(uses) || uses <= 0) return 0;
  return Math.floor(uses);
}

/**
 * Idle days for one card. The baseline is the last recorded use, then the
 * card's creation time; a card with neither timestamp counts as just created,
 * so legacy cards without timestamps never drop straight into the pool.
 */
export function cardIdleDays(input: { card: CharacterCard; usage?: CardUsageCounters; now: number | Date }): number {
  const nowMs = toEpochMs(input.now);
  const baseline = parseTimestamp(input.usage?.lastUsedAt) ?? parseTimestamp(input.card.createdAt);
  if (baseline === undefined) return 0;
  const idle = (nowMs - baseline) / MS_PER_DAY;
  return Number.isFinite(idle) && idle > 0 ? idle : 0;
}

/** Weight of one card from its use count and idle age. */
export function cardScore(input: { uses: number; idleDays: number }): number {
  const uses = Number.isFinite(input.uses) && input.uses > 0 ? input.uses : 0;
  const idleDays = Number.isFinite(input.idleDays) && input.idleDays > 0 ? input.idleDays : 0;
  return (
    CARD_SCORE_USE_FACTOR * Math.log1p(uses) +
    Math.pow(0.5, idleDays / CARD_SCORE_IDLE_HALF_LIFE_DAYS)
  );
}

function isNonLocalSource(card: CharacterCard): boolean {
  return card.source !== undefined && card.source !== 'local';
}

/**
 * Whether a card is exempt from the closed pool. The built-in Director card,
 * the stored default card, `neverClose` pins, and every non-local card
 * (imported, migrated, or code-defined) stay listed regardless of idle time.
 */
export function isCardExempt(input: { card: CharacterCard; isDefault?: boolean }): boolean {
  if (input.card.id === DIRECTOR_CARD_ID || input.card.source === 'builtin') return true;
  if (input.isDefault === true) return true;
  if (input.card.neverClose === true) return true;
  return isNonLocalSource(input.card);
}

/**
 * Classify one card as exempt, active, or closed. Exemption wins over every
 * idle threshold; otherwise a card closes after 90 idle days, or after 30 idle
 * days when it has been used at most once.
 */
export function cardUsageState(facts: CardWeightFacts): CardUsageState {
  if (isCardExempt(facts)) return 'exempt';
  const idleDays = cardIdleDays(facts);
  if (idleDays >= CARD_CLOSED_IDLE_DAYS) return 'closed';
  if (normalizeUses(facts.usage) <= CARD_CLOSED_LOW_USE_MAX && idleDays >= CARD_CLOSED_LOW_USE_IDLE_DAYS) return 'closed';
  return 'active';
}

/** Score and classify one card. */
export function rankCard(facts: CardWeightFacts): RankedCard {
  const uses = normalizeUses(facts.usage);
  const idleDays = cardIdleDays(facts);
  const lastUsedAt = facts.usage?.lastUsedAt;
  return {
    card: facts.card,
    score: cardScore({ uses, idleDays }),
    uses,
    ...(lastUsedAt !== undefined && lastUsedAt.trim().length > 0 ? { lastUsedAt } : {}),
    idleDays,
    state: cardUsageState(facts),
  };
}

/**
 * Score and rank every card: weight descending, then name ascending, then id
 * ascending so equal weights keep a stable order. The returned states include
 * closed cards; callers decide whether to filter them.
 */
export function rankCards(cards: readonly CharacterCard[], options: RankCardsOptions): RankedCard[] {
  const ranked = cards.map((card) =>
    rankCard({
      card,
      now: options.now,
      ...(options.usage?.[card.id] !== undefined ? { usage: options.usage[card.id] } : {}),
      ...(options.defaultCardId === card.id ? { isDefault: true } : {}),
    }),
  );
  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.card.name.localeCompare(b.card.name) ||
      a.card.id.localeCompare(b.card.id),
  );
}

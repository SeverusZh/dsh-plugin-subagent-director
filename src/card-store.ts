/**
 * Character-card repository and active-prompt bindings.
 *
 * Cards live in their own DSH storage domain (`subagent-director`, per-record
 * JSON layout): one file per card under the Host's storage root, never in the
 * plugin's public configuration. The service owns the single open handle for
 * that domain and exposes a small async API to the Host delegation tool and to
 * the optional web bridge. The in-memory snapshot keeps the hot path (guidance,
 * route resolution, prompt assembly) synchronous.
 */
import type { Context } from '@deepseek-ai/cordis';
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

import {
  buildCardBundle,
  cardToRoleTemplate,
  CharacterCardSchema,
  emptyImportResult,
  legacyRoleToCard,
  parseCardDraft,
  parseCardImportPayload,
  parseImportedCard,
  type LegacyRole,
} from './card-model.js';
import {
  CARD_LIMITS,
  cardIdFromName,
  isCardEnabled,
  renderCardPrompt,
  type CardImportResult,
  type CardImportStrategy,
  type CardLibrarySnapshot,
  type CardMigrationResult,
  type CardPromptBinding,
  type CardStorageStatus,
  type CardUsageSnapshot,
  type CharacterCard,
  type CharacterCardBundle,
} from './card-types.js';
import { rankCards, type RankedCard } from './card-weight.js';
import type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';
import { BUILTIN_DIRECTOR_CARD } from './director-card.js';
import { DIRECTOR_CARD_ID } from './director.js';

/** Domain name shared by the storage record files and the open handle. */
export const CARD_DOMAIN_NAME = 'subagent_director';

/** Domain format version; bump only when the stored record shape changes. */
export const CARD_DOMAIN_VERSION = 1;

/** Binding records are disposable snapshots; keep the newest few hundred. */
const MAX_BINDINGS = 500;

/** One active child-session card binding as stored. */
export const CardBindingSchema = z.object({
  sessionId: z.string().trim().min(1).max(160),
  cardId: z.string().trim().min(1).max(CARD_LIMITS.idLength),
  cardName: z.string().trim().min(1).max(CARD_LIMITS.nameLength),
  systemPrompt: z.string().max(CARD_LIMITS.promptLength).optional(),
  persona: z.string().max(CARD_LIMITS.promptLength).optional(),
  parentSessionId: z.string().trim().max(160).optional(),
  continuable: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
});

/**
 * Successful-delegation counters for one card. Usage records live under their
 * own table so a statistics write never rewrites the card document itself.
 */
export const CardUsageRecordSchema = z.object({
  uses: z.number().int().nonnegative(),
  lastUsedAt: z.string().trim().min(1).max(80),
});

/** Inferred usage record shape stored under `usage/<cardId>.json`. */
export type CardUsageRecord = z.infer<typeof CardUsageRecordSchema>;

/** Global singleton stored alongside the card table. */
const CardGlobalSchema = z.object({
  defaultCardId: z.string().trim().max(CARD_LIMITS.idLength).optional(),
  migratedAt: z.string().trim().max(80).optional(),
});

/** Inferred global shape (kept explicit so the domain handle keeps its fields). */
type CardGlobal = z.infer<typeof CardGlobalSchema>;

/** The card domain declaration. `cards` are authoritative; `bindings` are runtime prompt snapshots. */
export const cardDomainSpec = defineDomain({
  name: CARD_DOMAIN_NAME,
  version: CARD_DOMAIN_VERSION,
  layout: 'per-record',
  global: {
    schema: CardGlobalSchema,
    initial: {} as CardGlobal,
  },
  tables: {
    cards: domainTable(CharacterCardSchema),
    usage: domainTable(CardUsageRecordSchema),
    // Bindings are a disposable cache of fixed-prompt snapshots. Storing them
    // as unknown lets one corrupt binding be skipped instead of failing the
    // whole card domain at open; the schema validates each record below.
    bindings: domainTable(z.unknown()),
  },
});

/** Minimal logger face used by the service (Cordis logger is structural). */
export interface CardLogger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

/** Construction options for {@link CardService}. */
export interface CardServiceOptions {
  readonly ctx: Context;
  readonly getSettings: () => SubagentDirectorSettings;
  readonly logger?: CardLogger;
}

/** A role-like lookup result for delegation and guidance. */
export interface ResolvedCard {
  card: CharacterCard;
  id: string;
  byDisplayName: boolean;
}

/** Visibility switch used by Director sessions. */
export interface CardVisibilityOptions {
  /** Include the code-defined built-in director card. */
  includeBuiltIn?: boolean;
  /** Merge legacy settings roles into the resolver view. Default true. */
  includeLegacyRoles?: boolean;
}

type CardDomain = Domain<typeof cardDomainSpec>;

/**
 * The shared card service. Construct once in the main plugin entry, provide it
 * as `ctx.subagentDirectorCards`, and let the optional bridge resolve it at
 * request time. Every write updates the in-memory snapshot before resolving.
 */
export class CardService {
  private readonly ctx: Context;
  private readonly getSettings: () => SubagentDirectorSettings;
  private readonly logger: CardLogger;
  private domain: CardDomain | undefined;
  private facility: DomainFacility | undefined;
  private initPromise: Promise<void> | undefined;
  private retryPromise: Promise<void> | undefined;
  private disposed = false;
  private storage: CardStorageStatus = { state: 'unavailable' };
  private defaultCardId: string | undefined;
  private readonly cards = new Map<string, CharacterCard>();
  private readonly usage = new Map<string, CardUsageRecord>();
  private usageChain: Promise<void> = Promise.resolve();
  private readonly bindings = new Map<string, CardPromptBinding>();
  private readonly listeners = new Set<() => void>();

  constructor(options: CardServiceOptions) {
    this.ctx = options.ctx;
    this.getSettings = options.getSettings;
    this.logger =
      options.logger ??
      ({
        info: () => {},
        warn: () => {},
        debug: () => {},
      } satisfies CardLogger);
  }

  /** Storage availability as exposed to the page. */
  status(): CardStorageStatus {
    return this.storage;
  }

  /** Subscribe to snapshot changes (the bridge/page may reload on push). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a listener must never break a write */
      }
    }
  }

  /**
   * Attach the storage facility. Called from a reactive Cordis injection, so a
   * Host that mounts storage after this plugin still gets a working library.
   */
  attachStorage(facility: DomainFacility): void {
    if (this.disposed) return;
    this.facility = facility;
    if (this.domain !== undefined || this.initPromise !== undefined) return;
    this.initPromise = this.openDomain(facility);
  }

  /** Mark storage unavailable when the reactive injection never resolves. */
  markUnavailable(message?: string): void {
    if (this.domain !== undefined) return;
    this.storage = { state: 'unavailable', ...(message !== undefined ? { message } : {}) };
  }

  private async openDomain(facility: DomainFacility): Promise<void> {
    if (this.disposed || this.domain !== undefined) return;
    try {
      const domain = await facility.open(cardDomainSpec);
      if (this.disposed) {
        await domain.close();
        return;
      }
      this.domain = domain;
      this.storage = { state: 'ready' };
      const global = domain.global.get();
      this.defaultCardId = global.defaultCardId;
      for (const [id, card] of domain.table('cards').entries()) {
        this.cards.set(id, card);
      }
      for (const [cardId, raw] of domain.table('usage').entries()) {
        const parsed = CardUsageRecordSchema.safeParse(raw);
        if (parsed.success) this.usage.set(cardId, parsed.data);
        else {
          this.logger.warn('[subagent-director] discarding invalid card usage record ' + cardId);
          void domain.table('usage').delete(cardId);
        }
      }
      if (this.cards.has(DIRECTOR_CARD_ID)) {
        const legacy = this.cards.get(DIRECTOR_CARD_ID)!;
        const nextId = cardIdFromName(
          (legacy.name || DIRECTOR_CARD_ID) + ' legacy',
          new Set([...this.cards.keys(), DIRECTOR_CARD_ID]),
        );
        const renamed: CharacterCard = {
          ...legacy,
          id: nextId,
          updatedAt: new Date().toISOString(),
        };
        const table = domain.table('cards');
        // Persist the replacement first: a failed write or a crash must never
        // remove the user's original card before its renamed copy is durable.
        await table.put(nextId, renamed);
        try {
          await table.delete(DIRECTOR_CARD_ID);
        } catch (error) {
          this.logger.warn(
            '[subagent-director] renamed reserved card but could not delete the old record: ' +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        this.cards.delete(DIRECTOR_CARD_ID);
        this.cards.set(nextId, renamed);
        if (this.defaultCardId === DIRECTOR_CARD_ID) {
          this.defaultCardId = nextId;
          try {
            await domain.global.set({ ...global, defaultCardId: nextId });
          } catch (error) {
            this.logger.warn(
              '[subagent-director] renamed the reserved default card but could not update the default record: ' +
                (error instanceof Error ? error.message : String(error)),
            );
          }
        }
        this.logger.warn(
          '[subagent-director] the stored card "' +
            DIRECTOR_CARD_ID +
            '" is reserved; renamed it to "' +
            nextId +
            '" so Director Mode can use the built-in card',
        );
      }
      for (const [sessionId, raw] of domain.table('bindings').entries()) {
        const parsed = CardBindingSchema.safeParse(raw);
        if (parsed.success) this.bindings.set(sessionId, parsed.data);
        else {
          this.logger.warn('[subagent-director] discarding invalid card prompt binding ' + sessionId);
          void domain.table('bindings').delete(sessionId);
        }
      }
      this.pruneBindings();
      this.logger.info(
        '[subagent-director] card library ready: ' + String(this.cards.size) + ' card(s), ' + String(this.bindings.size) + ' prompt binding(s)',
      );
      this.notify();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.storage = { state: 'error', message };
      this.logger.warn('[subagent-director] card storage could not be opened: ' + message);
    }
  }

  /** Retry a failed storage open after the page's retry action. */
  async retry(): Promise<void> {
    if (this.disposed || this.domain !== undefined || this.facility === undefined) return;
    if (this.retryPromise !== undefined) return this.retryPromise;
    const facility = this.facility;
    this.retryPromise = (async () => {
      if (this.initPromise !== undefined) await this.initPromise;
      if (this.domain !== undefined || this.disposed) return;
      this.initPromise = this.openDomain(facility);
      await this.initPromise;
    })().finally(() => {
      this.retryPromise = undefined;
    });
    return this.retryPromise;
  }

  /** Resolve once the first open attempt has settled. */
  async ready(): Promise<void> {
    if (this.initPromise !== undefined) await this.initPromise;
    if (this.domain === undefined && this.storage.state === 'unavailable' && this.initPromise === undefined) {
      // The reactive injection has not fired yet; let the caller proceed with
      // the unavailable snapshot instead of hanging a settings request.
      return;
    }
  }

  /** Close the domain (plugin unload). */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    const domain = this.domain;
    this.domain = undefined;
    if (domain !== undefined) await domain.close();
  }

  /** Stored cards, plus the built-in Director card on request, in display order. */
  list(options: CardVisibilityOptions = {}): CharacterCard[] {
    const cards = [...this.cards.values()];
    if (options.includeBuiltIn === true) {
      const stored = cards.findIndex((card) => card.id === DIRECTOR_CARD_ID);
      if (stored >= 0) cards.splice(stored, 1);
      if (isCardEnabled(BUILTIN_DIRECTOR_CARD)) cards.push(BUILTIN_DIRECTOR_CARD);
    }
    return cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Enabled cards only, in display order. */
  listEnabled(options: CardVisibilityOptions = {}): CharacterCard[] {
    return this.list(options).filter((card) => isCardEnabled(card));
  }

  /** One card by id. */
  get(id: string, options: CardVisibilityOptions = {}): CharacterCard | undefined {
    if (options.includeBuiltIn === true && id === DIRECTOR_CARD_ID && isCardEnabled(BUILTIN_DIRECTOR_CARD)) {
      return BUILTIN_DIRECTOR_CARD;
    }
    return this.cards.get(id);
  }

  /** The current default card id, when it still names an enabled card. */
  defaultId(): string | undefined {
    if (this.defaultCardId === undefined) return undefined;
    const card = this.cards.get(this.defaultCardId);
    return card !== undefined && isCardEnabled(card) ? card.id : undefined;
  }

  /** Legacy role ids still present in the live settings snapshot. */
  legacyRoles(): Record<string, LegacyRole> {
    return (this.getSettings().roles ?? {}) as Record<string, LegacyRole>;
  }

  /** Snapshot rendered by the settings page. */
  librarySnapshot(): CardLibrarySnapshot {
    const settings = this.getSettings();
    return {
      storage: this.storage,
      cards: this.list(),
      ...(this.defaultId() !== undefined ? { defaultCardId: this.defaultId() } : {}),
      usage: this.cardUsageMap(),
      legacyRoles: Object.keys(settings.roles ?? {}),
      ...(settings.defaultRole !== undefined ? { legacyDefaultRole: settings.defaultRole } : {}),
    };
  }

  /**
   * Project cards (and still-unmigrated legacy roles) onto the settings shape
   * the pure route resolver consumes. Cards take precedence on id collisions;
   * disabled cards are not offered. The default binding prefers the stored
   * default card, then the legacy `defaultRole`.
   */
  settingsWithCards(
    settings: SubagentDirectorSettings = this.getSettings(),
    options: CardVisibilityOptions = {},
  ): SubagentDirectorSettings {
    const cards = this.list(options);
    const cardIds = new Set(cards.map((card) => card.id));
    const roles: Record<string, RoleTemplate> = {};
    // Cards come first so a display-name lookup prefers a card over a stale
    // legacy role with the same name.
    for (const card of cards) {
      if (isCardEnabled(card)) roles[card.id] = cardToRoleTemplate(card);
    }
    if (options.includeLegacyRoles !== false) {
      for (const [id, role] of Object.entries(settings.roles ?? {})) {
        if (role === undefined || cardIds.has(id)) continue;
        roles[id] = role;
      }
    }
    const defaultCard = this.defaultId();
    return {
      ...settings,
      roles,
      ...(defaultCard !== undefined ? { defaultRole: defaultCard } : {}),
    };
  }

  /** Resolve a delegation role id (or display name) to an enabled card. */
  resolveCard(roleIdOrName: string | undefined, options: CardVisibilityOptions = {}): ResolvedCard | undefined {
    if (roleIdOrName === undefined || roleIdOrName === '') return undefined;
    const direct = this.get(roleIdOrName, options);
    if (direct !== undefined && isCardEnabled(direct)) {
      return { card: direct, id: direct.id, byDisplayName: false };
    }
    for (const card of this.list(options)) {
      if (isCardEnabled(card) && card.name === roleIdOrName) {
        return { card, id: card.id, byDisplayName: true };
      }
    }
    return undefined;
  }

  /** Recorded usage counters for one card, when it has been used at all. */
  cardUsage(cardId: string): CardUsageRecord | undefined {
    return this.usage.get(cardId);
  }

  /** Immutable copy of every recorded usage counter, keyed by card id. */
  cardUsageMap(): Record<string, CardUsageSnapshot> {
    const snapshot: Record<string, CardUsageSnapshot> = {};
    for (const [cardId, record] of this.usage) {
      snapshot[cardId] = { uses: record.uses, lastUsedAt: record.lastUsedAt };
    }
    return snapshot;
  }

  /**
   * Record one successful delegation for a card. Statistics are best-effort:
   * an unavailable or failing storage write is logged and skipped so the
   * delegation or card creation that triggered it never fails. Writes are
   * serialized so concurrent delegations cannot lose an increment.
   */
  async recordCardUse(cardId: string, at: string = new Date().toISOString()): Promise<CardUsageSnapshot | undefined> {
    if (this.domain === undefined || this.disposed) return undefined;
    if (!this.cards.has(cardId)) return undefined;
    const run = async (): Promise<CardUsageSnapshot | undefined> => {
      if (this.domain === undefined || this.disposed) return undefined;
      if (!this.cards.has(cardId)) return undefined;
      const current = this.usage.get(cardId);
      const next: CardUsageRecord = { uses: (current?.uses ?? 0) + 1, lastUsedAt: at };
      try {
        await this.domain.table('usage').put(cardId, next);
      } catch (error) {
        this.logger.warn(
          '[subagent-director] could not record card usage for "' +
            cardId +
            '": ' +
            (error instanceof Error ? error.message : String(error)),
        );
        return undefined;
      }
      this.usage.set(cardId, next);
      return { uses: next.uses, lastUsedAt: next.lastUsedAt };
    };
    const pending = this.usageChain.then(run, run);
    this.usageChain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  /**
   * Score and classify the current library. Ordering is weight descending then
   * name ascending; `list()` keeps its alphabetical display order.
   */
  rankedCards(options: { now?: number | Date; includeBuiltIn?: boolean } = {}): RankedCard[] {
    return rankCards(this.list({ includeBuiltIn: options.includeBuiltIn === true }), {
      now: options.now ?? Date.now(),
      usage: this.cardUsageMap(),
      ...(this.defaultCardId !== undefined ? { defaultCardId: this.defaultCardId } : {}),
    });
  }

  /**
   * Create or update one card. Creation requires an unused id (or derives one
   * from the name); update keeps the original `createdAt`.
   */
  async put(value: unknown, options: { create: boolean; id?: string } = { create: false }): Promise<CharacterCard> {
    this.requireReady();
    const existingIds = new Set(this.cards.keys());
    const normalized = parseCardDraft(
      options.id !== undefined && (value === null || typeof value !== 'object' || (value as { id?: unknown }).id === undefined)
        ? { ...(value as object), id: options.id }
        : value,
      existingIds,
    );
    if (normalized.card === undefined) throw new Error('subagent-director: ' + (normalized.issue ?? 'invalid card'));
    const card = normalized.card;
    if (options.create && this.cards.has(card.id)) {
      throw new Error('subagent-director: card "' + card.id + '" already exists');
    }
    if (!options.create && !this.cards.has(card.id)) {
      throw new Error('subagent-director: card "' + card.id + '" does not exist');
    }
    const previous = this.cards.get(card.id);
    const now = new Date().toISOString();
    const next: CharacterCard = {
      ...card,
      ...(previous?.createdAt !== undefined ? { createdAt: previous.createdAt } : card.createdAt !== undefined ? { createdAt: card.createdAt } : { createdAt: now }),
      updatedAt: now,
      source: card.source ?? previous?.source ?? 'local',
    };
    await this.writeCard(next);
    return next;
  }

  /** Delete cards in one operation; a deleted default clears the default. */
  async remove(ids: readonly string[]): Promise<string[]> {
    this.requireReady();
    const removed: string[] = [];
    for (const id of ids) {
      if (!this.cards.has(id)) continue;
      await this.domain!.table('cards').delete(id);
      this.cards.delete(id);
      try {
        await this.domain!.table('usage').delete(id);
      } catch (error) {
        this.logger.warn(
          '[subagent-director] could not remove the usage record for "' +
            id +
            '": ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      this.usage.delete(id);
      removed.push(id);
    }
    if (this.defaultCardId !== undefined && removed.includes(this.defaultCardId)) {
      await this.setDefault(undefined);
    }
    if (removed.length > 0) this.notify();
    return removed;
  }

  /** Set or clear the default card. */
  async setDefault(id: string | undefined): Promise<void> {
    this.requireReady();
    if (id !== undefined) {
      const card = this.cards.get(id);
      if (card === undefined) {
        throw new Error('subagent-director: card "' + id + '" does not exist');
      }
      if (!isCardEnabled(card)) {
        throw new Error('subagent-director: card "' + id + '" is disabled and cannot be the default');
      }
    }
    const global = this.domain!.global.get();
    await this.domain!.global.set({ ...global, defaultCardId: id });
    this.defaultCardId = id;
    this.notify();
  }

  /**
   * Pin cards out of the closed pool or release them again. Only `neverClose`
   * changes; `updatedAt` deliberately stays untouched so pinning does not look
   * like a content edit.
   */
  async setNeverClose(ids: readonly string[], neverClose: boolean): Promise<CharacterCard[]> {
    this.requireReady();
    const changed: CharacterCard[] = [];
    for (const id of ids) {
      const card = this.cards.get(id);
      if (card === undefined) continue;
      if ((card.neverClose === true) === neverClose) continue;
      const { neverClose: _current, ...rest } = card;
      const next: CharacterCard = neverClose ? { ...rest, neverClose: true } : rest;
      await this.writeCard(next);
      changed.push(next);
    }
    if (changed.length > 0) this.notify();
    return changed;
  }

  /** Enable or disable a batch; disabling the default clears the default. */
  async setEnabled(ids: readonly string[], enabled: boolean): Promise<CharacterCard[]> {
    this.requireReady();
    const changed: CharacterCard[] = [];
    for (const id of ids) {
      const card = this.cards.get(id);
      if (card === undefined || isCardEnabled(card) === enabled) continue;
      const next = { ...card, enabled, updatedAt: new Date().toISOString() };
      await this.writeCard(next);
      changed.push(next);
    }
    if (!enabled && this.defaultCardId !== undefined && ids.includes(this.defaultCardId)) {
      await this.setDefault(undefined);
    }
    return changed;
  }

  /** Import a portable payload under the chosen conflict policy. */
  async importCards(payload: unknown, strategy: CardImportStrategy): Promise<CardImportResult> {
    this.requireReady();
    const parsed = parseCardImportPayload(payload);
    const result = emptyImportResult();
    result.issues.push(...parsed.issues);
    if (parsed.cards.length === 0) return result;
    const existing = new Set(this.cards.keys());
    for (let index = 0; index < parsed.cards.length; index += 1) {
      const candidate = parseImportedCard(parsed.cards[index], existing);
      if (candidate.card === undefined) {
        result.issues.push({ index, message: candidate.issue ?? 'invalid card' });
        continue;
      }
      let card = candidate.card;
      if (this.cards.has(card.id)) {
        if (strategy === 'skip') {
          result.skipped += 1;
          continue;
        }
        if (strategy === 'duplicate') {
          const nextId = cardIdFromName(card.name, existing);
          card = { ...card, id: nextId, source: 'import' };
          existing.add(nextId);
          result.duplicated += 1;
        } else {
          result.overwritten += 1;
        }
      } else {
        existing.add(card.id);
        result.imported += 1;
      }
      const previous = this.cards.get(card.id);
      const now = new Date().toISOString();
      const next: CharacterCard = {
        ...card,
        ...(previous?.createdAt !== undefined ? { createdAt: previous.createdAt } : card.createdAt !== undefined ? { createdAt: card.createdAt } : { createdAt: now }),
        updatedAt: now,
        source: 'import',
      };
      await this.writeCard(next);
      result.cards.push(next);
    }
    this.notify();
    return result;
  }

  /** Build a portable bundle for every card or a selected subset. */
  exportCards(ids?: readonly string[]): CharacterCardBundle {
    const selected = ids === undefined ? this.list() : this.list().filter((card) => ids.includes(card.id));
    return buildCardBundle(selected);
  }

  /**
   * Migrate legacy `roles` from the plugin settings. Existing card ids are
   * skipped, so the action is idempotent. The legacy `defaultRole` is promoted
   * only when no default card is set.
   */
  async migrateLegacy(
    legacy?: Record<string, LegacyRole>,
    legacyDefaultRole?: string,
  ): Promise<CardMigrationResult> {
    this.requireReady();
    const settings = this.getSettings();
    const source = legacy ?? ((settings.roles ?? {}) as Record<string, LegacyRole>);
    const defaultRole = legacyDefaultRole ?? settings.defaultRole;
    const migrated: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    const existing = new Set(this.cards.keys());
    for (const [roleId, role] of Object.entries(source)) {
      if (role === null || typeof role !== 'object') {
        failed.push({ id: roleId, message: 'legacy role is not an object' });
        continue;
      }
      if (existing.has(roleId)) {
        skipped.push(roleId);
        continue;
      }
      try {
        const card = legacyRoleToCard(roleId, role, existing);
        if (existing.has(card.id)) {
          skipped.push(roleId);
          continue;
        }
        existing.add(card.id);
        const now = new Date().toISOString();
        const next: CharacterCard = { ...card, createdAt: now, updatedAt: now, source: 'legacy' };
        await this.writeCard(next);
        migrated.push(card.id);
      } catch (error) {
        failed.push({ id: roleId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (this.defaultCardId === undefined && defaultRole !== undefined) {
      const candidate =
        this.cards.get(defaultRole) ??
        this.list().find((card) => card.name === defaultRole);
      if (candidate !== undefined && isCardEnabled(candidate)) await this.setDefault(candidate.id);
    }
    this.notify();
    return {
      migrated,
      skipped,
      failed,
      remainingLegacy: Object.keys(source),
      ...(this.defaultCardId !== undefined ? { defaultCardId: this.defaultCardId } : {}),
    };
  }

  // ---- active card prompts ------------------------------------------------

  /** Persist and expose the prompt snapshot bound to one child session. */
  async beginBinding(input: Omit<CardPromptBinding, 'createdAt'> & { createdAt?: number }): Promise<CardPromptBinding> {
    const binding: CardPromptBinding = { ...input, createdAt: input.createdAt ?? Date.now() };
    this.bindings.set(binding.sessionId, binding);
    this.pruneBindings();
    if (this.domain !== undefined) {
      await this.domain.table('bindings').put(binding.sessionId, binding);
    }
    return binding;
  }

  /** Remove one child's prompt binding. `onlyEphemeral` keeps continuable bindings. */
  async endBinding(sessionId: string, options: { onlyEphemeral?: boolean } = {}): Promise<void> {
    const current = this.bindings.get(sessionId);
    if (current === undefined) return;
    if (options.onlyEphemeral === true && current.continuable === true) return;
    this.bindings.delete(sessionId);
    if (this.domain !== undefined) {
      await this.domain.table('bindings').delete(sessionId);
    }
  }

  /** The prompt binding for one child session. */
  binding(sessionId: string): CardPromptBinding | undefined {
    return this.bindings.get(sessionId);
  }

  /** Render the fixed prompt for one child session, or '' when unbound. */
  bindingText(sessionId: string): string {
    const binding = this.bindings.get(sessionId);
    if (binding === undefined) return '';
    return renderCardPrompt({
      name: binding.cardName,
      systemPrompt: binding.systemPrompt,
      persona: binding.persona,
    });
  }

  /** Bindings currently held (diagnostics/tests). */
  bindingCount(): number {
    return this.bindings.size;
  }

  // ---- internals ----------------------------------------------------------

  private requireReady(): void {
    if (this.domain === undefined) {
      throw new Error(
        'subagent-director: card storage is not available in this deployment (the storage-domain service is not mounted)',
      );
    }
  }

  private async writeCard(card: CharacterCard): Promise<void> {
    await this.domain!.table('cards').put(card.id, card);
    this.cards.set(card.id, card);
  }

  private pruneBindings(): void {
    if (this.bindings.size <= MAX_BINDINGS) return;
    const ordered = [...this.bindings.values()].sort((a, b) => {
      const ephemeral = (binding: CardPromptBinding): number => (binding.continuable === true ? 1 : 0);
      return ephemeral(a) - ephemeral(b) || a.createdAt - b.createdAt;
    });
    for (const binding of ordered.slice(0, this.bindings.size - MAX_BINDINGS)) {
      this.bindings.delete(binding.sessionId);
      if (this.domain !== undefined) void this.domain.table('bindings').delete(binding.sessionId);
    }
  }
}

/** Structural service name provided by the main plugin entry. */
export const CARD_SERVICE_NAME = 'subagentDirectorCards' as const;

/** The service face the bridge consumes without importing the concrete class. */
export interface CardServiceLike {
  ready(): Promise<void>;
  /** Optional retry for a failed storage open. */
  retry?: () => Promise<void>;
  status(): CardStorageStatus;
  librarySnapshot(): CardLibrarySnapshot;
  cardUsageMap(): Record<string, CardUsageSnapshot>;
  rankedCards(options?: { now?: number | Date; includeBuiltIn?: boolean }): RankedCard[];
  recordCardUse(cardId: string, at?: string): Promise<CardUsageSnapshot | undefined>;
  exportCards(ids?: readonly string[]): CharacterCardBundle;
  importCards(payload: unknown, strategy: CardImportStrategy): Promise<CardImportResult>;
  put(value: unknown, options?: { create: boolean; id?: string }): Promise<CharacterCard>;
  remove(ids: readonly string[]): Promise<string[]>;
  setDefault(id: string | undefined): Promise<void>;
  setEnabled(ids: readonly string[], enabled: boolean): Promise<CharacterCard[]>;
  setNeverClose(ids: readonly string[], neverClose: boolean): Promise<CharacterCard[]>;
  migrateLegacy(
    legacy?: Record<string, LegacyRole>,
    legacyDefaultRole?: string,
  ): Promise<CardMigrationResult>;
  dispose(): Promise<void>;
}


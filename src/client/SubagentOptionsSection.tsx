/**
 * Subagent Director configuration page: the character-card library, the card
 * editor, import/export/migration flows, and the default-model panel.
 *
 * This component is registered on `plugins.bundle.config` for this package, so
 * it renders on the plugin's own page in the DSH plugin manager. It owns only
 * presentation and local UI state; all persistence goes through the page store,
 * which talks to the Host bridge and reloads the acknowledged library.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type { SnapshotSelectorHook } from './bind.js';
import type { DirectorAllowedRoute } from '../bridge-contract.js';
import { isCardEnabled, type CardMigrationResult, type CharacterCard } from '../card-types.js';
import { modelsForProvider, providerNames } from './allowed-routes.js';
import type { SubagentDirectorKey } from './locales.js';
import type { SubagentOptionsState, SubagentOptionsStore } from './store.js';
import { CardEditor } from './CardEditor.js';
import { CharacterCardTile } from './CharacterCardTile.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { ImportDialog } from './ImportDialog.js';
import { CARD_FILTERS, CARD_SORTS, cardLibraryRows, type CardFilter, type CardSort } from './card-library-view.js';
import { watchLibraryActivity } from './library-activity.js';
import { withReplacement } from './text.js';
import {
  IconChevron,
  IconDirector,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUpload,
  IconWarning,
  IconX,
} from './icons.js';

/** Toolbar labels for the library filters. */
const FILTER_KEYS: Record<CardFilter, SubagentDirectorKey> = {
  all: 'filterAll',
  active: 'filterActive',
  closed: 'filterClosed',
  disabled: 'filterDisabled',
};

/** Toolbar labels for the library orderings. */
const SORT_KEYS: Record<CardSort, SubagentDirectorKey> = {
  weight: 'sortWeight',
  recent: 'sortRecent',
  name: 'sortName',
};

/** Injected dependencies of the page (slot `inject`). */
export interface SubagentOptionsSectionInjected {
  controller: SubagentOptionsStore;
  useSnapshot: SnapshotSelectorHook<SubagentOptionsState>;
  t: (key: SubagentDirectorKey) => string;
}

/** Props delivered by the slot outlet. */
export type SubagentOptionsSectionProps = Partial<SubagentOptionsSectionInjected> & Partial<PluginConfigViewProps>;

interface EditorState {
  key: number;
  card?: CharacterCard;
  initial?: CharacterCard;
  create?: boolean;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<string | undefined>;
}

interface Notice {
  tone: 'success' | 'error' | 'info';
  text: string;
}

/**
 * User-facing outcome of one legacy migration. Host diagnostics never enter
 * this text: when clearing the legacy fields was requested but did not happen,
 * the page states that with localized copy and keeps the dialog open.
 */
export function legacyMigrationNotice(
  t: (key: SubagentDirectorKey) => string,
  result: CardMigrationResult,
  options: { clearRequested: boolean; cleared: boolean },
): { tone: Notice['tone']; text: string; close: boolean } {
  const text = withReplacement(t('legacyResult'), {
    migrated: result.migrated.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  });
  if (result.failed.length > 0) return { tone: 'error', text, close: false };
  if (options.clearRequested && !options.cleared) {
    return { tone: 'info', text: text + ' ' + t('legacyClearFailed'), close: false };
  }
  return { tone: 'success', text, close: options.cleared || result.migrated.length > 0 };
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFilename(count: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return 'subagent-director-cards-' + date + '-' + String(count) + '.json';
}

/**
 * Render the Subagent Director configuration page.
 * @param props - slot-delivered injected dependencies and page view.
 */
export function SubagentOptionsSection(props: SubagentOptionsSectionProps): JSX.Element | null {
  const { controller, useSnapshot, t } = props;
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null;
  if (props.view === 'summary') return null;
  return <Loaded injected={{ controller, useSnapshot, t }} />;
}

function Loaded({ injected }: { injected: SubagentOptionsSectionInjected }): JSX.Element | null {
  const { controller, t } = injected;
  const state = injected.useSnapshot((snapshot) => snapshot);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CardFilter>('all');
  const [sort, setSort] = useState<CardSort>('weight');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateClear, setMigrateClear] = useState(true);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (state.status === 'idle' && !state.loading) void controller.load();
  }, [state.status, state.loading, controller]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    return watchLibraryActivity({
      window,
      document,
      refresh: () => { void controller.refreshCards(); },
      onTick: setClock,
    });
  }, [controller]);

  useEffect(() => {
    setSelected((current) => {
      const known = new Set(state.cards.map((card) => card.id));
      const next = new Set([...current].filter((id) => known.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [state.cards]);

  const notify = (tone: Notice['tone'], text: string): void => setNotice({ tone, text });
  const existingIds = useMemo(() => new Set(state.cards.map((card) => card.id)), [state.cards]);
  const enabledCount = state.cards.filter((card) => isCardEnabled(card)).length;
  const defaultCard = state.cards.find((card) => card.id === state.defaultCardId);
  const defaultModel = [state.section?.defaultProvider, state.section?.defaultModel].filter((value) => value !== undefined && value !== '').join('/');
  const rows = useMemo(
    () => cardLibraryRows(state.cards, {
      now: clock,
      usage: state.usage,
      ...(state.defaultCardId !== undefined ? { defaultCardId: state.defaultCardId } : {}),
      filter,
      sort,
      query,
    }),
    [clock, state.cards, state.usage, state.defaultCardId, filter, sort, query],
  );

  if (state.status === 'error') {
    return (
      <div className="sd-page">
        <div className="sd-banner sd-banner-error">
          <IconWarning size={18} />
          <div>
            <strong>{t('loadError')}</strong>
            <p>{state.error ?? ''}</p>
          </div>
          <button type="button" className="sd-btn sd-btn-ghost" onClick={() => void controller.load()}>{t('retry')}</button>
        </div>
      </div>
    );
  }
  if (state.status !== 'ready') {
    return (
      <div className="sd-page">
        <PageHead t={t} />
        <div className="sd-skeleton" role="status" aria-label={t('loading')}>
          <div /><div /><div />
        </div>
      </div>
    );
  }

  const canWriteCards = state.cardStorage.state === 'ready';
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.card.id));
  const selectedCards = state.cards.filter((card) => selected.has(card.id));

  const toggleSelected = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) for (const row of rows) next.delete(row.card.id);
      else for (const row of rows) next.add(row.card.id);
      return next;
    });
  };

  const toggleSelectionMode = (): void => {
    if (selectionMode) setSelected(new Set());
    setSelectionMode(!selectionMode);
  };

  const exportCards = async (ids?: readonly string[]): Promise<void> => {
    setActionBusy('export');
    try {
      const outcome = await controller.exportCards(ids);
      if (!outcome.ok) {
        notify('error', outcome.message);
        return;
      }
      downloadJson(outcome.value, exportFilename(outcome.value.cards.length));
      notify('success', withReplacement(t('exportSummary'), { count: outcome.value.cards.length }));
      if (ids === undefined && selectionMode) setSelected(new Set());
    } finally {
      setActionBusy(undefined);
    }
  };

  const saveCard = async (card: CharacterCard, create: boolean): Promise<string | undefined> => {
    const message = await controller.saveCard(card, create);
    if (message === undefined) notify('success', t('cardSaved'));
    return message;
  };

  const deleteCard = (card: CharacterCard): void => {
    setConfirm({
      title: t('deleteCard'),
      body: withReplacement(t('confirmDeleteCard'), { id: card.id }),
      confirmLabel: t('deleteCard'),
      danger: true,
      run: async () => {
        const message = await controller.deleteCards([card.id]);
        if (message === undefined) notify('success', t('cardDeleted'));
        return message;
      },
    });
  };

  const deleteSelected = (): void => {
    if (selectedCards.length === 0) return;
    setConfirm({
      title: t('batchDelete'),
      body: withReplacement(t('confirmBatchDelete'), { count: selectedCards.length }),
      confirmLabel: t('batchDelete'),
      danger: true,
      run: async () => {
        const message = await controller.batchCards('delete', selectedCards.map((card) => card.id));
        if (message === undefined) {
          notify('success', t('batchDone'));
          setSelected(new Set());
          setSelectionMode(false);
        }
        return message;
      },
    });
  };

  const executeConfirm = async (): Promise<void> => {
    if (confirm === null) return;
    setConfirmBusy(true);
    try {
      const message = await confirm.run();
      if (message !== undefined) {
        notify('error', message);
        return;
      }
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const batchToggle = async (enabled: boolean): Promise<void> => {
    if (selectedCards.length === 0) return;
    setActionBusy(enabled ? 'enable' : 'disable');
    try {
      const message = await controller.batchCards(enabled ? 'enable' : 'disable', selectedCards.map((card) => card.id));
      if (message !== undefined) notify('error', message);
      else {
        notify('success', t('batchDone'));
        setSelected(new Set());
        setSelectionMode(false);
      }
    } finally {
      setActionBusy(undefined);
    }
  };

  const setDefault = async (card: CharacterCard): Promise<void> => {
    const message = await controller.setDefaultCard(card.id);
    if (message !== undefined) notify('error', message);
    else notify('success', t('setDefaultCard'));
  };

  const toggleEnabled = async (card: CharacterCard): Promise<void> => {
    const message = await controller.batchCards(isCardEnabled(card) ? 'disable' : 'enable', [card.id]);
    if (message !== undefined) notify('error', message);
    else notify('success', isCardEnabled(card) ? t('disabled') : t('enabled'));
  };

  const migrate = async (): Promise<void> => {
    setMigrateBusy(true);
    try {
      const outcome = await controller.migrateLegacy(migrateClear);
      if (!outcome.ok) {
        notify('error', outcome.message);
        return;
      }
      const { result, cleared } = outcome.value;
      const outcomeNotice = legacyMigrationNotice(t, result, { clearRequested: migrateClear, cleared });
      notify(outcomeNotice.tone, outcomeNotice.text);
      if (outcomeNotice.close) setMigrateOpen(false);
    } finally {
      setMigrateBusy(false);
    }
  };

  const openCreate = (): void => setEditor({ key: Date.now(), create: true });
  const openEdit = (card: CharacterCard): void => setEditor({ key: Date.now(), card });
  const openDuplicate = (card: CharacterCard): void => {
    setEditor({ key: Date.now(), create: true, initial: { ...card, id: '', name: withReplacement(t('duplicateName'), { name: card.name }) } });
  };

  const toggleNeverClose = async (card: CharacterCard): Promise<void> => {
    const pin = card.neverClose !== true;
    const message = await controller.batchCards(pin ? 'pin' : 'unpin', [card.id]);
    if (message !== undefined) notify('error', message);
    else notify('success', pin ? t('cardPinned') : t('cardUnpinned'));
  };

  return (
    <div className="sd-page">
      <PageHead
        t={t}
        actions={
          <>
            <button type="button" className="sd-btn sd-btn-primary" disabled={!canWriteCards} onClick={openCreate}>
              <IconPlus size={15} /> {t('newCard')}
            </button>
            <button type="button" className="sd-btn sd-btn-ghost" disabled={!canWriteCards} onClick={() => setImportOpen(true)}>
              <IconUpload size={15} /> {t('importCards')}
            </button>
            <button
              type="button"
              className="sd-btn sd-btn-ghost"
              disabled={state.cards.length === 0 || actionBusy === 'export'}
              onClick={() => void exportCards()}
            >
              <IconDownload size={15} /> {t('exportAll')}
            </button>
          </>
        }
      />

      {notice !== null ? (
        <div className={'sd-toast is-' + notice.tone} role="status" aria-live="polite">
          <span>{notice.text}</span>
          <button type="button" className="sd-icon-btn" aria-label={t('closeDialog')} onClick={() => setNotice(null)}>
            <IconX size={14} />
          </button>
        </div>
      ) : null}

      {state.cardStorage.state !== 'ready' ? (
        <div className={'sd-banner ' + (state.cardStorage.state === 'error' ? 'sd-banner-error' : 'sd-banner-warn')}>
          <IconWarning size={18} />
          <div>
            <strong>{state.cardStorage.state === 'error' ? t('storageError') : t('storageUnavailable')}</strong>
            <p>{t('storageHint')}</p>
          </div>
          <button type="button" className="sd-btn sd-btn-ghost" onClick={() => void controller.refreshCards()}>
            <IconRefresh size={14} /> {t('retryCards')}
          </button>
        </div>
      ) : null}

      {!state.writable ? (
        <div className="sd-banner sd-banner-warn">
          <IconShield size={18} />
          <div><strong>{t('readonly')}</strong><p>{t('readonlyCardStorage')}</p></div>
        </div>
      ) : null}

      {state.legacyRoles.length > 0 ? (
        <div className="sd-banner sd-banner-info">
          <IconWarning size={18} />
          <div>
            <strong>{t('legacyBanner')}</strong>
            <p>{withReplacement(t('legacyBannerBody'), { count: state.legacyRoles.length })}</p>
          </div>
          <button type="button" className="sd-btn sd-btn-ghost" disabled={!canWriteCards} onClick={() => setMigrateOpen(true)}>
            {t('legacyMigrate')}
          </button>
        </div>
      ) : null}

      <div className="sd-stats">
        <Stat label={t('statCards')} value={String(state.cards.length)} />
        <Stat label={t('statEnabled')} value={String(enabledCount)} />
        <Stat label={t('statDefault')} value={defaultCard?.name ?? '—'} hint={defaultCard === undefined ? t('cardDefaultHint') : undefined} />
        <Stat label={t('statModel')} value={defaultModel.length > 0 ? defaultModel : t('modelInherited')} />
      </div>

      <section className="sd-group">
        <div className="sd-group-head">
          <div>
            <h2>{t('cardsHeading')}</h2>
            <p className="sd-hint">{t('cardsHint')}</p>
          </div>
          <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" onClick={toggleSelectionMode}>
            {selectionMode ? t('batchDone') : t('batchSelect')}
          </button>
        </div>

        <div className="sd-toolbar">
          <div className="sd-search-wrap">
            <IconSearch size={15} />
            <input
              className="sd-search"
              value={query}
              placeholder={t('searchEmpty')}
              aria-label={t('searchCards')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query.length > 0 ? (
              <button type="button" className="sd-icon-btn sd-search-clear" aria-label={t('clearSearch')} onClick={() => setQuery('')}>
                <IconX size={13} />
              </button>
            ) : null}
          </div>
          <div className="sd-segmented" role="group" aria-label={t('filterCards')}>
            {CARD_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? 'is-active' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {t(FILTER_KEYS[value])}
              </button>
            ))}
          </div>
          <select className="sd-select sd-sort" value={sort} onChange={(event) => setSort(event.target.value as CardSort)} aria-label={t('sortCards')}>
            {CARD_SORTS.map((value) => <option key={value} value={value}>{t(SORT_KEYS[value])}</option>)}
          </select>
        </div>

        {selectionMode ? (
          <div className="sd-batchbar">
            <div className="sd-batchbar-main">
              <strong>{withReplacement(t('batchSelected'), { count: selected.size })}</strong>
              <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" onClick={toggleSelectAll}>
                {allVisibleSelected ? t('clearSelection') : t('selectAll')}
              </button>
              <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                {t('clearSelection')}
              </button>
            </div>
            <div className="sd-actions">
              <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" disabled={selected.size === 0 || actionBusy !== undefined} onClick={() => void batchToggle(true)}>
                {t('batchEnable')}
              </button>
              <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" disabled={selected.size === 0 || actionBusy !== undefined} onClick={() => void batchToggle(false)}>
                {t('batchDisable')}
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                disabled={selected.size === 0 || actionBusy !== undefined}
                onClick={() => void exportCards([...selected])}
              >
                {t('batchExport')}
              </button>
              <button type="button" className="sd-btn sd-btn-danger sd-btn-sm" disabled={selected.size === 0 || actionBusy !== undefined} onClick={deleteSelected}>
                {t('batchDelete')}
              </button>
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="sd-empty-state">
            <div className="sd-empty-icon"><IconPlus size={22} /></div>
            <h3>{state.cards.length === 0 ? t('emptyCardsTitle') : t('noSearchResults')}</h3>
            {state.cards.length === 0 ? <p className="sd-hint">{t('emptyCardsBody')}</p> : null}
            <div className="sd-actions">
              {state.cards.length === 0 ? (
                <>
                  <button type="button" className="sd-btn sd-btn-primary" disabled={!canWriteCards} onClick={openCreate}>{t('newCard')}</button>
                  <button type="button" className="sd-btn sd-btn-ghost" disabled={!canWriteCards} onClick={() => setImportOpen(true)}>{t('importCards')}</button>
                </>
              ) : (
                <button type="button" className="sd-btn sd-btn-ghost" onClick={() => { setQuery(''); setFilter('all'); }}>{t('clearSelection')}</button>
              )}
            </div>
          </div>
        ) : (
          <div className="sd-card-grid">
            {rows.map((row) => (
              <CharacterCardTile
                key={row.card.id}
                card={row.card}
                isDefault={state.defaultCardId === row.card.id}
                selectionMode={selectionMode}
                selected={selected.has(row.card.id)}
                usage={state.usage[row.card.id]}
                usageState={row.visibleState}
                t={t}
                onToggleSelect={() => toggleSelected(row.card.id)}
                onEdit={() => openEdit(row.card)}
                onSetDefault={() => void setDefault(row.card)}
                onDuplicate={() => openDuplicate(row.card)}
                onExport={() => void exportCards([row.card.id])}
                onToggleEnabled={() => void toggleEnabled(row.card)}
                onToggleNeverClose={() => void toggleNeverClose(row.card)}
                onDelete={() => deleteCard(row.card)}
              />
            ))}
          </div>
        )}
      </section>

      <details className="sd-panel" open>
        <summary>
          <span className="sd-panel-title">
            <strong>{t('defaultModelPanel')}</strong>
            <span className="sd-hint">{t('defaultModelPanelHint')}</span>
          </span>
          <IconChevron size={16} className="sd-panel-chevron" />
        </summary>
        <DefaultModelRow
          controller={controller}
          routes={state.allowedRoutes}
          modelSelectionEnabled={state.modelSelectionEnabled}
          writable={state.writable}
          current={{
            provider: state.section?.defaultProvider,
            model: state.section?.defaultModel,
            reasoningEffort: state.section?.defaultReasoningEffort,
          }}
          t={t}
        />
      </details>

      <p className="sd-footnote">{t('storageHint')}</p>

      <CardEditor
        key={editor?.key ?? 0}
        open={editor !== null}
        card={editor?.card}
        initial={editor?.initial}
        create={editor?.create}
        routes={state.allowedRoutes}
        modelSelectionEnabled={state.modelSelectionEnabled}
        existingIds={existingIds}
        t={t}
        onClose={() => setEditor(null)}
        onSave={saveCard}
      />

      <ImportDialog
        open={importOpen}
        t={t}
        onClose={() => setImportOpen(false)}
        onImport={(payload, strategy) => controller.importCards(payload, strategy)}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.confirmLabel ?? t('confirm')}
        danger={confirm?.danger}
        busy={confirmBusy}
        t={t}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void executeConfirm()}
      />

      <ConfirmDialog
        open={migrateOpen}
        title={t('migrateTitle')}
        body={t('migrateBody')}
        confirmLabel={t('migrateConfirm')}
        busy={migrateBusy}
        t={t}
        onCancel={() => setMigrateOpen(false)}
        onConfirm={() => void migrate()}
      >
        <div className="sd-migrate">
          <p className="sd-note">{state.legacyRoles.join(', ')}</p>
          <label className="sd-toggle">
            <input type="checkbox" checked={migrateClear} onChange={(event) => setMigrateClear(event.target.checked)} />
            <span>
              <strong>{t('migrateClearLabel')}</strong>
              <span className="sd-note">{t('legacyClearHint')}</span>
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function PageHead({ t, actions }: { t: (key: SubagentDirectorKey) => string; actions?: ReactNode }): JSX.Element {
  return (
    <header className="sd-page-head">
      <div className="sd-page-head-main">
        <span className="sd-eyebrow">{t('nav')}</span>
        <div className="sd-page-title-row">
          <IconDirector size={22} className="sd-page-title-icon" />
          <h1 className="sd-page-title">{t('pageTitle')}</h1>
        </div>
        <p className="sd-page-intro">{t('pageIntro')}</p>
      </div>
      {actions !== undefined ? <div className="sd-actions">{actions}</div> : null}
    </header>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="sd-stat">
      <span className="sd-stat-label">{label}</span>
      <strong className="sd-stat-value" title={value}>{value}</strong>
      {hint !== undefined ? <span className="sd-stat-hint">{hint}</span> : null}
    </div>
  );
}

interface DefaultRowDraft {
  provider: string;
  model: string;
  reasoningEffort: string;
}

function DefaultModelRow({ controller, routes, modelSelectionEnabled, writable, current, t }: {
  controller: SubagentOptionsStore;
  routes: readonly DirectorAllowedRoute[];
  modelSelectionEnabled: boolean;
  writable: boolean;
  current: { provider?: string; model?: string; reasoningEffort?: string };
  t: (key: SubagentDirectorKey) => string;
}): JSX.Element {
  const [draft, setDraft] = useState<DefaultRowDraft>({
    provider: current.provider ?? '',
    model: current.model ?? '',
    reasoningEffort: current.reasoningEffort ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [doneMessage, setDoneMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (busy) return;
    setDraft({
      provider: current.provider ?? '',
      model: current.model ?? '',
      reasoningEffort: current.reasoningEffort ?? '',
    });
  }, [current.provider, current.model, current.reasoningEffort, busy]);

  const providers = providerNames(routes);
  const modelOptions = draft.provider === '' ? [] : modelsForProvider(routes, draft.provider);
  const noAllowed = routes.length === 0;

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    setDoneMessage(undefined);
    try {
      const message = await controller.setDefaultModel({
        provider: draft.provider || undefined,
        model: draft.model || undefined,
        reasoningEffort: draft.reasoningEffort || undefined,
      });
      if (message !== undefined) {
        setFailure(message);
        return;
      }
      setDoneMessage(t('defaultSaved'));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    setDoneMessage(undefined);
    try {
      const message = await controller.restoreDefaults();
      if (message !== undefined) {
        setFailure(message);
        return;
      }
      setDoneMessage(t('restoreDone'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd-default">
      {noAllowed ? <p className="sd-warn-text">{t('noAllowedModels')}</p> : null}
      <div className="sd-grid sd-grid-3">
        <div className="sd-field">
          <label className="sd-label" htmlFor="sd-default-provider">{t('defaultProvider')}</label>
          {noAllowed ? <div className="sd-note">—</div> : (
            <select
              id="sd-default-provider"
              className="sd-select"
              value={draft.provider}
              disabled={!writable || providers.length === 0}
              onChange={(event) => setDraft({ provider: event.target.value, model: '', reasoningEffort: '' })}
            >
              <option value="">{t('modelInherited')}</option>
              {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          )}
        </div>
        <div className="sd-field">
          <label className="sd-label" htmlFor="sd-default-model">{t('defaultModel')}</label>
          {noAllowed ? <div className="sd-note">—</div> : (
            <select
              id="sd-default-model"
              className="sd-select"
              value={draft.model}
              disabled={!writable || modelOptions.length === 0}
              onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value, reasoningEffort: '' }))}
            >
              <option value="">{t('modelInherited')}</option>
              {modelOptions.map((entry) => <option key={entry.model} value={entry.model}>{entry.label}</option>)}
            </select>
          )}
        </div>
        <div className="sd-field">
          <label className="sd-label" htmlFor="sd-default-effort">{t('defaultReasoningEffort')}</label>
          <input
            id="sd-default-effort"
            className="sd-input"
            value={draft.reasoningEffort}
            disabled={!writable}
            placeholder={modelSelectionEnabled ? '' : t('modelAdvisory')}
            onChange={(event) => setDraft((value) => ({ ...value, reasoningEffort: event.target.value }))}
          />
        </div>
      </div>
      {failure !== undefined ? <p className="sd-error-text" role="alert">{failure}</p> : null}
      {doneMessage !== undefined ? <p className="sd-success-text" role="status">{doneMessage}</p> : null}
      <div className="sd-actions sd-actions-end">
        <button type="button" className="sd-btn sd-btn-ghost" disabled={!writable || busy} onClick={() => void restore()}>
          {t('restoreDefaults')}
        </button>
        <button type="button" className="sd-btn sd-btn-primary" disabled={!writable || busy} onClick={() => void save()}>
          {t('save')}
        </button>
      </div>
    </div>
  );
}

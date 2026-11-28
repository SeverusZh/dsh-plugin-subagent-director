/** One character card in the library grid. */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { CharacterCard, CardUsageSnapshot } from '../card-types.js';
import { cardAccentOf, hasCardPrompt, isCardEnabled } from '../card-types.js';
import type { SubagentDirectorKey } from './locales.js';
import type { CardVisibleState } from './card-library-view.js';
import { formatUsageTime } from './card-library-view.js';
import { CardAvatar } from './CardAvatar.js';
import { withReplacement } from './text.js';
import { IconCopy, IconDownload, IconEdit, IconMore, IconStar, IconTrash } from './icons.js';

export interface CharacterCardTileProps {
  card: CharacterCard;
  isDefault: boolean;
  selectionMode: boolean;
  selected: boolean;
  /** Usage counters recorded by the Host; absent means never used. */
  usage?: CardUsageSnapshot;
  /** Usage state as the library labels it. */
  usageState: CardVisibleState;
  t: (key: SubagentDirectorKey) => string;
  onToggleSelect: () => void;
  onEdit: () => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onToggleEnabled: () => void;
  onToggleNeverClose: () => void;
  onDelete: () => void;
}

const STATE_KEYS: Record<CardVisibleState, SubagentDirectorKey> = {
  active: 'cardStateActive',
  closed: 'cardStateClosed',
  disabled: 'disabled',
};

const STATE_TONES: Record<CardVisibleState, string> = {
  active: ' sd-chip-accent',
  closed: ' sd-chip-warn',
  disabled: ' sd-chip-muted',
};

/** Keep the pin interaction from reaching the card selection handler. */
function stopCardSelection(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

export interface CardPinToggleProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

/** Pin switch whose click and keyboard events never bubble to the card. */
export function CardPinToggle(props: CardPinToggleProps): JSX.Element {
  return (
    <label className="sd-pin" title={props.label} onClick={stopCardSelection} onKeyDown={stopCardSelection}>
      <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
      <span>{props.label}</span>
    </label>
  );
}

function modelLabel(card: CharacterCard): string | undefined {
  const provider = card.model?.provider;
  const model = card.model?.model;
  if (provider !== undefined && provider !== '' && model !== undefined && model !== '') return provider + '/' + model;
  if (provider !== undefined && provider !== '') return provider;
  if (model !== undefined && model !== '') return model;
  return undefined;
}

export function CharacterCardTile(props: CharacterCardTileProps): JSX.Element {
  const { card, isDefault, selectionMode, selected, usage, t } = props;
  const enabled = isCardEnabled(card);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const accent = cardAccentOf(card);
  const model = modelLabel(card);
  const tags = card.tags ?? [];
  const shownTags = tags.slice(0, 3);
  const extraTags = tags.length - shownTags.length;
  const lastUsed = usage?.lastUsedAt === undefined ? undefined : formatUsageTime(usage.lastUsedAt);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', close);
      cancelAnimationFrame(frame);
    };
  }, [menuOpen]);

  const run = (action: () => void): void => {
    setMenuOpen(false);
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home' ? 0 :
      event.key === 'End' ? items.length - 1 :
      event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length :
      (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <article
      className={
        'sd-card-tile sd-accent-' + accent +
        (selected ? ' is-selected' : '') +
        (enabled ? '' : ' is-disabled') +
        (selectionMode ? ' is-selectable' : '')
      }
      aria-label={card.name}
      onClick={selectionMode ? props.onToggleSelect : undefined}
    >
      {selectionMode ? (
        <label className="sd-card-select" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={props.onToggleSelect}
            aria-label={t('selected') + ': ' + card.name}
          />
        </label>
      ) : null}
      <header className="sd-card-tile-head">
        <CardAvatar name={card.name} emoji={card.emoji} accent={accent} />
        <div className="sd-card-tile-title">
          <h3>{card.name}</h3>
          <div className="sd-card-tile-sub">
            <span className="sd-mono">{card.id}</span>
            {isDefault ? <span className="sd-badge sd-badge-accent">{t('cardDefault')}</span> : null}
          </div>
        </div>
        {!selectionMode ? (
          <button
            type="button"
            className={'sd-icon-btn sd-star-btn' + (isDefault ? ' is-on' : '')}
            title={t('setDefaultCard')}
            aria-label={t('setDefaultCard')}
            aria-pressed={isDefault}
            disabled={isDefault || !enabled}
            onClick={props.onSetDefault}
          >
            <IconStar size={16} filled={isDefault} />
          </button>
        ) : null}
      </header>

      <p className="sd-card-tile-guidance">{card.delegationGuidance}</p>
      {card.avoidGuidance !== undefined && card.avoidGuidance.trim().length > 0 ? (
        <p className="sd-card-tile-avoid">{t('cardAvoidPrefix')}{card.avoidGuidance}</p>
      ) : null}

      <div className="sd-card-tile-tags">
        {shownTags.map((tag) => <span key={tag} className="sd-chip">{tag}</span>)}
        {extraTags > 0 ? <span className="sd-chip">+{extraTags}</span> : null}
        {tags.length === 0 ? <span className="sd-note">{t('cardTagsNone')}</span> : null}
      </div>

      <div className="sd-card-tile-meta">
        <span className="sd-chip sd-chip-model">{model ?? t('modelInherited')}</span>
        {hasCardPrompt(card) ? <span className="sd-chip sd-chip-accent">{t('cardPromptChip')}</span> : null}
        {card.agentPreset !== undefined && card.agentPreset !== '' ? <span className="sd-chip">{card.agentPreset}</span> : null}
      </div>

      <div className="sd-card-tile-status">
        <span className={'sd-chip' + STATE_TONES[props.usageState]}>{t(STATE_KEYS[props.usageState])}</span>
        <span className="sd-status-stat">{withReplacement(t('cardUses'), { count: usage?.uses ?? 0 })}</span>
        <span className="sd-status-stat">
          {lastUsed !== undefined ? withReplacement(t('cardLastUsed'), { time: lastUsed }) : t('cardNeverUsed')}
        </span>
        <CardPinToggle
          label={t('cardNeverClose')}
          checked={card.neverClose === true}
          onToggle={props.onToggleNeverClose}
        />
      </div>

      {!selectionMode ? (
        <footer className="sd-card-tile-foot">
          <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" onClick={props.onEdit}>
            <IconEdit size={14} /> {t('editCard')}
          </button>
          <div className="sd-menu-wrap" ref={menuRef}>
            <button
              type="button"
              ref={menuButtonRef}
              className="sd-icon-btn"
              title={t('moreActions')}
              aria-label={t('moreActions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <IconMore size={16} />
            </button>
            {menuOpen ? (
              <div className="sd-menu" role="menu" onKeyDown={onMenuKeyDown}>
                <button type="button" role="menuitem" onClick={() => run(props.onDuplicate)}>
                  <IconCopy size={14} /> {t('duplicateCard')}
                </button>
                <button type="button" role="menuitem" onClick={() => run(props.onExport)}>
                  <IconDownload size={14} /> {t('exportCard')}
                </button>
                <button type="button" role="menuitem" onClick={() => run(props.onToggleEnabled)}>
                  {enabled ? t('disableCard') : t('enableCard')}
                </button>
                <button type="button" role="menuitem" className="is-danger" onClick={() => run(props.onDelete)}>
                  <IconTrash size={14} /> {t('deleteCard')}
                </button>
              </div>
            ) : null}
          </div>
        </footer>
      ) : null}
    </article>
  );
}

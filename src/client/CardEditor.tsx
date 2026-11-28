/** Modal editor for one character card. */
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { DirectorAllowedRoute } from '../bridge-contract.js';
import {
  CARD_ACCENTS,
  CARD_GLYPHS,
  CARD_LIMITS,
  cardIdFromName,
  formatTagInput,
  parseTagInput,
  type CardAccent,
  type CharacterCard,
} from '../card-types.js';
import type { SubagentDirectorKey } from './locales.js';
import { modelsForProvider, providerNames } from './allowed-routes.js';
import { useDialogFocus } from './dialog-focus.js';
import { CardAvatar } from './CardAvatar.js';
import { withReplacement } from './text.js';
import { IconX } from './icons.js';

/** Dictionary keys for the six avatar accent tokens. */
const ACCENT_KEYS: Record<CardAccent, SubagentDirectorKey> = {
  blue: 'accentBlue',
  violet: 'accentViolet',
  green: 'accentGreen',
  amber: 'accentAmber',
  rose: 'accentRose',
  slate: 'accentSlate',
};

export interface CardEditorProps {
  open: boolean;
  /** Absent creates a new card. */
  card?: CharacterCard;
  /** Optional prefill for a new card (duplicate flow). */
  initial?: CharacterCard;
  /** Override the create/edit decision; defaults to `card === undefined`. */
  create?: boolean;
  routes: readonly DirectorAllowedRoute[];
  modelSelectionEnabled: boolean;
  existingIds: ReadonlySet<string>;
  t: (key: SubagentDirectorKey) => string;
  /** `force` skips the unsaved-changes confirmation (used after a save). */
  onClose: (force?: boolean) => void;
  onSave: (card: CharacterCard, create: boolean) => Promise<string | undefined>;
}

interface Draft {
  name: string;
  id: string;
  emoji: string;
  accent: CardAccent;
  tags: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  agentPreset: string;
  systemPrompt: string;
  persona: string;
  guidance: string;
  avoidGuidance: string;
  notes: string;
  enabled: boolean;
}

function blankDraft(): Draft {
  return {
    name: '',
    id: '',
    emoji: '',
    accent: 'blue',
    tags: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    agentPreset: '',
    systemPrompt: '',
    persona: '',
    guidance: '',
    avoidGuidance: '',
    notes: '',
    enabled: true,
  };
}

function draftOf(card: CharacterCard | undefined): Draft {
  if (card === undefined) return blankDraft();
  return {
    name: card.name,
    id: card.id,
    emoji: card.emoji ?? '',
    accent: card.accent ?? 'blue',
    tags: formatTagInput(card.tags),
    provider: card.model?.provider ?? '',
    model: card.model?.model ?? '',
    reasoningEffort: card.model?.reasoningEffort ?? '',
    agentPreset: card.agentPreset ?? '',
    systemPrompt: card.systemPrompt ?? '',
    persona: card.persona ?? '',
    guidance: card.delegationGuidance,
    avoidGuidance: card.avoidGuidance ?? '',
    notes: card.notes ?? '',
    enabled: card.enabled !== false,
  };
}

export function CardEditor(props: CardEditorProps): JSX.Element | null {
  const { open, card, initial, routes, modelSelectionEnabled, existingIds, t, onClose, onSave } = props;
  const create = props.create ?? card === undefined;
  const seed = card ?? initial;
  const seedDraft = (): Draft => {
    const next = draftOf(seed);
    if (create && next.id === '') next.id = cardIdFromName(next.name, existingIds);
    return next;
  };
  const [draft, setDraft] = useState<Draft>(seedDraft);
  const [idTouched, setIdTouched] = useState(seed !== undefined && seed.id !== '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialJson = useRef(JSON.stringify(seedDraft()));
  const dirty = JSON.stringify(draft) !== initialJson.current;
  useDialogFocus(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const next = seedDraft();
    setDraft(next);
    initialJson.current = JSON.stringify(next);
    setIdTouched(seed !== undefined && seed.id !== '');
    setBusy(false);
    setFailure(undefined);
    const timer = window.setTimeout(() => nameRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!busy && (!dirty || window.confirm(t('cardDirtyConfirm')))) onClose(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dirty, busy, onClose, t]);

  useEffect(() => {
    if (!open || !create || idTouched) return;
    setDraft((current) => ({ ...current, id: cardIdFromName(current.name, existingIds) }));
  }, [open, create, idTouched, draft.name, existingIds]);

  if (!open) return null;

  const providers = providerNames(routes);
  const modelOptions = draft.provider === '' ? [] : modelsForProvider(routes, draft.provider);
  const noRoutes = routes.length === 0;
  const glyphs: readonly string[] = CARD_GLYPHS;
  const customGlyph = draft.emoji !== '' && !glyphs.includes(draft.emoji);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const close = (): void => {
    if (busy) return;
    if (dirty && !window.confirm(t('cardDirtyConfirm'))) return;
    onClose(true);
  };

  const save = async (): Promise<void> => {
    const name = draft.name.trim();
    const guidance = draft.guidance.trim();
    const id = draft.id.trim();
    if (name === '') {
      setFailure(t('cardNameRequired'));
      return;
    }
    if (guidance === '') {
      setFailure(t('cardGuidanceRequired'));
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > CARD_LIMITS.idLength) {
      setFailure(t('cardInvalidId'));
      return;
    }
    if (create && existingIds.has(id)) {
      setFailure(t('cardDuplicateId'));
      return;
    }
    if ((draft.provider === '') !== (draft.model === '')) {
      setFailure(t('cardModelPair'));
      return;
    }
    const tags = parseTagInput(draft.tags);
    const next: CharacterCard = {
      id,
      name,
      delegationGuidance: guidance,
      ...(draft.avoidGuidance.trim().length > 0 ? { avoidGuidance: draft.avoidGuidance.trim() } : {}),
      ...(draft.systemPrompt.trim().length > 0 ? { systemPrompt: draft.systemPrompt.trim() } : {}),
      ...(draft.persona.trim().length > 0 ? { persona: draft.persona.trim() } : {}),
      ...(draft.provider.trim().length > 0 && draft.model.trim().length > 0
        ? {
            model: {
              provider: draft.provider.trim(),
              model: draft.model.trim(),
              ...(draft.reasoningEffort.trim().length > 0 ? { reasoningEffort: draft.reasoningEffort.trim() } : {}),
            },
          }
        : {}),
      ...(draft.agentPreset.trim().length > 0 ? { agentPreset: draft.agentPreset.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(draft.emoji.trim().length > 0 ? { emoji: draft.emoji.trim() } : {}),
      accent: draft.accent,
      ...(draft.notes.trim().length > 0 ? { notes: draft.notes.trim() } : {}),
      enabled: draft.enabled,
      source: card?.source ?? 'local',
      ...(card?.createdAt !== undefined ? { createdAt: card.createdAt } : {}),
    };
    setBusy(true);
    setFailure(undefined);
    try {
      const message = await onSave(next, create);
      if (message !== undefined) {
        setFailure(message);
        return;
      }
      initialJson.current = JSON.stringify(draft);
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sd-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={dialogRef} className="sd-dialog sd-editor" role="dialog" aria-modal="true" aria-labelledby="sd-editor-title">
        <header className="sd-dialog-head">
          <div>
            <h2 id="sd-editor-title">{create ? t('cardEditorNew') : t('cardEditorEdit')}</h2>
            <p className="sd-hint">{t('cardEditorHint')}</p>
          </div>
          <button type="button" className="sd-icon-btn" aria-label={t('closeDialog')} onClick={close}>
            <IconX size={18} />
          </button>
        </header>

        <div className="sd-dialog-body">
          <section className="sd-form-section">
            <h3>{t('cardIdentity')}</h3>
            <div className="sd-grid sd-grid-2">
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-name">{t('cardName')}</label>
                <input
                  id="sd-card-name"
                  ref={nameRef}
                  className="sd-input"
                  value={draft.name}
                  maxLength={CARD_LIMITS.nameLength}
                  onChange={(event) => set('name', event.target.value)}
                />
              </div>
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-id">{t('cardId')}</label>
                <input
                  id="sd-card-id"
                  className="sd-input sd-mono-input"
                  value={draft.id}
                  readOnly={!create}
                  maxLength={CARD_LIMITS.idLength}
                  onChange={(event) => {
                    setIdTouched(true);
                    set('id', event.target.value.toLowerCase());
                  }}
                />
                <span className="sd-note">{create ? t('cardIdHint') : t('cardIdImmutable')}</span>
              </div>
            </div>
            <div className="sd-field">
              <span className="sd-label">{t('cardEmoji')}</span>
              <div className="sd-avatar-picker">
                <CardAvatar name={draft.name} emoji={draft.emoji} accent={draft.accent} size="lg" />
                <div className="sd-avatar-options" role="group" aria-label={t('cardEmoji')}>
                  <button
                    type="button"
                    className={'sd-avatar-option is-initial' + (draft.emoji === '' ? ' is-active' : '')}
                    aria-pressed={draft.emoji === ''}
                    onClick={() => set('emoji', '')}
                  >
                    {t('cardAvatarInitial')}
                  </button>
                  {glyphs.map((glyph) => (
                    <button
                      key={glyph}
                      type="button"
                      className={'sd-avatar-option' + (draft.emoji === glyph ? ' is-active' : '')}
                      aria-pressed={draft.emoji === glyph}
                      onClick={() => set('emoji', glyph)}
                    >
                      {glyph}
                    </button>
                  ))}
                  {customGlyph ? (
                    <span className="sd-avatar-custom" title={t('cardAvatarCustom')}>
                      <span className="sd-avatar-custom-glyph">{draft.emoji}</span>
                      <span>{t('cardAvatarCustom')}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="sd-grid sd-grid-2">
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-accent">{t('cardAccent')}</label>
                <select
                  id="sd-card-accent"
                  className="sd-select"
                  value={draft.accent}
                  onChange={(event) => set('accent', event.target.value as CardAccent)}
                >
                  {CARD_ACCENTS.map((accent) => <option key={accent} value={accent}>{t(ACCENT_KEYS[accent])}</option>)}
                </select>
              </div>
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-tags">{t('cardTags')}</label>
                <input
                  id="sd-card-tags"
                  className="sd-input"
                  value={draft.tags}
                  onChange={(event) => set('tags', event.target.value)}
                />
                <span className="sd-note">{t('cardTagsHint')}</span>
              </div>
            </div>
          </section>

          <section className="sd-form-section">
            <h3>{t('cardModel')}</h3>
            <p className="sd-hint">{t('cardModelHint')}</p>
            {noRoutes ? <p className="sd-warn-text">{t('noAllowedModelsShort')}</p> : null}
            <div className="sd-grid sd-grid-3">
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-provider">{t('cardProvider')}</label>
                <select
                  id="sd-card-provider"
                  className="sd-select"
                  value={draft.provider}
                  disabled={noRoutes}
                  onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value, model: '', reasoningEffort: '' }))}
                >
                  <option value="">{t('modelInherited')}</option>
                  {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </div>
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-model">{t('cardModelId')}</label>
                <select
                  id="sd-card-model"
                  className="sd-select"
                  value={draft.model}
                  disabled={noRoutes || modelOptions.length === 0}
                  onChange={(event) => set('model', event.target.value)}
                >
                  <option value="">{t('modelInherited')}</option>
                  {modelOptions.map((entry) => <option key={entry.model} value={entry.model}>{entry.label}</option>)}
                </select>
              </div>
              <div className="sd-field">
                <label className="sd-label" htmlFor="sd-card-effort">{t('cardReasoningEffort')}</label>
                <input
                  id="sd-card-effort"
                  className="sd-input"
                  value={draft.reasoningEffort}
                  placeholder={modelSelectionEnabled ? '' : t('modelAdvisory')}
                  onChange={(event) => set('reasoningEffort', event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="sd-form-section">
            <h3>{t('cardPrompts')}</h3>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-system-prompt">{t('cardSystemPrompt')}</label>
              <textarea
                id="sd-card-system-prompt"
                className="sd-textarea"
                value={draft.systemPrompt}
                maxLength={CARD_LIMITS.promptLength}
                onChange={(event) => set('systemPrompt', event.target.value)}
              />
              <span className="sd-note">{t('cardSystemPromptHint')}</span>
              <span className="sd-counter">{withReplacement(t('cardPromptLength'), { count: draft.systemPrompt.length })}</span>
            </div>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-persona">{t('cardPersona')}</label>
              <textarea
                id="sd-card-persona"
                className="sd-textarea"
                value={draft.persona}
                maxLength={CARD_LIMITS.promptLength}
                onChange={(event) => set('persona', event.target.value)}
              />
              <span className="sd-note">{t('cardPersonaHint')}</span>
              <span className="sd-counter">{withReplacement(t('cardPromptLength'), { count: draft.persona.length })}</span>
            </div>
          </section>

          <section className="sd-form-section">
            <h3>{t('cardGuidance')}</h3>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-guidance">{t('cardGuidanceRecommended')}</label>
              <textarea
                id="sd-card-guidance"
                className="sd-textarea"
                value={draft.guidance}
                maxLength={CARD_LIMITS.guidanceLength}
                aria-label={t('cardGuidanceRecommended')}
                onChange={(event) => set('guidance', event.target.value)}
              />
              <span className="sd-note">{t('cardGuidanceHint')}</span>
              <span className="sd-counter">
                {withReplacement(t('cardGuidanceLength'), { count: draft.guidance.length, max: CARD_LIMITS.guidanceLength })}
              </span>
            </div>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-avoid">{t('cardAvoidGuidance')}</label>
              <textarea
                id="sd-card-avoid"
                className="sd-textarea"
                value={draft.avoidGuidance}
                maxLength={CARD_LIMITS.guidanceLength}
                aria-label={t('cardAvoidGuidance')}
                onChange={(event) => set('avoidGuidance', event.target.value)}
              />
              <span className="sd-note">{t('cardAvoidGuidanceHint')}</span>
              <span className="sd-counter">
                {withReplacement(t('cardGuidanceLength'), { count: draft.avoidGuidance.length, max: CARD_LIMITS.guidanceLength })}
              </span>
            </div>
          </section>

          <section className="sd-form-section">
            <h3>{t('cardAdvanced')}</h3>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-preset">{t('cardAgentPreset')}</label>
              <input
                id="sd-card-preset"
                className="sd-input"
                value={draft.agentPreset}
                onChange={(event) => set('agentPreset', event.target.value)}
              />
              <span className="sd-note">{t('cardAgentPresetHint')}</span>
            </div>
            <div className="sd-field">
              <label className="sd-label" htmlFor="sd-card-notes">{t('cardNotes')}</label>
              <textarea
                id="sd-card-notes"
                className="sd-textarea"
                value={draft.notes}
                maxLength={CARD_LIMITS.notesLength}
                onChange={(event) => set('notes', event.target.value)}
              />
              <span className="sd-note">{t('cardNotesHint')}</span>
            </div>
            <label className="sd-toggle">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} />
              <span>
                <strong>{t('cardEnabled')}</strong>
                <span className="sd-note">{t('cardEnabledHint')}</span>
              </span>
            </label>
          </section>

          {failure !== undefined ? <p className="sd-error-text" role="alert">{failure}</p> : null}
        </div>

        <footer className="sd-dialog-foot">
          <button type="button" className="sd-btn sd-btn-ghost" disabled={busy} onClick={close}>{t('cardCancel')}</button>
          <button type="button" className="sd-btn sd-btn-primary" disabled={busy} onClick={() => void save()}>
            {create ? t('cardCreate') : t('cardSave')}
          </button>
        </footer>
      </div>
    </div>
  );
}

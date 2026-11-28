/** Import dialog for portable character-card JSON. */
import { useEffect, useRef, useState } from 'react';
import {
  CARD_BUNDLE_KIND,
  CARD_KIND,
  CARD_LIMITS,
  type CardImportIssue,
  type CardImportResult,
  type CardImportStrategy,
} from '../card-types.js';
import type { CardImportOutcome } from './store.js';
import type { SubagentDirectorKey } from './locales.js';
import { formatImportIssue } from './import-issues.js';
import { IconCheck, IconUpload, IconWarning, IconX } from './icons.js';
import { useDialogFocus } from './dialog-focus.js';

export interface ImportDialogProps {
  open: boolean;
  t: (key: SubagentDirectorKey) => string;
  onClose: () => void;
  onImport: (payload: unknown, strategy: CardImportStrategy) => Promise<CardImportOutcome>;
}

function withReplacement(template: string, values: Record<string, string | number>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) text = text.split('{' + key + '}').join(String(value));
  return text;
}

/** Minimal file surface the dialog reads; `read()` rejects on browser read errors. */
export interface ImportFileLike {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

/** Outcome of reading the selected files; failures are dictionary keys, not host text. */
export type ImportFileRead =
  | { ok: true; contents: string[]; names: string[] }
  | { ok: false; failure: 'importFileTooLarge' | 'importReadFailed' };

/**
 * Read the selected files under the import byte limit. Browser read errors and
 * oversize input collapse to localized dictionary keys; the error object is
 * never surfaced.
 */
export async function readImportFiles(
  files: readonly ImportFileLike[],
  byteLimit: number,
): Promise<ImportFileRead> {
  const accepted: ImportFileLike[] = [];
  for (const file of files) {
    if (file.size > byteLimit) return { ok: false, failure: 'importFileTooLarge' };
    accepted.push(file);
  }
  if (accepted.reduce((total, file) => total + file.size, 0) > byteLimit) {
    return { ok: false, failure: 'importFileTooLarge' };
  }
  try {
    const contents = await Promise.all(accepted.map((file) => file.text()));
    return { ok: true, contents, names: accepted.map((file) => file.name) };
  } catch {
    return { ok: false, failure: 'importReadFailed' };
  }
}

/** Inline import failure line; the caller passes already-localized text. */
export function ImportFailure({ text }: { text: string }): JSX.Element {
  return <p className="sd-error-text" role="alert">{text}</p>;
}

export interface ImportIssuesProps {
  issues: readonly CardImportIssue[];
  t: (key: SubagentDirectorKey) => string;
}

/** Localized rejected-entry list; technical host messages never render. */
export function ImportIssues({ issues, t }: ImportIssuesProps): JSX.Element {
  return (
    <div className="sd-import-issues">
      <div className="sd-import-issues-head">
        <IconWarning size={14} /> {withReplacement(t('importIssueCount'), { count: issues.length })}
      </div>
      <ul>
        {issues.slice(0, 6).map((issue, index) => (
          <li key={index}>{formatImportIssue(t, issue)}</li>
        ))}
      </ul>
    </div>
  );
}

function countCards(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countCards(entry), 0);
  if (value === null || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  if (record.kind === CARD_BUNDLE_KIND || Array.isArray(record.cards)) {
    return Array.isArray(record.cards) ? record.cards.reduce((sum, entry) => sum + countCards(entry), 0) : 0;
  }
  if (record.kind === CARD_KIND) return countCards(record.card);
  return 1;
}

export function ImportDialog({ open, t, onClose, onImport }: ImportDialogProps): JSX.Element | null {
  const [texts, setTexts] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [strategy, setStrategy] = useState<CardImportStrategy>('skip');
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const [parseError, setParseError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<CardImportResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setTexts([]);
    setFileNames([]);
    setPaste('');
    setStrategy('skip');
    setPreview(undefined);
    setParseError(undefined);
    setFailure(undefined);
    setResult(undefined);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    const inputs = [...texts, ...(paste.trim().length > 0 ? [paste] : [])];
    if (inputs.length === 0) {
      setPreview(undefined);
      setParseError(undefined);
      return;
    }
    let count = 0;
    for (const text of inputs) {
      try {
        count += countCards(JSON.parse(text));
      } catch {
        setPreview(undefined);
        setParseError(t('importParseError'));
        return;
      }
    }
    setParseError(undefined);
    setPreview(count);
  }, [texts, paste, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const readFiles = async (files: FileList | readonly File[]): Promise<void> => {
    const outcome = await readImportFiles(Array.from(files), CARD_LIMITS.importBytes);
    if (!outcome.ok) {
      setFailure(t(outcome.failure));
      return;
    }
    setTexts(outcome.contents);
    setFileNames(outcome.names);
    setFailure(undefined);
    setResult(undefined);
  };

  const runImport = async (): Promise<void> => {
    const inputs = [...texts, ...(paste.trim().length > 0 ? [paste] : [])];
    if (inputs.length === 0) {
      setFailure(t('importNoCards'));
      return;
    }
    let parsed: unknown[];
    try {
      parsed = inputs.map((text) => JSON.parse(text));
    } catch {
      setFailure(t('importParseError'));
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      const payload = parsed.length === 1 ? parsed[0] : parsed;
      const outcome = await onImport(payload, strategy);
      if (!outcome.ok) {
        setFailure(outcome.message);
        return;
      }
      setResult(outcome.value);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  const total = result === undefined ? 0 : result.imported + result.overwritten + result.duplicated;

  return (
    <div className="sd-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="sd-dialog sd-import" role="dialog" aria-modal="true" aria-labelledby="sd-import-title">
        <header className="sd-dialog-head">
          <div>
            <h2 id="sd-import-title">{t('importTitle')}</h2>
            <p className="sd-hint">{t('importBody')}</p>
          </div>
          <button type="button" className="sd-icon-btn" aria-label={t('closeDialog')} disabled={busy} onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>

        <div className="sd-dialog-body">
          <button
            type="button"
            className={'sd-dropzone' + (dragging ? ' is-dragging' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length > 0) void readFiles(event.dataTransfer.files);
            }}
          >
            <IconUpload size={22} />
            <strong>{t('importDrop')}</strong>
            <span className="sd-hint">{t('importBrowse')} · {t('importHintFiles')}</span>
            {fileNames.length > 0 ? <span className="sd-chip">{fileNames.join(', ')}</span> : null}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files !== null && event.target.files.length > 0) void readFiles(event.target.files);
              event.target.value = '';
            }}
          />

          <div className="sd-field">
            <label className="sd-label" htmlFor="sd-import-paste">{t('importPaste')}</label>
            <textarea
              id="sd-import-paste"
              className="sd-textarea sd-textarea-code"
              value={paste}
              placeholder='{ "kind": "subagent-director/character-card-collection", "version": 2, "cards": [] }'
              onChange={(event) => {
                setPaste(event.target.value);
                setResult(undefined);
              }}
            />
            <span className="sd-note">{t('importPasteHint')}</span>
          </div>

          <fieldset className="sd-fieldset">
            <legend className="sd-label">{t('importStrategy')}</legend>
            {([
              ['skip', t('importSkip'), t('importSkipHint')],
              ['overwrite', t('importOverwrite'), t('importOverwriteHint')],
              ['duplicate', t('importDuplicate'), t('importDuplicateHint')],
            ] as Array<[CardImportStrategy, string, string]>).map(([value, label, hint]) => (
              <label key={value} className="sd-radio">
                <input
                  type="radio"
                  name="sd-import-strategy"
                  value={value}
                  checked={strategy === value}
                  onChange={() => setStrategy(value)}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="sd-note">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {parseError !== undefined ? <ImportFailure text={parseError} /> : null}
          {failure !== undefined ? <ImportFailure text={failure} /> : null}
          {preview !== undefined ? (
            <p className="sd-note" role="status">{withReplacement(t('importPreview'), { count: preview })}</p>
          ) : null}

          {result !== undefined ? (
            <div className="sd-import-result" role="status">
              <div className="sd-import-result-head">
                <IconCheck size={16} />
                <strong>{withReplacement(t('importSummary'), { count: total })}</strong>
              </div>
              <p className="sd-note">
                {withReplacement(t('importResult'), {
                  imported: result.imported,
                  overwritten: result.overwritten,
                  skipped: result.skipped,
                  duplicated: result.duplicated,
                })}
              </p>
              {result.issues.length > 0 ? <ImportIssues issues={result.issues} t={t} /> : null}
            </div>
          ) : null}
        </div>

        <footer className="sd-dialog-foot">
          <button type="button" className="sd-btn sd-btn-ghost" disabled={busy} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="sd-btn sd-btn-primary" disabled={busy || preview === undefined} onClick={() => void runImport()}>
            {t('importRun')}
          </button>
        </footer>
      </div>
    </div>
  );
}

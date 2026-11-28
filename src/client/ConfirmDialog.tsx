/** Generic confirmation dialog for destructive or irreversible card actions. */
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { SubagentDirectorKey } from './locales.js';
import { IconWarning, IconX } from './icons.js';
import { useDialogFocus } from './dialog-focus.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  t: (key: SubagentDirectorKey) => string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: JSX.Element;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  const { open, title, body, confirmLabel, cancelLabel, danger, busy, t, onConfirm, onCancel, children } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && busy !== true) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="sd-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== true) onCancel(); }}>
      <div ref={dialogRef} className="sd-dialog sd-confirm" role="dialog" aria-modal="true" aria-labelledby="sd-confirm-title">
        <header className="sd-dialog-head">
          <div className="sd-confirm-title">
            {danger === true ? <span className="sd-confirm-icon"><IconWarning size={18} /></span> : null}
            <h2 id="sd-confirm-title">{title}</h2>
          </div>
          <button type="button" className="sd-icon-btn" aria-label={t('closeDialog')} disabled={busy} onClick={onCancel}>
            <IconX size={18} />
          </button>
        </header>
        <div className="sd-dialog-body">
          <p className="sd-confirm-body">{body}</p>
          {children}
        </div>
        <footer className="sd-dialog-foot">
          <button type="button" className="sd-btn sd-btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? t('cancel')}
          </button>
          <button
            type="button"
            className={'sd-btn ' + (danger === true ? 'sd-btn-danger' : 'sd-btn-primary')}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

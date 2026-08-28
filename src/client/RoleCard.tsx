/** One role template card: read-only summary plus an inline editor.
 * Provider/model/effort selects cascade from the model catalog; writes go
 * through the controller as path ops, and failures return a localized message. */
import { useState } from 'react';
import type { ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client';
import type { SubagentDirectorKey } from './locales.js';
import type { RoleDraft, StoredRole } from './store-logic.js';
import { ToolSetPicker } from './ToolSetPicker.js';
import {
  cardStyle,
  dangerButtonStyle,
  fieldLabelStyle,
  ghostButtonStyle,
  primaryButtonStyle,
  rowStyle,
  selectStyle,
  textAreaStyle,
  textInputStyle,
  token,
} from './ui.js';

export interface RoleCardProps {
  /** Persisted role id (kebab-case). */
  id: string;
  /** Persisted role value. */
  role: StoredRole;
  /** Whether this role is the defaultRole. */
  isDefault: boolean;
  /** Available providers (for the provider select). */
  groups: readonly ModelProviderGroup[];
  /** Distinct model-visible tool names (for the tool-set row). */
  tools: readonly string[];
  /** Section copy. */
  t: (key: SubagentDirectorKey) => string;
  /** Commit an edited role; returns a localized failure message or undefined. */
  onSave: (draft: RoleDraft) => Promise<string | undefined>;
  /** Delete this role; returns a localized failure message or undefined. */
  onDelete: () => Promise<string | undefined>;
  /** Promote this role to default; returns a localized failure message or undefined. */
  onSetDefault: () => Promise<string | undefined>;
}

function effortsFor(groups: readonly ModelProviderGroup[], provider: string | undefined, model: string | undefined): readonly { id: string; name: string }[] {
  if (!provider || !model) return [];
  const group = groups.find((g) => g.id === provider);
  const entry = group?.models.find((m) => m.id === model);
  return entry?.reasoning?.efforts ?? [];
}

export function RoleCard({ id, role, isDefault, groups, tools, t, onSave, onDelete, onSetDefault }: RoleCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<RoleDraft>({
    displayName: role.displayName,
    description: role.description,
    persona: role.persona ?? '',
    provider: role.provider ?? '',
    model: role.model ?? '',
    reasoningEffort: role.reasoningEffort ?? '',
    toolFilter: { allow: role.toolFilter?.allow ?? [] },
  });

  const provider = draft.provider || role.provider;
  const model = draft.model || role.model;
  const modelOptions = provider ? (groups.find((g) => g.id === provider)?.models ?? []) : [];
  const effortOptions = effortsFor(groups, provider, model);

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      const message = await onSave(draft);
      if (message !== undefined) {
        setFailure(message);
        return;
      }
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(t('confirmDeleteRole').replace('{id}', id))) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const message = await onDelete();
      if (message !== undefined) setFailure(message);
    } finally {
      setBusy(false);
    }
  };

  const setField = (field: keyof RoleDraft, value: string): void => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const allowList = draft.toolFilter?.allow ?? [];

  if (editing) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ color: token.labelPrimary, fontSize: 14 }}>{t('roleDisplayName')}</strong>
          {isDefault ? <span style={{ color: token.accent, fontSize: 12 }}>{t('defaultRoleBadge')}</span> : null}
        </div>
        <div style={rowStyle}>
          <label style={fieldLabelStyle}>{t('roleDisplayName')}</label>
          <input style={textInputStyle} value={draft.displayName} placeholder={t('displayNamePlaceholder')} onChange={(e) => setField('displayName', e.target.value)} />
        </div>
        <div style={rowStyle}>
          <label style={fieldLabelStyle}>{t('roleDescription')}</label>
          <textarea style={textAreaStyle} value={draft.description} placeholder={t('descriptionPlaceholder')} onChange={(e) => setField('description', e.target.value)} />
        </div>
        <div style={rowStyle}>
          <label style={fieldLabelStyle}>{t('rolePersona')}</label>
          <textarea style={textAreaStyle} value={draft.persona} placeholder={t('personaPlaceholder')} onChange={(e) => setField('persona', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <div style={rowStyle}>
            <label style={fieldLabelStyle}>{t('provider')}</label>
            <select
              style={selectStyle}
              value={draft.provider}
              disabled={groups.length === 0}
              onChange={(e) => setField('provider', e.target.value)}
            >
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label style={fieldLabelStyle}>{t('model')}</label>
            <select
              style={selectStyle}
              value={draft.model}
              disabled={modelOptions.length === 0}
              onChange={(e) => setField('model', e.target.value)}
            >
              <option value="">—</option>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label style={fieldLabelStyle}>{t('reasoningEffort')}</label>
            <select
              style={selectStyle}
              value={draft.reasoningEffort}
              disabled={effortOptions.length === 0}
              onChange={(e) => setField('reasoningEffort', e.target.value)}
            >
              <option value="">—</option>
              {effortOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={rowStyle}>
          <ToolSetPicker
            tools={tools}
            selected={allowList}
            t={t}
            onChange={(allow) => setDraft((d) => ({ ...d, toolFilter: { allow } }))}
          />
        </div>
        {failure !== undefined ? <div style={{ color: token.danger, fontSize: 12 }}>{failure}</div> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryButtonStyle} disabled={busy} onClick={save}>{t('save')}</button>
          <button style={ghostButtonStyle} disabled={busy} onClick={() => setEditing(false)}>{t('cancel')}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ color: token.labelPrimary, fontSize: 14 }}>{role.displayName || id}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: token.labelTertiary, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{id}</span>
          {isDefault ? <span style={{ color: token.accent, fontSize: 12 }}>{t('defaultRoleBadge')}</span> : null}
        </div>
      </div>
      {role.description ? (
        <p style={{ margin: 0, color: token.labelSecondary, fontSize: 13, lineHeight: '18px' }}>{role.description}</p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Metadata label={t('provider')} value={role.provider} />
        <Metadata label={t('model')} value={role.model} />
        <Metadata label={t('reasoningEffort')} value={role.reasoningEffort} />
        {role.persona ? <Metadata label={t('persona')} value={role.persona} /> : null}
        {role.toolFilter?.allow?.length ? (
          <Metadata label={t('toolFilter')} value={role.toolFilter.allow.join(', ')} />
        ) : null}
      </div>
      {failure !== undefined ? <div style={{ color: token.danger, fontSize: 12 }}>{failure}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={ghostButtonStyle} disabled={busy} onClick={() => setEditing(true)}>{t('edit')}</button>
        <button style={ghostButtonStyle} disabled={busy || isDefault} onClick={() => (void onSetDefault(), undefined)}>{t('setDefaultRole')}</button>
        <button style={dangerButtonStyle} disabled={busy} onClick={remove}>{t('deleteRole')}</button>
      </div>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string | undefined }): JSX.Element | null {
  if (!value) return null;
  return (
    <span style={{ color: token.labelSecondary, fontSize: 12 }}>
      {label}: <span style={{ color: token.labelPrimary }}>{value}</span>
    </span>
  );
}

/**
 * Subagent Director settings section (design section 9): the default-model row
 * plus the role-template cards. The slot outlet erases the share boundary and
 * delivers the inject face flat (PropsRuntime<'settings.section'> renderer is
 * the DSH shell); this component guards for a not-yet-injected render and then
 * renders its content column from the live snapshot.
 *
 * State lives in the page store (SubagentOptionsStore); every write travels as
 * path ops through settings.mutate with an optimistic-revision lock, so the
 * section only ever echoes the acknowledge-and-reload outcome. Failures return
 * a localized message that the save/delete/restore controls surface inline.
 */
import { useEffect, useState } from 'react';
import type { SnapshotSelectorHook } from './bind.js';
import type { ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client';
import type { SubagentDirectorKey } from './locales.js';
import type { SubagentOptionsState, SubagentOptionsStore } from './store.js';
import type { RoleDraft, StoredRole } from './store-logic.js';
import { roleIdFromName } from './store-logic.js';
import { RoleCard } from './RoleCard.js';
import {
  cardStyle,
  fieldLabelStyle,
  ghostButtonStyle,
  primaryButtonStyle,
  rowStyle,
  sectionWidth,
  selectStyle,
  textAreaStyle,
  textInputStyle,
  token,
} from './ui.js';

/** Injected dependencies of {@link SubagentOptionsSection} (slot `inject`). */
export interface SubagentOptionsSectionInjected {
    /** The page store (loaded on mount, refreshed on pushed invalidations). */
    controller: SubagentOptionsStore;
    /** uSES subscription hook bound to the store. */
    useSnapshot: SnapshotSelectorHook<SubagentOptionsState>;
    /** Wire faces the page writes through (kept for parity with the slot contract). */
    api: unknown;
    /** Section copy. */
    t: (key: SubagentDirectorKey) => string;
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type SubagentOptionsSectionProps = Partial<SubagentOptionsSectionInjected>;

/** Local draft of the default-model row. */
interface DefaultRowDraft {
    provider: string;
    model: string;
    reasoningEffort: string;
}

/** Derive reasoning-effort options from the catalog for an exact provider+model. */
function effortsFor(
    groups: readonly ModelProviderGroup[],
    provider: string | undefined,
    model: string | undefined,
): readonly { id: string; name: string }[] {
    if (!provider || !model) return [];
    const group = groups.find((g) => g.id === provider);
    const entry = group?.models.find((m) => m.id === model);
    return entry?.reasoning?.efforts ?? [];
}

/**
 * Render the Subagent Director settings section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function SubagentOptionsSection(props: SubagentOptionsSectionProps): JSX.Element | null {
    const { controller, useSnapshot, t } = props;
    if (controller === undefined || useSnapshot === undefined || t === undefined) return null;
    return <Loaded injected={{ controller, useSnapshot, t }} />;
}

interface LoadedInjected {
    controller: SubagentOptionsStore;
    useSnapshot: SnapshotSelectorHook<SubagentOptionsState>;
    t: (key: SubagentDirectorKey) => string;
}

function Loaded({ injected }: { injected: LoadedInjected }): JSX.Element | null {
    const { controller, t } = injected;
    const state = injected.useSnapshot((s) => s);

    // Kick the first load once when the page mounts (post-load refreshes ride
    // the pushed invalidations wired in apply()).
    useEffect(() => {
        if (state.status === 'idle' && !state.loading) void controller.load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.status, state.loading]);

    if (state.status === 'error') {
        return (
            <div style={sectionWidth}>
                <p style={{ color: token.danger, fontSize: 13 }}>{t('loadError')}: {state.error ?? ''}</p>
                <button style={ghostButtonStyle} onClick={() => void controller.load()}>{t('retry')}</button>
            </div>
        );
    }
    if (state.status !== 'ready') {
        return <div style={sectionWidth}><p style={{ color: token.labelSecondary, fontSize: 13 }}>{t('sectionIntro')}</p></div>;
    }

    const section = state.section;
    const writable = state.writable;
    const roles = section?.roles ?? {};
    const entries = Object.entries(roles) as [string, StoredRole][];
    const groups = state.models;

    return (
        <div style={sectionWidth}>
            <p style={{ margin: 0, color: token.labelSecondary, fontSize: 13, lineHeight: '18px' }}>{t('sectionIntro')}</p>
            <DefaultModelRow
                controller={controller}
                groups={groups}
                writable={writable}
                current={{
                    provider: section?.defaultProvider,
                    model: section?.defaultModel,
                    reasoningEffort: section?.defaultReasoningEffort,
                }}
                t={t}
            />
            <RolesBlock
                controller={controller}
                groups={groups}
                writable={writable}
                roles={entries}
                defaultRole={section?.defaultRole}
                t={t}
            />
        </div>
    );
}

/** The default-model row: provider → model → reasoning-effort cascade + restore. */
function DefaultModelRow({ controller, groups, writable, current, t }: {
    controller: SubagentOptionsStore;
    groups: readonly ModelProviderGroup[];
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
    const [done, setDone] = useState(false);

    // Reflect a fresh server snapshot into the draft (a pushed invalidation or a
    // restore reload; a user mid-edit is not clobbered because the section owns
    // the only editor for these three fields).
    useEffect(() => {
        if (busy) return;
        setDraft({
            provider: current.provider ?? '',
            model: current.model ?? '',
            reasoningEffort: current.reasoningEffort ?? '',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current.provider, current.model, current.reasoningEffort]);

    const provider = draft.provider;
    const model = draft.model;
    const modelOptions = provider ? (groups.find((g) => g.id === provider)?.models ?? []) : [];
    const effortOptions = effortsFor(groups, provider, model);

    const save = async (): Promise<void> => {
        setBusy(true);
        setFailure(undefined);
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
            setDone(true);
        } finally {
            setBusy(false);
        }
    };

    const restore = async (): Promise<void> => {
        setBusy(true);
        setFailure(undefined);
        try {
            const message = await controller.restoreDefaults();
            if (message !== undefined) {
                setFailure(message);
                return;
            }
            setDone(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ color: token.labelPrimary, fontSize: 14 }}>{t('defaultsHeading')}</strong>
                <button style={ghostButtonStyle} disabled={!writable || busy} onClick={() => void restore()}>{t('restoreDefaults')}</button>
            </div>
            <p style={{ margin: 0, color: token.labelSecondary, fontSize: 13, lineHeight: '18px' }}>{t('defaultsHint')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <div style={rowStyle}>
                    <label style={fieldLabelStyle}>{t('defaultProvider')}</label>
                    <select
                        style={selectStyle}
                        value={draft.provider}
                        disabled={!writable || groups.length === 0}
                        onChange={(e) => setDraft((d) => ({ provider: e.target.value, model: '', reasoningEffort: '' }))}
                    >
                        <option value="">—</option>
                        {groups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                </div>
                <div style={rowStyle}>
                    <label style={fieldLabelStyle}>{t('defaultModel')}</label>
                    <select
                        style={selectStyle}
                        value={draft.model}
                        disabled={!writable || modelOptions.length === 0}
                        onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value, reasoningEffort: '' }))}
                    >
                        <option value="">—</option>
                        {modelOptions.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                </div>
                <div style={rowStyle}>
                    <label style={fieldLabelStyle}>{t('defaultReasoningEffort')}</label>
                    <select
                        style={selectStyle}
                        value={draft.reasoningEffort}
                        disabled={!writable || effortOptions.length === 0}
                        onChange={(e) => setDraft((d) => ({ ...d, reasoningEffort: e.target.value }))}
                    >
                        <option value="">—</option>
                        {effortOptions.map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                    </select>
                </div>
            </div>
            {failure !== undefined ? <div style={{ color: token.danger, fontSize: 12 }}>{failure}</div> : null}
            {done ? <div style={{ color: token.accent, fontSize: 12 }}>{t('restoreDone')}</div> : null}
            <div style={{ display: 'flex', gap: 8 }}>
                <button style={primaryButtonStyle} disabled={!writable || busy} onClick={() => void save()}>{t('save')}</button>
            </div>
        </div>
    );
}

/** The role-template roster: cards plus an inline add form. */
function RolesBlock({ controller, groups, writable, roles, defaultRole, t }: {
    controller: SubagentOptionsStore;
    groups: readonly ModelProviderGroup[];
    writable: boolean;
    roles: [string, StoredRole][];
    defaultRole: string | undefined;
    t: (key: SubagentDirectorKey) => string;
}): JSX.Element {
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState<RoleDraft>({
        displayName: '',
        description: '',
        persona: '',
        provider: '',
        model: '',
        reasoningEffort: '',
    });
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | undefined>(undefined);

    const beginAdd = (): void => {
        setDraft({ displayName: '', description: '', persona: '', provider: '', model: '', reasoningEffort: '' });
        setFailure(undefined);
        setAdding(true);
    };

    const saveAdd = async (): Promise<void> => {
        setBusy(true);
        setFailure(undefined);
        try {
            const existing = new Set(roles.map(([id]) => id));
            const id = roleIdFromName(draft.displayName, existing);
            const message = await controller.addRole(id, draft);
            if (message !== undefined) {
                setFailure(message);
                return;
            }
            setAdding(false);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ color: token.labelPrimary, fontSize: 14 }}>{t('rolesHeading')}</strong>
                <button style={ghostButtonStyle} disabled={!writable || adding} onClick={beginAdd}>{t('addRole')}</button>
            </div>
            <p style={{ margin: 0, color: token.labelSecondary, fontSize: 13, lineHeight: '18px' }}>{t('rolesHint')}</p>

            {adding ? (
                <div style={{ border: '1px dashed ' + token.border, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={rowStyle}>
                        <label style={fieldLabelStyle}>{t('roleDisplayName')}</label>
                        <input
                            style={textInputStyle}
                            value={draft.displayName}
                            placeholder={t('displayNamePlaceholder')}
                            onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                        />
                    </div>
                    <div style={rowStyle}>
                        <label style={fieldLabelStyle}>{t('roleDescription')}</label>
                        <textarea
                            style={textAreaStyle}
                            value={draft.description}
                            placeholder={t('descriptionPlaceholder')}
                            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        />
                    </div>
                    {failure !== undefined ? <div style={{ color: token.danger, fontSize: 12 }}>{failure}</div> : null}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button style={primaryButtonStyle} disabled={!writable || busy} onClick={() => void saveAdd()}>{t('addRole')}</button>
                        <button style={ghostButtonStyle} disabled={busy} onClick={() => setAdding(false)}>{t('cancel')}</button>
                    </div>
                </div>
            ) : null}

            {roles.length === 0 && !adding ? (
                <p style={{ margin: 0, color: token.labelSecondary, fontSize: 13 }}>{t('emptyRoles')}</p>
            ) : (
                roles.map(([id, role]) => (
                    <RoleCard
                        key={id}
                        id={id}
                        role={role}
                        isDefault={defaultRole === id}
                        groups={groups}
                        t={t}
                        onSave={(d: RoleDraft) => controller.updateRole(id, role, d)}
                        onDelete={() => controller.removeRole(id)}
                        onSetDefault={() => controller.setDefaultRole(id)}
                    />
                ))
            )}
        </div>
    );
}

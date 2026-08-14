/**
 * Subagent Director — M3b observability dock readout.
 *
 * Contributes a single ambient line to the `conversation.composer.dock` seat
 * (the band under the composer card). When the current session is an
 * addressed subagent child it shows the provider/model that child actually
 * ran on, read off the opened transcript's latest assistant message (zero
 * extra RPC — see subagent-model.ts). When the transcript has not yet proven
 * a model — a just-created child, or a transcript whose provider reported no
 * provenance — it degrades to a short notice. Ordinary sessions render
 * nothing, so the dock stays clean.
 *
 * The dock is an additive list slot declared by ui-conversation at runtime;
 * we only contribute an occupant, never re-declare it. Our compile-time
 * SlotMap augmentation in index.ts narrows the registration typing.
 */

import type { ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SubagentDirectorKey } from './locales.js';
import { formatModelRef, isAddressedSubagent, latestSubagentModel, type SubagentModelRef } from './subagent-model.js';

/** Owner currency of the composer dock as ui-conversation declares it. */
export interface ComposerDockOwner {
    readonly session: ConversationSnapshot | undefined;
}

/** Full props of the dock entry: runtime (owner session) plus the locale seat. */
export type SubagentModelDockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<typeof NS>;

/** Locale namespace shared with the settings page (registered in index apply). */
export const NS = 'settings.subagentDirector' as const;

/** Inline styling using the shared token surface (no CSS pipeline; M2 deviation). */
const style: { [key: string]: React.CSSProperties } = {
    root: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 16px',
        fontSize: 12,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
    },
    ref: {
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'var(--dsw-font-family-mono, monospace)',
    },
};

/** Render the provider/model readout for an addressed subagent, or nothing. */
export function SubagentModelDock({
    session,
    t,
}: SubagentModelDockProps): React.JSX.Element | null {
    if (!isAddressedSubagent(session)) return null;
    const lookup = latestSubagentModel(session as ConversationSnapshot);
    if (!lookup.found) {
        return (
            <div style={style.root} role="status">
                {t('modelNotRecorded')}
            </div>
        );
    }
    const ref: SubagentModelRef = lookup;
    return (
        <div style={style.root} role="status">
            <span>{t('modelRanOn')}</span>
            <span style={style.ref} title={t('modelRanOnTitle', { model: formatModelRef(ref) })}>
                {formatModelRef(ref)}
            </span>
        </div>
    );
}

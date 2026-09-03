/**
 * Subagent Director — "release sustained state" header action (issue #1).
 *
 * Contributes one button to the `conversation.session.header.actions` seat
 * (the additive per-session control row beside the session title). It renders
 * only while the CURRENT session is a continuable subagent child
 * (snapshot.subagent.address.mode === 'continuable') and otherwise returns
 * null, so ordinary sessions and one-shot children see nothing.
 *
 * Clicking asks the Host bridge's `subagentClose` endpoint to
 * drainContinuableChildren under the address's durable parent authority; on
 * success the button turns into a settled label, on failure a short inline
 * error shows the core message.
 */

import { useEffect, useState } from 'react';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import {
  SUBAGENT_DIRECTOR_RPC_CHANNEL,
  SUBAGENT_DIRECTOR_RPC_CLOSE,
} from '../bridge-contract.js';
import type { SubagentDirectorKey } from './locales.js';
import { isContinuableChild } from './subagent-model.js';
import { dangerButtonStyle, token } from './ui.js';

/** Business face injected by the registration (client/index.ts). */
export interface SubagentCloseActionInjected {
  /** Generic RPC caller for the /subagent-director bridge channel. */
  rpc: ClientConnectionRpc;
}

/** Full props: framework session kit + injected RPC + locale seat. */
export type SubagentCloseActionProps = PropsRuntime<'conversation.session.header.actions'> &
  InjectFace<SubagentCloseActionInjected> &
  PropsLocale<typeof NS>;

/** Locale namespace shared with the settings page (registered in index apply). */
export const NS = 'settings.subagentDirector' as const;

type ActionState = 'idle' | 'closing' | 'closed' | 'failed';

/** Inline styling using the shared token surface (no CSS pipeline; M2 deviation). */
const style: { [key: string]: React.CSSProperties } = {
  wrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    ...dangerButtonStyle,
    height: 24,
    fontSize: 12,
    padding: '0 10px',
  },
  settled: {
    color: token.labelTertiary,
    fontSize: 12,
    lineHeight: '16px',
  },
  error: {
    color: token.danger,
    fontSize: 12,
    lineHeight: '16px',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};

/** Render the release-sustained-state button for a continuable child, or nothing. */
export function SubagentCloseAction({
  useSession,
  sessionId,
  rpc,
  t,
}: SubagentCloseActionProps): React.JSX.Element | null {
  const session = useSession((s: SessionSnapshot) => s);
  const [state, setState] = useState<ActionState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Reset the outcome when the user switches to another session.
  useEffect(() => {
    setState('idle');
    setError(null);
  }, [sessionId]);

  if (!isContinuableChild(session)) return null;
  const address = session!.subagent!.address;

  const onClose = async (): Promise<void> => {
    if (state === 'closing') return;
    setState('closing');
    setError(null);
    try {
      const result = await rpc.call(SUBAGENT_DIRECTOR_RPC_CHANNEL, SUBAGENT_DIRECTOR_RPC_CLOSE, {
        parentSessionId: address.parentSessionId,
        childSessionId: address.childSessionId,
      });
      if (result.ok) {
        setState('closed');
      } else {
        setState('failed');
        setError(result.error.message);
      }
    } catch {
      setState('failed');
    }
  };

  if (state === 'closed') {
    return (
      <div style={style.wrap} role="status">
        <span style={style.settled}>{t('closedSubagent')}</span>
      </div>
    );
  }

  return (
    <div style={style.wrap}>
      <button
        type="button"
        style={style.button}
        disabled={state === 'closing'}
        onClick={() => {
          const confirmed =
            typeof window === 'undefined' ||
            window.confirm(t('confirmCloseContinuable', { id: address.childSessionId }));
          if (confirmed) void onClose();
        }}
        title={t('closeContinuableTitle', { id: address.childSessionId })}
      >
        {state === 'closing' ? t('closingContinuable') : t('closeContinuable')}
      </button>
      {state === 'failed' && (
        <span style={style.error} role="alert">
          {t('closeFailed', { message: error ?? '' })}
        </span>
      )}
    </div>
  );
}

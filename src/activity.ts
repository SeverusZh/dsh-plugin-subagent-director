/** Pure fold of Subagent Director calls for renderer-neutral clients. */

import type { SessionEvent } from '@deepseek-ai/dsh-session';

import {
  type DirectorActivityEntry,
  type DirectorActivityMode,
  type DirectorActivityProjection,
} from './blue-contract.js';

const MAX_ACTIVITY_ENTRIES = 32;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    return object(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

function resultFacts(event: Extract<SessionEvent, { type: 'tool/result' }>): {
  callId: string;
  failed: boolean;
  mode: DirectorActivityMode;
  targetId?: string;
} {
  const block = event.data.message.content[0];
  const meta = object(event.data.meta);
  const kind = nonEmpty(meta?.kind);
  const mode: DirectorActivityMode = kind === 'foreground'
    ? 'foreground'
    : kind === 'continuable'
      ? 'continuable'
      : kind === 'background'
        ? 'one-shot'
        : 'unknown';
  const targetId = kind === 'continuable'
    ? nonEmpty(meta?.subagentId)
    : kind === 'background'
      ? nonEmpty(meta?.jobId)
      : nonEmpty(meta?.runId);
  return {
    callId: String(block.toolCallId),
    failed: block.isError === true,
    mode,
    ...(targetId === undefined ? {} : { targetId }),
  };
}

/** Fold one ordinary Harness event into the bounded Director activity view. */
export function applyDirectorActivityEvent(
  state: DirectorActivityProjection,
  event: SessionEvent,
  toolName: string,
): DirectorActivityProjection {
  if (event.type === 'tool/call' && event.data.name === toolName) {
    const args = parseArguments(event.data.arguments);
    const entry: DirectorActivityEntry = {
      callId: String(event.data.callId),
      description: nonEmpty(args.description) ?? 'Delegated task',
      ...(nonEmpty(args.role) === undefined ? {} : { roleId: nonEmpty(args.role) }),
      ...(nonEmpty(args.provider) === undefined ? {} : { provider: nonEmpty(args.provider) }),
      ...(nonEmpty(args.model) === undefined ? {} : { model: nonEmpty(args.model) }),
      status: 'pending',
      mode: 'unknown',
      startedAt: event.time,
      updatedAt: event.time,
    };
    const withoutDuplicate = state.entries.filter((item) => item.callId !== entry.callId);
    return { version: 1, entries: [...withoutDuplicate, entry].slice(-MAX_ACTIVITY_ENTRIES) };
  }

  if (event.type !== 'tool/result') return state;
  const facts = resultFacts(event);
  const index = state.entries.findIndex((entry) => entry.callId === facts.callId);
  if (index < 0) return state;
  const previous = state.entries[index]!;
  const status = facts.failed
    ? 'failed'
    : facts.mode === 'foreground'
      ? 'completed'
      : 'delegated';
  const next: DirectorActivityEntry = {
    ...previous,
    status,
    mode: facts.mode,
    ...(facts.targetId === undefined ? {} : { targetId: facts.targetId }),
    updatedAt: event.time,
  };
  const entries = [...state.entries];
  entries[index] = next;
  return { version: 1, entries };
}

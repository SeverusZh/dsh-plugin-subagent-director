/** Renderer-neutral data shared by the Director Host and Blue frontend. */

import type { RoleTemplate, SubagentDirectorSettings } from './route-resolver.js';

export type DirectorActivityStatus = 'pending' | 'delegated' | 'completed' | 'failed';
export type DirectorActivityMode = 'foreground' | 'one-shot' | 'continuable' | 'unknown';

export interface DirectorActivityEntry {
  callId: string;
  description: string;
  roleId?: string;
  provider?: string;
  model?: string;
  status: DirectorActivityStatus;
  mode: DirectorActivityMode;
  targetId?: string;
  startedAt: number;
  updatedAt: number;
}

export interface DirectorActivityProjection {
  version: 1;
  entries: DirectorActivityEntry[];
}

export interface DirectorActivitySnapshot extends DirectorActivityProjection {
  sessionId?: string;
}

export interface DirectorRuntimeSnapshot {
  settings: SubagentDirectorSettings;
  toolName: string;
  transport: string;
  backgroundMode: 'one-shot' | 'continuable';
}

export interface DirectorOrchestrateSnapshot {
  mode: 'on' | 'off';
  sessionId?: string;
}

/** Host-owned mutations exposed to renderer-neutral frontends. */
export interface SubagentDirectorHost {
  snapshot(): DirectorRuntimeSnapshot;
  activity(sessionId?: string): DirectorActivitySnapshot;
  orchestrate(sessionId?: string): DirectorOrchestrateSnapshot;
  watch(listener: () => void): () => void;
  saveRole(id: string, role: RoleTemplate): Promise<void>;
  deleteRole(id: string): Promise<void>;
}

/**
 * In-memory storage-domain fixture for card tests.
 *
 * The real domain stores per-record JSON under the Host storage root; this fake
 * keeps the same table/global surface so the repository can be exercised
 * without a live storage backend or filesystem.
 */
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { CardService } from '../src/card-store.js';
import type { SubagentDirectorSettings } from '../src/route-resolver.js';

type Tables = Map<string, Map<string, unknown>>;

export interface MemoryDomain {
  facility: DomainFacility;
  tables: Tables;
  global: { value: Record<string, unknown> };
  /** Record keys whose next write is rejected, for migration failure probes. */
  failPuts: Set<string>;
}

export function createMemoryDomain(): MemoryDomain {
  const tables: Tables = new Map();
  const global = { value: {} as Record<string, unknown> };
  const failPuts = new Set<string>();
  const domain = {
    name: 'subagent_director',
    global: {
      get: () => global.value,
      set: async (value: Record<string, unknown>) => {
        global.value = value;
      },
    },
    table: (name: string) => {
      let table = tables.get(name);
      if (table === undefined) {
        table = new Map();
        tables.set(name, table);
      }
      const map = table;
      return {
        get: (key: string) => map.get(key),
        entries: () => map.entries(),
        keys: () => map.keys(),
        size: map.size,
        put: async (key: string, value: unknown) => {
          if (failPuts.has(key)) throw new Error('injected put failure for ' + key);
          map.set(key, value);
        },
        delete: async (key: string) => map.delete(key),
        deleteMany: async (keys: readonly string[]) => {
          let removed = 0;
          for (const key of keys) if (map.delete(key)) removed += 1;
          return removed;
        },
        update: async (key: string, fn: (current: unknown) => unknown) => {
          const next = fn(map.get(key));
          map.set(key, next);
          return next;
        },
      };
    },
    close: async () => {},
  };
  return {
    facility: { open: async () => domain as unknown as Domain<never> } as unknown as DomainFacility,
    tables,
    global,
    failPuts,
  };
}

export function createCardService(
  settings: () => SubagentDirectorSettings = () => ({}),
): { service: CardService; memory: MemoryDomain } {
  const memory = createMemoryDomain();
  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  } as never;
  const service = new CardService({ ctx, getSettings: settings, logger: { info: () => {}, warn: () => {}, debug: () => {} } });
  service.attachStorage(memory.facility);
  return { service, memory };
}

export const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: 'Card ' + id,
  delegationGuidance: 'Use this card for ' + id + '.',
  ...overrides,
});

/**
 * Unit tests for the pure tool-set picker logic (src/client/toolset-logic.ts):
 * filtered-scope search, single toggle, and the select-all / deselect-all set
 * algebra that must never touch tools hidden by the search.
 */
import { describe, it, expect } from 'vitest';
import {
  addToolNames,
  filterToolNames,
  removeToolNames,
  toggleToolName,
} from '../src/client/toolset-logic.js';

const TOOLS = ['bash', 'read', 'write', 'edit', 'web_search', 'web_fetch', 'glob', 'grep'];

describe('filterToolNames', () => {
  it('keeps every tool for an empty or blank query', () => {
    expect(filterToolNames(TOOLS, '')).toEqual(TOOLS);
    expect(filterToolNames(TOOLS, '   ')).toEqual(TOOLS);
  });

  it('matches case-insensitive substrings', () => {
    expect(filterToolNames(TOOLS, 'WEB')).toEqual(['web_search', 'web_fetch']);
    expect(filterToolNames(TOOLS, 'Bash')).toEqual(['bash']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterToolNames(TOOLS, 'zzz')).toEqual([]);
  });
});

describe('toggleToolName', () => {
  it('adds an absent name and removes a present one (order-preserving)', () => {
    expect(toggleToolName(['bash'], 'read')).toEqual(['bash', 'read']);
    expect(toggleToolName(['bash', 'read'], 'bash')).toEqual(['read']);
  });
});

describe('addToolNames / removeToolNames（过滤范围语义）', () => {
  it('adds every candidate without duplicating existing names', () => {
    expect(addToolNames(['bash'], ['bash', 'read', 'web_search'])).toEqual([
      'bash',
      'read',
      'web_search',
    ]);
  });

  it('removes every candidate and keeps unrelated names', () => {
    expect(removeToolNames(['bash', 'read', 'web_search'], ['read', 'web_search'])).toEqual([
      'bash',
    ]);
  });

  it('select-all over the filtered scope never touches tools hidden by the search', () => {
    // Search "web" → candidates are web_search + web_fetch only.
    const filtered = filterToolNames(TOOLS, 'web');
    const next = addToolNames(['bash'], filtered);
    expect(next).toEqual(['bash', 'web_search', 'web_fetch']);
  });

  it('deselect-all over the filtered scope keeps tools outside the filter', () => {
    const filtered = filterToolNames(TOOLS, 'web');
    const next = removeToolNames(['bash', 'web_search', 'web_fetch'], filtered);
    expect(next).toEqual(['bash']);
  });
});

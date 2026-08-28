/**
 * Pure tool-set picker logic for the role editor (search / select-all /
 * deselect-all). Framework-free so the filtering and set algebra are
 * unit-testable without React.
 *
 * The select-all / deselect-all semantics follow the "filtered scope" rule:
 * they operate ONLY on the currently filtered tool names, never on tools the
 * search has hidden, so a user searching for "web" cannot accidentally select
 * every unrelated tool.
 */

/** Case-insensitive substring filter over tool names; empty query keeps all. */
export function filterToolNames(tools: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...tools];
  return tools.filter((tool) => tool.toLowerCase().includes(q));
}

/** Toggle one tool name in the allow list (order-preserving). */
export function toggleToolName(current: readonly string[], name: string): string[] {
  return current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
}

/** Add every candidate to the allow list (deduplicated, order-preserving). */
export function addToolNames(current: readonly string[], candidates: readonly string[]): string[] {
  const set = new Set(current);
  for (const candidate of candidates) set.add(candidate);
  return [...set];
}

/** Remove every candidate from the allow list. */
export function removeToolNames(current: readonly string[], candidates: readonly string[]): string[] {
  const drop = new Set(candidates);
  return current.filter((name) => !drop.has(name));
}

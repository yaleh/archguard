import type { QueryScopeEntry } from './query-manifest.js';

/** One line per persisted scope: key, kind/role, entity count, sources. */
export function formatScopeTable(entries: QueryScopeEntry[]): string[] {
  return entries.map((entry) => {
    const kind = entry.role ? `${entry.kind}/${entry.role}` : entry.kind;
    return `${entry.key}  ${kind}  ${entry.entityCount} entities  ${entry.sources.join(', ')}`;
  });
}

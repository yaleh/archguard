import path from 'path';
import type { QueryScopeEntry } from './query-manifest.js';
import { realpathOrSelf } from '../processors/arch-json-utils.js';

/**
 * Scope containment — derive the immediate `parentScopeKey` of every query scope.
 *
 * Kept out of `query-artifacts.ts` so the artifact writer stays within the
 * repository's hygiene line-count ratchet.
 */

/** Resolve one source path to an absolute realpath (relative routes against the project root). */
function resolveSourcePath(source: string, projectRoot: string): string {
  const absolute = path.isAbsolute(source) ? source : path.resolve(projectRoot, source);
  return realpathOrSelf(absolute);
}

/**
 * Whether `childPath` is `parentPath` or lies below it.
 *
 * Segment-aware: `/a/bc` is *not* inside `/a/b`. Both paths are expected to be
 * absolute and already realpath-resolved by the caller.
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Depth at which `parentSources` covers every `childSources` entry, or
 * undefined when at least one child source lies outside every parent source.
 *
 * The depth is the *shallowest* covering parent root (string length), so a
 * parent that only covers a child at the project root scores lower than one
 * rooted directly at the child's directory.
 */
function coverageDepth(childSources: string[], parentSources: string[]): number | undefined {
  let shallowest = Number.POSITIVE_INFINITY;
  for (const childSource of childSources) {
    let deepest = -1;
    for (const parentSource of parentSources) {
      if (isPathInside(childSource, parentSource)) {
        deepest = Math.max(deepest, parentSource.length);
      }
    }
    if (deepest < 0) return undefined;
    shallowest = Math.min(shallowest, deepest);
  }
  return shallowest;
}

interface ResolvedScopeSources {
  entry: QueryScopeEntry;
  sources: string[];
}

/**
 * Compute the immediate container of every scope in `entries`.
 *
 * A candidate is a parent when it covers all of the child's sources (path
 * containment after realpath normalization) and is not itself contained in the
 * child — i.e. a strict superset. Equal source sets therefore never form a
 * chain. Containment is only meaningful within one language: a scope's ArchJSON
 * covers entities of its own language, so a TypeScript root does not "contain"
 * a Go fixture directory that happens to sit under it.
 *
 * Among all strict supersets the most specific one wins (deepest coverage,
 * then fewer source roots, then key order) — `/proj/src/cli` points at
 * `/proj/src`, never at `/proj`. Root scopes and scopes disjoint from every
 * other scope are absent from the returned map.
 *
 * Sources are resolved against `projectRoot` when relative, and always
 * realpath-resolved, so symlink aliases of the same directory compare equal.
 */
export function computeParentScopeKeys(
  entries: QueryScopeEntry[],
  projectRoot: string
): Map<string, string> {
  const resolved: ResolvedScopeSources[] = entries.map((entry) => ({
    entry,
    sources: (entry.sources ?? []).map((source) => resolveSourcePath(source, projectRoot)),
  }));

  const parents = new Map<string, string>();

  for (const child of resolved) {
    if (child.sources.length === 0) continue;

    let best: { key: string; depth: number; sourceCount: number } | undefined;
    for (const candidate of resolved) {
      if (candidate.entry.key === child.entry.key) continue;
      if (candidate.entry.language !== child.entry.language) continue;
      if (candidate.sources.length === 0) continue;

      const depth = coverageDepth(child.sources, candidate.sources);
      if (depth === undefined) continue;

      // Strict: a candidate that itself sits inside the child (equal source set
      // included) is not a superset, so it cannot be the parent.
      if (coverageDepth(candidate.sources, child.sources) !== undefined) continue;

      const sourceCount = candidate.sources.length;
      const better =
        best === undefined ||
        depth > best.depth ||
        (depth === best.depth && sourceCount < best.sourceCount) ||
        (depth === best.depth &&
          sourceCount === best.sourceCount &&
          candidate.entry.key.localeCompare(best.key) < 0);
      if (better) best = { key: candidate.entry.key, depth, sourceCount };
    }

    if (best) parents.set(child.entry.key, best.key);
  }

  return parents;
}

/**
 * Attach the recomputed `parentScopeKey` to each entry, dropping links that no
 * longer resolve (a pruned parent or a moved scope must not leave a dangling
 * chain behind).
 */
export function applyParentScopeKeys(
  entries: QueryScopeEntry[],
  projectRoot: string
): QueryScopeEntry[] {
  const parents = computeParentScopeKeys(entries, projectRoot);
  return entries.map((entry) => {
    const parentScopeKey = parents.get(entry.key);
    if (parentScopeKey) return { ...entry, parentScopeKey };
    const { parentScopeKey: _stale, ...rest } = entry;
    return rest;
  });
}

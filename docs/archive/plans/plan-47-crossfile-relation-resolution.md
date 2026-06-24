# Plan 47: Spike — Cross-File Relation Resolution

**Proposal**: `docs/proposals/proposal-crossfile-relation-resolution.md`
**Priority**: MEDIUM (research spike — outcome determines whether full plan is warranted)
**Estimated total changes**: ~60 lines source (spike implementation) + ~50 test lines

---

## Overview

A research spike to determine whether a global name-to-ID resolution pass can resolve class diagram relation targets without ambiguity. `ParallelParser` processes files in isolation without TypeScript's `TypeChecker`, so relation targets are bare class names (e.g., `ILanguagePlugin`) rather than qualified entity IDs (e.g., `core/interfaces/plugin.ts.ILanguagePlugin`). This causes ~97% of class diagram relations to be filtered as unknown.

| # | Research question | Approach | Priority |
|---|---|---|---|
| 1 | Can unique-name lookup resolve > 80% of bare targets? | Build `Map<simpleName, qualifiedId[]>` post-parse | MEDIUM |
| 2 | What is the ambiguity rate for ArchGuard itself? | Count 0/1/2+ match buckets on live data | MEDIUM |

---

## Phase A — Implement Spike: `resolveRelationTargets()`

**Files**: `src/parser/relation-resolver.ts` (new file), `tests/unit/parser/relation-resolver.test.ts` (new file)
**Estimated lines**: ~60 source + ~50 test

### Stage A1 — Implement `resolveRelationTargets()` as a standalone function

**File**: `src/parser/relation-resolver.ts` (new file)

```typescript
/**
 * relation-resolver — Post-parse cross-file relation target resolution.
 *
 * Spike implementation for Plan 47.
 *
 * After ParallelParser produces an ArchJSON, relation targets are bare class
 * names (e.g., 'ILanguagePlugin') rather than qualified entity IDs.
 * This module attempts to resolve them by building a name→ID map from the
 * full entity list and performing an unambiguous lookup.
 *
 * Resolution rules:
 * - 0 matches: leave target as-is (external dependency or unresolvable)
 * - 1 match:   replace target with qualified ID (high confidence)
 * - 2+ matches: apply longest-common-prefix heuristic; if still ambiguous,
 *               leave as-is to avoid false positives
 *
 * @module parser/relation-resolver
 */

import type { ArchJSON, Relation } from '@/types/index.js';

export interface ResolutionStats {
  /** Number of relation targets already resolved (in knownEntityIds) */
  alreadyResolved: number;
  /** Number of targets resolved by unique name lookup */
  uniqueMatch: number;
  /** Number of targets resolved by longest-common-prefix heuristic */
  heuristicMatch: number;
  /** Number of targets with 2+ candidates where heuristic was inconclusive */
  ambiguous: number;
  /** Number of targets with 0 candidates (unresolvable) */
  unresolvable: number;
}

/**
 * Resolve bare relation target names to qualified entity IDs.
 *
 * @param archJson - ArchJSON with entities and unresolved relations
 * @returns New ArchJSON with relations having resolved target IDs where possible,
 *          plus resolution statistics for analysis.
 */
export function resolveRelationTargets(archJson: ArchJSON): {
  resolved: ArchJSON;
  stats: ResolutionStats;
} {
  const stats: ResolutionStats = {
    alreadyResolved: 0,
    uniqueMatch: 0,
    heuristicMatch: 0,
    ambiguous: 0,
    unresolvable: 0,
  };

  // Build name → qualified ID[] map
  const nameToIds = new Map<string, string[]>();
  const knownEntityIds = new Set<string>();
  for (const entity of archJson.entities) {
    knownEntityIds.add(entity.id);
    const existing = nameToIds.get(entity.name) ?? [];
    existing.push(entity.id);
    nameToIds.set(entity.name, existing);
  }

  const resolvedRelations: Relation[] = archJson.relations.map((relation) => {
    // Already resolved (target is a known entity ID)
    if (knownEntityIds.has(relation.target)) {
      stats.alreadyResolved++;
      return relation;
    }

    const candidates = nameToIds.get(relation.target) ?? [];

    if (candidates.length === 0) {
      // Unresolvable: external type or generic name with no entity match
      stats.unresolvable++;
      return relation;
    }

    if (candidates.length === 1) {
      // Unique match: high confidence
      stats.uniqueMatch++;
      return { ...relation, target: candidates[0] };
    }

    // 2+ candidates: apply longest-common-prefix heuristic
    // Prefer the candidate whose package prefix most closely matches the source entity's package.
    const sourceEntity = archJson.entities.find((e) => e.id === relation.source);
    if (sourceEntity) {
      // Extract package from source entity ID (first path component or first dot-segment)
      const sourcePackage = extractPackagePrefix(sourceEntity.id);
      const samePackageCandidates = candidates.filter((c) =>
        extractPackagePrefix(c) === sourcePackage
      );
      if (samePackageCandidates.length === 1) {
        stats.heuristicMatch++;
        return { ...relation, target: samePackageCandidates[0] };
      }
    }

    // Still ambiguous: leave as-is
    stats.ambiguous++;
    return relation;
  });

  return {
    resolved: { ...archJson, relations: resolvedRelations },
    stats,
  };
}

/**
 * Extract the top-level package prefix from an entity ID.
 *
 * For TypeScript IDs like 'src/core/interfaces/plugin.ts.ILanguagePlugin',
 * this returns 'src'.
 * For dotted Python IDs like 'myapp.models.User', this returns 'myapp'.
 */
function extractPackagePrefix(entityId: string): string {
  // Prefer slash-based (TypeScript) over dot-based (Python)
  const slashIdx = entityId.indexOf('/');
  if (slashIdx > 0) return entityId.slice(0, slashIdx);
  const dotIdx = entityId.indexOf('.');
  if (dotIdx > 0) return entityId.slice(0, dotIdx);
  return entityId;
}
```

**Acceptance**: Function is pure, side-effect free, and returns `{ resolved: ArchJSON, stats: ResolutionStats }`.

### Stage A2 — Unit tests for `resolveRelationTargets()`

**File**: `tests/unit/parser/relation-resolver.test.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest';
import { resolveRelationTargets } from '@/parser/relation-resolver.js';
import type { ArchJSON } from '@/types/index.js';

function entity(id: string, name: string, file = 'src/a.ts') {
  return {
    id, name, type: 'class' as const, visibility: 'public' as const,
    members: [], sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

function relation(source: string, target: string) {
  return { id: `${source}-${target}`, source, target, type: 'dependency' as const };
}

function makeArchJson(entities: ReturnType<typeof entity>[], relations: ReturnType<typeof relation>[]): ArchJSON {
  return { version: '1.0', language: 'typescript', entities, relations, extensions: {} };
}

describe('resolveRelationTargets', () => {
  it('leaves already-resolved targets unchanged', () => {
    const archJson = makeArchJson(
      [entity('src/core/Plugin', 'Plugin'), entity('src/parser/Parser', 'Parser')],
      [relation('src/core/Plugin', 'src/parser/Parser')]
    );
    const { resolved, stats } = resolveRelationTargets(archJson);
    expect(resolved.relations[0].target).toBe('src/parser/Parser');
    expect(stats.alreadyResolved).toBe(1);
    expect(stats.uniqueMatch).toBe(0);
  });

  it('resolves unique bare name to qualified ID', () => {
    const archJson = makeArchJson(
      [entity('src/core/Plugin', 'Plugin'), entity('src/parser/Parser', 'Parser')],
      [relation('src/core/Plugin', 'Parser')]
    );
    const { resolved, stats } = resolveRelationTargets(archJson);
    expect(resolved.relations[0].target).toBe('src/parser/Parser');
    expect(stats.uniqueMatch).toBe(1);
  });

  it('leaves unresolvable targets unchanged', () => {
    const archJson = makeArchJson(
      [entity('src/core/Plugin', 'Plugin')],
      [relation('src/core/Plugin', 'IExternal')]
    );
    const { resolved, stats } = resolveRelationTargets(archJson);
    expect(resolved.relations[0].target).toBe('IExternal');
    expect(stats.unresolvable).toBe(1);
  });

  it('uses same-package heuristic when 2+ candidates exist', () => {
    const archJson = makeArchJson(
      [
        entity('src/core/Config', 'Config'),
        entity('src/parser/Config', 'Config'),  // same name, different package
        entity('src/core/Plugin', 'Plugin'),
      ],
      [relation('src/core/Plugin', 'Config')]  // source is in 'src' package → prefer 'src/core/Config'
    );
    const { resolved, stats } = resolveRelationTargets(archJson);
    // Both candidates start with 'src' — same package prefix — heuristic inconclusive
    expect(stats.ambiguous).toBe(1);
    expect(resolved.relations[0].target).toBe('Config'); // left as-is
  });

  it('resolves when same-package heuristic is conclusive', () => {
    const archJson = makeArchJson(
      [
        entity('core/Config', 'Config', 'core/config.ts'),
        entity('other/Config', 'Config', 'other/config.ts'),
        entity('core/Plugin', 'Plugin', 'core/plugin.ts'),
      ],
      [relation('core/Plugin', 'Config')]
    );
    const { resolved, stats } = resolveRelationTargets(archJson);
    // Source 'core/Plugin' has package 'core'; 'core/Config' is in 'core' → unique match
    expect(resolved.relations[0].target).toBe('core/Config');
    expect(stats.heuristicMatch).toBe(1);
  });

  it('returns correct stats for mixed resolutions', () => {
    const archJson = makeArchJson(
      [
        entity('src/A', 'A'),
        entity('src/B', 'B'),
      ],
      [
        relation('src/A', 'src/B'),     // already resolved
        relation('src/A', 'B'),          // bare name → unique match
        relation('src/A', 'External'),   // unresolvable
      ]
    );
    const { stats } = resolveRelationTargets(archJson);
    expect(stats.alreadyResolved).toBe(1);
    expect(stats.uniqueMatch).toBe(1);
    expect(stats.unresolvable).toBe(1);
    expect(stats.ambiguous).toBe(0);
    expect(stats.heuristicMatch).toBe(0);
  });
});
```

**Dependencies**: A1

### Stage A3 — Spike Measurement: Run on ArchGuard itself

**File**: `scripts/spike-crossfile-resolution.mjs` (temporary script, not committed to main branch)

After building (`npm run build`), run:

```bash
node -e "
const { ParallelParser } = await import('./dist/parser/parallel-parser.js');
const { resolveRelationTargets } = await import('./dist/parser/relation-resolver.js');
const { FileDiscoveryService } = await import('./dist/cli/utils/file-discovery-service.js');

const fds = new FileDiscoveryService();
const files = await fds.discoverFiles({ sources: ['./src'], skipMissing: false });
const parser = new ParallelParser({ continueOnError: true, workspaceRoot: process.cwd() });
const archJson = await parser.parseFiles(files);

const { stats } = resolveRelationTargets(archJson);
console.log('Resolution stats:', stats);
const total = Object.values(stats).reduce((a, b) => a + b, 0);
console.log('Total relations:', total);
console.log('Unique match rate:', (stats.uniqueMatch / total * 100).toFixed(1) + '%');
console.log('Ambiguity rate:', (stats.ambiguous / total * 100).toFixed(1) + '%');
"
```

**Acceptance**: Script runs without errors and prints resolution stats.

---

## Phase B — Integration Decision

This is a research spike. After Phase A is complete, evaluate the following criteria:

| Criterion | Pass threshold | Action if passed | Action if failed |
|---|---|---|---|
| Unique match rate | > 80% of unresolved targets | Proceed to full Plan (integrate into ParallelParser) | Investigate why; may need deeper heuristics |
| Ambiguity rate | < 5% of all relation targets | Safe to enable by default | Enable with opt-in flag only |
| False positive rate | < 2% (manual inspection of heuristic matches) | Merge | Restrict heuristic to same-file-path matches only |
| Performance overhead | < 50ms for ArchGuard's ~1500 entities | Enable by default | Make optional |

### Stage B1 — Decision gate

Based on spike results, decide one of:

1. **Full integration**: Move `resolveRelationTargets()` call into `ParallelParser.parseFiles()` after aggregation. Enable by default.
2. **Opt-in flag**: Add `--resolve-relations` CLI flag; call `resolveRelationTargets()` only when flag is set.
3. **Abandon**: Spike results show ambiguity rate > 10% or false positives > 5%; file a note and close the spike.

---

## Dependency Graph

```
A2 depends on A1
A3 depends on A1, A2 (needs built dist/)
B1 depends on A3 (needs spike measurement results)
```

---

## Testing Strategy

- **TDD**: Write A2 tests first. Implement A1. Run tests.
- **Spike measurement**: A3 is manual/scripted; not in test suite.
- **No regression risk**: `resolveRelationTargets()` is a new standalone function; ParallelParser is unchanged in this phase.
- **Existing test suite**: Must remain green (2787+ tests) after Phase A.

---

## Acceptance Criteria

| Stage | Criterion |
|---|---|
| A1 | `resolveRelationTargets()` is pure, side-effect free, returns `{ resolved, stats }` |
| A1 | Unique match resolution replaces bare name with qualified entity ID |
| A1 | Same-package heuristic applied only when source entity is found |
| A1 | Unresolvable and ambiguous targets left unchanged |
| A2 | 6 unit tests pass |
| A3 | Spike measurement completes without error |
| B1 | Spike decision documented with measured stats |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| High ambiguity rate (> 10%) makes resolution unsafe | Heuristic already requires same-package prefix match; conservative fallback to no-op |
| Generic names (Config, Options, Result) are everywhere | These will be ambiguous → left as-is; no false positives introduced |
| External names accidentally match internal class names | External names with 0 matches → unresolvable; only 1-match case modifies the relation |
| Spike proves resolution rate too low to be useful | Close spike; document in plan as "not viable without TypeChecker" |

---

## Validation

After Phase A:

```bash
npm test tests/unit/parser/relation-resolver.test.ts
# All 6 tests pass

npm run build
node scripts/spike-crossfile-resolution.mjs
# Prints resolution stats; unique match rate > 80% → proceed to B1
```

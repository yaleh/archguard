# Plan 28: Agent Query Layer — Development Plan

> Source proposal: `docs/proposals/proposal-agent-query-layer.md`
> Branch: `feat/agent-query-layer`
> Status: Draft

---

## Overview

Five phases. Each phase must pass `npm test` independently before the next begins.

| Phase | Scope | New files | Modified files | Dependency |
|-------|-------|-----------|----------------|------------|
| Phase 1 | `DiagramProcessor.getPrimaryArchJson()` + `persistArchArtifacts` | 1 | 2 | None |
| Phase 2 | `ArchIndex` types + `ArchIndexBuilder` + `QueryEngine` | 3 | 0 | Phase 1 complete |
| Phase 3 | `query` subcommand | 1 | 1 | Phase 2 complete |
| Phase 4 | `search` subcommand | 1 | 1 | Phase 2 complete |
| Phase 5 | MCP Server (`mcp` subcommand) | 2 | 2 | Phase 3 + 4 complete |

**Recommended order**: 1 → 2 → 3 → 4 → 5.

---

## Pre-flight

```bash
npm test
# Note current passing count (expected: 2165+)

npm run type-check
# Expected: 0 errors

npm run build
node dist/cli/index.js analyze -v
# Baseline: confirm .archguard/ generated, arch.json absent
ls .archguard/
# Expected: index.md, overview/, class/, method/ — no arch.json
```

---

## Phase 1 — `DiagramProcessor.getPrimaryArchJson()` + `persistArchArtifacts`

### Objectives

1. Expose `rawArchJSON` from `DiagramProcessor` via a new public getter
2. Add `src/cli/query/arch-artifacts.ts` with `persistArchArtifacts(outputDir, archJson)`
3. Wire into `analyzeCommandHandler` so `arch.json` is written after every successful analyze

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/processors/diagram-processor.ts` | Modify | Add `getPrimaryArchJson(): ArchJSON \| null` |
| `src/cli/query/arch-artifacts.ts` | New | `persistArchArtifacts(outputDir, archJson)` |
| `src/cli/commands/analyze.ts` | Modify | Call `persistArchArtifacts` after `processAll()` |
| `tests/unit/cli/processors/diagram-processor-primary-arch.test.ts` | New | Unit tests for `getPrimaryArchJson()` |

---

### Stage 1-0 — Verify baseline

```bash
npm test -- --reporter=verbose 2>&1 | tail -5
# 0 failures

grep -n "getPrimaryArchJson\|persistArchArtifacts" \
  src/cli/processors/diagram-processor.ts \
  src/cli/commands/analyze.ts 2>/dev/null
# Expected: no matches (features absent)
```

---

### Stage 1-1 — Add `getPrimaryArchJson()` to `DiagramProcessor`

In `src/cli/processors/diagram-processor.ts`, after the closing `}` of `processAll()` (around line 328), add:

```typescript
/**
 * Returns the "primary" rawArchJSON after processAll() completes.
 *
 * Selection rule: the entry in archJsonCache with the highest entity count.
 * For standard projects this is the root source group (e.g. './src').
 *
 * Returns null when:
 * - processAll() has not been called
 * - all cached ArchJSONs have 0 entities (e.g. Go Atlas mode)
 * - archJsonCache is empty (all source groups failed)
 */
getPrimaryArchJson(): ArchJSON | null {
  let best: ArchJSON | null = null;
  for (const archJson of this.archJsonCache.values()) {
    if (!best || archJson.entities.length > best.entities.length) {
      best = archJson;
    }
  }
  return best && best.entities.length > 0 ? best : null;
}
```

Verify type-check:

```bash
npm run type-check
# Expected: 0 errors
```

---

### Stage 1-2 — Write tests for `getPrimaryArchJson()` (red)

Create `tests/unit/cli/processors/diagram-processor-primary-arch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramProcessor } from '@/cli/processors/diagram-processor.js';
import type { DiagramProcessorOptions } from '@/cli/processors/diagram-processor.js';

// Minimal stubs — avoid heavy imports
const makeOptions = (overrides: Partial<DiagramProcessorOptions> = {}): DiagramProcessorOptions => ({
  diagrams: [{ name: 'test', sources: ['./src'], level: 'class' }],
  globalConfig: { outputDir: '/tmp/out', format: 'mermaid' } as any,
  progress: { start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), info: vi.fn(), warn: vi.fn() } as any,
  ...overrides,
});

describe('DiagramProcessor.getPrimaryArchJson()', () => {
  it('returns null before processAll() is called', () => {
    const processor = new DiagramProcessor(makeOptions());
    expect(processor.getPrimaryArchJson()).toBeNull();
  });

  it('returns null when all cached ArchJSONs have 0 entities', () => {
    const processor = new DiagramProcessor(makeOptions());
    // Directly set private cache via type cast
    (processor as any).archJsonCache.set('key1', { entities: [], relations: [] });
    expect(processor.getPrimaryArchJson()).toBeNull();
  });

  it('returns the entry with the most entities', () => {
    const processor = new DiagramProcessor(makeOptions());
    const small = { entities: [{ id: 'A' }], relations: [] } as any;
    const large = { entities: [{ id: 'B' }, { id: 'C' }], relations: [] } as any;
    (processor as any).archJsonCache.set('key1', small);
    (processor as any).archJsonCache.set('key2', large);
    expect(processor.getPrimaryArchJson()).toBe(large);
  });
});
```

Run:

```bash
npm test -- tests/unit/cli/processors/diagram-processor-primary-arch.test.ts
# Expected: 2 pass (null cases), 1 fail (cache access – cache is private Map)
# Adjust test to use internal access pattern matching actual field name
```

---

### Stage 1-3 — Create `src/cli/query/arch-artifacts.ts`

Create directory and file:

```typescript
// src/cli/query/arch-artifacts.ts

import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import type { ArchJSON } from '@/types/index.js';

export const ARCH_JSON_FILENAME  = 'arch.json';
export const ARCH_INDEX_FILENAME = 'arch-index.json';

/**
 * Persist rawArchJSON to <outputDir>/arch.json.
 * Does NOT write arch-index.json — that is handled by Phase 2's ArchIndexBuilder.
 * Phase 1 only writes arch.json; Phase 2 extends this function.
 *
 * Write order: arch.json first, arch-index.json second (see proposal §3).
 */
export async function persistArchArtifacts(
  outputDir: string,
  archJson: ArchJSON,
): Promise<void> {
  await fs.ensureDir(outputDir);
  const archJsonPath = path.join(outputDir, ARCH_JSON_FILENAME);
  await fs.writeJson(archJsonPath, archJson);
  // arch-index.json written by ArchIndexBuilder in Phase 2
}

/** Compute SHA-256 of arch.json file content (used by ArchIndexBuilder). */
export async function computeArchJsonHash(outputDir: string): Promise<string> {
  const archJsonPath = path.join(outputDir, ARCH_JSON_FILENAME);
  const content = await fs.readFile(archJsonPath);
  return createHash('sha256').update(content).digest('hex');
}
```

---

### Stage 1-4 — Wire into `analyzeCommandHandler`

In `src/cli/commands/analyze.ts`, add the import at the top:

```typescript
import { persistArchArtifacts } from '@/cli/query/arch-artifacts.js';
```

In `analyzeCommandHandler`, after `const results = await processor.processAll();` (around line 322), insert:

```typescript
// Persist rawArchJSON for query/search/mcp commands
const primaryArchJson = processor.getPrimaryArchJson();
if (primaryArchJson) {
  await persistArchArtifacts(config.outputDir, primaryArchJson);
}
```

Verify:

```bash
npm run type-check
# Expected: 0 errors

npm run build
node dist/cli/index.js analyze -v
ls .archguard/
# Expected: arch.json now present alongside index.md, overview/, class/, method/

node -e "const a = require('./.archguard/arch.json'); console.log(a.entities.length)"
# Expected: 261 (or current entity count from self-analysis)
```

---

### Stage 1-5 — Full test suite

```bash
npm test
# Expected: same count as baseline or higher, 0 failures
npm run type-check
# 0 errors
```

---

## Phase 2 — `ArchIndex` types + `ArchIndexBuilder` + `QueryEngine`

### Objectives

1. Define the `ArchIndex` interface in `src/cli/query/arch-index.ts`
2. Implement `ArchIndexBuilder.build(archJson, archJsonHash)` as a pure function
3. Implement `QueryEngine` with load/validate/fallback logic and all query methods
4. Extend `persistArchArtifacts` to also write `arch-index.json`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/arch-index.ts` | New | `ArchIndex` interface |
| `src/cli/query/arch-index-builder.ts` | New | `ArchIndexBuilder.build()` pure function |
| `src/cli/query/query-engine.ts` | New | `QueryEngine` with `load()`, `fromArchJson()`, all query methods |
| `src/cli/query/arch-artifacts.ts` | Modify | Extend to write `arch-index.json` after `arch.json` |
| `tests/unit/cli/query/arch-index-builder.test.ts` | New | Unit tests for `ArchIndexBuilder` |
| `tests/unit/cli/query/query-engine.test.ts` | New | Unit tests for `QueryEngine` (load, hash mismatch, BFS, cycles) |

---

### Stage 2-1 — `src/cli/query/arch-index.ts`

```typescript
// src/cli/query/arch-index.ts

import type { RelationType } from '@/types/index.js';

export interface ArchIndexCycle {
  size: number;
  members: string[];       // entity IDs
  memberNames: string[];   // entity names, parallel to members
  files: string[];         // deduplicated source file paths
}

export interface ArchIndex {
  /** Schema version for forward-compatibility checks. */
  version: string;          // "1.0"

  /** ISO 8601 build time. */
  generatedAt: string;

  /**
   * SHA-256 of the arch.json file content at the time this index was built.
   * QueryEngine compares this against the live arch.json to detect staleness.
   */
  archJsonHash: string;

  /** Language reported by arch.json. */
  language: string;

  /** entity.name (case-sensitive) → entity ID list (handles cross-module duplicates). */
  nameToIds: Record<string, string[]>;

  /** entity ID → source file relative path (C++ absolute paths normalised). */
  idToFile: Record<string, string>;

  /** entity ID → entity name (for display without loading full arch.json). */
  idToName: Record<string, string>;

  /** entity ID → list of entity IDs that depend on it (reverse edges). */
  dependents: Record<string, string[]>;

  /** entity ID → list of entity IDs it depends on (forward edges). */
  dependencies: Record<string, string[]>;

  /** Relation type → [source ID, target ID][] (only internal relations). */
  relationsByType: Partial<Record<RelationType, [string, string][]>>;

  /** Source file relative path → entity ID list. */
  fileToIds: Record<string, string[]>;

  /** Non-trivial SCCs (size > 1), sorted by size DESC. Aligns with CycleInfo in proposal-file-stats. */
  cycles: ArchIndexCycle[];
}

export const ARCH_INDEX_VERSION = '1.0';
```

---

### Stage 2-2 — `src/cli/query/arch-index-builder.ts`

```typescript
// src/cli/query/arch-index-builder.ts

import path from 'path';
import { createHash } from 'crypto';
import type { ArchJSON, RelationType } from '@/types/index.js';
import { ARCH_INDEX_VERSION } from './arch-index.js';
import type { ArchIndex, ArchIndexCycle } from './arch-index.js';

export class ArchIndexBuilder {
  /**
   * Build an ArchIndex from a rawArchJSON.
   *
   * @param archJson  - The rawArchJSON returned by getPrimaryArchJson()
   * @param archJsonHash - SHA-256 of the serialised arch.json file content
   */
  static build(archJson: ArchJSON, archJsonHash: string): ArchIndex {
    const { entities, relations, language, workspaceRoot } = archJson;

    const entityIds = new Set(entities.map(e => e.id));

    // Internal relations only (both endpoints known)
    const internalRelations = (relations ?? []).filter(
      r => entityIds.has(r.source) && entityIds.has(r.target)
    );

    // Build forward maps
    const nameToIds: Record<string, string[]> = {};
    const idToFile: Record<string, string> = {};
    const idToName: Record<string, string> = {};
    const dependents: Record<string, string[]> = {};
    const dependencies: Record<string, string[]> = {};
    const fileToIds: Record<string, string[]> = {};

    for (const entity of entities) {
      // nameToIds
      const bucket = nameToIds[entity.name] ?? [];
      bucket.push(entity.id);
      nameToIds[entity.name] = bucket;

      // idToFile (normalise C++ absolute paths)
      let file = entity.sourceLocation?.file ?? '';
      if (workspaceRoot && path.isAbsolute(file)) {
        file = path.relative(workspaceRoot, file);
      }
      idToFile[entity.id] = file;

      // idToName
      idToName[entity.id] = entity.name;

      // seed empty adjacency lists
      dependents[entity.id] = [];
      dependencies[entity.id] = [];

      // fileToIds
      if (file) {
        const fb = fileToIds[file] ?? [];
        fb.push(entity.id);
        fileToIds[file] = fb;
      }
    }

    // Populate adjacency + relationsByType
    const relationsByType: Partial<Record<RelationType, [string, string][]>> = {};
    for (const r of internalRelations) {
      dependents[r.target].push(r.source);
      dependencies[r.source].push(r.target);

      const bucket = relationsByType[r.type] ?? [];
      bucket.push([r.source, r.target]);
      relationsByType[r.type] = bucket;
    }

    // SCC (Kosaraju) — reuse logic pattern from MetricsCalculator
    const cycles = ArchIndexBuilder.computeCycles(entities, internalRelations, idToFile, idToName);

    return {
      version: ARCH_INDEX_VERSION,
      generatedAt: new Date().toISOString(),
      archJsonHash,
      language: language ?? 'unknown',
      nameToIds,
      idToFile,
      idToName,
      dependents,
      dependencies,
      relationsByType,
      fileToIds,
      cycles,
    };
  }

  private static computeCycles(
    entities: ArchJSON['entities'],
    relations: ArchJSON['relations'],
    idToFile: Record<string, string>,
    idToName: Record<string, string>,
  ): ArchIndexCycle[] {
    if (entities.length === 0) return [];

    const graph      = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const e of entities) {
      graph.set(e.id, []);
      transposed.set(e.id, []);
    }
    for (const r of relations) {
      graph.get(r.source)?.push(r.target);
      transposed.get(r.target)?.push(r.source);
    }

    // Pass 1: finish-order DFS
    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    const dfs = (start: string, adj: Map<string, string[]>, vis: Set<string>, out: string[] | null) => {
      const stack: [string, number][] = [[start, 0]];
      vis.add(start);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const neighbors = adj.get(top[0]) ?? [];
        if (top[1] < neighbors.length) {
          const next = neighbors[top[1]++];
          if (!vis.has(next)) { vis.add(next); stack.push([next, 0]); }
        } else {
          stack.pop();
          out?.push(top[0]);
        }
      }
    };
    for (const id of graph.keys()) {
      if (!visited1.has(id)) dfs(id, graph, visited1, finishStack);
    }

    // Pass 2: collect SCC members
    const visited2 = new Set<string>();
    const result: ArchIndexCycle[] = [];
    while (finishStack.length) {
      const node = finishStack.pop()!;
      if (!visited2.has(node)) {
        const members: string[] = [];
        dfs(node, transposed, visited2, members);
        if (members.length > 1) {
          result.push({
            size: members.length,
            members,
            memberNames: members.map(id => idToName[id] ?? id),
            files: [...new Set(members.map(id => idToFile[id] ?? '').filter(Boolean))],
          });
        }
      }
    }

    return result.sort((a, b) => b.size - a.size);
  }
}
```

---

### Stage 2-3 — `src/cli/query/query-engine.ts`

```typescript
// src/cli/query/query-engine.ts

import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import type { ArchJSON } from '@/types/index.js';
import { ArchIndexBuilder } from './arch-index-builder.js';
import { ARCH_INDEX_VERSION, type ArchIndex } from './arch-index.js';
import { ARCH_JSON_FILENAME, ARCH_INDEX_FILENAME } from './arch-artifacts.js';

export class QueryDataMissingError extends Error {
  constructor(archDir: string) {
    super(`No arch.json found in ${archDir}. Run 'archguard analyze' first.`);
    this.name = 'QueryDataMissingError';
  }
}

export interface EntityResult {
  id: string;
  name: string;
  type: string;
  file: string;
  startLine: number;
  members?: { name: string; type: string; visibility: string }[];
}

export interface CycleResult {
  size: number;
  members: string[];
  memberNames: string[];
  files: string[];
}

export interface SummaryResult {
  entityCount: number;
  relationCount: number;
  cycleCount: number;
  language: string;
  topDependents: { name: string; file: string; inDegree: number }[];
}

export class QueryEngine {
  private constructor(
    private readonly index: ArchIndex,
    private readonly archJson: ArchJSON,
  ) {}

  // ----------------------------------------------------------------
  // Factory
  // ----------------------------------------------------------------

  /**
   * Load from disk. Validates archJsonHash; falls back to fromArchJson() on mismatch.
   * Throws QueryDataMissingError if arch.json does not exist.
   */
  static async load(archDir: string): Promise<QueryEngine> {
    const archJsonPath  = path.join(archDir, ARCH_JSON_FILENAME);
    const archIndexPath = path.join(archDir, ARCH_INDEX_FILENAME);

    if (!(await fs.pathExists(archJsonPath))) {
      throw new QueryDataMissingError(archDir);
    }

    const archJsonContent = await fs.readFile(archJsonPath, 'utf-8');
    const archJson        = JSON.parse(archJsonContent) as ArchJSON;
    const liveHash        = createHash('sha256').update(archJsonContent).digest('hex');

    if (await fs.pathExists(archIndexPath)) {
      try {
        const index = await fs.readJson(archIndexPath) as ArchIndex;
        if (index.version === ARCH_INDEX_VERSION && index.archJsonHash === liveHash) {
          return new QueryEngine(index, archJson);
        }
        // Hash mismatch or version mismatch: fall through to rebuild
      } catch {
        // Corrupt index: fall through to rebuild
      }
    }

    // Build in-memory index (do NOT write to disk here)
    return QueryEngine.fromArchJson(archJson, liveHash);
  }

  /** Build engine entirely from an ArchJSON (no disk I/O). */
  static fromArchJson(archJson: ArchJSON, archJsonHash = ''): QueryEngine {
    const index = ArchIndexBuilder.build(archJson, archJsonHash);
    return new QueryEngine(index, archJson);
  }

  // ----------------------------------------------------------------
  // Queries
  // ----------------------------------------------------------------

  findEntity(name: string, fuzzy = false): EntityResult[] {
    const ids = fuzzy
      ? Object.keys(this.index.nameToIds)
          .filter(n => n.includes(name))
          .flatMap(n => this.index.nameToIds[n])
      : (this.index.nameToIds[name] ?? []);

    return ids.map(id => this.toEntityResult(id)).filter(Boolean) as EntityResult[];
  }

  getDependents(entityName: string, depth = 1): EntityResult[] {
    const rootIds = this.index.nameToIds[entityName] ?? [];
    return this.bfsRelation(rootIds, depth, 'dependents');
  }

  getDependencies(entityName: string, depth = 1): EntityResult[] {
    const rootIds = this.index.nameToIds[entityName] ?? [];
    return this.bfsRelation(rootIds, depth, 'dependencies');
  }

  findImplementations(interfaceName: string): EntityResult[] {
    const targetIds = new Set(this.index.nameToIds[interfaceName] ?? []);
    const impls = (this.index.relationsByType['implementation'] ?? [])
      .filter(([, target]) => targetIds.has(target))
      .map(([source]) => this.toEntityResult(source))
      .filter(Boolean) as EntityResult[];
    return impls;
  }

  getFileEntities(filePath: string): EntityResult[] {
    const ids = this.index.fileToIds[filePath] ?? [];
    return ids.map(id => this.toEntityResult(id, true)).filter(Boolean) as EntityResult[];
  }

  getCycles(entityName?: string): CycleResult[] {
    if (!entityName) return this.index.cycles;
    return this.index.cycles.filter(c => c.memberNames.includes(entityName));
  }

  getSummary(): SummaryResult {
    const totalRelations = Object.values(this.index.relationsByType)
      .reduce((sum, arr) => sum + (arr?.length ?? 0), 0);

    const topDependents = Object.entries(this.index.dependents)
      .map(([id, deps]) => ({ id, inDegree: deps.length }))
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, 5)
      .map(({ id, inDegree }) => ({
        name: this.index.idToName[id] ?? id,
        file: this.index.idToFile[id] ?? '',
        inDegree,
      }));

    return {
      entityCount: Object.keys(this.index.idToName).length,
      relationCount: totalRelations,
      cycleCount: this.index.cycles.length,
      language: this.index.language,
      topDependents,
    };
  }

  // ----------------------------------------------------------------
  // Search helpers (used by `search` subcommand)
  // ----------------------------------------------------------------

  /** Returns entity results where dependents[id].length >= threshold. */
  findHighCoupling(threshold: number): EntityResult[] {
    return Object.entries(this.index.dependents)
      .filter(([, deps]) => deps.length >= threshold)
      .map(([id]) => this.toEntityResult(id))
      .filter(Boolean) as EntityResult[];
  }

  /** Returns entity results with no dependents. */
  findOrphans(): EntityResult[] {
    return Object.entries(this.index.dependents)
      .filter(([, deps]) => deps.length === 0)
      .map(([id]) => this.toEntityResult(id))
      .filter(Boolean) as EntityResult[];
  }

  /** Returns entities that participate in at least one non-trivial SCC. */
  findInCycles(): EntityResult[] {
    const cycleIds = new Set(this.index.cycles.flatMap(c => c.members));
    return [...cycleIds].map(id => this.toEntityResult(id)).filter(Boolean) as EntityResult[];
  }

  /**
   * Returns entities whose dependency list intersects the entity IDs for `callTarget`.
   * Precision is entity-level (not method-level) — see proposal §5 for limitations.
   */
  findCallers(callTarget: string): EntityResult[] {
    const targetIds = new Set(this.index.nameToIds[callTarget] ?? []);
    if (targetIds.size === 0) return [];
    return Object.entries(this.index.dependencies)
      .filter(([, deps]) => deps.some(d => targetIds.has(d)))
      .map(([id]) => this.toEntityResult(id))
      .filter(Boolean) as EntityResult[];
  }

  /**
   * Returns entities matching the given EntityType string.
   * Handles both `abstract_class` as a type AND `isAbstract === true && type === 'class'`.
   */
  findByType(entityType: string): EntityResult[] {
    return this.archJson.entities
      .filter(e =>
        e.type === entityType ||
        (entityType === 'abstract_class' && (e as any).isAbstract === true && e.type === 'class')
      )
      .map(e => this.toEntityResult(e.id))
      .filter(Boolean) as EntityResult[];
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  private bfsRelation(
    startIds: string[],
    depth: number,
    direction: 'dependents' | 'dependencies',
  ): EntityResult[] {
    const MAX_DEPTH = Math.min(depth, 5);
    const visited = new Set<string>(startIds);
    let frontier = [...startIds];
    const result: EntityResult[] = [];

    for (let d = 0; d < MAX_DEPTH; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of (this.index[direction][id] ?? [])) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
            const er = this.toEntityResult(neighbor);
            if (er) result.push(er);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    return result;
  }

  private toEntityResult(id: string, includeMembers = false): EntityResult | null {
    const entity = this.archJson.entities.find(e => e.id === id);
    if (!entity) return null;
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      file: this.index.idToFile[id] ?? '',
      startLine: entity.sourceLocation?.startLine ?? 0,
      ...(includeMembers
        ? {
            members: entity.members
              .filter(m => m.visibility === 'public')
              .map(m => ({ name: m.name, type: m.type, visibility: m.visibility })),
          }
        : {}),
    };
  }
}
```

---

### Stage 2-4 — Extend `persistArchArtifacts` to write `arch-index.json`

In `src/cli/query/arch-artifacts.ts`, update `persistArchArtifacts`:

```typescript
import { ArchIndexBuilder } from './arch-index-builder.js';

export async function persistArchArtifacts(
  outputDir: string,
  archJson: ArchJSON,
): Promise<void> {
  await fs.ensureDir(outputDir);

  // 1. Write arch.json first
  const archJsonPath = path.join(outputDir, ARCH_JSON_FILENAME);
  const content = JSON.stringify(archJson);
  await fs.writeFile(archJsonPath, content, 'utf-8');

  // 2. Compute hash of the just-written file
  const archJsonHash = createHash('sha256').update(content).digest('hex');

  // 3. Build and write arch-index.json
  const index = ArchIndexBuilder.build(archJson, archJsonHash);
  const archIndexPath = path.join(outputDir, ARCH_INDEX_FILENAME);
  await fs.writeJson(archIndexPath, index);
}
```

Verify:

```bash
npm run type-check
# Expected: 0 errors

npm run build
node dist/cli/index.js analyze -v
ls .archguard/
# Expected: arch.json AND arch-index.json present

node -e "
  const idx = require('./.archguard/arch-index.json');
  console.log('version:', idx.version);
  console.log('entities:', Object.keys(idx.idToName).length);
  console.log('cycles:', idx.cycles.length);
"
# Expected: version 1.0, entities > 0
```

---

### Stage 2-5 — Write tests (red → green)

Create `tests/unit/cli/query/arch-index-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ArchIndexBuilder } from '@/cli/query/arch-index-builder.js';
import type { ArchJSON } from '@/types/index.js';

const makeArchJson = (overrides: Partial<ArchJSON> = {}): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: [],
  entities: [],
  relations: [],
  ...overrides,
});

describe('ArchIndexBuilder.build()', () => {
  it('produces empty index for empty ArchJSON', () => {
    const index = ArchIndexBuilder.build(makeArchJson(), 'hash');
    expect(Object.keys(index.nameToIds)).toHaveLength(0);
    expect(index.cycles).toHaveLength(0);
  });

  it('maps entity name → ID', () => {
    const archJson = makeArchJson({
      entities: [
        { id: 'src/foo.ts.Foo', name: 'Foo', type: 'class', visibility: 'public',
          members: [], sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 } }
      ],
    });
    const index = ArchIndexBuilder.build(archJson, 'h');
    expect(index.nameToIds['Foo']).toEqual(['src/foo.ts.Foo']);
    expect(index.idToFile['src/foo.ts.Foo']).toBe('src/foo.ts');
    expect(index.fileToIds['src/foo.ts']).toEqual(['src/foo.ts.Foo']);
  });

  it('builds dependents and dependencies from internal relations', () => {
    const archJson = makeArchJson({
      entities: [
        { id: 'A', name: 'A', type: 'class', visibility: 'public', members: [],
          sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } },
        { id: 'B', name: 'B', type: 'class', visibility: 'public', members: [],
          sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } },
      ],
      relations: [{ id: 'r1', type: 'dependency', source: 'A', target: 'B' }],
    });
    const index = ArchIndexBuilder.build(archJson, 'h');
    expect(index.dependencies['A']).toContain('B');
    expect(index.dependents['B']).toContain('A');
    expect(index.dependencies['B']).toHaveLength(0);
    expect(index.dependents['A']).toHaveLength(0);
  });

  it('detects non-trivial SCC (size > 1)', () => {
    const archJson = makeArchJson({
      entities: [
        { id: 'A', name: 'A', type: 'class', visibility: 'public', members: [],
          sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } },
        { id: 'B', name: 'B', type: 'class', visibility: 'public', members: [],
          sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } },
      ],
      relations: [
        { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
        { id: 'r2', type: 'dependency', source: 'B', target: 'A' },
      ],
    });
    const index = ArchIndexBuilder.build(archJson, 'h');
    expect(index.cycles).toHaveLength(1);
    expect(index.cycles[0].size).toBe(2);
    expect(index.cycles[0].memberNames).toContain('A');
    expect(index.cycles[0].memberNames).toContain('B');
  });

  it('stores archJsonHash', () => {
    const index = ArchIndexBuilder.build(makeArchJson(), 'abc123');
    expect(index.archJsonHash).toBe('abc123');
  });
});
```

Create `tests/unit/cli/query/query-engine.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { QueryEngine, QueryDataMissingError } from '@/cli/query/query-engine.js';
import type { ArchJSON } from '@/types/index.js';

const baseArchJson: ArchJSON = {
  version: '1.0', language: 'typescript', timestamp: '', sourceFiles: [],
  entities: [
    { id: 'A', name: 'Alpha', type: 'class', visibility: 'public', members: [],
      sourceLocation: { file: 'src/alpha.ts', startLine: 1, endLine: 20 } },
    { id: 'B', name: 'Beta', type: 'interface', visibility: 'public', members: [],
      sourceLocation: { file: 'src/beta.ts', startLine: 1, endLine: 10 } },
    { id: 'C', name: 'Gamma', type: 'class', visibility: 'public', members: [],
      sourceLocation: { file: 'src/gamma.ts', startLine: 1, endLine: 15 } },
  ],
  relations: [
    { id: 'r1', type: 'dependency',     source: 'A', target: 'B' },
    { id: 'r2', type: 'implementation', source: 'C', target: 'B' },
  ],
};

describe('QueryEngine.fromArchJson()', () => {
  it('findEntity — exact match', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.findEntity('Alpha');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('A');
  });

  it('findEntity — fuzzy match', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.findEntity('lpha', true);
    expect(results.map(r => r.id)).toContain('A');
  });

  it('getDependents — depth 1', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.getDependents('Beta');
    expect(results.map(r => r.id)).toContain('A'); // A depends on B
    expect(results.map(r => r.id)).toContain('C'); // C implements B
  });

  it('getDependencies — depth 1', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.getDependencies('Alpha');
    expect(results.map(r => r.id)).toContain('B');
  });

  it('findImplementations', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.findImplementations('Beta');
    expect(results.map(r => r.id)).toContain('C');
    expect(results.map(r => r.id)).not.toContain('A'); // dependency, not implementation
  });

  it('getFileEntities', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const results = engine.getFileEntities('src/alpha.ts');
    expect(results.map(r => r.id)).toEqual(['A']);
  });

  it('getSummary returns correct counts', () => {
    const engine = QueryEngine.fromArchJson(baseArchJson);
    const summary = engine.getSummary();
    expect(summary.entityCount).toBe(3);
    expect(summary.relationCount).toBe(2);
    expect(summary.language).toBe('typescript');
  });

  it('getDependents BFS with cycle does not loop infinitely', () => {
    const cycleJson: ArchJSON = {
      ...baseArchJson,
      relations: [
        { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
        { id: 'r2', type: 'dependency', source: 'B', target: 'A' }, // cycle
      ],
    };
    const engine = QueryEngine.fromArchJson(cycleJson);
    // Should not throw or hang
    const results = engine.getDependents('Alpha', 3);
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('QueryEngine.load()', () => {
  it('throws QueryDataMissingError when arch.json absent', async () => {
    await expect(QueryEngine.load('/nonexistent/path')).rejects.toThrow(QueryDataMissingError);
  });
});
```

Run tests:

```bash
npm test -- tests/unit/cli/query/
# Expected: all tests pass

npm test
# Expected: no regressions
```

---

## Phase 3 — `query` subcommand

### Objectives

Implement `archguard query` as a Commander subcommand backed by `QueryEngine`.

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/query.ts` | New | Commander command with all `--entity / --used-by / --deps-of / --impls-of / --file / --cycles / --summary` flags |
| `src/cli/index.ts` | Modify | Register `query` subcommand |

---

### Stage 3-1 — `src/cli/commands/query.ts`

```typescript
// src/cli/commands/query.ts

import { Command } from 'commander';
import path from 'path';
import { QueryEngine, QueryDataMissingError } from '@/cli/query/query-engine.js';

function resolveArchDir(sourceDir?: string): string {
  return sourceDir ? path.resolve(sourceDir) : path.join(process.cwd(), '.archguard');
}

async function loadEngine(sourceDir?: string): Promise<QueryEngine> {
  const archDir = resolveArchDir(sourceDir);
  try {
    return await QueryEngine.load(archDir);
  } catch (err) {
    if (err instanceof QueryDataMissingError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

function printJson(data: unknown): void { console.log(JSON.stringify(data, null, 2)); }
function printText(label: string, items: { name: string; file: string; startLine?: number }[]): void {
  console.log(`\n${label}\n`);
  for (const item of items) {
    const loc = item.startLine ? `:${item.startLine}` : '';
    console.log(`  ${item.name.padEnd(40)} ${item.file}${loc}`);
  }
  console.log('');
}

export function createQueryCommand(): Command {
  return new Command('query')
    .description('Query the persisted ArchJSON index (run analyze first)')
    .option('--source-dir <dir>', 'Path to .archguard/ directory (default: ./.archguard)')
    .option('-f, --format <fmt>', 'Output format: json|text', 'json')

    .option('--entity <name>',   'Find entity by name (exact)')
    .option('--fuzzy',           'Use substring matching with --entity')
    .option('--used-by <name>',  'Find entities that depend on <name>')
    .option('--deps-of <name>',  'Find entities that <name> depends on')
    .option('--depth <n>',       'BFS depth for --used-by / --deps-of (1–5)', '1')
    .option('--impls-of <name>', 'Find implementations of interface/abstract class')
    .option('--file <path>',     'List all entities in a source file')
    .option('--cycles',          'Show all circular dependencies')
    .option('--entity-filter <name>', 'Filter --cycles to those containing this entity name')
    .option('--summary',         'Show project structure summary')

    .action(async (opts) => {
      const engine = await loadEngine(opts.sourceDir);
      const fmt    = opts.format as 'json' | 'text';
      const depth  = Math.min(Math.max(parseInt(opts.depth, 10) || 1, 1), 5);

      if (opts.entity !== undefined) {
        const results = engine.findEntity(opts.entity, !!opts.fuzzy);
        fmt === 'json' ? printJson(results) : printText(`"${opts.entity}" — ${results.length} match(es)`, results);
        return;
      }
      if (opts.usedBy !== undefined) {
        const results = engine.getDependents(opts.usedBy, depth);
        fmt === 'json' ? printJson(results) : printText(`${opts.usedBy}  ←  used by ${results.length} entities`, results);
        return;
      }
      if (opts.depsOf !== undefined) {
        const results = engine.getDependencies(opts.depsOf, depth);
        fmt === 'json' ? printJson(results) : printText(`${opts.depsOf}  →  depends on ${results.length} entities`, results);
        return;
      }
      if (opts.implsOf !== undefined) {
        const results = engine.findImplementations(opts.implsOf);
        fmt === 'json' ? printJson(results) : printText(`Implementations of ${opts.implsOf}`, results);
        return;
      }
      if (opts.file !== undefined) {
        const results = engine.getFileEntities(opts.file);
        fmt === 'json' ? printJson(results) : printText(`Entities in ${opts.file}`, results);
        return;
      }
      if (opts.cycles) {
        const results = engine.getCycles(opts.entityFilter);
        fmt === 'json'
          ? printJson(results)
          : results.length === 0
            ? console.log('No circular dependencies detected.')
            : results.forEach((c, i) =>
                console.log(`#${i + 1} [size=${c.size}] ${c.memberNames.join(' → ')}  (${c.files.join(', ')})`)
              );
        return;
      }
      if (opts.summary) {
        const summary = engine.getSummary();
        fmt === 'json' ? printJson(summary) : console.log(JSON.stringify(summary, null, 2));
        return;
      }

      // No flag provided
      console.error("Specify a query flag. Run 'archguard query --help' for options.");
      process.exit(1);
    });
}
```

### Stage 3-2 — Register in `src/cli/index.ts`

Add import and register:

```typescript
import { createQueryCommand } from './commands/query.js';
// ...
program.addCommand(createQueryCommand());
```

Verify:

```bash
npm run build
node dist/cli/index.js query --help
# Expected: lists all flags

node dist/cli/index.js query --entity "DiagramProcessor" --format text
# Expected: entity found with file path

node dist/cli/index.js query --used-by "ArchJSON" --format text
# Expected: list of dependent entities

node dist/cli/index.js query --cycles
# Expected: JSON array (may be empty)
```

---

## Phase 4 — `search` subcommand

### Objectives

Implement `archguard search` for structure-pattern file discovery.

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/commands/search.ts` | New | Commander command: `--calls / --type / --high-coupling / --orphans / --in-cycles` |
| `src/cli/index.ts` | Modify | Register `search` subcommand |

---

### Stage 4-1 — `src/cli/commands/search.ts`

```typescript
// src/cli/commands/search.ts

import { Command } from 'commander';
import path from 'path';
import { QueryEngine, QueryDataMissingError } from '@/cli/query/query-engine.js';

function resolveArchDir(sourceDir?: string): string {
  return sourceDir ? path.resolve(sourceDir) : path.join(process.cwd(), '.archguard');
}

async function loadEngine(sourceDir?: string): Promise<QueryEngine> {
  const archDir = resolveArchDir(sourceDir);
  try {
    return await QueryEngine.load(archDir);
  } catch (err) {
    if (err instanceof QueryDataMissingError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Deduplicate results by file, print one line per file. */
function printFiles(results: { name: string; file: string; startLine?: number }[], fmt: string): void {
  if (fmt === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  const files = [...new Set(results.map(r => r.file))].sort();
  files.forEach(f => console.log(f));
}

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Find files by structural patterns (no re-parsing required)')
    .option('--source-dir <dir>', 'Path to .archguard/ directory (default: ./.archguard)')
    .option('-f, --format <fmt>', 'Output format: json|text', 'text')

    .option('--calls <name>',        'Files containing entities that depend on <name> (entity-level; see docs for precision limits)')
    .option('--type <entityType>',   'Files containing entities of given EntityType (class, interface, abstract_class, enum, function, struct, trait)')
    .option('--module <prefix>',     'Restrict --type results to files under this path prefix')
    .option('--high-coupling',       'Entities with inDegree >= threshold')
    .option('--threshold <n>',       'Minimum dependents count for --high-coupling', '8')
    .option('--orphans',             'Entities with no dependents (potential dead code)')
    .option('--in-cycles',           'Files containing entities in circular dependencies')

    .action(async (opts) => {
      const engine = await loadEngine(opts.sourceDir);
      const fmt    = opts.format as 'json' | 'text';

      if (opts.calls !== undefined) {
        const results = engine.findCallers(opts.calls);
        printFiles(results, fmt);
        return;
      }
      if (opts.type !== undefined) {
        let results = engine.findByType(opts.type);
        if (opts.module) {
          results = results.filter(r => r.file.startsWith(opts.module));
        }
        printFiles(results, fmt);
        return;
      }
      if (opts.highCoupling) {
        const threshold = parseInt(opts.threshold, 10) || 8;
        const results = engine.findHighCoupling(threshold);
        // For high-coupling, show entity + inDegree
        if (fmt === 'json') {
          console.log(JSON.stringify(results, null, 2));
        } else {
          results
            .sort((a, b) => {
              const ia = engine.getSummary(); // inDegree not on EntityResult; compute via index
              return 0; // placeholder — actual impl accesses index.dependents directly
            })
            .forEach(r => console.log(`${r.name.padEnd(40)} ${r.file}`));
        }
        return;
      }
      if (opts.orphans) {
        const results = engine.findOrphans();
        printFiles(results, fmt);
        return;
      }
      if (opts.inCycles) {
        const results = engine.findInCycles();
        printFiles(results, fmt);
        return;
      }

      console.error("Specify a search flag. Run 'archguard search --help' for options.");
      process.exit(1);
    });
}
```

> **Note**: The `--high-coupling` text output in the stub above is a placeholder. During implementation, expose `index.dependents` length via `QueryEngine` or add an `EntityResult.inDegree` field to surface the count cleanly.

### Stage 4-2 — Register in `src/cli/index.ts`

```typescript
import { createSearchCommand } from './commands/search.js';
// ...
program.addCommand(createSearchCommand());
```

Verify:

```bash
npm run build
node dist/cli/index.js search --help

node dist/cli/index.js search --orphans
# Expected: list of files (text format, one per line)

node dist/cli/index.js search --in-cycles
# Expected: files in circular deps (may be empty)

node dist/cli/index.js search --type interface
# Expected: files containing interface entities
```

---

## Phase 5 — MCP Server

### Objectives

Expose `QueryEngine` methods as MCP tools via `@modelcontextprotocol/sdk`, accessible from Claude Code sessions.

### Prerequisites

```bash
npm install @modelcontextprotocol/sdk
# Confirm it appears in package.json dependencies (not devDependencies)
```

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/mcp-server.ts` | New | MCP Server: registers 7 tools, delegates to `QueryEngine` |
| `src/cli/commands/mcp.ts` | New | `mcp` Commander subcommand: loads engine, starts server |
| `src/cli/index.ts` | Modify | Register `mcp` subcommand |
| `package.json` | Modify | `@modelcontextprotocol/sdk` in `dependencies` |

---

### Stage 5-1 — `src/cli/mcp/mcp-server.ts`

```typescript
// src/cli/mcp/mcp-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { QueryEngine } from '@/cli/query/query-engine.js';

const TOOLS = [
  {
    name: 'archguard_find_entity',
    description: 'Find entities by name. Returns type, source file, line number, and public members.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name:  { type: 'string', description: 'Entity name (exact or fuzzy)' },
        fuzzy: { type: 'boolean', description: 'Use substring matching', default: false },
      },
      required: ['name'],
    },
  },
  {
    name: 'archguard_get_dependents',
    description: 'Return entities that depend on the named entity (change impact analysis).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityName: { type: 'string' },
        depth: { type: 'number', description: 'BFS depth (1–5)', default: 1 },
      },
      required: ['entityName'],
    },
  },
  {
    name: 'archguard_get_dependencies',
    description: 'Return entities that the named entity depends on.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityName: { type: 'string' },
        depth: { type: 'number', description: 'BFS depth (1–5)', default: 1 },
      },
      required: ['entityName'],
    },
  },
  {
    name: 'archguard_find_implementations',
    description: 'Return all implementations of an interface or subclasses of an abstract class.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        interfaceName: { type: 'string' },
      },
      required: ['interfaceName'],
    },
  },
  {
    name: 'archguard_get_file_entities',
    description: 'Return all entities defined in a source file, with their public members.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Project-relative file path' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'archguard_detect_cycles',
    description: 'Return circular dependencies (SCCs of size > 1). Optionally filter to those containing a specific entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityName: { type: 'string', description: 'Optional: filter to cycles containing this entity name' },
      },
    },
  },
  {
    name: 'archguard_summary',
    description: 'Return a project-level summary: entity count, relation count, cycle count, language, and top-5 most-depended-on entities.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export async function startMcpServer(engine: QueryEngine): Promise<void> {
  const server = new Server(
    { name: 'archguard', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    let result: unknown;

    switch (name) {
      case 'archguard_find_entity':
        result = engine.findEntity(args.name as string, !!(args.fuzzy));
        break;
      case 'archguard_get_dependents':
        result = engine.getDependents(args.entityName as string, (args.depth as number) ?? 1);
        break;
      case 'archguard_get_dependencies':
        result = engine.getDependencies(args.entityName as string, (args.depth as number) ?? 1);
        break;
      case 'archguard_find_implementations':
        result = engine.findImplementations(args.interfaceName as string);
        break;
      case 'archguard_get_file_entities':
        result = engine.getFileEntities(args.filePath as string);
        break;
      case 'archguard_detect_cycles':
        result = engine.getCycles(args.entityName as string | undefined);
        break;
      case 'archguard_summary':
        result = engine.getSummary();
        break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

---

### Stage 5-2 — `src/cli/commands/mcp.ts`

```typescript
// src/cli/commands/mcp.ts

import { Command } from 'commander';
import path from 'path';
import { QueryEngine, QueryDataMissingError } from '@/cli/query/query-engine.js';
import { startMcpServer } from '@/cli/mcp/mcp-server.js';

export function createMcpCommand(): Command {
  return new Command('mcp')
    .description('Start an MCP stdio server exposing ArchGuard query tools to Claude Code')
    .option('--source-dir <dir>', 'Path to .archguard/ directory (default: ./.archguard)')
    .action(async (opts) => {
      const archDir = opts.sourceDir
        ? path.resolve(opts.sourceDir)
        : path.join(process.cwd(), '.archguard');

      let engine: QueryEngine;
      try {
        engine = await QueryEngine.load(archDir);
      } catch (err) {
        if (err instanceof QueryDataMissingError) {
          // Startup failure: exit immediately with non-zero code (do not enter listen loop)
          console.error(err.message);
          process.exit(1);
        }
        throw err;
      }

      await startMcpServer(engine);
    });
}
```

### Stage 5-3 — Register in `src/cli/index.ts`

```typescript
import { createMcpCommand } from './commands/mcp.js';
// ...
program.addCommand(createMcpCommand());
```

### Stage 5-4 — Verify

```bash
npm run build

# Smoke test: should print tool list then hang (ctrl-c to exit)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  node dist/cli/index.js mcp 2>/dev/null | head -1
# Expected: JSON with tools array containing 7 entries

# Verify startup failure without arch.json
rm -rf /tmp/empty-archguard && mkdir /tmp/empty-archguard
node dist/cli/index.js mcp --source-dir /tmp/empty-archguard; echo "exit: $?"
# Expected: error message + "exit: 1"
```

---

## Final Validation

```bash
npm test
# Expected: no regressions, all new tests pass

npm run type-check
# Expected: 0 errors

npm run build
node dist/cli/index.js analyze -v

# Full query smoke test
node dist/cli/index.js query --summary --format text
node dist/cli/index.js query --entity "DiagramProcessor" --format text
node dist/cli/index.js query --used-by "ArchJSON" --format text
node dist/cli/index.js query --impls-of "IParser" --format text
node dist/cli/index.js query --cycles

# Search smoke test
node dist/cli/index.js search --type interface
node dist/cli/index.js search --orphans
node dist/cli/index.js search --in-cycles

# Index consistency: re-run analyze and verify archJsonHash matches
node dist/cli/index.js analyze -v
node -e "
  const crypto = require('crypto');
  const fs = require('fs');
  const hash = crypto.createHash('sha256').update(fs.readFileSync('.archguard/arch.json')).digest('hex');
  const idx  = JSON.parse(fs.readFileSync('.archguard/arch-index.json', 'utf-8'));
  console.log('hash match:', hash === idx.archJsonHash);
"
# Expected: hash match: true
```

---

## Acceptance Criteria Checklist

Cross-reference with proposal §"验收标准". Each item maps to a numbered criterion.

| # | Criterion | Phase | Verified by |
|---|-----------|-------|-------------|
| 1 | `arch.json` present after analyze (TS/Go/Java/Python/C++) | 1 | Self-analysis smoke test |
| 2 | `arch.json` entity count = `getPrimaryArchJson().entities.length` | 1 | Console check |
| 3 | Go Atlas: no `arch.json`, no error | 1 | Go Atlas project test |
| 4 | All groups fail: no `arch.json`, no error | 1 | Error-path test |
| 5 | `-f json`: both files coexist without conflict | 1 | Self-analysis `-f json` run |
| 6–10 | index field correctness | 2 | `arch-index-builder.test.ts` |
| 11 | `archJsonHash` matches written `arch.json` | 2 | Final validation script |
| 12 | Missing index: rebuild from `arch.json`, no disk write | 2 | `query-engine.test.ts` |
| 13 | Hash mismatch: rebuild from `arch.json`, no stale data | 2 | `query-engine.test.ts` |
| 14 | `arch.json` absent: `QueryDataMissingError`, exit 1 | 2 | `query-engine.test.ts` |
| 15 | MCP: exit 1 if `arch.json` absent (no silent start) | 5 | Stage 5-4 smoke test |
| 16–24 | `query` flag correctness | 3 | `query.test.ts` + smoke tests |
| 25–29 | `search` flag correctness | 4 | `search.test.ts` + smoke tests |
| 30–34 | MCP tool correctness | 5 | MCP smoke test + unit tests |
| 35–36 | No regressions, type-check clean | All | `npm test`, `npm run type-check` |

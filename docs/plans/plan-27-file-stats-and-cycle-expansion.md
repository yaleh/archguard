# Plan 27: File-Level Stats & Cycle Expansion — Development Plan

> Source proposal: `docs/proposals/proposal-file-stats-and-cycle-expansion.md`
> Branch: `feat/file-stats-and-cycle-expansion`
> Status: Draft

---

## Overview

Three phases. Each phase must pass `npm test` independently before the next begins.

| Phase | Scope | New files | Modified files | Dependency |
|-------|-------|-----------|----------------|------------|
| Phase 1 | Types + `MetricsCalculator` algorithm | 0 | 2 | None |
| Phase 2 | `DiagramResult.metrics` + `DiagramIndexGenerator` rendering | 1 | 2 | Phase 1 complete |
| Phase 3 | Build + validate against ArchGuard self-analysis | 0 | 0 | Phase 2 complete |

**Recommended order**: 1 → 2 → 3.

---

## Pre-flight

```bash
npm test
# Note current passing count (expected: 1938+)

npm run type-check
# Expected: 0 errors

npm run build
node dist/cli/index.js analyze -f json -v 2>&1 | grep -E "entities|relations|SCC"
# Baseline: confirm metrics field present in JSON output, fileStats/cycles absent
```

---

## Phase 1 — Types + `MetricsCalculator`

### Objectives

1. Add `FileStats`, `CycleInfo` interfaces and extend `ArchJSONMetrics` in `src/types/index.ts`
2. Refactor `countSCC()` → `computeCycles()` (retains SCC members)
3. Add `computeFileStats()` with level/mode guards
4. Update `calculate()` to fill `fileStats` and `cycles` conditionally

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/types/index.ts` | Modify | New `FileStats`, `CycleInfo` interfaces; extend `ArchJSONMetrics` |
| `src/parser/metrics-calculator.ts` | Modify | `computeCycles()`, `computeFileStats()`, updated `calculate()` |
| `tests/unit/parser/metrics-calculator.test.ts` | Modify | New test groups for `fileStats` and `cycles` |

---

### Stage 1-0 — Verify baseline

```bash
npm test
# 0 failures in metrics-calculator.test.ts

grep -n "countSCC\|FileStats\|CycleInfo\|fileStats\|cycles" \
  src/parser/metrics-calculator.ts src/types/index.ts
# Confirm: countSCC exists; FileStats/CycleInfo/fileStats/cycles absent
```

---

### Stage 1-1 — Add types to `src/types/index.ts`

In `src/types/index.ts`, after the closing `}` of `ArchJSONMetrics`, append:

```typescript
/**
 * Per-source-file statistics. Only present when level === 'class' | 'method'
 * and not in Go Atlas mode. All values are raw counts with no thresholds.
 */
export interface FileStats {
  /** Source file path, relative to workspaceRoot (C++ absolute paths normalised). */
  file: string;
  /** Approximate line count: max(entity.sourceLocation.endLine) for entities in this file. */
  loc: number;
  /** Number of entities (class / interface / struct / enum / …) defined in this file. */
  entityCount: number;
  /** Total methods: members where type === 'method' || type === 'constructor'. */
  methodCount: number;
  /** Total fields: members where type === 'property' || type === 'field'. */
  fieldCount: number;
  /** Number of internal relations whose target is an entity in this file. */
  inDegree: number;
  /** Number of internal relations whose source is an entity in this file. */
  outDegree: number;
  /** Count of distinct non-trivial SCCs (size > 1) that contain an entity from this file. */
  cycleCount: number;
}

/**
 * One strongly connected component of size > 1 (non-trivial cycle).
 * Kosaraju produces a partition — members across different CycleInfo entries never overlap.
 */
export interface CycleInfo {
  /** Number of entities in this cycle. */
  size: number;
  /** Entity IDs (ArchJSON entities[].id) — for programmatic lookup. */
  members: string[];
  /** Entity names, parallel to members — for human-readable rendering in index.md. */
  memberNames: string[];
  /** Deduplicated source file paths (relative) of all members. */
  files: string[];
}
```

Then extend `ArchJSONMetrics` with two optional fields (append inside the existing interface):

```typescript
  /**
   * Per-file statistics, sorted by inDegree DESC.
   * undefined when level === 'package', Go Atlas mode, or entities array is empty.
   */
  fileStats?: FileStats[];

  /**
   * Non-trivial SCCs (size > 1), sorted by size DESC.
   * Empty array = no size > 1 cycles. Self-loops (size = 1) are excluded.
   */
  cycles?: CycleInfo[];
```

Run type-check only (no logic yet):

```bash
npm run type-check
# Expected: 0 errors
```

---

### Stage 1-2 — Write tests first (red)

Append two new `describe` blocks to `tests/unit/parser/metrics-calculator.test.ts`.

**Helper additions** (at the top of the file alongside existing helpers):

```typescript
const makeEntityInFile = (
  id: string,
  file: string,
  endLine = 10,
  members: import('@/types/index.js').Member[] = [],
): Entity => ({
  id,
  name: id,
  type: 'class',
  visibility: 'public',
  members,
  sourceLocation: { file, startLine: 1, endLine },
});

const makeMember = (
  type: import('@/types/index.js').MemberType,
): import('@/types/index.js').Member => ({
  name: 'x',
  type,
  visibility: 'public',
});
```

**`describe('MetricsCalculator — cycles')`**:

```typescript
describe('MetricsCalculator — cycles', () => {
  const calc = new MetricsCalculator();

  it('no cycle: cycles = []', () => {
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B')],
      [makeRelation('r1', 'A', 'B')],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toEqual([]);
  });

  it('simple 2-node cycle: one CycleInfo with correct fields', () => {
    const arch = makeArchJSON(
      [
        makeEntityInFile('A', 'src/a.ts'),
        makeEntityInFile('B', 'src/b.ts'),
      ],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toHaveLength(1);
    const c = r.cycles![0];
    expect(c.size).toBe(2);
    expect(c.members.sort()).toEqual(['A', 'B']);
    expect(c.memberNames.sort()).toEqual(['A', 'B']);
    expect(c.files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('self-loop A→A: not in cycles (size = 1)', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts')],
      [makeRelation('r1', 'A', 'A')],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toEqual([]);
  });

  it('two independent cycles: both appear, sorted by size DESC', () => {
    // Cycle 1: A→B→C→A (size 3), Cycle 2: D→E→D (size 2)
    const entities = ['A', 'B', 'C', 'D', 'E'].map(id => makeEntityInFile(id, `src/${id.toLowerCase()}.ts`));
    const relations = [
      makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'C'), makeRelation('r3', 'C', 'A'),
      makeRelation('r4', 'D', 'E'), makeRelation('r5', 'E', 'D'),
    ];
    const r = calc.calculate(makeArchJSON(entities, relations), 'class');
    expect(r.cycles).toHaveLength(2);
    expect(r.cycles![0].size).toBe(3);
    expect(r.cycles![1].size).toBe(2);
  });

  it('intra-file cycle: files list has length 1', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/a.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles![0].files).toEqual(['src/a.ts']);
  });

  it('memberNames parallel to members (id === name in test fixtures)', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('Alpha', 'src/a.ts'), makeEntityInFile('Beta', 'src/b.ts')],
      [makeRelation('r1', 'Alpha', 'Beta'), makeRelation('r2', 'Beta', 'Alpha')],
    );
    const r = calc.calculate(arch, 'class');
    const c = r.cycles![0];
    const pairs = c.members.map((id, i) => [id, c.memberNames[i]]);
    for (const [id, name] of pairs) {
      expect(id).toBe(name); // in test fixtures entity.id === entity.name
    }
  });

  it('cycles undefined when level === package', () => {
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')],
    );
    const r = calc.calculate(arch, 'package');
    expect(r.cycles).toBeUndefined();
  });

  it('cycles undefined for Go Atlas mode', () => {
    const arch: ArchJSON = {
      ...makeArchJSON([makeEntityInFile('A', 'pkg/a.go')], []),
      extensions: { goAtlas: {} as any },
    };
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toBeUndefined();
  });

  it('Kosaraju partition: sum of cycle sizes equals non-trivial entity count exactly', () => {
    // A→B→C→A (size 3), D isolated
    const entities = ['A', 'B', 'C', 'D'].map(id => makeEntityInFile(id, 'src/a.ts'));
    const relations = [
      makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'C'), makeRelation('r3', 'C', 'A'),
    ];
    const r = calc.calculate(makeArchJSON(entities, relations), 'class');
    const sum = r.cycles!.reduce((acc, c) => acc + c.size, 0);
    expect(sum).toBe(3); // exactly 3, not >=
  });

  it('empty graph: cycles = []', () => {
    const r = calc.calculate(makeArchJSON([], []), 'class');
    expect(r.cycles).toEqual([]);
  });
});
```

**`describe('MetricsCalculator — fileStats')`**:

```typescript
describe('MetricsCalculator — fileStats', () => {
  const calc = new MetricsCalculator();

  it('single file: one FileStats entry', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts', 50)],
      [],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats).toHaveLength(1);
    expect(r.fileStats![0].file).toBe('src/a.ts');
  });

  it('entityCount === number of entities in that file', () => {
    const arch = makeArchJSON(
      [
        makeEntityInFile('A', 'src/a.ts'),
        makeEntityInFile('B', 'src/a.ts'),
        makeEntityInFile('C', 'src/b.ts'),
      ],
      [],
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats!.find(f => f.file === 'src/a.ts')!;
    const b = r.fileStats!.find(f => f.file === 'src/b.ts')!;
    expect(a.entityCount).toBe(2);
    expect(b.entityCount).toBe(1);
  });

  it('loc = max(endLine) across entities in file', () => {
    const arch = makeArchJSON(
      [
        makeEntityInFile('A', 'src/a.ts', 30),
        makeEntityInFile('B', 'src/a.ts', 80),
        makeEntityInFile('C', 'src/a.ts', 50),
      ],
      [],
    );
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats![0].loc).toBe(80);
  });

  it('methodCount counts method and constructor, not property or field', () => {
    const entity = makeEntityInFile('A', 'src/a.ts', 10, [
      makeMember('method'),
      makeMember('constructor'),
      makeMember('property'),
      makeMember('field'),
    ]);
    const r = calc.calculate(makeArchJSON([entity], []), 'class');
    expect(r.fileStats![0].methodCount).toBe(2);
    expect(r.fileStats![0].fieldCount).toBe(2);
  });

  it('fieldCount counts property and field, not method or constructor', () => {
    const entity = makeEntityInFile('A', 'src/a.ts', 10, [
      makeMember('property'),
      makeMember('field'),
      makeMember('method'),
    ]);
    const r = calc.calculate(makeArchJSON([entity], []), 'class');
    expect(r.fileStats![0].fieldCount).toBe(2);
  });

  it('inDegree: only internal relations count (external targets excluded)', () => {
    // A in src/a.ts is a target of B→A (internal) and Z→A (Z not in entities)
    const arch: ArchJSON = {
      ...makeArchJSON(
        [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
        [
          makeRelation('r1', 'B', 'A'),       // internal → counts
          makeRelation('r2', 'Z', 'A'),       // Z external → skipped
        ],
      ),
    };
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats!.find(f => f.file === 'src/a.ts')!;
    expect(a.inDegree).toBe(1);
  });

  it('outDegree: only internal relations count (external sources excluded)', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
      [
        makeRelation('r1', 'A', 'B'),         // internal → counts
        makeRelation('r2', 'A', 'EXTERNAL'),  // external target → skipped
      ],
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats!.find(f => f.file === 'src/a.ts')!;
    expect(a.outDegree).toBe(1);
  });

  it('cycleCount: files with entities in a non-trivial SCC get count 1', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')],
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats!.find(f => f.file === 'src/a.ts')!;
    const b = r.fileStats!.find(f => f.file === 'src/b.ts')!;
    expect(a.cycleCount).toBe(1);
    expect(b.cycleCount).toBe(1);
  });

  it('cycleCount: file with no cycle entities gets 0', () => {
    const arch = makeArchJSON(
      [
        makeEntityInFile('A', 'src/a.ts'),
        makeEntityInFile('B', 'src/b.ts'),
        makeEntityInFile('C', 'src/c.ts'), // C not in any cycle
      ],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')],
    );
    const r = calc.calculate(arch, 'class');
    const c = r.fileStats!.find(f => f.file === 'src/c.ts')!;
    expect(c.cycleCount).toBe(0);
  });

  it('sorted by inDegree DESC (then outDegree DESC)', () => {
    // src/a.ts inDegree 3, src/b.ts inDegree 1
    const arch = makeArchJSON(
      [
        makeEntityInFile('A1', 'src/a.ts'), makeEntityInFile('A2', 'src/a.ts'),
        makeEntityInFile('B',  'src/b.ts'),
        makeEntityInFile('C1', 'src/c.ts'), makeEntityInFile('C2', 'src/c.ts'), makeEntityInFile('C3', 'src/c.ts'),
      ],
      [
        makeRelation('r1', 'C1', 'A1'), makeRelation('r2', 'C2', 'A1'), makeRelation('r3', 'C3', 'A2'),
        makeRelation('r4', 'C1', 'B'),
      ],
    );
    const r = calc.calculate(arch, 'class');
    const files = r.fileStats!.map(f => f.file);
    expect(files[0]).toBe('src/a.ts'); // inDegree 3
    expect(files[1]).toBe('src/b.ts'); // inDegree 1
    expect(files[2]).toBe('src/c.ts'); // inDegree 0
  });

  it('fileStats undefined when level === package', () => {
    const arch = makeArchJSON([makeEntityInFile('A', 'src/a.ts')], []);
    const r = calc.calculate(arch, 'package');
    expect(r.fileStats).toBeUndefined();
  });

  it('fileStats undefined for Go Atlas mode', () => {
    const arch: ArchJSON = {
      ...makeArchJSON([makeEntityInFile('A', 'src/a.ts')], []),
      extensions: { goAtlas: {} as any },
    };
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats).toBeUndefined();
  });

  it('empty ArchJSON: fileStats = []', () => {
    const r = calc.calculate(makeArchJSON([], []), 'class');
    expect(r.fileStats).toEqual([]);
  });

  it('C++ absolute path normalised via workspaceRoot', () => {
    const arch: ArchJSON = {
      ...makeArchJSON(
        [makeEntityInFile('Foo', '/home/user/proj/src/foo.cpp', 20)],
        [],
      ),
      workspaceRoot: '/home/user/proj',
    };
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats![0].file).toBe('src/foo.cpp');
  });

  it('entity without sourceLocation is skipped gracefully', () => {
    const broken: Entity = {
      id: 'X', name: 'X', type: 'class', visibility: 'public', members: [],
      sourceLocation: { file: '', startLine: 0, endLine: 0 },
    };
    const arch = makeArchJSON([broken, makeEntityInFile('A', 'src/a.ts')], []);
    expect(() => calc.calculate(arch, 'class')).not.toThrow();
  });
});
```

Run to confirm all new tests fail:

```bash
npx vitest run tests/unit/parser/metrics-calculator.test.ts
# Expected: 20+ new failures (methods not yet implemented)
```

---

### Stage 1-3 — Implement in `metrics-calculator.ts`

Replace the body of `metrics-calculator.ts` with the following (preserve existing import):

```typescript
import path from 'path';
import type { ArchJSON, ArchJSONMetrics, RelationType, DetailLevel, FileStats, CycleInfo } from '@/types/index.js';

export class MetricsCalculator {
  calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics {
    const { entities, relations } = archJSON;
    const isAtlas = !!archJSON.extensions?.goAtlas;
    const entityCount = entities.length;
    const relationCount = relations.length;

    const { sccCount, cycles, nonTrivialSCCs } = this.computeCycles(archJSON, level, isAtlas);

    const fileStats =
      !isAtlas && level !== 'package'
        ? this.computeFileStats(archJSON, nonTrivialSCCs)
        : undefined;

    return {
      level,
      entityCount,
      relationCount,
      relationTypeBreakdown: this.buildTypeBreakdown(relations),
      stronglyConnectedComponents: sccCount,
      inferredRelationRatio: this.calcInferredRatio(relations),
      fileStats,
      cycles: !isAtlas && level !== 'package' ? cycles : undefined,
    };
  }

  // ── Private: type breakdown ───────────────────────────────────────────────

  private buildTypeBreakdown(
    relations: ArchJSON['relations'],
  ): Partial<Record<RelationType, number>> {
    const breakdown: Partial<Record<RelationType, number>> = {};
    for (const r of relations) {
      breakdown[r.type] = (breakdown[r.type] ?? 0) + 1;
    }
    return breakdown;
  }

  private calcInferredRatio(relations: ArchJSON['relations']): number {
    if (relations.length === 0) return 0;
    const inferredCount = relations.filter(
      r => r.inferenceSource !== undefined && r.inferenceSource !== 'explicit',
    ).length;
    return Math.round((inferredCount / relations.length) * 100) / 100;
  }

  // ── Private: SCC / cycles ─────────────────────────────────────────────────

  private computeCycles(
    archJSON: ArchJSON,
    level: DetailLevel,
    isAtlas: boolean,
  ): { sccCount: number; cycles: CycleInfo[]; nonTrivialSCCs: string[][] } {
    const empty = { sccCount: 0, cycles: [] as CycleInfo[], nonTrivialSCCs: [] as string[][] };
    if (isAtlas || level === 'package') return empty;

    const { entities, relations, workspaceRoot } = archJSON;
    if (entities.length === 0) return { sccCount: 0, cycles: [], nonTrivialSCCs: [] };

    const entityIds = new Set(entities.map(e => e.id));
    const validRelations = relations.filter(r => entityIds.has(r.source) && entityIds.has(r.target));

    // Build forward and transposed adjacency lists
    const graph = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const id of entityIds) { graph.set(id, []); transposed.set(id, []); }
    for (const r of validRelations) {
      graph.get(r.source)!.push(r.target);
      transposed.get(r.target)!.push(r.source);
    }

    // Pass 1: collect finish order
    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    for (const id of entityIds) {
      if (!visited1.has(id)) this.dfsIterative(id, graph, visited1, finishStack);
    }

    // Pass 2: collect SCC members
    const visited2 = new Set<string>();
    const sccGroups: string[][] = [];
    while (finishStack.length > 0) {
      const node = finishStack.pop()!;
      if (!visited2.has(node)) {
        const members: string[] = [];
        this.dfsIterative(node, transposed, visited2, members);
        sccGroups.push(members);
      }
    }

    const sccCount = sccGroups.length;
    const nonTrivialSCCs = sccGroups.filter(g => g.length > 1);

    // Build entity maps for CycleInfo construction
    const entityFileMap = new Map<string, string>();
    const entityNameMap = new Map<string, string>();
    for (const e of entities) {
      const rawFile = e.sourceLocation?.file ?? '';
      const file =
        workspaceRoot && rawFile && path.isAbsolute(rawFile)
          ? path.relative(workspaceRoot, rawFile).replace(/\\/g, '/')
          : rawFile;
      entityFileMap.set(e.id, file);
      entityNameMap.set(e.id, e.name);
    }

    const cycles: CycleInfo[] = nonTrivialSCCs
      .map(members => ({
        size: members.length,
        members,
        memberNames: members.map(id => entityNameMap.get(id) ?? id),
        files: [...new Set(members.map(id => entityFileMap.get(id) ?? '').filter(Boolean))],
      }))
      .sort((a, b) => b.size - a.size);

    return { sccCount, cycles, nonTrivialSCCs };
  }

  // ── Private: file stats ───────────────────────────────────────────────────

  private computeFileStats(archJSON: ArchJSON, nonTrivialSCCs: string[][]): FileStats[] {
    const { entities, relations, workspaceRoot } = archJSON;

    const normalise = (rawFile: string): string => {
      if (!rawFile) return '';
      if (workspaceRoot && path.isAbsolute(rawFile)) {
        return path.relative(workspaceRoot, rawFile).replace(/\\/g, '/');
      }
      return rawFile;
    };

    // Group entities by normalised file path
    const fileEntityMap = new Map<string, typeof entities>();
    for (const e of entities) {
      const file = normalise(e.sourceLocation?.file ?? '');
      if (!file) continue;
      if (!fileEntityMap.has(file)) fileEntityMap.set(file, []);
      fileEntityMap.get(file)!.push(e);
    }

    // Build per-entity degree maps (internal relations only)
    const entityIds = new Set(entities.map(e => e.id));
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const r of relations) {
      if (!entityIds.has(r.source) || !entityIds.has(r.target)) continue;
      outDegree.set(r.source, (outDegree.get(r.source) ?? 0) + 1);
      inDegree.set(r.target, (inDegree.get(r.target) ?? 0) + 1);
    }

    // Build cycleCount per file
    const entityFileMap = new Map<string, string>();
    for (const e of entities) {
      entityFileMap.set(e.id, normalise(e.sourceLocation?.file ?? ''));
    }
    const cycleCountPerFile = new Map<string, number>();
    for (const scc of nonTrivialSCCs) {
      const filesInSCC = new Set(scc.map(id => entityFileMap.get(id) ?? '').filter(Boolean));
      for (const f of filesInSCC) {
        cycleCountPerFile.set(f, (cycleCountPerFile.get(f) ?? 0) + 1);
      }
    }

    // Build FileStats per file
    const stats: FileStats[] = [];
    for (const [file, ents] of fileEntityMap) {
      let loc = 0;
      let methodCount = 0;
      let fieldCount = 0;
      let filInDegree = 0;
      let filOutDegree = 0;

      for (const e of ents) {
        if (e.sourceLocation.endLine > loc) loc = e.sourceLocation.endLine;
        for (const m of e.members) {
          if (m.type === 'method' || m.type === 'constructor') methodCount++;
          else if (m.type === 'property' || m.type === 'field') fieldCount++;
        }
        filInDegree  += inDegree.get(e.id)  ?? 0;
        filOutDegree += outDegree.get(e.id) ?? 0;
      }

      stats.push({
        file,
        loc,
        entityCount: ents.length,
        methodCount,
        fieldCount,
        inDegree:  filInDegree,
        outDegree: filOutDegree,
        cycleCount: cycleCountPerFile.get(file) ?? 0,
      });
    }

    // Sort by inDegree DESC, outDegree DESC as tiebreaker
    stats.sort((a, b) => b.inDegree - a.inDegree || b.outDegree - a.outDegree);
    return stats;
  }

  // ── Private: iterative DFS ────────────────────────────────────────────────

  /**
   * Iterative DFS. finishList receives nodes in finish order when non-null.
   */
  private dfsIterative(
    start: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    finishList: string[] | null,
  ): void {
    const stack: [string, number][] = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const neighbors = graph.get(node) ?? [];
      if (idx < neighbors.length) {
        top[1]++;
        const next = neighbors[idx];
        if (!visited.has(next)) { visited.add(next); stack.push([next, 0]); }
      } else {
        stack.pop();
        if (finishList !== null) finishList.push(node);
      }
    }
  }
}
```

Run to confirm green:

```bash
npx vitest run tests/unit/parser/metrics-calculator.test.ts
# Expected: all tests pass (including all pre-existing SCC tests)

npm test
# Expected: 0 new failures

npm run type-check
# Expected: 0 errors
```

---

## Phase 2 — `DiagramResult.metrics` + `DiagramIndexGenerator`

### Objectives

1. Add `metrics?: ArchJSONMetrics` to `DiagramResult` and always compute it in `processDiagramWithArchJSON()`
2. Write tests and implement `DiagramIndexGenerator` stats table rendering

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/processors/diagram-processor.ts` | Modify | `DiagramResult.metrics` field; always compute metrics |
| `src/cli/utils/diagram-index-generator.ts` | Modify | `generate()` selects metrics; appends two stats tables |
| `tests/unit/cli/utils/diagram-index-generator.test.ts` | Create | Unit tests for table rendering and metrics selection |

---

### Stage 2-0 — Verify baseline

```bash
npm test
# 0 new failures since Phase 1

grep -n "DiagramResult\|metricsCalculator\|format === 'json'" \
  src/cli/processors/diagram-processor.ts | head -20
# Confirm: DiagramResult has no metrics field; metricsCalculator.calculate() called only inside format==='json' branch
```

---

### Stage 2-1 — Extend `DiagramResult` + decouple metrics computation

**`src/cli/processors/diagram-processor.ts`**

Step A — Add `metrics` field to `DiagramResult`:

```typescript
// Inside the DiagramResult interface, after the error field:
  /**
   * Structural metrics for this diagram (computed regardless of output format).
   * Used by DiagramIndexGenerator to render index.md stats tables.
   * Only present when success === true.
   */
  metrics?: ArchJSONMetrics;
```

Add the required import at the top of the file (alongside existing type imports):

```typescript
import type { ArchJSON, ArchJSONMetrics } from '@/types/index.js';
```

Step B — Always compute metrics in `processDiagramWithArchJSON()`. Locate the block that currently reads:

```typescript
const outputJSON =
  format === 'json'
    ? { ...aggregatedJSON, metrics: this.metricsCalculator.calculate(aggregatedJSON, diagram.level) }
    : aggregatedJSON;
```

Replace with:

```typescript
const computedMetrics: ArchJSONMetrics = this.metricsCalculator.calculate(aggregatedJSON, diagram.level);
const outputJSON =
  format === 'json'
    ? { ...aggregatedJSON, metrics: computedMetrics }
    : aggregatedJSON;
```

Then, in the success return value of `processDiagramWithArchJSON()`, add `metrics: computedMetrics` to the returned `DiagramResult`. Locate the object that builds the success result (contains `name`, `success: true`, `paths`, `stats`) and add:

```typescript
  metrics: computedMetrics,
```

Run to confirm no regressions:

```bash
npm test
# Expected: 0 new failures

npm run type-check
# Expected: 0 errors
```

---

### Stage 2-2 — Write tests first for `DiagramIndexGenerator` (red)

Create `tests/unit/cli/utils/diagram-index-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DiagramIndexGenerator } from '@/cli/utils/diagram-index-generator.js';
import type { DiagramResult } from '@/cli/processors/diagram-processor.js';
import type { ArchJSONMetrics, FileStats, CycleInfo } from '@/types/index.js';
import type { GlobalConfig } from '@/types/config.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

// ── Helpers ─────────────────────────────────────────────────────────────────

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-idx-'));

const baseConfig = (outputDir: string): GlobalConfig =>
  ({ outputDir } as GlobalConfig);

const makeResult = (
  name: string,
  level: ArchJSONMetrics['level'],
  fileStats?: FileStats[],
  cycles?: CycleInfo[],
): DiagramResult => ({
  name,
  success: true,
  stats: { entities: 10, relations: 5, parseTime: 1000 },
  metrics: {
    level,
    entityCount: 10,
    relationCount: 5,
    relationTypeBreakdown: {},
    stronglyConnectedComponents: 10,
    inferredRelationRatio: 0,
    fileStats,
    cycles,
  },
});

const makeFileStats = (file: string, overrides: Partial<FileStats> = {}): FileStats => ({
  file,
  loc: 100,
  entityCount: 2,
  methodCount: 5,
  fieldCount: 3,
  inDegree: 4,
  outDegree: 2,
  cycleCount: 0,
  ...overrides,
});

const makeCycle = (size: number, files: string[], members: string[]): CycleInfo => ({
  size,
  members,
  memberNames: members,
  files,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DiagramIndexGenerator — stats tables', () => {
  it('no metrics in any result: no stats sections in index.md', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([{ name: 'pkg', success: true, stats: { entities: 1, relations: 0, parseTime: 0 } }]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).not.toContain('## Circular Dependencies');
    await fs.remove(dir);
  });

  it('only package-level metrics: no stats sections', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    const result = makeResult('pkg', 'package', undefined, undefined);
    await gen.generate([result]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).not.toContain('## Circular Dependencies');
    await fs.remove(dir);
  });

  it('class-level metrics: File Statistics section appears', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      makeResult('cls', 'class', [makeFileStats('src/a.ts')], []),
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('## File Statistics');
    expect(content).toContain('src/a.ts');
    await fs.remove(dir);
  });

  it('class-level metrics: Circular Dependencies section appears', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      makeResult('cls', 'class',
        [makeFileStats('src/a.ts')],
        [makeCycle(2, ['src/a.ts', 'src/b.ts'], ['A', 'B'])],
      ),
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('## Circular Dependencies');
    expect(content).toContain('1 cycle');
    expect(content).toContain('A, B');
    await fs.remove(dir);
  });

  it('empty cycles: "No circular dependencies detected." message', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('No circular dependencies detected');
    expect(content).not.toMatch(/\| # \| Size/); // no table
    await fs.remove(dir);
  });

  it('fileStats undefined (Go Atlas): File Statistics section omitted', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('atlas', 'class', undefined, undefined)]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    await fs.remove(dir);
  });

  it('prefers class over method when both present', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      makeResult('method-diag', 'method', [makeFileStats('src/x.ts')], []),
      makeResult('class-diag',  'class',  [makeFileStats('src/y.ts')], []),
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    // class-level stats should appear (src/y.ts), not method-level (src/x.ts)
    expect(content).toContain('src/y.ts');
    expect(content).not.toContain('src/x.ts');
    await fs.remove(dir);
  });

  it('uses method-level when no class-level present', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('method-diag', 'method', [makeFileStats('src/m.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('src/m.ts');
    await fs.remove(dir);
  });

  it('stats tables appear after the Diagrams section', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    const diagramsIdx    = content.indexOf('## Diagrams');
    const fileStatsIdx   = content.indexOf('## File Statistics');
    const circularIdx    = content.indexOf('## Circular Dependencies');
    expect(diagramsIdx).toBeGreaterThan(-1);
    expect(fileStatsIdx).toBeGreaterThan(diagramsIdx);
    expect(circularIdx).toBeGreaterThan(fileStatsIdx);
    await fs.remove(dir);
  });

  it('file stats table header contains expected columns', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('| File |');
    expect(content).toContain('LOC');
    expect(content).toContain('Entities');
    expect(content).toContain('Methods');
    expect(content).toContain('Fields');
    expect(content).toContain('InDegree');
    expect(content).toContain('OutDegree');
    expect(content).toContain('Cycles');
    await fs.remove(dir);
  });

  it('top-30 truncation: only first 30 files shown when fileStats has 35 entries', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    const manyFiles = Array.from({ length: 35 }, (_, i) =>
      makeFileStats(`src/file${String(i).padStart(2, '0')}.ts`, { inDegree: 35 - i }),
    );
    await gen.generate([makeResult('cls', 'class', manyFiles, [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    // file00 (inDegree 35) should be present, file34 (inDegree 1) should be absent
    expect(content).toContain('src/file00.ts');
    expect(content).not.toContain('src/file34.ts');
    await fs.remove(dir);
  });
});
```

Run to confirm all new tests fail:

```bash
npx vitest run tests/unit/cli/utils/diagram-index-generator.test.ts
# Expected: all tests fail
```

---

### Stage 2-3 — Implement in `diagram-index-generator.ts`

Add the following import to `src/cli/utils/diagram-index-generator.ts`:

```typescript
import type { ArchJSONMetrics, FileStats, CycleInfo } from '@/types/index.js';
```

Add a private method to select metrics and extend `buildIndexContent()`. The complete additions:

```typescript
// In buildIndexContent(), add before the closing return:
content += this.buildStatsSection(results);
```

New private methods:

```typescript
  /**
   * Select metrics for stats tables: class level preferred, then method.
   * package level and missing metrics are excluded.
   */
  private selectMetrics(results: DiagramResult[]): ArchJSONMetrics | undefined {
    return (
      results.find(r => r.success && r.metrics?.level === 'class')?.metrics ??
      results.find(r => r.success && r.metrics?.level === 'method')?.metrics
    );
  }

  /**
   * Build the File Statistics and Circular Dependencies sections.
   * Returns '' when no applicable metrics are available.
   */
  private buildStatsSection(results: DiagramResult[]): string {
    const metrics = this.selectMetrics(results);
    if (!metrics) return '';

    let section = '';
    section += this.buildFileStatsTable(metrics);
    section += this.buildCyclesTable(metrics);
    return section;
  }

  private buildFileStatsTable(metrics: ArchJSONMetrics): string {
    const { fileStats, level } = metrics;
    if (!fileStats || fileStats.length === 0) return '';

    const TOP_N = 30;
    const rows = fileStats.slice(0, TOP_N);
    const truncated = fileStats.length > TOP_N;

    let s = '## File Statistics (sorted by InDegree ↓)\n\n';
    s += `> \`LOC\` is approximate (max entity endLine). `;
    s += `\`InDegree\`/\`OutDegree\` count relations within parsed scope. `;
    s += `Level: \`${level}\``;
    if (truncated) s += `. Showing top ${TOP_N} of ${fileStats.length} files.`;
    s += '\n\n';
    s += '| File | LOC | Entities | Methods | Fields | InDegree | OutDegree | Cycles |\n';
    s += '|------|-----|----------|---------|--------|----------|-----------|--------|\n';
    for (const f of rows) {
      s += `| ${f.file} | ${f.loc} | ${f.entityCount} | ${f.methodCount} | ${f.fieldCount} | ${f.inDegree} | ${f.outDegree} | ${f.cycleCount} |\n`;
    }
    s += '\n';
    return s;
  }

  private buildCyclesTable(metrics: ArchJSONMetrics): string {
    const { cycles } = metrics;
    if (cycles === undefined) return '';

    let s = '## Circular Dependencies\n\n';
    if (cycles.length === 0) {
      s += 'No circular dependencies detected.\n\n';
      return s;
    }

    const noun = cycles.length === 1 ? 'cycle' : 'cycles';
    s += `${cycles.length} ${noun} detected.\n\n`;
    s += '| # | Size | Files | Members |\n';
    s += '|---|------|-------|---------|\n';
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      s += `| ${i + 1} | ${c.size} | ${c.files.join(', ')} | ${c.memberNames.join(', ')} |\n`;
    }
    s += '\n';
    return s;
  }
```

Run to confirm green:

```bash
npx vitest run tests/unit/cli/utils/diagram-index-generator.test.ts
# Expected: all tests pass

npm test
# Expected: 0 new failures

npm run type-check
# Expected: 0 errors
```

---

## Phase 3 — Build + Validate

### Stage 3-1 — Build

```bash
npm run build
# Expected: 0 errors, dist/ updated
```

### Stage 3-2 — Validate: JSON format includes fileStats and cycles

```bash
node dist/cli/index.js analyze -f json -v

# Check output JSON for new fields:
node -e "
const data = JSON.parse(require('fs').readFileSync('.archguard/class/all-classes.json', 'utf8'));
console.log('fileStats count:', data.metrics?.fileStats?.length ?? 'MISSING');
console.log('cycles count:',    data.metrics?.cycles?.length    ?? 'MISSING');
console.log('top file:',        data.metrics?.fileStats?.[0]?.file ?? 'none');
console.log('SCC:',             data.metrics?.stronglyConnectedComponents);
"
# Expected: fileStats count > 0, cycles count >= 0 (integer), top file is a real path
```

### Stage 3-3 — Validate: Mermaid format generates stats in index.md

```bash
node dist/cli/index.js analyze -v

cat .archguard/index.md | grep -A 5 "## File Statistics"
# Expected: table with column headers and data rows

cat .archguard/index.md | grep -A 3 "## Circular Dependencies"
# Expected: either cycle count + table, or "No circular dependencies detected."
```

### Stage 3-4 — Validate: package-level metrics have no fileStats

```bash
node dist/cli/index.js analyze -f json --diagrams package -v

node -e "
const data = JSON.parse(require('fs').readFileSync('.archguard/overview/package.json', 'utf8'));
console.log('fileStats:', data.metrics?.fileStats);   // must be undefined or absent
console.log('cycles:',    data.metrics?.cycles);      // must be undefined or absent
"
# Expected: fileStats: undefined, cycles: undefined
```

### Stage 3-5 — Validate: external project (C++ absolute path normalisation)

```bash
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  -f json --diagrams class --output-dir /home/yale/work/llama.cpp/.archguard

node -e "
const data = JSON.parse(require('fs').readFileSync(
  '/home/yale/work/llama.cpp/.archguard/llama.cpp/class.json', 'utf8'));
const files = data.metrics?.fileStats?.map(f => f.file) ?? [];
const hasAbsolute = files.some(f => f.startsWith('/'));
console.log('absolute paths:', hasAbsolute);         // must be false
console.log('sample files:', files.slice(0, 3));
"
# Expected: absolute paths: false; sample paths are relative (e.g. 'src/llama.cpp')
```

### Stage 3-6 — Validate: self-analysis unchanged

```bash
node dist/cli/index.js analyze -v
# Expected: index.md has File Statistics + Circular Dependencies sections
# No errors or warnings about new fields

npm test
# Final gate: 0 new failures
```

---

## Acceptance Criteria

| Check | How to verify | Expected |
|-------|--------------|---------|
| `fileStats` in JSON output | `data.metrics?.fileStats?.length` | > 0 for class/method level |
| `cycles` in JSON output | `data.metrics?.cycles?.length` | integer ≥ 0 |
| `fileStats` absent at package level | `data.metrics?.fileStats` | `undefined` |
| C++ absolute paths normalised | no `f.file.startsWith('/')` | `false` |
| `index.md` has File Statistics | `grep "## File Statistics"` | present |
| `index.md` has Circular Dependencies | `grep "## Circular Dependencies"` | present |
| Stats appear after Diagrams section | position check in index.md | ✓ |
| Empty cycles: no table | `grep -c "| # |"` in cycles section | 0 when no cycles |
| Top-30 truncation | `wc -l` of File Statistics table rows | ≤ 32 (header + separator + 30 rows) |
| memberNames readable | inspect cycle table Members column | entity names, not IDs |
| Test suite | `npm test` | 0 new failures |
| Type check | `npm run type-check` | 0 errors |

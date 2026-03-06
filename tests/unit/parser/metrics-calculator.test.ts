/**
 * Unit tests for MetricsCalculator
 *
 * TDD test suite for Stage A-2: structural proxy metrics calculation.
 * Covers basic metrics and SCC (Kosaraju algorithm) edge cases.
 */

import { describe, it, expect } from 'vitest';
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { DetailLevel } from '@/types/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEntity = (id: string): Entity => ({
  id,
  name: id,
  type: 'class',
  visibility: 'public',
  members: [],
  sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
});

const makeRelation = (
  id: string,
  source: string,
  target: string,
  inferenceSource?: 'explicit' | 'inferred' | 'gopls'
): Relation => ({
  id,
  type: 'dependency',
  source,
  target,
  ...(inferenceSource !== undefined ? { inferenceSource } : {}),
});

const makeArchJSON = (entities: Entity[], relations: Relation[]): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: '2024-01-01T00:00:00.000Z',
  sourceFiles: [],
  entities,
  relations,
});

const makeEntityInFile = (
  id: string,
  file: string,
  endLine = 10,
  members: import('@/types/index.js').Member[] = []
): Entity => ({
  id,
  name: id,
  type: 'class',
  visibility: 'public',
  members,
  sourceLocation: { file, startLine: 1, endLine },
});

const makeMember = (
  type: import('@/types/index.js').MemberType
): import('@/types/index.js').Member => ({
  name: 'x',
  type,
  visibility: 'public',
});

// ---------------------------------------------------------------------------
// Tests — Basic Metrics
// ---------------------------------------------------------------------------

describe('MetricsCalculator — basic metrics', () => {
  const calc = new MetricsCalculator();

  it('empty graph: all counts are 0, ratio is 0, SCC is 0', () => {
    const arch = makeArchJSON([], []);
    const result = calc.calculate(arch, 'class');
    expect(result.entityCount).toBe(0);
    expect(result.relationCount).toBe(0);
    expect(result.inferredRelationRatio).toBe(0);
    expect(result.stronglyConnectedComponents).toBe(0);
    expect(result.relationTypeBreakdown).toEqual({});
  });

  it('entityCount === entities.length', () => {
    const arch = makeArchJSON([makeEntity('A'), makeEntity('B'), makeEntity('C')], []);
    const result = calc.calculate(arch, 'class');
    expect(result.entityCount).toBe(3);
  });

  it('relationCount === relations.length', () => {
    const arch = makeArchJSON([makeEntity('A'), makeEntity('B')], [makeRelation('r1', 'A', 'B')]);
    const result = calc.calculate(arch, 'class');
    expect(result.relationCount).toBe(1);
  });

  it('level field matches the passed DetailLevel', () => {
    const levels: DetailLevel[] = ['package', 'class', 'method'];
    const arch = makeArchJSON([], []);
    for (const level of levels) {
      const result = calc.calculate(arch, level);
      expect(result.level).toBe(level);
    }
  });

  it('relationTypeBreakdown only lists types with count > 0', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations: Relation[] = [
      { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
      { id: 'r2', type: 'dependency', source: 'A', target: 'C' },
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    // Only 'dependency' should appear; no 'inheritance', 'composition', etc.
    expect(Object.keys(result.relationTypeBreakdown)).toEqual(['dependency']);
    expect(result.relationTypeBreakdown.dependency).toBe(2);
    expect(result.relationTypeBreakdown.inheritance).toBeUndefined();
  });

  it('sum of relationTypeBreakdown values === relationCount', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations: Relation[] = [
      { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
      { id: 'r2', type: 'inheritance', source: 'A', target: 'C' },
      { id: 'r3', type: 'dependency', source: 'B', target: 'C' },
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    const breakdownSum = Object.values(result.relationTypeBreakdown).reduce((a, b) => a + b, 0);
    expect(breakdownSum).toBe(result.relationCount);
  });

  it('inferredRelationRatio: all explicit returns 0', () => {
    const entities = [makeEntity('A'), makeEntity('B')];
    const relations: Relation[] = [
      makeRelation('r1', 'A', 'B', 'explicit'),
      makeRelation('r2', 'B', 'A', 'explicit'),
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.inferredRelationRatio).toBe(0);
  });

  it('inferredRelationRatio: all inferred returns 1', () => {
    const entities = [makeEntity('A'), makeEntity('B')];
    const relations: Relation[] = [
      makeRelation('r1', 'A', 'B', 'inferred'),
      makeRelation('r2', 'B', 'A', 'gopls'),
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.inferredRelationRatio).toBe(1);
  });

  it('inferredRelationRatio: mixed — rounded to 2 decimal places', () => {
    // 2 out of 3 inferred → 0.67
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations: Relation[] = [
      makeRelation('r1', 'A', 'B', 'explicit'),
      makeRelation('r2', 'A', 'C', 'inferred'),
      makeRelation('r3', 'B', 'C', 'gopls'),
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.inferredRelationRatio).toBe(0.67);
  });

  it('inferredRelationRatio: relationCount=0 returns 0 (no division by zero)', () => {
    const arch = makeArchJSON([makeEntity('A')], []);
    const result = calc.calculate(arch, 'class');
    expect(result.inferredRelationRatio).toBe(0);
  });

  it('missing inferenceSource field is treated as explicit', () => {
    // Relations without inferenceSource should count as explicit (ratio stays 0)
    const entities = [makeEntity('A'), makeEntity('B')];
    // makeRelation without 4th arg omits inferenceSource
    const relations: Relation[] = [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.inferredRelationRatio).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — SCC (Strongly Connected Components)
// ---------------------------------------------------------------------------

describe('MetricsCalculator — SCC', () => {
  const calc = new MetricsCalculator();

  it('no relations: SCC === entityCount (each node is its own SCC)', () => {
    const arch = makeArchJSON([makeEntity('A'), makeEntity('B'), makeEntity('C')], []);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(3);
  });

  it('DAG A→B→C: SCC === entityCount (no cycles)', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations = [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'C')];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(3);
  });

  it('single-node self-loop A→A: SCC === entityCount (self-loop does not form multi-node SCC)', () => {
    const entities = [makeEntity('A'), makeEntity('B')];
    const relations = [makeRelation('r1', 'A', 'A')];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    // A→A is a self-loop; A is still its own SCC, B is its own SCC → total 2
    expect(result.stronglyConnectedComponents).toBe(2);
  });

  it('two nodes mutually dependent (A→B, B→A): SCC === 1', () => {
    const entities = [makeEntity('A'), makeEntity('B')];
    const relations = [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(1);
  });

  it('three-node cycle (A→B→C→A): SCC === 1', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'C'),
      makeRelation('r3', 'C', 'A'),
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(1);
  });

  it('two independent cycles (A→B→A, C→D→C): SCC === 2', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C'), makeEntity('D')];
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'A'),
      makeRelation('r3', 'C', 'D'),
      makeRelation('r4', 'D', 'C'),
    ];
    const arch = makeArchJSON(entities, relations);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(2);
  });

  it('relation with external endpoint (not in entities): skip silently, no error', () => {
    // Only A and B are entities; relation r2 references external node Z
    const entities = [makeEntity('A'), makeEntity('B')];
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'A', 'Z'), // Z is external
    ];
    const arch = makeArchJSON(entities, relations);
    expect(() => calc.calculate(arch, 'class')).not.toThrow();
    const result = calc.calculate(arch, 'class');
    // A→B is a DAG, so SCC === entityCount (2)
    expect(result.stronglyConnectedComponents).toBe(2);
  });

  it('empty graph (entities=[], relations=[]): SCC === 0', () => {
    const arch = makeArchJSON([], []);
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(0);
  });

  it('SCC never exceeds entityCount', () => {
    // Various graphs should always satisfy SCC <= entityCount
    const graphs: Array<[Entity[], Relation[]]> = [
      // DAG
      [
        [makeEntity('A'), makeEntity('B'), makeEntity('C')],
        [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'C')],
      ],
      // Full cycle
      [
        [makeEntity('X'), makeEntity('Y')],
        [makeRelation('r1', 'X', 'Y'), makeRelation('r2', 'Y', 'X')],
      ],
      // No relations
      [[makeEntity('P'), makeEntity('Q')], []],
    ];
    for (const [entities, relations] of graphs) {
      const arch = makeArchJSON(entities, relations);
      const result = calc.calculate(arch, 'class');
      expect(result.stronglyConnectedComponents).toBeLessThanOrEqual(result.entityCount);
    }
  });

  it('large graph (100-node linear chain): no stack overflow', () => {
    // Build a 100-node linear DAG: N0→N1→N2→...→N99
    const count = 100;
    const entities = Array.from({ length: count }, (_, i) => makeEntity(`N${i}`));
    const relations = Array.from({ length: count - 1 }, (_, i) =>
      makeRelation(`r${i}`, `N${i}`, `N${i + 1}`)
    );
    const arch = makeArchJSON(entities, relations);
    expect(() => calc.calculate(arch, 'class')).not.toThrow();
    const result = calc.calculate(arch, 'class');
    // Linear DAG: each node is its own SCC
    expect(result.stronglyConnectedComponents).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// Tests — cycles (non-trivial SCCs)
// ---------------------------------------------------------------------------

describe('MetricsCalculator — cycles', () => {
  const calc = new MetricsCalculator();

  it('no cycle: cycles = []', () => {
    const arch = makeArchJSON([makeEntity('A'), makeEntity('B')], [makeRelation('r1', 'A', 'B')]);
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toEqual([]);
  });

  it('simple 2-node cycle: one CycleInfo with correct fields', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toHaveLength(1);
    const c = r.cycles[0];
    expect(c.size).toBe(2);
    expect(c.members.sort()).toEqual(['A', 'B']);
    expect(c.memberNames.sort()).toEqual(['A', 'B']);
    expect(c.files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('self-loop A→A: not in cycles (size = 1)', () => {
    const arch = makeArchJSON([makeEntityInFile('A', 'src/a.ts')], [makeRelation('r1', 'A', 'A')]);
    const r = calc.calculate(arch, 'class');
    expect(r.cycles).toEqual([]);
  });

  it('two independent cycles: both appear, sorted by size DESC', () => {
    // Cycle 1: A→B→C→A (size 3), Cycle 2: D→E→D (size 2)
    const entities = ['A', 'B', 'C', 'D', 'E'].map((id) =>
      makeEntityInFile(id, `src/${id.toLowerCase()}.ts`)
    );
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'C'),
      makeRelation('r3', 'C', 'A'),
      makeRelation('r4', 'D', 'E'),
      makeRelation('r5', 'E', 'D'),
    ];
    const r = calc.calculate(makeArchJSON(entities, relations), 'class');
    expect(r.cycles).toHaveLength(2);
    expect(r.cycles[0].size).toBe(3);
    expect(r.cycles[1].size).toBe(2);
  });

  it('intra-file cycle: files list has length 1', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/a.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    expect(r.cycles[0].files).toEqual(['src/a.ts']);
  });

  it('memberNames parallel to members (id === name in test fixtures)', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('Alpha', 'src/a.ts'), makeEntityInFile('Beta', 'src/b.ts')],
      [makeRelation('r1', 'Alpha', 'Beta'), makeRelation('r2', 'Beta', 'Alpha')]
    );
    const r = calc.calculate(arch, 'class');
    const c = r.cycles[0];
    const pairs = c.members.map((id, i) => [id, c.memberNames[i]]);
    for (const [id, name] of pairs) {
      expect(id).toBe(name); // in test fixtures entity.id === entity.name
    }
  });

  it('cycles undefined when level === package', () => {
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
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
    const entities = ['A', 'B', 'C', 'D'].map((id) => makeEntityInFile(id, 'src/a.ts'));
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'C'),
      makeRelation('r3', 'C', 'A'),
    ];
    const r = calc.calculate(makeArchJSON(entities, relations), 'class');
    const sum = r.cycles.reduce((acc, c) => acc + c.size, 0);
    expect(sum).toBe(3); // exactly 3, not >=
  });

  it('empty graph: cycles = []', () => {
    const r = calc.calculate(makeArchJSON([], []), 'class');
    expect(r.cycles).toEqual([]);
  });

  it('CycleInfo.files: no empty strings when some members lack sourceLocation', () => {
    const noFile: Entity = {
      id: 'A',
      name: 'A',
      type: 'class',
      visibility: 'public',
      members: [],
      sourceLocation: { file: '', startLine: 0, endLine: 0 },
    };
    const arch = makeArchJSON(
      [noFile, makeEntityInFile('B', 'src/b.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    const c = r.cycles[0];
    // empty string must be filtered — files must not contain ''
    expect(c.files.every((f) => f.length > 0)).toBe(true);
    expect(c.files).toEqual(['src/b.ts']);
  });

  it('package level: stronglyConnectedComponents still computed, cycles undefined', () => {
    // Regression guard: computeSCCGroups must run for all levels
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'package');
    expect(r.stronglyConnectedComponents).toBe(1); // A→B→A forms one SCC
    expect(r.cycles).toBeUndefined();
    expect(r.fileStats).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — fileStats (per-file statistics)
// ---------------------------------------------------------------------------

describe('MetricsCalculator — fileStats', () => {
  const calc = new MetricsCalculator();

  it('single file: one FileStats entry', () => {
    const arch = makeArchJSON([makeEntityInFile('A', 'src/a.ts', 50)], []);
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats).toHaveLength(1);
    expect(r.fileStats[0].file).toBe('src/a.ts');
  });

  it('entityCount === number of entities in that file', () => {
    const arch = makeArchJSON(
      [
        makeEntityInFile('A', 'src/a.ts'),
        makeEntityInFile('B', 'src/a.ts'),
        makeEntityInFile('C', 'src/b.ts'),
      ],
      []
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats.find((f) => f.file === 'src/a.ts');
    const b = r.fileStats.find((f) => f.file === 'src/b.ts');
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
      []
    );
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats[0].loc).toBe(80);
  });

  it('methodCount counts method and constructor, not property or field', () => {
    const entity = makeEntityInFile('A', 'src/a.ts', 10, [
      makeMember('method'),
      makeMember('constructor'),
      makeMember('property'),
      makeMember('field'),
    ]);
    const r = calc.calculate(makeArchJSON([entity], []), 'class');
    expect(r.fileStats[0].methodCount).toBe(2);
    expect(r.fileStats[0].fieldCount).toBe(2);
  });

  it('fieldCount counts property and field, not method or constructor', () => {
    const entity = makeEntityInFile('A', 'src/a.ts', 10, [
      makeMember('property'),
      makeMember('field'),
      makeMember('method'),
    ]);
    const r = calc.calculate(makeArchJSON([entity], []), 'class');
    expect(r.fileStats[0].fieldCount).toBe(2);
  });

  it('inDegree: only internal relations count (external targets excluded)', () => {
    const arch: ArchJSON = {
      ...makeArchJSON(
        [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
        [
          makeRelation('r1', 'B', 'A'), // internal → counts
          makeRelation('r2', 'Z', 'A'), // Z external → skipped
        ]
      ),
    };
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats.find((f) => f.file === 'src/a.ts');
    expect(a.inDegree).toBe(1);
  });

  it('outDegree: only internal relations count (external sources excluded)', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
      [
        makeRelation('r1', 'A', 'B'), // internal → counts
        makeRelation('r2', 'A', 'EXTERNAL'), // external target → skipped
      ]
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats.find((f) => f.file === 'src/a.ts');
    expect(a.outDegree).toBe(1);
  });

  it('cycleCount: files with entities in a non-trivial SCC get count 1', () => {
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/b.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats.find((f) => f.file === 'src/a.ts');
    const b = r.fileStats.find((f) => f.file === 'src/b.ts');
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
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    const c = r.fileStats.find((f) => f.file === 'src/c.ts');
    expect(c.cycleCount).toBe(0);
  });

  it('cycleCount: two entities in same file forming one SCC → cycleCount 1, not 2', () => {
    // A and B are both in src/a.ts and together form one non-trivial SCC.
    // cycleCount must count distinct SCCs containing the file, not entity memberships.
    const arch = makeArchJSON(
      [makeEntityInFile('A', 'src/a.ts'), makeEntityInFile('B', 'src/a.ts')],
      [makeRelation('r1', 'A', 'B'), makeRelation('r2', 'B', 'A')]
    );
    const r = calc.calculate(arch, 'class');
    const a = r.fileStats.find((f) => f.file === 'src/a.ts');
    expect(a.cycleCount).toBe(1); // one SCC, not two entity memberships
  });

  it('sorted by inDegree DESC (then outDegree DESC)', () => {
    // src/a.ts inDegree 3, src/b.ts inDegree 1
    const arch = makeArchJSON(
      [
        makeEntityInFile('A1', 'src/a.ts'),
        makeEntityInFile('A2', 'src/a.ts'),
        makeEntityInFile('B', 'src/b.ts'),
        makeEntityInFile('C1', 'src/c.ts'),
        makeEntityInFile('C2', 'src/c.ts'),
        makeEntityInFile('C3', 'src/c.ts'),
      ],
      [
        makeRelation('r1', 'C1', 'A1'),
        makeRelation('r2', 'C2', 'A1'),
        makeRelation('r3', 'C3', 'A2'),
        makeRelation('r4', 'C1', 'B'),
      ]
    );
    const r = calc.calculate(arch, 'class');
    const files = r.fileStats.map((f) => f.file);
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
      ...makeArchJSON([makeEntityInFile('Foo', '/home/user/proj/src/foo.cpp', 20)], []),
      workspaceRoot: '/home/user/proj',
    };
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats[0].file).toBe('src/foo.cpp');
  });

  it('entity without sourceLocation file is skipped gracefully', () => {
    const broken: Entity = {
      id: 'X',
      name: 'X',
      type: 'class',
      visibility: 'public',
      members: [],
      sourceLocation: { file: '', startLine: 0, endLine: 0 },
    };
    const arch = makeArchJSON([broken, makeEntityInFile('A', 'src/a.ts')], []);
    expect(() => calc.calculate(arch, 'class')).not.toThrow();
    // broken entity (empty file) is skipped; only src/a.ts appears
    const r = calc.calculate(arch, 'class');
    expect(r.fileStats.every((f) => f.file.length > 0)).toBe(true);
  });
});

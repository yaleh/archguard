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

const makeArchJSON = (
  entities: Entity[],
  relations: Relation[]
): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: '2024-01-01T00:00:00.000Z',
  sourceFiles: [],
  entities,
  relations,
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
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B'), makeEntity('C')],
      []
    );
    const result = calc.calculate(arch, 'class');
    expect(result.entityCount).toBe(3);
  });

  it('relationCount === relations.length', () => {
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B')],
      [makeRelation('r1', 'A', 'B')]
    );
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
    const breakdownSum = Object.values(result.relationTypeBreakdown).reduce(
      (a, b) => a + b,
      0
    );
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
    const relations: Relation[] = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'A'),
    ];
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
    const arch = makeArchJSON(
      [makeEntity('A'), makeEntity('B'), makeEntity('C')],
      []
    );
    const result = calc.calculate(arch, 'class');
    expect(result.stronglyConnectedComponents).toBe(3);
  });

  it('DAG A→B→C: SCC === entityCount (no cycles)', () => {
    const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'C'),
    ];
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
    const relations = [
      makeRelation('r1', 'A', 'B'),
      makeRelation('r2', 'B', 'A'),
    ];
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
    const entities = [
      makeEntity('A'),
      makeEntity('B'),
      makeEntity('C'),
      makeEntity('D'),
    ];
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
      expect(result.stronglyConnectedComponents).toBeLessThanOrEqual(
        result.entityCount
      );
    }
  });

  it('large graph (100-node linear chain): no stack overflow', () => {
    // Build a 100-node linear DAG: N0→N1→N2→...→N99
    const count = 100;
    const entities = Array.from({ length: count }, (_, i) =>
      makeEntity(`N${i}`)
    );
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

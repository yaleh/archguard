/**
 * Unit tests for adjacency-builder.ts (TASK-64 Phase B).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAdjacencyMatrix,
  normalizeColumns,
  weightForRelationType,
} from '@/analysis/jl/adjacency-builder.js';
import type { ArchJSON } from '@/types/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeArchJson(
  entityIds: string[],
  relations: Array<{ type: string; source: string; target: string }>
): Pick<ArchJSON, 'entities' | 'relations'> {
  return {
    entities: entityIds.map((id) => ({
      id,
      name: id,
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: 'x.ts', startLine: 1, endLine: 1 },
    })),
    relations: relations.map((r, i) => ({
      id: `r${i}`,
      type: r.type as ArchJSON['relations'][number]['type'],
      source: r.source,
      target: r.target,
    })),
  };
}

describe('buildAdjacencyMatrix', () => {
  it('places non-zero entries at the correct positions for a 3-entity/2-dependency fixture', () => {
    const archJson = makeArchJson(
      ['A', 'B', 'C'],
      [
        { type: 'dependency', source: 'A', target: 'B' },
        { type: 'dependency', source: 'C', target: 'A' },
      ]
    );

    const matrix = buildAdjacencyMatrix(archJson);

    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toEqual([0, 1, 0]); // A → B
    expect(matrix[1]).toEqual([0, 0, 0]); // B → nothing
    expect(matrix[2]).toEqual([1, 0, 0]); // C → A
  });

  it('maps relation weights (inheritance 2.0, composition 1.5, dependency 1.0)', () => {
    const archJson = makeArchJson(
      ['A', 'B', 'C', 'D'],
      [
        { type: 'inheritance', source: 'A', target: 'B' },
        { type: 'composition', source: 'C', target: 'D' },
        { type: 'dependency', source: 'D', target: 'A' },
      ]
    );

    const matrix = buildAdjacencyMatrix(archJson);

    expect(matrix[0][1]).toBe(2.0);
    expect(matrix[2][3]).toBe(1.5);
    expect(matrix[3][0]).toBe(1.0);
  });

  it('accumulates weight when multiple relations share the same source/target', () => {
    const archJson = makeArchJson(
      ['A', 'B'],
      [
        { type: 'dependency', source: 'A', target: 'B' },
        { type: 'composition', source: 'A', target: 'B' },
        { type: 'aggregation', source: 'A', target: 'B' },
      ]
    );

    const matrix = buildAdjacencyMatrix(archJson);

    expect(matrix[0][1]).toBe(1.0 + 1.5 + 1.0);
  });

  it('skips relations referencing unknown entity IDs without throwing', () => {
    const archJson = makeArchJson(
      ['A', 'B'],
      [
        { type: 'dependency', source: 'A', target: 'Ghost' },
        { type: 'dependency', source: 'Ghost', target: 'B' },
      ]
    );

    const matrix = buildAdjacencyMatrix(archJson);

    expect(matrix).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('uses weight 1.0 and warns for an unknown relation type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const archJson = makeArchJson(['A', 'B'], [{ type: 'unknown-kind', source: 'A', target: 'B' }]);

    const matrix = buildAdjacencyMatrix(archJson);

    expect(matrix[0][1]).toBe(1.0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown relation type'));
  });

  it('does not warn for known relation types', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const archJson = makeArchJson(
      ['A', 'B'],
      [
        { type: 'dependency', source: 'A', target: 'B' },
        { type: 'association', source: 'B', target: 'A' },
        { type: 'implementation', source: 'A', target: 'B' },
      ]
    );

    buildAdjacencyMatrix(archJson);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns a 0×0 matrix for a zero-entity ArchJSON', () => {
    const archJson = makeArchJson([], []);
    const matrix = buildAdjacencyMatrix(archJson);
    expect(matrix).toEqual([]);
  });

  it('returns a plain number[][] (not an ml-matrix Matrix)', () => {
    const archJson = makeArchJson(['A', 'B'], [{ type: 'dependency', source: 'A', target: 'B' }]);
    const matrix = buildAdjacencyMatrix(archJson);
    expect(Array.isArray(matrix)).toBe(true);
    expect(Array.isArray(matrix[0])).toBe(true);
    expect(typeof matrix[0][1]).toBe('number');
  });
});

describe('weightForRelationType', () => {
  it('returns the documented weights', () => {
    expect(weightForRelationType('inheritance')).toEqual({ weight: 2.0, known: true });
    expect(weightForRelationType('implementation')).toEqual({ weight: 2.0, known: true });
    expect(weightForRelationType('composition')).toEqual({ weight: 1.5, known: true });
    expect(weightForRelationType('aggregation')).toEqual({ weight: 1.0, known: true });
    expect(weightForRelationType('dependency')).toEqual({ weight: 1.0, known: true });
    expect(weightForRelationType('association')).toEqual({ weight: 1.0, known: true });
  });

  it('defaults unknown types to 1.0 with known=false', () => {
    expect(weightForRelationType('bogus')).toEqual({ weight: 1.0, known: false });
    expect(weightForRelationType('extends')).toEqual({ weight: 1.0, known: false });
  });

  it('treats call as a known general-usage relation (weight 1.0)', () => {
    expect(weightForRelationType('call')).toEqual({ weight: 1.0, known: true });
  });
});

describe('normalizeColumns', () => {
  it('produces per-column mean ≈ 0 and std ≈ 1', () => {
    const matrix = [
      [1, 2, 5],
      [2, 0, 6],
      [3, 4, 7],
    ];
    const normalized = normalizeColumns(matrix);

    expect(normalized).toHaveLength(3);
    for (let j = 0; j < 3; j++) {
      const col = normalized.map((row) => row[j]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      const variance = col.reduce((a, b) => a + (b - mean) ** 2, 0) / col.length;
      expect(mean).toBeCloseTo(0, 10);
      expect(Math.sqrt(variance)).toBeCloseTo(1, 10);
    }
  });

  it('keeps an all-zero column at zero', () => {
    const matrix = [
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    const normalized = normalizeColumns(matrix);
    expect(normalized.map((row) => row[1])).toEqual([0, 0, 0]);
  });

  it('keeps a zero-variance non-zero column at zero', () => {
    const matrix = [
      [2, 5],
      [2, 5],
    ];
    const normalized = normalizeColumns(matrix);
    expect(normalized.map((row) => row[1])).toEqual([0, 0]);
  });

  it('returns [] for an empty matrix', () => {
    expect(normalizeColumns([])).toEqual([]);
  });
});

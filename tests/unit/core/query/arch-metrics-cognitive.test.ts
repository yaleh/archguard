/**
 * Unit tests for CognitiveMetrics (arch-metrics-cognitive).
 */

import { describe, it, expect } from 'vitest';
import { CognitiveMetrics } from '@/core/query/arch-metrics-cognitive.js';
import { StructureMetrics } from '@/core/query/arch-metrics-structure.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity } from '@/types/index.js';

function makeEntity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: `src/${name.toLowerCase()}.ts`, startLine: 1, endLine: 10 },
    ...overrides,
  };
}

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

function makeCognitive(archJson: ArchJSON): CognitiveMetrics {
  const index = buildArchIndex(archJson, 'hash');
  const entityMap = new Map<string, Entity>(archJson.entities.map((e) => [e.id, e]));
  const ext = new ExtensionAccessor(archJson);
  const structure = new StructureMetrics(archJson, index, ext, entityMap);
  return new CognitiveMetrics(archJson, index, ext, structure);
}

function makeMethod(name: string) {
  return { name, type: 'method' as const, visibility: 'public' as const };
}

describe('CognitiveMetrics.getSummary', () => {
  it('computes entity/relation counts and top lists for a plain TS project', () => {
    const a = { ...makeEntity('a', 'A'), members: [makeMethod('m1'), makeMethod('m2')] };
    const b = { ...makeEntity('b', 'B'), members: [makeMethod('m1')] };
    const archJson = makeArchJson({
      entities: [a, b],
      relations: [
        { id: '1', source: 'a', target: 'b', type: 'dependency' },
        { id: '2', source: 'a', target: 'b', type: 'call' },
      ],
      sourceFiles: ['src/a.ts', 'src/b.ts'],
    });
    const summary = makeCognitive(archJson).getSummary();
    expect(summary.entityCount).toBe(2);
    expect(summary.relationCount).toBe(2);
    // both relations target b → B has 2 dependents, A has 0
    expect(summary.topDependedOn[0]).toEqual({ name: 'B', dependentCount: 2 });
    expect(summary.relationCountByType.dependency).toBe(1);
    expect(summary.relationCountByType.call).toBe(1);
    expect(summary.topByMethodCount[0]).toMatchObject({ name: 'A', methodCount: 2 });
    expect(summary.topByOutDegree[0]).toMatchObject({ name: 'A', outDegree: 2 });
    expect(summary.totalPackageCount).toBeGreaterThan(0);
  });

  it('switches to Atlas edge count and suppresses topDependedOn when Go Atlas present', () => {
    const archJson = makeArchJson({
      language: 'go',
      entities: [{ ...makeEntity('a', 'A') }],
      relations: [],
      sourceFiles: [],
      extensions: {
        goAtlas: {
          version: '1.0',
          layers: {
            package: {
              nodes: [{ id: 'a', name: 'a', type: 'internal', fileCount: 1 }],
              edges: [{ source: 'a', target: 'b', strength: 1 }],
              cycles: [],
            },
          },
          metadata: {
            generatedAt: '',
            generationStrategy: {
              functionBodyStrategy: 'none' as const,
              detectedFrameworks: [],
              followIndirectCalls: false,
              goplsEnabled: false,
            },
            completeness: { package: 1, capability: 1, goroutine: 1, flow: 1 },
            performance: { fileCount: 1, parseTime: 1, totalTime: 1, memoryUsage: 1 },
          },
        },
      },
    });
    const summary = makeCognitive(archJson).getSummary();
    expect(summary.relationCount).toBe(1); // atlas edge count
    expect(summary.topDependedOn).toEqual([]);
    expect(summary.topDependedOnNote).toBeDefined();
  });
});

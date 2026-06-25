/**
 * Phase 93 TDD tests for QueryEngine.findCallers()
 */
import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/core/query/query-engine.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultScope: QueryScopeEntry = {
  key: 'core-test',
  label: 'core test',
  kind: 'parsed',
  sources: ['./src'],
  language: 'typescript',
  entityCount: 0,
  relationCount: 0,
  hasAtlasExtension: false,
};

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

function makeCallEdge(
  source: string,
  target: string,
  sourceMethod?: string,
  targetMethod?: string,
  callType?: 'direct' | 'interface' | 'indirect'
): Relation {
  return {
    source,
    target,
    type: 'call',
    sourceMethod,
    targetMethod,
    callType,
  };
}

function makeEngine(entities: Entity[], relations: Relation[]): QueryEngine {
  const archJson = makeArchJson({ entities, relations });
  const archIndex = buildArchIndex(archJson, 'hash-callers-test');
  return new QueryEngine({ archJson, archIndex, scopeEntry: defaultScope });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryEngine.findCallers()', () => {
  describe('depth=1 (default)', () => {
    it('returns only direct callers when depth=1', () => {
      const entities = [
        makeEntity('pkg.A', 'A'),
        makeEntity('pkg.B', 'B'),
        makeEntity('pkg.C', 'C'),
      ];
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'callB', 'doWork', 'direct'),
        makeCallEdge('pkg.C', 'pkg.B', 'callB', 'doWork', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers).toHaveLength(2);
      const callerEntities = callers.map((c) => c.callerEntity).sort();
      expect(callerEntities).toEqual(['pkg.A', 'pkg.C']);
    });

    it('returns depth=1 for direct callers', () => {
      const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
      const relations = [makeCallEdge('pkg.A', 'pkg.B', 'go', 'run', 'direct')];
      const engine = makeEngine(entities, relations);

      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers[0].depth).toBe(1);
    });

    it('returns empty array when no call edges match', () => {
      const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
      const relations = [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' as const }];
      const engine = makeEngine(entities, relations);

      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers).toHaveLength(0);
    });
  });

  describe('depth=2 BFS', () => {
    it('returns direct and indirect callers at depth=2', () => {
      // Chain: A → B → C  (A calls B, B calls C)
      const entities = [
        makeEntity('pkg.A', 'A'),
        makeEntity('pkg.B', 'B'),
        makeEntity('pkg.C', 'C'),
      ];
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'callB', 'run', 'direct'),
        makeCallEdge('pkg.B', 'pkg.C', 'callC', 'exec', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      // Looking for callers of C
      const callers = engine.relationQueryService.findCallers('C', 2);
      expect(callers).toHaveLength(2);

      const byEntity = Object.fromEntries(callers.map((c) => [c.callerEntity, c]));
      expect(byEntity['pkg.B'].depth).toBe(1);
      expect(byEntity['pkg.A'].depth).toBe(2);
    });

    it('includes callType from the edge', () => {
      const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
      const relations = [makeCallEdge('pkg.A', 'pkg.B', 'invoke', 'handle', 'interface')];
      const engine = makeEngine(entities, relations);

      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers[0].callType).toBe('interface');
    });

    it('defaults callType to "direct" when edge has no callType', () => {
      const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
      const relations: Relation[] = [
        { source: 'pkg.A', target: 'pkg.B', type: 'call', sourceMethod: 'go', targetMethod: 'run' },
      ];
      const engine = makeEngine(entities, relations);

      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers[0].callType).toBe('direct');
    });
  });

  describe('cycle detection', () => {
    it('does not loop infinitely on A→B→A cycle', () => {
      const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'callB', 'doIt', 'direct'),
        makeCallEdge('pkg.B', 'pkg.A', 'callA', 'start', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      // Should terminate without throwing
      const callers = engine.relationQueryService.findCallers('B', 5);
      // pkg.A calls B directly (depth 1)
      const depth1 = callers.filter((c) => c.callerEntity === 'pkg.A' && c.depth === 1);
      expect(depth1).toHaveLength(1);
      // Should not infinite loop
      expect(callers.length).toBeLessThan(20);
    });
  });

  describe('entityName parsing', () => {
    it('matches ClassName.methodName precisely when dot notation used', () => {
      const entities = [makeEntity('pkg.B', 'B')];
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'x', 'doWork', 'direct'),
        makeCallEdge('pkg.C', 'pkg.B', 'y', 'otherMethod', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      // Only callers of B.doWork, not B.otherMethod
      const callers = engine.relationQueryService.findCallers('B.doWork', 1);
      expect(callers).toHaveLength(1);
      expect(callers[0].callerEntity).toBe('pkg.A');
      expect(callers[0].callerMethod).toBe('x');
    });

    it('returns callers of any method when no dot in entityName', () => {
      const entities = [makeEntity('pkg.B', 'B')];
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'x', 'doWork', 'direct'),
        makeCallEdge('pkg.C', 'pkg.B', 'y', 'otherMethod', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      // No method filter → both callers returned
      const callers = engine.relationQueryService.findCallers('B', 1);
      expect(callers).toHaveLength(2);
    });

    it('matches by entity name suffix (last segment)', () => {
      const entities = [makeEntity('com.example.Service', 'Service')];
      const relations = [
        makeCallEdge('com.example.Client', 'com.example.Service', 'call', 'handle', 'direct'),
      ];
      const engine = makeEngine(entities, relations);

      // Entity name is just "Service", but target ID is "com.example.Service"
      const callers = engine.relationQueryService.findCallers('Service', 1);
      expect(callers).toHaveLength(1);
      expect(callers[0].callerEntity).toBe('com.example.Client');
    });
  });

  describe('depth clamping', () => {
    it('clamps depth=10 to 5', () => {
      // Chain: A→B→C→D→E→F→G  (7 levels)
      const entities = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => makeEntity(`pkg.${n}`, n));
      const relations = [
        makeCallEdge('pkg.A', 'pkg.B', 'f', 'g'),
        makeCallEdge('pkg.B', 'pkg.C', 'f', 'g'),
        makeCallEdge('pkg.C', 'pkg.D', 'f', 'g'),
        makeCallEdge('pkg.D', 'pkg.E', 'f', 'g'),
        makeCallEdge('pkg.E', 'pkg.F', 'f', 'g'),
        makeCallEdge('pkg.F', 'pkg.G', 'f', 'g'),
      ];
      const engine = makeEngine(entities, relations);

      // depth=10 should be clamped to 5 → only 5 levels of callers for G
      const callers = engine.relationQueryService.findCallers('G', 10);
      const depths = callers.map((c) => c.depth);
      expect(Math.max(...depths)).toBeLessThanOrEqual(5);
    });
  });

  describe('empty state', () => {
    it('returns empty array when archJson has no relations', () => {
      const entities = [makeEntity('pkg.A', 'A')];
      const engine = makeEngine(entities, []);

      const callers = engine.relationQueryService.findCallers('A', 1);
      expect(callers).toHaveLength(0);
    });
  });
});

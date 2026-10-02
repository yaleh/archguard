/**
 * Unit tests for StructureMetrics (arch-metrics-structure).
 */

import { describe, it, expect } from 'vitest';
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

function makeMetrics(archJson: ArchJSON): StructureMetrics {
  const index = buildArchIndex(archJson, 'test-hash');
  const entityMap = new Map<string, Entity>(archJson.entities.map((e) => [e.id, e]));
  return new StructureMetrics(archJson, index, new ExtensionAccessor(archJson), entityMap);
}

function makeMethod(name: string) {
  return { name, type: 'method' as const, visibility: 'public' as const };
}

// ── Go Atlas path ───────────────────────────────────────────────────────────

describe('StructureMetrics.getPackageStats — Go Atlas', () => {
  it('aggregates internal and cmd nodes with entity metrics', () => {
    const archJson = makeArchJson({
      language: 'go',
      entities: [
        {
          ...makeEntity('pkg/a/Service', 'Service'),
          sourceLocation: { file: 'pkg/a/service.go', startLine: 1, endLine: 20 },
          members: [makeMethod('Serve')],
        },
      ],
      sourceFiles: ['pkg/a/service.go'],
      extensions: {
        goAtlas: {
          version: '1.0',
          layers: {
            package: {
              nodes: [
                {
                  id: 'pkg/a',
                  name: 'pkg/a',
                  type: 'internal',
                  fileCount: 3,
                  stats: { structs: 2, interfaces: 1, functions: 5 },
                },
                { id: 'pkg/cmd', name: 'pkg/cmd', type: 'cmd', fileCount: 1 },
                { id: 'github.com/ext', name: 'github.com/ext', type: 'external', fileCount: 1 },
              ],
              edges: [],
              cycles: [],
            },
          },
          metadata: {
            generatedAt: '2026-01-01T00:00:00Z',
            generationStrategy: {
              functionBodyStrategy: 'none',
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
    const metrics = makeMetrics(archJson);
    const result = metrics.getPackageStats();
    expect(result.meta.dataPath).toBe('go-atlas');
    expect(result.packages).toHaveLength(2); // external excluded
    expect(result.packages[0]).toMatchObject({
      package: 'pkg/a',
      fileCount: 3,
      languageStats: { structs: 2, interfaces: 1, functions: 5 },
    });
  });

  it('respects topN slicing', () => {
    const archJson = makeArchJson({
      language: 'go',
      extensions: {
        goAtlas: {
          version: '1.0',
          layers: {
            package: {
              nodes: [
                { id: 'a', name: 'a', type: 'internal', fileCount: 5 },
                { id: 'b', name: 'b', type: 'internal', fileCount: 2 },
              ],
              edges: [],
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
    const result = makeMetrics(archJson).getPackageStats(2, 1);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].package).toBe('a'); // sorted by fileCount desc
  });
});

// ── TypeScript module graph path ────────────────────────────────────────────

describe('StructureMetrics.getPackageStats — TypeScript module graph', () => {
  it('builds packages from tsAnalysis.moduleGraph with testFileCount', () => {
    const archJson = makeArchJson({
      language: 'typescript',
      entities: [
        {
          ...makeEntity('src/api/User', 'User'),
          sourceLocation: { file: 'src/api/user.ts', startLine: 1, endLine: 10 },
          members: [makeMethod('get')],
        },
      ],
      sourceFiles: ['src/api/user.ts', 'src/api/user.test.ts'],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              {
                id: 'src/api',
                name: 'src/api',
                type: 'internal',
                fileCount: 2,
                stats: { classes: 1, interfaces: 0, functions: 1, enums: 0 },
              },
              {
                id: 'node_modules/x',
                name: 'x',
                type: 'external',
                fileCount: 1,
                stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
              },
            ],
            edges: [],
            cycles: [],
          },
        },
      },
    });
    const result = makeMetrics(archJson).getPackageStats();
    expect(result.meta.dataPath).toBe('ts-module-graph');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toMatchObject({
      package: 'src/api',
      testFileCount: 1,
      languageStats: { classes: 1, interfaces: 0, functions: 1, enums: 0 },
    });
  });
});

// ── TypeScript package count semantics (root prefix + direct scope) ─────────

describe('StructureMetrics.getPackageStats — TS root package and count semantics', () => {
  it('counts root-level files in the (root) package instead of always reporting 0', () => {
    const archJson = makeArchJson({
      language: 'typescript',
      entities: [
        {
          ...makeEntity('a.A', 'A'),
          sourceLocation: { file: 'a.ts', startLine: 1, endLine: 10 },
        },
        {
          ...makeEntity('sub.b.B1', 'B1'),
          sourceLocation: { file: 'sub/b.ts', startLine: 1, endLine: 10 },
        },
        {
          ...makeEntity('sub.b.B2', 'B2'),
          sourceLocation: { file: 'sub/b.ts', startLine: 11, endLine: 20 },
        },
      ],
      sourceFiles: ['a.ts', 'sub/b.ts'],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              {
                id: '',
                name: '(root)',
                type: 'internal',
                fileCount: 1,
                stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
              },
              {
                id: 'sub',
                name: 'sub',
                type: 'internal',
                fileCount: 1,
                stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 },
              },
            ],
            edges: [],
            cycles: [],
          },
        },
      },
    });
    const result = makeMetrics(archJson).getPackageStats();
    const root = result.packages.find((p) => p.package === '(root)');
    const sub = result.packages.find((p) => p.package === 'sub');
    // (root) used to be 0 because packagePrefix '' produced sep '/' that no
    // relative path starts with.
    expect(root?.entityCount).toBe(1);
    expect(sub?.entityCount).toBe(2);
  });

  it('counts only direct files, so entityCount sums to the project total (no subtree double-count)', () => {
    const archJson = makeArchJson({
      language: 'typescript',
      entities: [
        {
          ...makeEntity('p.P1', 'P1'),
          sourceLocation: { file: 'p/x.ts', startLine: 1, endLine: 10 },
        },
        {
          ...makeEntity('p.c.C1', 'C1'),
          sourceLocation: { file: 'p/c/y.ts', startLine: 1, endLine: 10 },
        },
        {
          ...makeEntity('p.c.C2', 'C2'),
          sourceLocation: { file: 'p/c/y.ts', startLine: 11, endLine: 20 },
        },
      ],
      sourceFiles: ['p/x.ts', 'p/c/y.ts'],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              {
                id: 'p',
                name: 'p',
                type: 'internal',
                fileCount: 1,
                stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
              },
              {
                id: 'p/c',
                name: 'p/c',
                type: 'internal',
                fileCount: 1,
                stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 },
              },
            ],
            edges: [],
            cycles: [],
          },
        },
      },
    });
    const result = makeMetrics(archJson).getPackageStats(3);
    const parent = result.packages.find((p) => p.package === 'p');
    const child = result.packages.find((p) => p.package === 'p/c');
    // Parent used to fold in the whole subtree (would have been 3).
    expect(parent?.entityCount).toBe(1);
    expect(child?.entityCount).toBe(2);
    const sum = result.packages.reduce((n, p) => n + p.entityCount, 0);
    expect(sum).toBe(archJson.entities.length);
  });

  it('flat directory: a single (root) package holds every entity, aligned with languageStats', () => {
    const archJson = makeArchJson({
      language: 'typescript',
      entities: [
        {
          ...makeEntity('a.A', 'A'),
          sourceLocation: { file: 'a.ts', startLine: 1, endLine: 10 },
        },
        {
          ...makeEntity('b.F1', 'F1', { type: 'function' }),
          sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
        },
        {
          ...makeEntity('b.F2', 'F2', { type: 'function' }),
          sourceLocation: { file: 'b.ts', startLine: 6, endLine: 12 },
        },
      ],
      sourceFiles: ['a.ts', 'b.ts'],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              {
                id: '',
                name: '(root)',
                type: 'internal',
                fileCount: 2,
                stats: { classes: 1, interfaces: 0, functions: 2, enums: 0 },
              },
            ],
            edges: [],
            cycles: [],
          },
        },
      },
    });
    const result = makeMetrics(archJson).getPackageStats(3);
    expect(result.packages).toHaveLength(1); // == summary.totalPackageCount
    const root = result.packages[0];
    expect(root.package).toBe('(root)');
    expect(root.entityCount).toBe(archJson.entities.length);
    expect(root.entityCount).toBeGreaterThan(0);
    // entityCount and languageStats must agree in direction (both non-zero here).
    expect(root.languageStats?.classes).toBeGreaterThan(0);
    expect(root.languageStats?.functions).toBeGreaterThan(0);
  });
});

// ── OO fallback path ────────────────────────────────────────────────────────

describe('StructureMetrics.getPackageStats — OO fallback', () => {
  it('derives packages from fileToIds with loc and testFileCount', () => {
    const archJson = makeArchJson({
      language: 'java',
      entities: [
        {
          ...makeEntity('com.example.a.A', 'A'),
          sourceLocation: { file: 'src/com/example/a/A.java', startLine: 1, endLine: 30 },
          members: [makeMethod('run')],
        },
      ],
      sourceFiles: ['src/com/example/a/A.java', 'src/com/example/a/ATest.java'],
    });
    const result = makeMetrics(archJson).getPackageStats(3);
    expect(result.meta.dataPath).toBe('oo-derived');
    expect(result.meta.locAvailable).toBe(true);
    const pkg = result.packages.find((p) => p.package === 'src/com/example');
    expect(pkg).toBeDefined();
    expect(pkg?.entityCount).toBeGreaterThan(0);
    expect(pkg?.loc).toBeGreaterThan(0);
  });

  it('clamps depth between 1 and 5', () => {
    const archJson = makeArchJson({
      language: 'java',
      entities: [
        {
          ...makeEntity('com.example.a.b.c.d.e.F', 'F'),
          sourceLocation: { file: 'src/com/example/a/b/c/d/e/F.java', startLine: 1, endLine: 5 },
        },
      ],
      sourceFiles: ['src/com/example/a/b/c/d/e/F.java'],
    });
    const result = makeMetrics(archJson).getPackageStats(99);
    expect(result.meta.dataPath).toBe('oo-derived');
    expect(result.packages.length).toBeGreaterThan(0);
  });
});

// ── Kotlin path ─────────────────────────────────────────────────────────────

describe('StructureMetrics.getPackageStats — Kotlin', () => {
  it('groups entities by package prefix from dotted ids', () => {
    const archJson = makeArchJson({
      language: 'kotlin',
      entities: [
        {
          ...makeEntity('com.example.repo.UserRepo', 'UserRepo'),
          sourceLocation: { file: 'src/com/example/repo/UserRepo.kt', startLine: 1, endLine: 40 },
          members: [makeMethod('save')],
        },
        {
          ...makeEntity('com.example.repo.AdminRepo', 'AdminRepo'),
          sourceLocation: { file: 'src/com/example/repo/AdminRepo.kt', startLine: 1, endLine: 25 },
          members: [],
        },
      ],
      sourceFiles: ['src/com/example/repo/UserRepo.kt', 'src/com/example/repo/AdminRepo.kt'],
    });
    const result = makeMetrics(archJson).getPackageStats();
    expect(result.meta.dataPath).toBe('kotlin-package');
    expect(result.meta.locAvailable).toBe(true);
    const pkg = result.packages.find((p) => p.package === 'com.example.repo');
    expect(pkg?.entityCount).toBe(2);
    expect(pkg?.methodCount).toBe(1);
    expect(pkg?.fileCount).toBe(2);
  });
});

// ── findHighCoupling / findOrphans / findInCycles ───────────────────────────

describe('StructureMetrics structural queries', () => {
  const base = (): ArchJSON => {
    const a = { ...makeEntity('a', 'A'), members: [] };
    const b = { ...makeEntity('b', 'B'), members: [] };
    const c = { ...makeEntity('c', 'C'), members: [] };
    return makeArchJson({
      entities: [a, b, c],
      relations: [
        { id: '1', source: 'a', target: 'b', type: 'dependency' },
        { id: '2', source: 'b', target: 'a', type: 'dependency' },
        { id: '3', source: 'a', target: 'c', type: 'dependency' },
      ],
      sourceFiles: [],
    });
  };

  it('findHighCoupling returns entities at or above the threshold', () => {
    const metrics = makeMetrics(base());
    // a has in=1 (from b), out=2 (to b,c) => 3. b has in=1, out=1 => 2.
    const result = metrics.findHighCoupling(3);
    expect(result.map((e) => e.id)).toEqual(['a']);
  });

  it('findOrphans returns entities with no edges', () => {
    const archJson = base();
    archJson.entities.push({ ...makeEntity('orphan', 'Orphan'), members: [] });
    const metrics = makeMetrics(archJson);
    const result = metrics.findOrphans();
    expect(result.map((e) => e.id)).toEqual(['orphan']);
  });

  it('findInCycles returns entities that participate in cycles', () => {
    const metrics = makeMetrics(base());
    const result = metrics.findInCycles();
    expect(result.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});

// ── buildTestPattern ────────────────────────────────────────────────────────

describe('StructureMetrics.buildTestPattern', () => {
  it('returns language-appropriate test file patterns', () => {
    expect(
      makeMetrics(makeArchJson({ language: 'typescript' }))
        .buildTestPattern()
        .test('a.test.ts')
    ).toBe(true);
    expect(
      makeMetrics(makeArchJson({ language: 'java' }))
        .buildTestPattern()
        .test('A.java')
    ).toBe(false);
    expect(
      makeMetrics(makeArchJson({ language: 'java' }))
        .buildTestPattern()
        .test('ATest.java')
    ).toBe(true);
    expect(
      makeMetrics(makeArchJson({ language: 'python' }))
        .buildTestPattern()
        .test('test_foo.py')
    ).toBe(true);
    expect(
      makeMetrics(makeArchJson({ language: 'cpp' }))
        .buildTestPattern()
        .test('test_foo.cpp')
    ).toBe(true);
    // unknown languages fall back to the generic .test./.spec. pattern
    expect(
      makeMetrics(makeArchJson({ language: 'go' }))
        .buildTestPattern()
        .test('a.go')
    ).toBe(false);
    expect(
      makeMetrics(makeArchJson({ language: 'go' }))
        .buildTestPattern()
        .test('a.test.ts')
    ).toBe(true);
    expect(
      makeMetrics(makeArchJson({ language: 'kotlin' }))
        .buildTestPattern()
        .test('FooTest.kt')
    ).toBe(true);
  });
});

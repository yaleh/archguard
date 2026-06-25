/**
 * TDD tests for ExtensionAccessor (Phase 109)
 *
 * Covers all 5 accessor methods; verifies graceful handling when extensions are undefined.
 */
import { describe, it, expect } from 'vitest';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import type { ArchJSON } from '@/types/index.js';
import type { GoAtlasExtension } from '@/types/extensions/go-atlas.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.1',
    language: 'go',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

const mockPackageGraph = {
  nodes: [{ id: 'pkg/foo', name: 'foo', type: 'internal' as const, fileCount: 3 }],
  edges: [],
  cycles: [],
};

const mockGoAtlas: GoAtlasExtension = {
  version: '2.0',
  layers: {
    package: mockPackageGraph,
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    generationStrategy: {
      functionBodyStrategy: 'none',
      detectedFrameworks: [],
      followIndirectCalls: false,
      goplsEnabled: false,
    },
    completeness: { package: 1, capability: 0, goroutine: 0, flow: 0 },
    performance: { fileCount: 10, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
  },
};

const mockTestAnalysis: TestAnalysis = {
  version: '1.0',
  patternConfigSource: 'auto',
  testFiles: [],
  coverageMap: [],
  issues: [],
  metrics: {
    totalTestFiles: 0,
    byType: { unit: 0, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
    entityCoverageRatio: 0,
    assertionDensity: 0,
    skipRatio: 0,
    issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
  },
};

// ---------------------------------------------------------------------------
// Tests — with extensions
// ---------------------------------------------------------------------------

describe('ExtensionAccessor — with goAtlas extension', () => {
  const archJson = makeArchJson({ extensions: { goAtlas: mockGoAtlas } });
  const accessor = new ExtensionAccessor(archJson);

  it('getAtlasLayer("package") returns the package graph when present', () => {
    const layer = accessor.getAtlasLayer('package');
    expect(layer).toBeDefined();
    expect(layer?.nodes).toHaveLength(1);
    expect(layer?.nodes[0].name).toBe('foo');
  });

  it('getAtlasLayer("capability") returns undefined when layer not present', () => {
    const layer = accessor.getAtlasLayer('capability');
    expect(layer).toBeUndefined();
  });

  it('getAtlasLayers() returns the full layers object', () => {
    const layers = accessor.getAtlasLayers();
    expect(layers).toBeDefined();
    expect(Object.keys(layers)).toContain('package');
  });

  it('hasAtlasExtension() returns true when goAtlas is present', () => {
    expect(accessor.hasAtlasExtension()).toBe(true);
  });

  it('getTestAnalysis() returns undefined when testAnalysis not present', () => {
    expect(accessor.getTestAnalysis()).toBeUndefined();
  });

  it('hasTestAnalysis() returns false when testAnalysis not present', () => {
    expect(accessor.hasTestAnalysis()).toBe(false);
  });
});

describe('ExtensionAccessor — with testAnalysis extension', () => {
  const archJson = makeArchJson({ extensions: { testAnalysis: mockTestAnalysis } });
  const accessor = new ExtensionAccessor(archJson);

  it('getTestAnalysis() returns the TestAnalysis object when present', () => {
    const analysis = accessor.getTestAnalysis();
    expect(analysis).toBeDefined();
    expect(analysis?.version).toBe('1.0');
  });

  it('hasTestAnalysis() returns true when testAnalysis is present', () => {
    expect(accessor.hasTestAnalysis()).toBe(true);
  });

  it('hasAtlasExtension() returns false when goAtlas not present', () => {
    expect(accessor.hasAtlasExtension()).toBe(false);
  });

  it('getAtlasLayer("package") returns undefined when goAtlas not present', () => {
    expect(accessor.getAtlasLayer('package')).toBeUndefined();
  });

  it('getAtlasLayers() returns undefined when goAtlas not present', () => {
    expect(accessor.getAtlasLayers()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — no extensions at all
// ---------------------------------------------------------------------------

describe('ExtensionAccessor — no extensions', () => {
  const archJson = makeArchJson(); // no extensions field
  const accessor = new ExtensionAccessor(archJson);

  it('getAtlasLayer() returns undefined without crashing', () => {
    expect(accessor.getAtlasLayer('package')).toBeUndefined();
  });

  it('getAtlasLayers() returns undefined without crashing', () => {
    expect(accessor.getAtlasLayers()).toBeUndefined();
  });

  it('hasAtlasExtension() returns false without crashing', () => {
    expect(accessor.hasAtlasExtension()).toBe(false);
  });

  it('getTestAnalysis() returns undefined without crashing', () => {
    expect(accessor.getTestAnalysis()).toBeUndefined();
  });

  it('hasTestAnalysis() returns false without crashing', () => {
    expect(accessor.hasTestAnalysis()).toBe(false);
  });
});

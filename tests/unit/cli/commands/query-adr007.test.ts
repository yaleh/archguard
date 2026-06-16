/**
 * ADR-007 §4 compliance — CLI/MCP interface symmetry.
 *
 * Tests for CLI flags that mirror MCP tools added after the initial Phase 5
 * batch was deleted. Each test follows the pattern:
 *   1. Register the flag in createQueryCommand()
 *   2. Route to the right engine / history-query method
 *   3. Print sensible output or a clear error when data is absent
 *
 * Tools covered:
 *   --atlas-layer           ↔ archguard_get_atlas_layer
 *   --test-patterns         ↔ archguard_detect_test_patterns
 *   --test-issues           ↔ archguard_get_test_issues
 *   --test-metrics          ↔ archguard_get_test_metrics
 *   --entity-coverage       ↔ archguard_get_entity_coverage
 *   --package-fanin         ↔ archguard_get_package_fanin
 *   --package-fanout        ↔ archguard_get_package_fanout
 *   --god-packages          ↔ archguard_detect_god_packages
 *   --change-context        ↔ archguard_get_change_context
 *   --cochange              ↔ archguard_get_cochange
 *   --change-risk           ↔ archguard_get_change_risk
 *   --ownership             ↔ archguard_get_ownership
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entity, Relation, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import type {
  TestAnalysis,
  TestFileInfo,
  TestIssue,
} from '@/types/extensions/test-analysis.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/cli/query/engine-loader.js', () => ({
  resolveArchDir: vi.fn((dir?: string) => dir ?? '.archguard'),
  loadEngine: vi.fn(),
  readManifest: vi.fn(),
}));

vi.mock('@/cli/git-history/history-loader.js', () => ({
  loadHistoryData: vi.fn(),
  GitHistoryNotFoundError: class GitHistoryNotFoundError extends Error {},
}));

vi.mock('@/cli/git-history/history-query.js', () => ({
  HistoryQuery: vi.fn().mockImplementation(() => ({
    getChangeContext: vi.fn().mockReturnValue({ target: 'src/foo.ts', churn: 5 }),
    getCochange: vi.fn().mockReturnValue({ pairs: [] }),
    getChangeRisk: vi.fn().mockReturnValue({ riskScore: 0.3, factors: [] }),
    getOwnership: vi.fn().mockReturnValue({ contributors: [] }),
  })),
}));

import { createQueryCommand } from '@/cli/commands/query.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { loadHistoryData, GitHistoryNotFoundError } from '@/cli/git-history/history-loader.js';
import { HistoryQuery } from '@/cli/git-history/history-query.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const parsedScope: QueryScopeEntry = {
  key: 'abc123',
  label: 'src (go)',
  language: 'go',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 2,
  relationCount: 1,
  hasAtlasExtension: true,
};

const entities: Entity[] = [
  {
    id: 'e1',
    name: 'Server',
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: 'src/server.go', startLine: 1, endLine: 50 },
  },
];
const relations: Relation[] = [];

function makeArchJson(extra: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.1',
    language: 'go',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
    ...extra,
  };
}

const mockPackageGraph = {
  nodes: [
    { id: 'pkg/a', name: 'a', type: 'internal' as const, fileCount: 3 },
    { id: 'pkg/b', name: 'b', type: 'internal' as const, fileCount: 1 },
  ],
  edges: [
    { from: 'pkg/b', to: 'pkg/a', source: 'pkg/b', target: 'pkg/a', strength: 2 },
  ],
  cycles: [],
};

const mockTestAnalysis: TestAnalysis = {
  version: '1.0',
  testFiles: [
    {
      id: 'tf1',
      filePath: 'src/foo_test.go',
      frameworks: ['testing'],
      testCaseCount: 3,
      assertionCount: 5,
      assertionDensity: 1.67,
      skipCount: 0,
      testType: 'unit',
      coveredEntityIds: ['e1'],
    } as TestFileInfo,
  ],
  issues: [
    {
      id: 'i1',
      type: 'zero_assertion',
      severity: 'warning',
      filePath: 'src/bar_test.go',
      message: 'No assertions found',
    } as TestIssue,
  ],
  metrics: {
    totalTestFiles: 1,
    totalTestCases: 3,
    totalAssertions: 5,
    assertionDensity: 1.67,
    testTypeBreakdown: { unit: 1 },
    orphanTestFiles: 0,
    orphanTestRate: 0,
    entityCoverageRatio: 1.0,
    zeroAssertionFiles: 0,
    skipAccumulation: 0,
  },
  coverageMap: [],
  patternConfigSource: 'auto',
};

function createTestEngine(atlasGraph?: typeof mockPackageGraph, testAnalysis?: TestAnalysis): { engine: QueryEngine; archJson: ArchJSON } {
  const extensions: ArchJSON['extensions'] = {};
  if (atlasGraph) {
    extensions.goAtlas = {
      version: '2.0',
      layers: { package: atlasGraph },
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
        performance: { fileCount: 2, parseTime: 0, totalTime: 0, memoryUsage: 0 },
      },
    };
  }
  if (testAnalysis) {
    extensions.testAnalysis = testAnalysis;
  }
  const archJson = makeArchJson(Object.keys(extensions).length > 0 ? { extensions } : {});
  const archIndex = buildArchIndex(archJson, 'testhash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry: parsedScope });
  return { engine, archJson };
}

function wrapEngine({ engine, archJson }: { engine: QueryEngine; archJson: ArchJSON }) {
  return { engine, extensionAccessor: new ExtensionAccessor(archJson), scopeEntry: parsedScope };
}

// ── Console capture ───────────────────────────────────────────────────────────

let consoleOutput: string[];
let consoleErrorOutput: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalExit: typeof process.exit;

beforeEach(() => {
  consoleOutput = [];
  consoleErrorOutput = [];
  originalLog = console.log;
  originalError = console.error;
  originalExit = process.exit;

  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    consoleErrorOutput.push(args.map(String).join(' '));
  };
  process.exit = vi.fn() as unknown as typeof process.exit;

  vi.mocked(loadEngine).mockClear();
  vi.mocked(loadHistoryData).mockClear();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
  vi.clearAllMocks();
});

async function runQuery(...args: string[]): Promise<void> {
  const cmd = createQueryCommand();
  cmd.exitOverride();
  try {
    await cmd.parseAsync(['node', 'query', ...args]);
  } catch {
    // commander throws on exitOverride; that's expected for --help etc.
  }
}

// ── Flag existence smoke tests ────────────────────────────────────────────────

describe('ADR-007 §4 — new flags registered in createQueryCommand()', () => {
  it('registers all 12 new flags', () => {
    const cmd = createQueryCommand();
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--atlas-layer');
    expect(longs).toContain('--test-patterns');
    expect(longs).toContain('--test-issues');
    expect(longs).toContain('--test-metrics');
    expect(longs).toContain('--entity-coverage');
    expect(longs).toContain('--package-fanin');
    expect(longs).toContain('--package-fanout');
    expect(longs).toContain('--god-packages');
    expect(longs).toContain('--change-context');
    expect(longs).toContain('--cochange');
    expect(longs).toContain('--change-risk');
    expect(longs).toContain('--ownership');
  });
});

// ── --atlas-layer ─────────────────────────────────────────────────────────────

describe('query --atlas-layer', () => {
  it('returns package layer JSON when Atlas data is present', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(mockPackageGraph)));
    await runQuery('--atlas-layer', 'package', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('nodes');
    expect(json).toHaveProperty('edges');
  });

  it('exits 1 when Atlas data is absent', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--atlas-layer', 'package');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/atlas|no.*data/i);
  });
});

// ── --test-patterns ───────────────────────────────────────────────────────────

describe('query --test-patterns', () => {
  it('returns test pattern config JSON when test analysis is present', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(undefined, mockTestAnalysis)));

    await runQuery('--test-patterns', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('patternConfigSource');
    expect(json).toHaveProperty('totalTestFiles');
    expect(json).toHaveProperty('frameworks');
  });

  it('exits 1 when no test analysis data', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));

    await runQuery('--test-patterns');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/test.*analys|no.*test/i);
  });
});

// ── --test-issues ─────────────────────────────────────────────────────────────

describe('query --test-issues', () => {
  it('returns issues list JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(undefined, mockTestAnalysis)));

    await runQuery('--test-issues', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues[0]).toHaveProperty('type', 'zero_assertion');
  });

  it('filters issues by severity when --severity is given', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(undefined, mockTestAnalysis)));

    await runQuery('--test-issues', '--severity', 'info', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(Array.isArray(json.issues)).toBe(true);
    // No 'info' severity issues in fixture → empty
    expect(json.issues).toHaveLength(0);
  });

  it('exits 1 when no test analysis data', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));

    await runQuery('--test-issues');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --test-metrics ────────────────────────────────────────────────────────────

describe('query --test-metrics', () => {
  it('returns metrics JSON', async () => {
    const { engine, archJson } = createTestEngine(undefined, mockTestAnalysis);
    vi.spyOn(engine, 'getPackageCoverage').mockReturnValue([]);
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine({ engine, archJson }));

    await runQuery('--test-metrics', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('totalTestFiles', 1);
    expect(json).toHaveProperty('assertionDensity');
  });

  it('exits 1 when no test analysis data', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));

    await runQuery('--test-metrics');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --entity-coverage ─────────────────────────────────────────────────────────

describe('query --entity-coverage', () => {
  it('returns coverage result JSON for a known entity', async () => {
    const { engine, archJson } = createTestEngine(undefined, mockTestAnalysis);
    vi.spyOn(engine, 'getEntityCoverage').mockReturnValue({
      found: true,
      entityId: 'e1',
      coverageScore: 0.85,
      coveredBy: [],
    });
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine({ engine, archJson }));

    await runQuery('--entity-coverage', 'e1', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('found', true);
    expect(json).toHaveProperty('entityId', 'e1');
  });

  it('exits 1 when no test analysis data', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));

    await runQuery('--entity-coverage', 'e1');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --package-fanin ───────────────────────────────────────────────────────────

describe('query --package-fanin', () => {
  it('returns packages ranked by fan-in', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(mockPackageGraph)));
    await runQuery('--package-fanin', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(Array.isArray(json.packages)).toBe(true);
    // pkg/a has fanIn=1 (b→a), pkg/b has fanIn=0
    expect(json.packages[0]).toHaveProperty('fanIn');
    expect(json.packages[0].fanIn).toBeGreaterThanOrEqual(json.packages[1]?.fanIn ?? 0);
  });

  it('exits 1 when Atlas data is absent', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--package-fanin');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/atlas|no.*data/i);
  });
});

// ── --package-fanout ──────────────────────────────────────────────────────────

describe('query --package-fanout', () => {
  it('returns packages ranked by fan-out', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(mockPackageGraph)));
    await runQuery('--package-fanout', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(Array.isArray(json.packages)).toBe(true);
    // pkg/b has fanOut=1 (b→a)
    expect(json.packages[0]).toHaveProperty('fanOut');
    expect(json.packages[0].fanOut).toBeGreaterThanOrEqual(json.packages[1]?.fanOut ?? 0);
  });

  it('exits 1 when Atlas data is absent', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--package-fanout');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --god-packages ────────────────────────────────────────────────────────────

describe('query --god-packages', () => {
  it('returns god package analysis JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(mockPackageGraph)));
    await runQuery('--god-packages', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('godPackages');
    expect(Array.isArray(json.godPackages)).toBe(true);
  });

  it('exits 1 when Atlas data is absent', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--god-packages');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --change-context ──────────────────────────────────────────────────────────

describe('query --change-context', () => {
  it('calls HistoryQuery.getChangeContext and prints JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockResolvedValue({} as any);

    await runQuery('--change-context', 'src/foo.ts', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    expect(loadHistoryData).toHaveBeenCalled();
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('target');
  });

  it('exits 1 and shows message when git history data not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('not found'));

    await runQuery('--change-context', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/git.*history|analyze_git/i);
  });
});

// ── --cochange ────────────────────────────────────────────────────────────────

describe('query --cochange', () => {
  it('calls HistoryQuery.getCochange and prints JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockResolvedValue({} as any);

    await runQuery('--cochange', 'src/foo.ts', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('pairs');
  });

  it('exits 1 when git history data not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('not found'));

    await runQuery('--cochange', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --change-risk ─────────────────────────────────────────────────────────────

describe('query --change-risk', () => {
  it('calls HistoryQuery.getChangeRisk and prints JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockResolvedValue({} as any);

    await runQuery('--change-risk', 'src/foo.ts', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('riskScore');
  });

  it('exits 1 when git history data not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('not found'));

    await runQuery('--change-risk', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── --ownership ───────────────────────────────────────────────────────────────

describe('query --ownership', () => {
  it('calls HistoryQuery.getOwnership and prints JSON', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockResolvedValue({} as any);

    await runQuery('--ownership', 'src/foo.ts', '--format', 'json');
    expect(process.exit).not.toHaveBeenCalledWith(1);
    const json = JSON.parse(consoleOutput.join('\n'));
    expect(json).toHaveProperty('contributors');
  });

  it('exits 1 when git history data not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('not found'));

    await runQuery('--ownership', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// ── validateQueryOptions extension ───────────────────────────────────────────

describe('validateQueryOptions: new flags included in exclusivity check', () => {
  it('rejects two primary flags together (--atlas-layer + --summary)', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine(mockPackageGraph)));
    await runQuery('--atlas-layer', 'package', '--summary');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/exactly one/i);
  });

  it('rejects --change-context + --cochange together', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--change-context', 'src/foo.ts', '--cochange', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toMatch(/exactly one/i);
  });
});

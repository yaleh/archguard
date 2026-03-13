/**
 * Unit tests for the query command.
 * Mocks engine-loader to avoid filesystem access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entity, Relation, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';

// Mock engine-loader before importing the command
vi.mock('@/cli/query/engine-loader.js', () => ({
  resolveArchDir: vi.fn((dir?: string) => dir ?? '.archguard'),
  loadEngine: vi.fn(),
  readManifest: vi.fn(),
}));

// Mock history-loader for git history tests
vi.mock('@/cli/git-history/history-loader.js', () => ({
  loadHistoryData: vi.fn(),
  GitHistoryNotFoundError: class GitHistoryNotFoundError extends Error {
    constructor(dir: string) {
      super(`Git history not found in ${dir}`);
      this.name = 'GitHistoryNotFoundError';
    }
  },
}));

import { createQueryCommand } from '@/cli/commands/query.js';
import { resolveArchDir, loadEngine, readManifest } from '@/cli/query/engine-loader.js';
import { loadHistoryData, GitHistoryNotFoundError } from '@/cli/git-history/history-loader.js';

// -- Test fixtures --

function makeEntity(
  id: string,
  name: string,
  type: string = 'class',
  file: string = 'src/foo.ts'
): Entity {
  return {
    id,
    name,
    type: type as Entity['type'],
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

const entities: Entity[] = [
  makeEntity('cm', 'CacheManager', 'class', 'src/cache.ts'),
  makeEntity('dp', 'DiagramProcessor', 'class', 'src/processor.ts'),
  makeEntity('ilp', 'ILanguagePlugin', 'interface', 'src/plugin.ts'),
  makeEntity('tsp', 'TypeScriptPlugin', 'class', 'src/ts-plugin.ts'),
  makeEntity('orphan', 'OrphanClass', 'class', 'src/orphan.ts'),
];

const relations: Relation[] = [
  { id: 'dp->cm', source: 'dp', target: 'cm', type: 'dependency' },
  { id: 'dp->ilp', source: 'dp', target: 'ilp', type: 'dependency' },
  { id: 'tsp->ilp', source: 'tsp', target: 'ilp', type: 'implementation' },
  { id: 'cm->dp', source: 'cm', target: 'dp', type: 'dependency' }, // cycle cm <-> dp
];

const parsedScope: QueryScopeEntry = {
  key: 'abc123',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 5,
  relationCount: 4,
  hasAtlasExtension: false,
};

const derivedScope: QueryScopeEntry = {
  key: 'def456',
  label: 'src/sub (typescript)',
  language: 'typescript',
  kind: 'derived',
  sources: ['/project/src/sub'],
  entityCount: 5,
  relationCount: 4,
  hasAtlasExtension: false,
};

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
  };
}

function createTestEngine(scope: QueryScopeEntry = parsedScope): QueryEngine {
  const archJson = makeArchJson();
  const archIndex = buildArchIndex(archJson, 'testhash');
  return new QueryEngine({ archJson, archIndex, scopeEntry: scope });
}

// -- Console capture --

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

  vi.mocked(resolveArchDir).mockClear();
  vi.mocked(loadEngine).mockClear();
  vi.mocked(readManifest).mockClear();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
});

async function runQuery(...args: string[]): Promise<void> {
  const cmd = createQueryCommand();
  await cmd.parseAsync(['node', 'query', ...args]);
}

// -- Tests --

describe('createQueryCommand', () => {
  it('registers with correct name and description', () => {
    const cmd = createQueryCommand();
    expect(cmd.name()).toBe('query');
    expect(cmd.description()).toContain('Query');
  });

  it('has all expected options registered', () => {
    const cmd = createQueryCommand();
    const optionNames = cmd.options.map((o) => o.long);

    expect(optionNames).toContain('--arch-dir');
    expect(optionNames).toContain('--scope');
    expect(optionNames).toContain('--format');
    expect(optionNames).toContain('--entity');
    expect(optionNames).toContain('--deps-of');
    expect(optionNames).toContain('--used-by');
    expect(optionNames).toContain('--implementers-of');
    expect(optionNames).toContain('--subclasses-of');
    expect(optionNames).toContain('--file');
    expect(optionNames).toContain('--depth');
    expect(optionNames).toContain('--cycles');
    expect(optionNames).toContain('--summary');
    expect(optionNames).toContain('--list-scopes');
    expect(optionNames).toContain('--type');
    expect(optionNames).toContain('--high-coupling');
    expect(optionNames).toContain('--threshold');
    expect(optionNames).toContain('--orphans');
    expect(optionNames).toContain('--in-cycles');
    expect(optionNames).toContain('--verbose');
    // Phase 5 options
    expect(optionNames).toContain('--package-stats');
    expect(optionNames).toContain('--atlas-layer');
    expect(optionNames).toContain('--test-patterns');
    expect(optionNames).toContain('--test-issues');
    expect(optionNames).toContain('--test-metrics');
    expect(optionNames).toContain('--entity-coverage');
    expect(optionNames).toContain('--change-context');
    expect(optionNames).toContain('--cochange');
    expect(optionNames).toContain('--change-risk');
    expect(optionNames).toContain('--ownership');
    expect(optionNames).toContain('--target-type');
  });

  it('does NOT expose --calls', () => {
    const cmd = createQueryCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).not.toContain('--calls');
  });
});

describe('query --list-scopes', () => {
  it('reads manifest and displays scopes', async () => {
    vi.mocked(readManifest).mockResolvedValue({
      version: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      scopes: [parsedScope, derivedScope],
    });

    await runQuery('--list-scopes');

    const output = consoleOutput.join('\n');
    expect(output).toContain('abc123');
    expect(output).toContain('parsed');
    expect(output).toContain('def456');
    expect(output).toContain('derived');
    expect(loadEngine).not.toHaveBeenCalled();
  });
});

describe('query --entity', () => {
  it('finds entity and outputs text', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
  });

  it('reports when not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'NonExistent');
    const output = consoleOutput.join('\n');
    expect(output).toContain('none');
  });

  it('outputs summary JSON by default', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeUndefined();
    expect(parsed[0].methodCount).toBeDefined();
  });

  it('outputs full entities when --verbose is set', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json', '--verbose');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeDefined();
  });
});

describe('query --deps-of', () => {
  it('calls getDependencies', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getDependencies');
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--deps-of', 'DiagramProcessor', '--depth', '2');
    expect(spy).toHaveBeenCalledWith('DiagramProcessor', 2);
  });
});

describe('query --used-by', () => {
  it('calls getDependents', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getDependents');
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--used-by', 'CacheManager');
    expect(spy).toHaveBeenCalledWith('CacheManager', 1);
  });
});

describe('query --implementers-of', () => {
  it('finds implementers', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--implementers-of', 'ILanguagePlugin');
    const output = consoleOutput.join('\n');
    expect(output).toContain('TypeScriptPlugin');
  });
});

describe('query --file', () => {
  it('finds entities in file', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--file', 'src/cache.ts');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
  });
});

describe('query --cycles', () => {
  it('shows cycles', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--cycles');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(output).toContain('DiagramProcessor');
  });
});

describe('query --summary', () => {
  it('shows summary', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--summary');
    const output = consoleOutput.join('\n');
    expect(output).toContain('5'); // entities
    expect(output).toContain('4'); // relations
  });
});

describe('query --type', () => {
  it('filters by type', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--type', 'interface');
    const output = consoleOutput.join('\n');
    expect(output).toContain('ILanguagePlugin');
    expect(output).not.toContain('CacheManager');
  });
});

describe('query --orphans', () => {
  it('finds orphans', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--orphans');
    const output = consoleOutput.join('\n');
    expect(output).toContain('OrphanClass');
  });
});

describe('query --in-cycles', () => {
  it('finds entities in cycles', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--in-cycles');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(output).toContain('DiagramProcessor');
    expect(output).not.toContain('OrphanClass');
  });
});

describe('query --format json', () => {
  it('outputs JSON for --entity', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('CacheManager');
  });

  it('outputs JSON for --summary', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--summary', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.entityCount).toBe(5);
  });
});

describe('derived scope warning', () => {
  it('shows note when scope is derived', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine(derivedScope));
    await runQuery('--summary');
    const output = consoleOutput.join('\n');
    expect(output).toContain('derived');
    expect(output).toContain('partial');
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — architecture query tools
// ---------------------------------------------------------------------------

describe('query --package-stats', () => {
  it('calls getPackageStats with default depth 2', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getPackageStats').mockReturnValue({
      depth: 2,
      packages: [],
      totalPackages: 0,
      totalEntities: 0,
      totalRelations: 0,
    });
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--package-stats');
    expect(spy).toHaveBeenCalledWith(2);
  });

  it('calls getPackageStats with explicit depth', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getPackageStats').mockReturnValue({
      depth: 3,
      packages: [],
      totalPackages: 0,
      totalEntities: 0,
      totalRelations: 0,
    });
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--package-stats', '3');
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('rejects out-of-range depth for --package-stats', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--package-stats', '9');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('--package-stats');
  });

  it('outputs JSON for --package-stats', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getPackageStats').mockReturnValue({
      depth: 2,
      packages: [{ name: 'src', entityCount: 5, relationCount: 3, avgRelations: 0.6 }],
      totalPackages: 1,
      totalEntities: 5,
      totalRelations: 3,
    });
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--package-stats', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.totalPackages).toBe(1);
  });
});

describe('query --atlas-layer', () => {
  it('rejects unknown atlas layer', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--atlas-layer', 'unknown');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --atlas-layer');
  });

  it('reports missing atlas data gracefully', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getAtlasLayer').mockReturnValue(undefined);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--atlas-layer', 'package');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('not found');
  });

  it('calls getAtlasLayer with correct key', async () => {
    const engine = createTestEngine();
    const spy = vi
      .spyOn(engine, 'getAtlasLayer')
      .mockReturnValue({ nodes: [], edges: [] } as unknown as ReturnType<
        typeof engine.getAtlasLayer
      >);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--atlas-layer', 'capability', '--format', 'json');
    expect(spy).toHaveBeenCalledWith('capability');
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — test analysis tools
// ---------------------------------------------------------------------------

function makeTestAnalysis() {
  return {
    testFiles: [
      {
        id: 'f1',
        filePath: 'tests/test_foo.py',
        frameworks: ['pytest'],
        testCases: [{ name: 'test_add', assertionCount: 2, isSkipped: false }],
        testTypeHint: 'unit' as const,
        importedSourceFiles: [],
      },
    ],
    issues: [{ type: 'zero_assertion', file: 'tests/test_bar.py', severity: 'warning' }],
    metrics: {
      totalTestFiles: 1,
      totalTestCases: 1,
      assertionDensity: 2,
      skippedTests: 0,
      unitTests: 1,
      integrationTests: 0,
      e2eTests: 0,
      performanceTests: 0,
      debugTests: 0,
      frameworks: ['pytest'],
    },
    coverageMap: new Map(),
    patternConfigSource: 'default' as const,
  };
}

describe('query --test-patterns', () => {
  it('returns detected frameworks and totalTestFiles', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(makeTestAnalysis() as unknown as ReturnType<typeof engine.getTestAnalysis>);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-patterns', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.detectedFrameworks).toEqual([{ name: 'pytest', confidence: 'high' }]);
    expect(parsed.totalTestFiles).toBe(1);
  });

  it('exits 1 when no test analysis data', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(undefined);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-patterns');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('No test analysis data');
  });
});

describe('query --test-issues', () => {
  it('returns issues array as JSON', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(makeTestAnalysis() as unknown as ReturnType<typeof engine.getTestAnalysis>);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-issues', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe('zero_assertion');
  });

  it('exits 1 when no test analysis data', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(undefined);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-issues');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('query --test-metrics', () => {
  it('returns metrics object as JSON', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(makeTestAnalysis() as unknown as ReturnType<typeof engine.getTestAnalysis>);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-metrics', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.totalTestFiles).toBe(1);
    expect(parsed.assertionDensity).toBe(2);
  });

  it('exits 1 when no test analysis data', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getTestAnalysis').mockReturnValue(undefined);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--test-metrics');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('query --entity-coverage', () => {
  it('calls getEntityCoverage with given entity ID', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'hasTestAnalysis').mockReturnValue(true);
    const spy = vi.spyOn(engine, 'getEntityCoverage').mockReturnValue({
      entityId: 'cm',
      coveredBy: [],
      coverageScore: 0,
      isCovered: false,
    });
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--entity-coverage', 'cm', '--format', 'json');
    expect(spy).toHaveBeenCalledWith('cm');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.entityId).toBe('cm');
  });

  it('exits 1 when no test analysis data', async () => {
    const engine = createTestEngine();
    vi.spyOn(engine, 'hasTestAnalysis').mockReturnValue(false);
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--entity-coverage', 'cm');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('No test analysis data');
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — git history tools
// ---------------------------------------------------------------------------

const fakeHistoryData = { fileMetrics: [], packageMetrics: [], commitMetrics: [] };

describe('query --change-context', () => {
  it('calls getChangeContext and outputs JSON', async () => {
    const contextResult = {
      target: 'src/foo.ts',
      targetType: 'file' as const,
      changeFrequency: 5,
      lastChangedAt: '2026-01-01',
      topContributors: [],
      cochangedFiles: [],
    };
    vi.mocked(loadHistoryData).mockResolvedValue(fakeHistoryData as unknown as Awaited<ReturnType<typeof loadHistoryData>>);
    const { HistoryQuery } = await import('@/cli/git-history/history-query.js');
    vi.spyOn(HistoryQuery.prototype, 'getChangeContext').mockReturnValue(contextResult);
    await runQuery('--change-context', 'src/foo.ts', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.target).toBe('src/foo.ts');
    expect(parsed.changeFrequency).toBe(5);
  });

  it('exits 1 when git history not found', async () => {
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('.archguard'));
    await runQuery('--change-context', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('No git history data found');
  });
});

describe('query --cochange', () => {
  it('calls getCochange with targetType and outputs JSON', async () => {
    const cochangeResult = { target: 'src/foo.ts', targetType: 'file' as const, neighbors: [] };
    vi.mocked(loadHistoryData).mockResolvedValue(fakeHistoryData as unknown as Awaited<ReturnType<typeof loadHistoryData>>);
    const { HistoryQuery } = await import('@/cli/git-history/history-query.js');
    vi.spyOn(HistoryQuery.prototype, 'getCochange').mockReturnValue(cochangeResult);
    await runQuery('--cochange', 'src/foo.ts', '--target-type', 'file', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.target).toBe('src/foo.ts');
  });
});

describe('query --change-risk', () => {
  it('calls getChangeRisk and outputs JSON', async () => {
    const riskResult = {
      target: 'src/foo.ts',
      targetType: 'file' as const,
      riskScore: 0.7,
      riskLevel: 'high' as const,
      factors: [],
    };
    vi.mocked(loadHistoryData).mockResolvedValue(fakeHistoryData as unknown as Awaited<ReturnType<typeof loadHistoryData>>);
    const { HistoryQuery } = await import('@/cli/git-history/history-query.js');
    vi.spyOn(HistoryQuery.prototype, 'getChangeRisk').mockReturnValue(riskResult);
    await runQuery('--change-risk', 'src/foo.ts', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.riskScore).toBe(0.7);
  });
});

describe('query --ownership', () => {
  it('calls getOwnership and outputs JSON', async () => {
    const ownerResult = {
      target: 'src/foo.ts',
      targetType: 'file' as const,
      primaryOwner: 'alice',
      ownershipRatio: 0.8,
      contributors: [],
    };
    vi.mocked(loadHistoryData).mockResolvedValue(fakeHistoryData as unknown as Awaited<ReturnType<typeof loadHistoryData>>);
    const { HistoryQuery } = await import('@/cli/git-history/history-query.js');
    vi.spyOn(HistoryQuery.prototype, 'getOwnership').mockReturnValue(ownerResult);
    await runQuery('--ownership', 'src/foo.ts', '--format', 'json');
    const parsed = JSON.parse(consoleOutput.join('\n'));
    expect(parsed.primaryOwner).toBe('alice');
  });

  it('exits 1 when git history not found', async () => {
    vi.mocked(loadHistoryData).mockRejectedValue(new GitHistoryNotFoundError('.archguard'));
    await runQuery('--ownership', 'src/foo.ts');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses --target-type package for package queries', async () => {
    const ownerResult = {
      target: 'src',
      targetType: 'package' as const,
      primaryOwner: 'bob',
      ownershipRatio: 0.6,
      contributors: [],
    };
    vi.mocked(loadHistoryData).mockResolvedValue(fakeHistoryData as unknown as Awaited<ReturnType<typeof loadHistoryData>>);
    const { HistoryQuery } = await import('@/cli/git-history/history-query.js');
    const spy = vi.spyOn(HistoryQuery.prototype, 'getOwnership').mockReturnValue(ownerResult);
    await runQuery('--ownership', 'src', '--target-type', 'package', '--format', 'json');
    expect(spy).toHaveBeenCalledWith('package', 'src');
  });
});

describe('query --target-type validation', () => {
  it('rejects invalid --target-type value', async () => {
    vi.mocked(loadHistoryData).mockRejectedValue(new Error('unreachable'));
    await runQuery('--ownership', 'src/foo.ts', '--target-type', 'invalid');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --target-type');
  });
});

describe('error handling', () => {
  it('exits 1 when loadEngine fails (multiple scopes)', async () => {
    vi.mocked(loadEngine).mockRejectedValue(
      new Error('Multiple scopes found. Use --scope to select one')
    );
    await runQuery('--summary');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Multiple scopes');
  });

  it('passes --arch-dir and --scope to loadEngine', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'Foo', '--arch-dir', '/custom', '--scope', 'my-scope');
    expect(resolveArchDir).toHaveBeenCalledWith('/custom');
    expect(loadEngine).toHaveBeenCalledWith(expect.any(String), 'my-scope');
  });

  it('rejects conflicting primary query options', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'Foo', '--summary');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Specify exactly one primary query option');
  });

  it('rejects invalid depth values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--deps-of', 'Foo', '--depth', 'abc');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --depth');
  });

  it('rejects out-of-range depth values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--deps-of', 'Foo', '--depth', '7');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --depth');
  });

  it('rejects invalid threshold values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--high-coupling', '--threshold', 'abc');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --threshold');
  });
});

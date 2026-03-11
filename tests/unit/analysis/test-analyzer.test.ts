import { describe, it, expect, vi } from 'vitest';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';

function makePlugin(fileExtensions: string[] = ['.ts', '.tsx']): ILanguagePlugin {
  return {
    metadata: {
      name: 'test',
      version: '1.0',
      displayName: 'Test',
      fileExtensions,
      author: 'test',
      minCoreVersion: '1.0.0',
      capabilities: {
        singleFileParsing: true,
        incrementalParsing: false,
        dependencyExtraction: false,
        typeInference: false,
        testStructureExtraction: true,
      },
    },
    initialize: vi.fn(),
    canHandle: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
    supportedLevels: ['class'],
    parseCode: vi.fn(),
    parseProject: vi.fn().mockResolvedValue({
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
      extensions: {},
    }),
    isTestFile: vi.fn((p: string) => p.includes('.test.') || p.includes('.spec.')),
    extractTestStructure: vi.fn().mockReturnValue(null),
  } as unknown as ILanguagePlugin;
}

function makeArchJson(entities: any[] = []): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities,
    relations: [],
    extensions: {},
  } as any;
}

function makeRawTestFile(filePath: string, overrides: Partial<RawTestFile> = {}): RawTestFile {
  return {
    filePath,
    frameworks: ['vitest'],
    testTypeHint: 'unit',
    testCases: [{ name: 'test 1', isSkipped: false, assertionCount: 2 }],
    importedSourceFiles: [],
    ...overrides,
  };
}

describe('TestAnalyzer.analyze()', () => {
  it('returns TestAnalysis with correct totalTestFiles from 3 test files', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePaths = [
      `${workspaceRoot}/foo.test.ts`,
      `${workspaceRoot}/bar.test.ts`,
      `${workspaceRoot}/baz.spec.ts`,
    ];

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue(filePaths);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue(
      filePaths.map((fp) => makeRawTestFile(fp))
    );

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.metrics.totalTestFiles).toBe(3);
  });

  it('classifies zero-assertion test as "debug"', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePath = `${workspaceRoot}/debug.test.ts`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'console log test', isSkipped: false, assertionCount: 0 }],
      }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].testType).toBe('debug');
  });
});

describe('TestAnalyzer - patternConfig override', () => {
  it('uses testTypeHint from plugin when assertionCount > 0', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePath = `${workspaceRoot}/integration.test.ts`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'integration',
        testCases: [{ name: 'test', isSkipped: false, assertionCount: 3 }],
      }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].testType).toBe('integration');
  });
});

describe('TestAnalyzer - metrics computation', () => {
  it('computes correct byType counts', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePaths = [
      `${workspaceRoot}/foo.test.ts`,
      `${workspaceRoot}/bar.integration.test.ts`,
    ];

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue(filePaths);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePaths[0], { testTypeHint: 'unit' }),
      makeRawTestFile(filePaths[1], { testTypeHint: 'integration' }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.metrics.byType.unit).toBe(1);
    expect(result.metrics.byType.integration).toBe(1);
  });

  it('produces non-empty version field', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.version).toBe('1.0');
  });

  it('counts issues correctly', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePath = `${workspaceRoot}/bad.test.ts`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    // zero assertions + no coverage → should get zero_assertion + orphan_test issues
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'test', isSkipped: false, assertionCount: 0 }],
        importedSourceFiles: [],
      }),
    ]);

    // zero-assertion test → testType becomes 'debug' → exempt from orphan_test
    // but the debug testType is exempt from zero_assertion too
    // so no issues expected for a debug file
    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.metrics.issueCount.zero_assertion).toBe(0); // debug exempt
    expect(result.metrics.issueCount.orphan_test).toBe(0);    // debug exempt
  });
});

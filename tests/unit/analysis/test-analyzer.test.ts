import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

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

describe('TestAnalyzer - performance hint exemption', () => {
  it('preserves performance testTypeHint even when assertionCount is 0 (JMH/benchmark files)', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePath = `${workspaceRoot}/VectorPerfBench.java`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'performance',
        testCases: [{ name: 'benchDotProduct', isSkipped: false, assertionCount: 0 }],
      }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].testType).toBe('performance');
  });

  it('does NOT emit zero_assertion issue for performance-typed files', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePath = `${workspaceRoot}/TensorBench.java`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'performance',
        testCases: [{ name: 'benchMatmul', isSkipped: false, assertionCount: 0 }],
      }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].testType).toBe('performance');
    expect(result.metrics.issueCount.zero_assertion).toBe(0);
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

    // zero-assertion test → testType becomes 'debug'
    // debug files EMIT zero_assertion (proposal: "同步输出 issue") but are EXEMPT from orphan_test
    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.metrics.issueCount.zero_assertion).toBe(1); // debug emits zero_assertion
    expect(result.metrics.issueCount.orphan_test).toBe(0);    // debug exempt from orphan
  });
});

describe('TestAnalyzer.discoverTestFiles — Java multi-module (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'archguard-java-test-'));
    // Create a root-level 'src/' to force inferTestDirs to scope to tmpDir/src (triggering the bug).
    // With src/ present, inferTestDirs returns [tmpDir/src], so the glob only visits tmpDir/src/**/*
    // and misses the sub-module test files in jlama-net/ and jlama-tests/.
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await mkdir(path.join(tmpDir, 'jlama-core/src/main/java/com/example'), { recursive: true });
    await mkdir(path.join(tmpDir, 'jlama-net/src/test/java/com/example'), { recursive: true });
    await mkdir(path.join(tmpDir, 'jlama-tests/src/test/java/com/example'), { recursive: true });

    await writeFile(
      path.join(tmpDir, 'jlama-core/src/main/java/com/example/Core.java'),
      'public class Core {}'
    );
    await writeFile(
      path.join(tmpDir, 'jlama-net/src/test/java/com/example/RestServiceTest.java'),
      'import org.junit.Test;\npublic class RestServiceTest { @Test public void testGet() {} }'
    );
    await writeFile(
      path.join(tmpDir, 'jlama-tests/src/test/java/com/example/IntegrationTest.java'),
      'import org.junit.Test;\npublic class IntegrationTest { @Test public void testFlow() {} }'
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('discovers test files in all sub-modules when workspaceRoot is the project root', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: tmpDir });

    const analyzer = new TestAnalyzer();
    // collectRawTestFiles is mocked so tree-sitter is never invoked
    const collectSpy = vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot: tmpDir });

    const discoveredPaths: string[] = collectSpy.mock.calls[0][0];

    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    // Non-test sources must be excluded
    expect(discoveredPaths.some((p) => p.includes('Core.java'))).toBe(false);
  });

  it('discovers only test files within the given sub-module when workspaceRoot is a single sub-module root', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const plugin = new JavaPlugin();
    const subRoot = path.join(tmpDir, 'jlama-tests');
    await plugin.initialize({ workspaceRoot: subRoot });

    const analyzer = new TestAnalyzer();
    const collectSpy = vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot: subRoot });

    const discoveredPaths: string[] = collectSpy.mock.calls[0][0];

    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(false);
  });
});

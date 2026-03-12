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

describe('TestAnalyzer - Java Maven suffix import matching', () => {
  it('links Java test to entity via suffix match (multi-module Maven path)', async () => {
    // Simulates: test imports "com.github.tjake.jlama.tensor.AbstractTensor"
    // which resolves to importedSourceFiles: ['com/github/tjake/jlama/tensor/AbstractTensor.java']
    // Entity source is at: jlama-core/src/main/java/com/github/tjake/jlama/tensor/AbstractTensor.java
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/jlama-tests/src/test/java/TestParser.java`;

    const archJson = makeArchJson([
      {
        id: 'com.github.tjake.jlama.tensor.AbstractTensor',
        name: 'AbstractTensor',
        type: 'abstract_class',
        sourceLocation: {
          file: 'jlama-core/src/main/java/com/github/tjake/jlama/tensor/AbstractTensor.java',
          startLine: 1,
          endLine: 100,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'testParse', isSkipped: false, assertionCount: 5 }],
        importedSourceFiles: ['com/github/tjake/jlama/tensor/AbstractTensor.java'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.github.tjake.jlama.tensor.AbstractTensor');
    expect(result.metrics.entityCoverageRatio).toBeGreaterThan(0);
  });

  it('links multiple Java test imports to multiple entities', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/jlama-tests/src/test/java/TestOperations.java`;

    const archJson = makeArchJson([
      {
        id: 'com.github.tjake.jlama.tensor.AbstractTensor',
        name: 'AbstractTensor',
        type: 'abstract_class',
        sourceLocation: { file: 'jlama-core/src/main/java/com/github/tjake/jlama/tensor/AbstractTensor.java', startLine: 1, endLine: 100 },
      },
      {
        id: 'com.github.tjake.jlama.tensor.FloatBufferTensor',
        name: 'FloatBufferTensor',
        type: 'class',
        sourceLocation: { file: 'jlama-core/src/main/java/com/github/tjake/jlama/tensor/FloatBufferTensor.java', startLine: 1, endLine: 80 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'testOps', isSkipped: false, assertionCount: 10 }],
        importedSourceFiles: [
          'com/github/tjake/jlama/tensor/AbstractTensor.java',
          'com/github/tjake/jlama/tensor/FloatBufferTensor.java',
        ],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.github.tjake.jlama.tensor.AbstractTensor');
    expect(result.testFiles[0].coveredEntityIds).toContain('com.github.tjake.jlama.tensor.FloatBufferTensor');
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

// Fix 2A: directory-prefix matching for Go package imports
describe('TestAnalyzer - Go package directory import resolution', () => {
  it('resolves entities whose file is inside an imported package directory', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.go']);

    const archJson = makeArchJson([
      {
        id: 'internal/service.Handler',
        name: 'Handler',
        type: 'struct',
        sourceLocation: { file: 'internal/service/handler.go', startLine: 1, endLine: 30 },
      },
      {
        id: 'internal/service.Config',
        name: 'Config',
        type: 'struct',
        sourceLocation: { file: 'internal/service/config.go', startLine: 1, endLine: 15 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    const filePath = `${workspaceRoot}/internal/service/handler_test.go`;
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        // Package-level import: the directory 'internal/service' covers all files inside it
        importedSourceFiles: ['internal/service'],
        testCases: [{ name: 'TestHandler', isSkipped: false, assertionCount: 3 }],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });

    // Both entities in internal/service/ must be linked
    const handlerLink = result.coverageMap.find((l: any) => l.sourceEntityId === 'internal/service.Handler');
    const configLink = result.coverageMap.find((l: any) => l.sourceEntityId === 'internal/service.Config');
    expect(handlerLink?.coverageScore).toBeGreaterThan(0);
    expect(configLink?.coverageScore).toBeGreaterThan(0);
    expect(result.metrics.entityCoverageRatio).toBeGreaterThan(0);
  });

  it('does NOT match entities in sibling packages via directory prefix', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.go']);

    const archJson = makeArchJson([
      {
        id: 'internal/service.Handler',
        name: 'Handler',
        type: 'struct',
        sourceLocation: { file: 'internal/service/handler.go', startLine: 1, endLine: 30 },
      },
      {
        id: 'internal/servicebus.Bus',
        name: 'Bus',
        type: 'struct',
        // 'internal/servicebus' starts with 'internal/service' but is a DIFFERENT package
        sourceLocation: { file: 'internal/servicebus/bus.go', startLine: 1, endLine: 20 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    const filePath = `${workspaceRoot}/internal/service/handler_test.go`;
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        importedSourceFiles: ['internal/service'],
        testCases: [{ name: 'TestHandler', isSkipped: false, assertionCount: 2 }],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });

    const busLink = result.coverageMap.find((l: any) => l.sourceEntityId === 'internal/servicebus.Bus');
    // servicebus must NOT be linked by 'internal/service' import
    expect(busLink?.coverageScore ?? 0).toBe(0);
  });
});

describe('TestAnalyzer - totalAssertions field (C++ rounding fix)', () => {
  it('uses totalAssertions from RawTestFile when per-case sums to 0', async () => {
    // Simulates: 4 assert() calls in file, 9 test functions → Math.round(4/9)=0 per case
    // With fix: RawTestFile.totalAssertions=4 → assertionCount=4, NOT classified as debug
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.cpp']);
    const filePath = `${workspaceRoot}/tests/test-grammar-llguidance.cpp`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      {
        ...makeRawTestFile(filePath, {
          testTypeHint: 'unit',
          // 9 cases, each with 0 from rounding, but totalAssertions=4 at file level
          testCases: Array.from({ length: 9 }, (_, i) => ({
            name: `test_fn_${i}`,
            isSkipped: false,
            assertionCount: 0,
          })),
        }),
        totalAssertions: 4,
      },
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].testType).not.toBe('debug');
    expect(result.testFiles[0].assertionCount).toBe(4);
  });

  it('falls back to summing testCase assertionCounts when totalAssertions absent', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.cpp']);
    const filePath = `${workspaceRoot}/tests/test-something.cpp`;

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testCases: [
          { name: 'test_a', isSkipped: false, assertionCount: 3 },
          { name: 'test_b', isSkipped: false, assertionCount: 2 },
        ],
      }),
      // no totalAssertions field
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot, patternConfig: undefined });
    expect(result.testFiles[0].assertionCount).toBe(5);
  });
});

describe('TestAnalyzer - C++ relative import path normalization (Fix ../ paths)', () => {
  it('resolves "../src/llama-grammar.h" from tests/ to src/llama-grammar entity', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.cpp']);

    const archJson = makeArchJson([
      {
        id: 'src.llama_grammar',
        name: 'llama_grammar',
        type: 'struct',
        sourceLocation: { file: 'src/llama-grammar.h', startLine: 1, endLine: 50 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    const filePath = `${workspaceRoot}/tests/test-grammar-parser.cpp`;
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        // Raw include from a test in tests/: "../src/llama-grammar.h"
        importedSourceFiles: ['../src/llama-grammar.h'],
        testCases: [{ name: 'test_grammar', isSkipped: false, assertionCount: 5 }],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });
    const link = result.coverageMap.find((l: any) => l.sourceEntityId === 'src.llama_grammar');
    expect(link?.coverageScore).toBeGreaterThan(0);
  });

  it('resolves "../src/unicode.h" from tests/ to src/unicode entity', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.cpp']);

    const archJson = makeArchJson([
      {
        id: 'src.unicode_cpt',
        name: 'unicode_cpt',
        type: 'struct',
        sourceLocation: { file: 'src/unicode.h', startLine: 1, endLine: 20 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    const filePath = `${workspaceRoot}/tests/test-tokenizer-1-bpe.cpp`;
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        importedSourceFiles: ['../src/unicode.h'],
        testCases: [{ name: 'main', isSkipped: false, assertionCount: 2 }],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });
    const link = result.coverageMap.find((l: any) => l.sourceEntityId === 'src.unicode_cpt');
    expect(link?.coverageScore).toBeGreaterThan(0);
  });

  it('still resolves normal relative paths (no ..) correctly', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.cpp']);

    const archJson = makeArchJson([
      {
        id: 'src.MyClass',
        name: 'MyClass',
        type: 'class',
        sourceLocation: { file: 'src/my-class.h', startLine: 1, endLine: 30 },
      },
    ]);

    const analyzer = new TestAnalyzer();
    const filePath = `${workspaceRoot}/tests/test-myclass.cpp`;
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        importedSourceFiles: ['src/my-class.h'],
        testCases: [{ name: 'main', isSkipped: false, assertionCount: 1 }],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot, patternConfig: undefined });
    const link = result.coverageMap.find((l: any) => l.sourceEntityId === 'src.MyClass');
    expect(link?.coverageScore).toBeGreaterThan(0);
  });
});

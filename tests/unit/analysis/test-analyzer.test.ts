import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ProjectSemantics } from '@/types/extensions/project-semantics.js';

function makePlugin(fileExtensions: string[] = ['.ts', '.tsx']): ILanguagePlugin {
  return {
    metadata: {
      name: 'test',
      version: '1.1',
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
      version: '1.1',
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
    version: '1.1',
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    expect(result.testFiles[0].testType).toBe('performance');
    expect(result.metrics.issueCount.zero_assertion).toBe(0);
  });
});

describe('TestAnalyzer - metrics computation', () => {
  it('computes correct byType counts', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin();
    const filePaths = [`${workspaceRoot}/foo.test.ts`, `${workspaceRoot}/bar.integration.test.ts`];

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue(filePaths);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePaths[0], { testTypeHint: 'unit' }),
      makeRawTestFile(filePaths[1], { testTypeHint: 'integration' }),
    ]);

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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
    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    expect(result.metrics.issueCount.zero_assertion).toBe(1); // debug emits zero_assertion
    expect(result.metrics.issueCount.orphan_test).toBe(0); // debug exempt from orphan
  });
});

describe('TestAnalyzer - ProjectSemantics integration', () => {
  it('passes custom assertion regexes from ProjectSemantics when patternConfig does not override them', async () => {
    const { mergeProjectSemanticsIntoPatternConfig } = await import('@/analysis/test-analyzer.js');

    const merged = mergeProjectSemanticsIntoPatternConfig(undefined, {
      customAssertionPatterns: ['\\bverify\\s*\\('],
    } as Partial<ProjectSemantics>);

    expect(merged?.customAssertionRegexes).toEqual(['\\bverify\\s*\\(']);
  });

  it('keeps patternConfig assertionPatterns as higher priority than ProjectSemantics regexes', async () => {
    const { mergeProjectSemanticsIntoPatternConfig } = await import('@/analysis/test-analyzer.js');

    const merged = mergeProjectSemanticsIntoPatternConfig(
      {
        assertionPatterns: ['expect('],
      },
      {
        customAssertionPatterns: ['\\bverify\\s*\\('],
      } as Partial<ProjectSemantics>
    );

    expect(merged?.assertionPatterns).toEqual(['expect(']);
    expect(merged?.customAssertionRegexes).toBeUndefined();
  });

  it('merges additionalTestPatterns into testFileGlobs', async () => {
    const { mergeProjectSemanticsIntoPatternConfig } = await import('@/analysis/test-analyzer.js');

    const merged = mergeProjectSemanticsIntoPatternConfig(
      {
        testFileGlobs: ['**/*.spec.ts'],
      },
      {
        additionalTestPatterns: ['**/*.integration.ts'],
      } as Partial<ProjectSemantics>
    );

    expect(merged?.testFileGlobs).toEqual(['**/*.spec.ts', '**/*.integration.ts']);
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    expect(result.testFiles[0].coveredEntityIds).toContain(
      'com.github.tjake.jlama.tensor.AbstractTensor'
    );
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
        sourceLocation: {
          file: 'jlama-core/src/main/java/com/github/tjake/jlama/tensor/AbstractTensor.java',
          startLine: 1,
          endLine: 100,
        },
      },
      {
        id: 'com.github.tjake.jlama.tensor.FloatBufferTensor',
        name: 'FloatBufferTensor',
        type: 'class',
        sourceLocation: {
          file: 'jlama-core/src/main/java/com/github/tjake/jlama/tensor/FloatBufferTensor.java',
          startLine: 1,
          endLine: 80,
        },
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    expect(result.testFiles[0].coveredEntityIds).toContain(
      'com.github.tjake.jlama.tensor.AbstractTensor'
    );
    expect(result.testFiles[0].coveredEntityIds).toContain(
      'com.github.tjake.jlama.tensor.FloatBufferTensor'
    );
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
    const plugin = new JavaPlugin(nativeParserBackend);
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
    const plugin = new JavaPlugin(nativeParserBackend);
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

// Fix 3: autotest directory support
describe('TestAnalyzer.inferTestDirs — autotest directory candidate (Fix 3)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'archguard-autotest-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('includes autotest/ in inferred test dirs when it exists', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    await mkdir(path.join(tmpDir, 'autotest'), { recursive: true });

    const analyzer = new TestAnalyzer();
    const dirs: string[] = await (analyzer as any).inferTestDirs(tmpDir);
    expect(dirs).toContain(path.join(tmpDir, 'autotest'));
  });

  it('does not include autotest/ when it does not exist', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    // no autotest dir created
    const analyzer = new TestAnalyzer();
    const dirs: string[] = await (analyzer as any).inferTestDirs(tmpDir);
    expect(dirs).not.toContain(path.join(tmpDir, 'autotest'));
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });

    // Both entities in internal/service/ must be linked
    const handlerLink = result.coverageMap.find(
      (l: any) => l.sourceEntityId === 'internal/service.Handler'
    );
    const configLink = result.coverageMap.find(
      (l: any) => l.sourceEntityId === 'internal/service.Config'
    );
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });

    const busLink = result.coverageMap.find(
      (l: any) => l.sourceEntityId === 'internal/servicebus.Bus'
    );
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(makeArchJson(), plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    expect(result.testFiles[0].assertionCount).toBe(5);
  });
});

describe('TestAnalyzer - entityCoverageRatio denominator dedupes duplicate ids', () => {
  it('counts unique entity ids, not raw array length', async () => {
    // archJson.entities may carry duplicate ids (same class across source sets).
    // Denominator must be the distinct id set so the ratio reflects unique entities.
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/workspace';
    const plugin = makePlugin(['.ts']);
    const filePath = `${workspaceRoot}/src/a.test.ts`;

    // 3 entities, one of which appears twice in the array (duplicate id).
    const archJson = makeArchJson([
      { id: 'a.A', name: 'A', type: 'class', sourceLocation: { file: 'src/a/A.ts', startLine: 1, endLine: 10 } },
      { id: 'b.B', name: 'B', type: 'class', sourceLocation: { file: 'src/b/B.ts', startLine: 1, endLine: 10 } },
      { id: 'c.C', name: 'C', type: 'class', sourceLocation: { file: 'src/c/C.ts', startLine: 1, endLine: 10 } },
      { id: 'a.A', name: 'A', type: 'class', sourceLocation: { file: 'src/a/A.ts', startLine: 1, endLine: 10 } }, // dup
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 't', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: ['src/a/A.ts'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    // coveredEntities = { a.A }; unique ids = { a.A, b.B, c.C } = 3 → 1/3
    expect(result.metrics.entityCoverageRatio).toBeCloseTo(1 / 3, 5);
  });
});

describe('TestAnalyzer - same-package inference (Java FooTest → com.x.Foo)', () => {
  it('links same-package target even when test has no imports', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/app/src/test/java/com/example/calc/CalculatorTest.java`;

    const archJson = makeArchJson([
      {
        id: 'com.example.calc.Calculator',
        name: 'Calculator',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/app/src/main/java/com/example/calc/Calculator.java`,
          startLine: 1,
          endLine: 50,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'adds', isSkipped: false, assertionCount: 1 }],
        // No imports at all — coverage must come from same-package inference.
        importedSourceFiles: [],
        samePackageTargets: ['com.example.calc.Calculator'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.example.calc.Calculator');
    // Not an orphan — it now has a coverage link.
    const orphanIssues = result.issues.filter((i) => i.type === 'orphan_test');
    expect(orphanIssues).toHaveLength(0);
  });

  it('ignores samePackageTargets that do not exist in arch.json', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/app/src/test/java/com/example/calc/CalculatorTest.java`;

    const archJson = makeArchJson([]); // no entities

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'adds', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: [],
        samePackageTargets: ['com.example.calc.Calculator'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    expect(result.testFiles[0].coveredEntityIds).toHaveLength(0);
  });

  it('links variant-descriptor test to its base class via prefix shortening', async () => {
    // SprayHomeHeadViewPureTest → samePackageTargets ['com.x.SprayHomeHeadViewPure']
    // The tested class is SprayHomeHeadView (variant descriptor "Pure" stripped).
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/app/src/test/java/com/x/SprayHomeHeadViewPureTest.java`;

    const archJson = makeArchJson([
      {
        id: 'com.x.SprayHomeHeadView',
        name: 'SprayHomeHeadView',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/app/src/main/java/com/x/SprayHomeHeadView.java`,
          startLine: 1,
          endLine: 50,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'render', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: [],
        samePackageTargets: ['com.x.SprayHomeHeadViewPure'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.x.SprayHomeHeadView');
  });

  it('greedy prefix matching picks the longest available same-package class', async () => {
    // com.x.SprayHomeHeadViewPure shortens to SprayHomeHeadView (present) — the
    // longest match wins, not a shorter ambiguous prefix.
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/app/src/test/java/com/x/SprayHomeHeadViewPureTest.java`;

    const archJson = makeArchJson([
      {
        id: 'com.x.SprayHomeHeadView',
        name: 'SprayHomeHeadView',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/app/src/main/java/com/x/SprayHomeHeadView.java`,
          startLine: 1,
          endLine: 50,
        },
      },
      {
        id: 'com.x.SprayHomeHead',
        name: 'SprayHomeHead',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/app/src/main/java/com/x/SprayHomeHead.java`,
          startLine: 1,
          endLine: 50,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'render', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: [],
        samePackageTargets: ['com.x.SprayHomeHeadViewPure'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    // Greedy longest-prefix match: SprayHomeHeadView (the real target), not the
    // shorter SprayHomeHead that also shares a prefix.
    expect(result.testFiles[0].coveredEntityIds).toContain('com.x.SprayHomeHeadView');
    expect(result.testFiles[0].coveredEntityIds).not.toContain('com.x.SprayHomeHead');
  });

  it('links same-package direct-reference targets (Bean/Pojo aggregate tests)', async () => {
    // BeanBasicDataTest constructs BaseUnitBean and ConnectionBean via `new`
    // (same package, no import) — both must be linked as covered entities.
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.java']);
    const filePath = `${workspaceRoot}/fjspray/src/test/java/com/x/bean/BeanBasicDataTest.java`;

    const archJson = makeArchJson([
      {
        id: 'com.x.bean.BaseUnitBean',
        name: 'BaseUnitBean',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/fjspray/src/main/java/com/x/bean/BaseUnitBean.java`,
          startLine: 1,
          endLine: 10,
        },
      },
      {
        id: 'com.x.bean.ConnectionBean',
        name: 'ConnectionBean',
        type: 'class',
        sourceLocation: {
          file: `${workspaceRoot}/fjspray/src/main/java/com/x/bean/ConnectionBean.java`,
          startLine: 1,
          endLine: 10,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'build', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: [],
        samePackageTargets: ['com.x.bean.BaseUnitBean', 'com.x.bean.ConnectionBean'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.x.bean.BaseUnitBean');
    expect(result.testFiles[0].coveredEntityIds).toContain('com.x.bean.ConnectionBean');
    const orphanIssues = result.issues.filter((i) => i.type === 'orphan_test');
    expect(orphanIssues).toHaveLength(0);
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
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

    const result = await analyzer.analyze(archJson, plugin, {
      workspaceRoot,
      patternConfig: undefined,
    });
    const link = result.coverageMap.find((l: any) => l.sourceEntityId === 'src.MyClass');
    expect(link?.coverageScore).toBeGreaterThan(0);
  });
});

describe('TestAnalyzer - Kotlin entity-ID import matching', () => {
  it('links Kotlin androidTest to production entity via dotted entity-ID match', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.kt']);
    const filePath = `${workspaceRoot}/app/src/androidTest/java/com/example/app/AppShellLocalPackageImportTest.kt`;

    const archJson = makeArchJson([
      {
        id: 'com.example.app.AppShell',
        name: 'AppShell',
        type: 'class',
        sourceLocation: {
          file: 'app/src/main/java/com/example/app/AppShell.kt',
          startLine: 1,
          endLine: 80,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'integration',
        testCases: [{ name: 'importsLocalPackage', isSkipped: false, assertionCount: 2 }],
        importedSourceFiles: ['com.example.app.AppShell'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    expect(result.testFiles[0].coveredEntityIds).toContain('com.example.app.AppShell');
    expect(result.metrics.entityCoverageRatio).toBeGreaterThan(0);
  });

  it('links Kotlin test importing a package to all entities in that package', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const workspaceRoot = '/repo';
    const plugin = makePlugin(['.kt']);
    const filePath = `${workspaceRoot}/app/src/test/java/com/example/usb/UsbDeviceRefreshControllerTest.kt`;

    const archJson = makeArchJson([
      {
        id: 'com.example.usb.UsbDeviceRefreshController',
        name: 'UsbDeviceRefreshController',
        type: 'class',
        sourceLocation: {
          file: 'app/src/main/java/com/example/usb/UsbDeviceRefreshController.kt',
          startLine: 1,
          endLine: 40,
        },
      },
      {
        id: 'com.example.usb.AndroidUsbSerialManager',
        name: 'AndroidUsbSerialManager',
        type: 'class',
        sourceLocation: {
          file: 'app/src/main/java/com/example/usb/AndroidUsbSerialManager.kt',
          startLine: 1,
          endLine: 60,
        },
      },
    ]);

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue([filePath]);
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([
      makeRawTestFile(filePath, {
        testTypeHint: 'unit',
        testCases: [{ name: 'refreshes on attach', isSkipped: false, assertionCount: 1 }],
        // Package-level import links to all entities in the package
        importedSourceFiles: ['com.example.usb'],
      }),
    ]);

    const result = await analyzer.analyze(archJson, plugin, { workspaceRoot });
    const covered = result.testFiles[0].coveredEntityIds;
    expect(covered).toContain('com.example.usb.UsbDeviceRefreshController');
    expect(covered).toContain('com.example.usb.AndroidUsbSerialManager');
  });
});

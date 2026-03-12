import { describe, it, expect } from 'vitest';
import type { TestFileInfo, CoverageLink } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

function makeTestFile(id: string, coveredEntityIds: string[] = []): TestFileInfo {
  return {
    id,
    filePath: `/workspace/${id}`,
    frameworks: ['vitest'],
    testType: 'unit',
    testCaseCount: 2,
    assertionCount: 4,
    skipCount: 0,
    assertionDensity: 2,
    coveredEntityIds,
  };
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

describe('TestCoverageMapper', () => {
  it('creates CoverageLink for each covered entity', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [
      makeTestFile('foo.test.ts', ['entity-1', 'entity-2']),
      makeTestFile('bar.test.ts', ['entity-1']),
    ];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Entity1', type: 'class', sourceLocation: { file: 'src/entity1.ts', startLine: 1, endLine: 10 } },
      { id: 'entity-2', name: 'Entity2', type: 'class', sourceLocation: { file: 'src/entity2.ts', startLine: 1, endLine: 10 } },
    ]);

    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const entity1 = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-1');
    expect(entity1).toBeDefined();
    expect(entity1!.coveredByTestIds).toContain('foo.test.ts');
    expect(entity1!.coveredByTestIds).toContain('bar.test.ts');
  });

  it('coverageScore is > 0 for covered entities', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('foo.test.ts', ['entity-1'])];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Entity1', type: 'class', sourceLocation: { file: 'src/entity1.ts', startLine: 1, endLine: 10 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    expect(result[0].coverageScore).toBeGreaterThan(0);
  });

  it('returns empty array when no test files', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const result = mapper.buildCoverageMap([], makeArchJson([]), '/workspace');
    expect(result).toHaveLength(0);
  });

  // Deviation 5: coverage map must include ALL entities (score=0 for uncovered ones)
  it('includes entities with no test coverage (score 0, empty coveredByTestIds)', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('foo.test.ts', ['entity-1'])];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Covered', type: 'class', sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 5 } },
      { id: 'entity-2', name: 'Uncovered', type: 'class', sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 5 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const uncovered = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-2');
    expect(uncovered).toBeDefined();
    expect(uncovered!.coverageScore).toBe(0);
    expect(uncovered!.coveredByTestIds).toHaveLength(0);
  });

  it('path-convention matching creates link for test with matching name', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    // foo.test.ts should match entity in foo.ts via path convention
    const testFiles = [makeTestFile('foo.test.ts', [])];
    const archJson = makeArchJson([
      { id: 'entity-foo', name: 'Foo', type: 'class', sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-foo');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('foo.test.ts');
  });

  // Python path-convention (Fix — test_*.py / *_test.py patterns)
  it('Python: test_foo.py matches entities in foo.py via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('tests/test_engine.py', [])];
    const archJson = makeArchJson([
      { id: 'lmdeploy.pytorch.engine.Engine', name: 'Engine', type: 'class', sourceLocation: { file: '/workspace/lmdeploy/pytorch/engine.py', startLine: 1, endLine: 50 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'lmdeploy.pytorch.engine.Engine');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('tests/test_engine.py');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  it('Python: foo_test.py matches entities in foo.py via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('tests/kernels_test.py', [])];
    const archJson = makeArchJson([
      { id: 'lmdeploy.pytorch.kernels.Attention', name: 'Attention', type: 'class', sourceLocation: { file: '/workspace/lmdeploy/pytorch/kernels.py', startLine: 1, endLine: 30 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'lmdeploy.pytorch.kernels.Attention');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('tests/kernels_test.py');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  // Fix 2B: Go path-convention (_test.go → source file)
  it('Go: filter_test.go matches entities in filter.go via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('internal/filter/filter_test.go', [])];
    const archJson = makeArchJson([
      { id: 'internal/filter.Filter', name: 'Filter', type: 'struct', sourceLocation: { file: 'internal/filter/filter.go', startLine: 1, endLine: 30 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'internal/filter.Filter');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('internal/filter/filter_test.go');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  // Fix C: C++ path-convention (test-foo.cpp / test_foo.cpp / foo_test.cpp → foo)
  it('C++: test-sampling.cpp matches entities in sampling.cpp via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('tests/test-sampling.cpp', [])];
    const archJson = makeArchJson([
      { id: 'common.Sampler', name: 'Sampler', type: 'struct', sourceLocation: { file: 'common/sampling.cpp', startLine: 1, endLine: 50 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'common.Sampler');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('tests/test-sampling.cpp');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  it('C++: test_grammar_parser.cpp matches entities in grammar_parser.cpp via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('tests/test_grammar_parser.cpp', [])];
    const archJson = makeArchJson([
      { id: 'common.GrammarParser', name: 'GrammarParser', type: 'struct', sourceLocation: { file: 'common/grammar_parser.cpp', startLine: 1, endLine: 30 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'common.GrammarParser');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('tests/test_grammar_parser.cpp');
  });

  it('C++: foo_test.cpp matches entities in foo.cpp via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('tests/rope_test.cpp', [])];
    const archJson = makeArchJson([
      { id: 'src.RopeCalc', name: 'RopeCalc', type: 'struct', sourceLocation: { file: 'src/rope.cpp', startLine: 1, endLine: 20 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'src.RopeCalc');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('tests/rope_test.cpp');
  });

  it('Go: query_test.go matches entities in query.go via path-convention', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('internal/query/tools_test.go', [])];
    const archJson = makeArchJson([
      { id: 'internal/query.ToolQuery', name: 'ToolQuery', type: 'struct', sourceLocation: { file: 'internal/query/tools.go', startLine: 1, endLine: 50 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'internal/query.ToolQuery');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('internal/query/tools_test.go');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  // Fix 3: Go directory-match layer — any _test.go in same dir as entity's source file
  it('Go: handle_tools_call_test.go matches entity whose source is executor.go (same dir)', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    // Entity sourceLocation is executor.go, but test is handle_tools_call_test.go — same directory
    const testFiles = [makeTestFile('cmd/mcp-server/handle_tools_call_test.go', [])];
    const archJson = makeArchJson([
      { id: 'cmd/mcp-server.ToolExecutor', name: 'ToolExecutor', type: 'struct',
        sourceLocation: { file: 'cmd/mcp-server/executor.go', startLine: 1, endLine: 30 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'cmd/mcp-server.ToolExecutor');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('cmd/mcp-server/handle_tools_call_test.go');
    expect(link!.coverageScore).toBeGreaterThan(0);
  });

  it('Go: directory-match does NOT link test to entity in a different directory', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('internal/filter/expression_test.go', [])];
    const archJson = makeArchJson([
      { id: 'internal/query.Stage2', name: 'Stage2', type: 'struct',
        sourceLocation: { file: 'internal/query/stage2.go', startLine: 1, endLine: 20 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'internal/query.Stage2');
    expect(link?.coverageScore ?? 0).toBe(0);
  });
});

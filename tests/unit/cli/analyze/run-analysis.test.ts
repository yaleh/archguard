import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/cli/config-loader.js';
import type { DiagramResult } from '@/cli/processors/diagram-processor.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSON } from '@/types/index.js';

const loadMock = vi.fn();
const normalizeToDiagramsMock = vi.fn();
const readManifestMock = vi.fn();
const cleanStaleDiagramsMock = vi.fn();
const writeManifestMock = vi.fn();
const persistQueryScopesMock = vi.fn();
const processAllMock = vi.fn();
const getQuerySourceGroupsMock = vi.fn();
const getLastArchJsonMock = vi.fn();
const generateTestCoverageHeatmapMock = vi.fn();
const indexGenerateMock = vi.fn();
const diagramProcessorCtorMock = vi.fn();
const testAnalyzerAnalyzeMock = vi.fn();
const testOutputWriterWriteMock = vi.fn();
const computeImportApproximationFIMMock = vi.fn();
const validateFIMAgainstGitMock = vi.fn();
const writeFIMCurrentArtifactMock = vi.fn();
const appendFIMSnapshotMock = vi.fn();
const readGitLogMock = vi.fn();
const isGitRepoMock = vi.fn();
const getGitRootMock = vi.fn();

vi.mock('@/cli/config-loader.js', () => ({
  ConfigLoader: class {
    constructor(public configDir: string) {
      loadMock.mockImplementation(() => Promise.resolve(baseConfig));
      (this as any).configDir = configDir;
    }
    load = loadMock;
  },
}));

vi.mock('@/cli/analyze/normalize-to-diagrams.js', () => ({
  normalizeToDiagrams: normalizeToDiagramsMock,
}));

vi.mock('@/cli/cache/diagram-manifest.js', () => ({
  readManifest: readManifestMock,
  cleanStaleDiagrams: cleanStaleDiagramsMock,
  writeManifest: writeManifestMock,
}));

vi.mock('@/cli/query/query-artifacts.js', () => ({
  persistQueryScopes: persistQueryScopesMock,
}));

vi.mock('@/cli/processors/diagram-processor.js', () => ({
  DiagramProcessor: class {
    constructor(options: unknown) {
      diagramProcessorCtorMock(options);
    }
    processAll = processAllMock;
    getQuerySourceGroups = getQuerySourceGroupsMock;
    getLastArchJson = getLastArchJsonMock;
    generateTestCoverageHeatmap = generateTestCoverageHeatmapMock;
  },
}));

vi.mock('@/analysis/test-analyzer.js', () => ({
  TestAnalyzer: class {
    analyze = testAnalyzerAnalyzeMock;
  },
}));

vi.mock('@/cli/utils/test-output-writer.js', () => ({
  TestOutputWriter: class {
    write = testOutputWriterWriteMock;
  },
}));

vi.mock('@/analysis/fim/fim-analysis.js', () => ({
  computeImportApproximationFIM: computeImportApproximationFIMMock,
  validateFIMAgainstGit: validateFIMAgainstGitMock,
}));

vi.mock('@/analysis/fim/fim-artifacts.js', () => ({
  writeFIMCurrentArtifact: writeFIMCurrentArtifactMock,
}));

vi.mock('@/analysis/fim/fim-snapshot.js', () => ({
  appendFIMSnapshot: appendFIMSnapshotMock,
}));

vi.mock('@/cli/git-history/git-log-reader.js', () => ({
  readGitLog: readGitLogMock,
  isGitRepo: isGitRepoMock,
  getGitRoot: getGitRootMock,
  getHeadRef: vi.fn(),
  getCurrentBranch: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: {
    outputJson: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/cli/utils/diagram-index-generator.js', () => ({
  DiagramIndexGenerator: class {
    generate = indexGenerateMock;
  },
}));

const baseConfig: Config = {
  workDir: '/tmp/project/.archguard',
  outputDir: '/tmp/project/.archguard/output',
  format: 'mermaid',
  mermaid: { renderer: 'isomorphic', theme: 'default', transparentBackground: false },
  exclude: [],
  cli: { command: 'claude', args: [], timeout: 60000 },
  cache: { enabled: true, ttl: 86400, dir: '/tmp/project/.archguard/cache' },
  concurrency: 4,
  verbose: false,
  diagrams: [],
};

const successfulResult: DiagramResult = {
  name: 'class/all-classes',
  success: true,
  stats: { entities: 10, relations: 12, parseTime: 25 },
  paths: { json: '/tmp/project/.archguard/output/class/all-classes.json' },
};

const persistedEntry: QueryScopeEntry = {
  key: 'abcd1234',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/tmp/project/src'],
  entityCount: 10,
  relationCount: 12,
  hasAtlasExtension: false,
};

const persistedPythonEntry: QueryScopeEntry = {
  key: 'python5678',
  label: 'gguf-py (python)',
  language: 'python',
  kind: 'parsed',
  sources: ['/tmp/project/gguf-py'],
  entityCount: 4,
  relationCount: 1,
  hasAtlasExtension: false,
};

describe('runAnalysis', () => {
  beforeEach(() => {
    vi.resetModules();
    loadMock.mockReset();
    normalizeToDiagramsMock.mockReset();
    readManifestMock.mockReset();
    cleanStaleDiagramsMock.mockReset();
    writeManifestMock.mockReset();
    persistQueryScopesMock.mockReset();
    processAllMock.mockReset();
    getQuerySourceGroupsMock.mockReset();
    getLastArchJsonMock.mockReset();
    generateTestCoverageHeatmapMock.mockReset();
    indexGenerateMock.mockReset();
    diagramProcessorCtorMock.mockReset();
    testAnalyzerAnalyzeMock.mockReset();
    testOutputWriterWriteMock.mockReset();
    computeImportApproximationFIMMock.mockReset();
    validateFIMAgainstGitMock.mockReset();
    writeFIMCurrentArtifactMock.mockReset();
    appendFIMSnapshotMock.mockReset();
    readGitLogMock.mockReset();
    isGitRepoMock.mockReset();
    getGitRootMock.mockReset();

    loadMock.mockResolvedValue(baseConfig);
    getLastArchJsonMock.mockReturnValue(null);
    generateTestCoverageHeatmapMock.mockResolvedValue(undefined);
    testAnalyzerAnalyzeMock.mockResolvedValue({ metrics: { totalTestFiles: 0 } });
    testOutputWriterWriteMock.mockResolvedValue(undefined);
    computeImportApproximationFIMMock.mockResolvedValue({
      artifact: {
        timestamp: '2026-03-30T00:00:00Z',
        source: 'import-approximation',
        descriptionLength: 12,
        fileIds: ['src/a.ts'],
        packageNames: ['src'],
        fileMatrix: [[1]],
        packageMatrix: [[1]],
        fileResult: {
          eigenvalues: [1],
          conditionNumber: 1,
          effectiveDimension: 1,
          fileCount: 1,
          testCount: 1,
          diagonal: [{ fileId: 'src/a.ts', selfInfo: 1 }],
          uncoveredFiles: [],
          fragilityHotspots: [],
        },
        packageResult: {
          eigenvalues: [1],
          conditionNumber: 1,
          effectiveDimension: 1,
          fileCount: 1,
          testCount: 1,
          diagonal: [{ fileId: 'src', selfInfo: 1 }],
          uncoveredFiles: [],
          fragilityHotspots: [],
        },
      },
      snapshot: {
        timestamp: '2026-03-30T00:00:00Z',
        source: 'import-approximation',
        descriptionLength: 12,
        fileCount: 1,
        testCount: 1,
        conditionNumber: 1,
        effectiveDimension: 1,
        topEigenvalueShares: [1],
        uncoveredFileCount: 0,
      },
      coverage: {
        matrix: [[1]],
        testIds: ['tests/a.test.ts'],
        fileIds: ['src/a.ts'],
      },
    });
    validateFIMAgainstGitMock.mockReturnValue({
      mantel: {
        observedCorrelation: 0.7,
        permutations: 999,
        pValue: 0.01,
        isValidProxy: true,
      },
      packageCochangeMatrix: [[1]],
    });
    writeFIMCurrentArtifactMock.mockResolvedValue(undefined);
    appendFIMSnapshotMock.mockResolvedValue(undefined);
    readGitLogMock.mockReturnValue([{ sha: 'abc', authorEmail: 'dev@example.com', date: '2026-03-30', files: [] }]);
    isGitRepoMock.mockReturnValue(true);
    getGitRootMock.mockReturnValue('/tmp/project');
    normalizeToDiagramsMock.mockResolvedValue([
      { name: 'class/all-classes', sources: ['/tmp/project/src'], level: 'class' },
    ]);
    readManifestMock.mockResolvedValue(null);
    cleanStaleDiagramsMock.mockResolvedValue([]);
    writeManifestMock.mockResolvedValue(undefined);
    persistQueryScopesMock.mockResolvedValue([persistedEntry]);
    processAllMock.mockResolvedValue([successfulResult]);
    getQuerySourceGroupsMock.mockReturnValue([
      {
        key: 'abcd1234',
        sources: ['/tmp/project/src'],
        kind: 'parsed',
        archJson: {
          version: '1.0',
          language: 'typescript',
          timestamp: '2026-03-07T00:00:00Z',
          sourceFiles: [],
          entities: [],
          relations: [],
        },
      },
    ]);
    indexGenerateMock.mockResolvedValue(undefined);
  });

  it('uses sessionRoot for config discovery and pins workDir for output persistence', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { sources: ['./src'] },
      reporter: silentReporter(),
    });

    expect(loadMock).toHaveBeenCalledWith(
      expect.objectContaining({ workDir: '/tmp/project/.archguard' }),
      undefined
    );
    expect(normalizeToDiagramsMock).toHaveBeenCalledWith(
      baseConfig,
      { sources: ['./src'] },
      '/tmp/project'
    );
    expect(persistQueryScopesMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.any(Array),
      expect.objectContaining({ preferredGlobalScopeKey: undefined })
    );
    expect(result.persistedScopeKeys).toEqual(['abcd1234']);
  });

  it('passes preferredGlobalScopeKey when normalized diagrams mark a primary scope', async () => {
    normalizeToDiagramsMock.mockResolvedValue([
      {
        name: 'cpp/overview/package',
        sources: ['./src'],
        level: 'package',
        language: 'cpp',
        queryRole: 'primary',
      },
      {
        name: 'cpp/class/all-classes',
        sources: ['./src'],
        level: 'class',
        language: 'cpp',
        queryRole: 'primary',
      },
      {
        name: 'python/overview/package',
        sources: ['./gguf-py'],
        level: 'package',
        language: 'python',
        queryRole: 'secondary',
      },
    ]);
    getQuerySourceGroupsMock.mockReturnValue([
      {
        key: 'abcd1234',
        sources: ['/tmp/project/src'],
        kind: 'parsed',
        role: 'primary',
        archJson: {
          version: '1.0',
          language: 'cpp',
          timestamp: '2026-03-07T00:00:00Z',
          sourceFiles: [],
          entities: [],
          relations: [],
        },
      },
      {
        key: 'python5678',
        sources: ['/tmp/project/gguf-py'],
        kind: 'parsed',
        role: 'secondary',
        archJson: {
          version: '1.0',
          language: 'python',
          timestamp: '2026-03-07T00:00:00Z',
          sourceFiles: [],
          entities: [],
          relations: [],
        },
      },
    ]);
    persistQueryScopesMock.mockResolvedValue([persistedEntry, persistedPythonEntry]);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(persistQueryScopesMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.any(Array),
      expect.objectContaining({ preferredGlobalScopeKey: 'abcd1234' })
    );
  });

  it('generates index only when multiple results are present', async () => {
    processAllMock.mockResolvedValue([
      successfulResult,
      { ...successfulResult, name: 'method/cli' },
    ]);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(indexGenerateMock).toHaveBeenCalledTimes(1);
  });

  it('does not fail the analysis when query scope persistence throws', async () => {
    persistQueryScopesMock.mockRejectedValue(new Error('disk full'));

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(result.queryScopesPersisted).toBe(0);
    expect(result.persistedScopeKeys).toEqual([]);
    expect(result.results).toHaveLength(1);
  });

  it('resolves config-defined relative sources against sessionRoot before processing', async () => {
    normalizeToDiagramsMock.mockResolvedValue([
      { name: 'class/all-classes', sources: ['./src'], level: 'class' },
    ]);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/external-project',
      workDir: '/tmp/external-project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(diagramProcessorCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        diagrams: [
          expect.objectContaining({
            sources: ['/tmp/external-project/src'],
          }),
        ],
      })
    );
  });

  it('skips cleanStaleDiagrams when --diagrams level filter is set (partial run)', async () => {
    readManifestMock.mockResolvedValue({
      diagrams: ['archguard/overview/package', 'archguard/class/all-classes'],
      outputDir: '/tmp/project/.archguard/output',
      updatedAt: '2026-03-07T00:00:00Z',
    });

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { diagrams: ['method'] },
      reporter: silentReporter(),
    });

    expect(cleanStaleDiagramsMock).not.toHaveBeenCalled();
  });

  it('skips cleanStaleDiagrams when --sources override is set (partial run)', async () => {
    readManifestMock.mockResolvedValue({
      diagrams: ['archguard/overview/package', 'archguard/class/all-classes'],
      outputDir: '/tmp/project/.archguard/output',
      updatedAt: '2026-03-07T00:00:00Z',
    });

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { sources: ['/some/path'] },
      reporter: silentReporter(),
    });

    expect(cleanStaleDiagramsMock).not.toHaveBeenCalled();
  });

  it('skips writeManifest when --diagrams level filter is set (partial run)', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { diagrams: ['method'] },
      reporter: silentReporter(),
    });

    expect(writeManifestMock).not.toHaveBeenCalled();
  });

  it('skips writeManifest when --sources override is set (partial run)', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { sources: ['/some/path'] },
      reporter: silentReporter(),
    });

    expect(writeManifestMock).not.toHaveBeenCalled();
  });

  it('runs cleanStaleDiagrams and writeManifest on a full run (no diagrams, no sources)', async () => {
    readManifestMock.mockResolvedValue({
      diagrams: ['archguard/overview/package', 'archguard/class/all-classes'],
      outputDir: '/tmp/project/.archguard/output',
      updatedAt: '2026-03-07T00:00:00Z',
    });

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(cleanStaleDiagramsMock).toHaveBeenCalledTimes(1);
    expect(writeManifestMock).toHaveBeenCalledTimes(1);
  });
});

describe('runAnalysis — test analysis workspaceRoot (Fix 1: Java workspaceRoot)', () => {
  function makeArchJsonForLanguage(language: string, workspaceRoot: string): ArchJSON {
    return {
      version: '1.0',
      language: language as any,
      timestamp: '2026-03-13T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
      workspaceRoot,
    } as any;
  }

  it('passes archJson.workspaceRoot to TestAnalyzer for Java (not sessionRoot)', async () => {
    const externalRoot = '/some/external/java/project';
    const javaArchJson = makeArchJsonForLanguage('java', externalRoot);
    getLastArchJsonMock.mockReturnValue(javaArchJson);
    testAnalyzerAnalyzeMock.mockResolvedValue({ metrics: { totalTestFiles: 2 } });

    // Mock the Java plugin import
    vi.doMock('@/plugins/java/index.js', () => ({
      JavaPlugin: class {
        initialize = vi.fn().mockResolvedValue(undefined);
      },
    }));

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/home/archguard',
      workDir: '/home/archguard/.archguard',
      cliOptions: { includeTests: true },
      reporter: silentReporter(),
    });

    expect(testAnalyzerAnalyzeMock).toHaveBeenCalledWith(
      javaArchJson,
      expect.anything(),
      expect.objectContaining({ workspaceRoot: externalRoot })
    );
    // Must NOT use sessionRoot
    expect(testAnalyzerAnalyzeMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ workspaceRoot: '/home/archguard' })
    );
  });

  it('falls back to sessionRoot when archJson.workspaceRoot is undefined', async () => {
    const archJsonNoRoot: ArchJSON = {
      version: '1.0',
      language: 'java' as any,
      timestamp: '2026-03-13T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
    } as any;
    getLastArchJsonMock.mockReturnValue(archJsonNoRoot);
    testAnalyzerAnalyzeMock.mockResolvedValue({ metrics: { totalTestFiles: 0 } });

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/home/archguard',
      workDir: '/home/archguard/.archguard',
      cliOptions: { includeTests: true },
      reporter: silentReporter(),
    });

    expect(testAnalyzerAnalyzeMock).toHaveBeenCalledWith(
      archJsonNoRoot,
      expect.anything(),
      expect.objectContaining({ workspaceRoot: '/home/archguard' })
    );
  });
});

describe('runAnalysis — FIM integration', () => {
  it('computes and persists FIM artifacts when fim=true', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-03-30T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
      workspaceRoot: '/tmp/project',
    } as any;
    getLastArchJsonMock.mockReturnValue(archJson);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { fim: true },
      reporter: silentReporter(),
    });

    expect(computeImportApproximationFIMMock).toHaveBeenCalledWith(
      expect.objectContaining({ archJson, workspaceRoot: '/tmp/project' })
    );
    expect(writeFIMCurrentArtifactMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.objectContaining({ source: 'import-approximation' })
    );
    expect(appendFIMSnapshotMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.objectContaining({ source: 'import-approximation' })
    );
  });

  it('does not run FIM work when fim is not requested', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-03-30T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
      workspaceRoot: '/tmp/project',
    } as any;
    getLastArchJsonMock.mockReturnValue(archJson);

    const initialCallCount = computeImportApproximationFIMMock.mock.calls.length;
    const initialWriteCount = writeFIMCurrentArtifactMock.mock.calls.length;
    const initialSnapshotCount = appendFIMSnapshotMock.mock.calls.length;

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(computeImportApproximationFIMMock.mock.calls.length).toBe(initialCallCount);
    expect(writeFIMCurrentArtifactMock.mock.calls.length).toBe(initialWriteCount);
    expect(appendFIMSnapshotMock.mock.calls.length).toBe(initialSnapshotCount);
  });

  it('runs Mantel validation when fimValidate=true', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-03-30T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
      workspaceRoot: '/tmp/project',
    } as any;
    getLastArchJsonMock.mockReturnValue(archJson);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { fim: true, fimValidate: true },
      reporter: silentReporter(),
    });

    expect(readGitLogMock).toHaveBeenCalled();
    expect(validateFIMAgainstGitMock).toHaveBeenCalled();
    expect(writeFIMCurrentArtifactMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.objectContaining({
        mantel: expect.objectContaining({ isValidProxy: true }),
      })
    );
  });
});

function silentReporter() {
  return {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
}

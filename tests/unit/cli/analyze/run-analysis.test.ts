import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/cli/config-loader.js';
import type { DiagramResult } from '@/cli/processors/diagram-processor.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSON } from '@/types/index.js';

// In-memory fs-extra subset so arch-health-history.json writes can be observed.
const memFiles = vi.hoisted(() => new Map<string, unknown>());

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
const mergeProjectSemanticsIntoPatternConfigMock = vi.fn();
const testOutputWriterWriteMock = vi.fn();
const readGitLogMock = vi.fn();
const isGitRepoMock = vi.fn();
const getGitRootMock = vi.fn();
const loadProjectSemanticsSidecarMock = vi.fn();
const writeHistoryArtifactsMock = vi.fn();
const metricsAppendMock = vi.fn();

vi.mock('@/cli/config-loader.js', () => ({
  ConfigLoader: class {
    constructor(public configDir: string) {
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

vi.mock('@/cli/metrics-history-writer.js', () => ({
  MetricsHistoryWriter: class {
    append = metricsAppendMock;
  },
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
  mergeProjectSemanticsIntoPatternConfig: mergeProjectSemanticsIntoPatternConfigMock,
}));

vi.mock('@/cli/utils/test-output-writer.js', () => ({
  TestOutputWriter: class {
    write = testOutputWriterWriteMock;
  },
}));

vi.mock('@/cli/git-history/git-log-reader.js', () => ({
  readGitLogWindow: readGitLogMock,
  isGitRepo: isGitRepoMock,
  getGitRoot: getGitRootMock,
  getHeadRef: vi.fn(),
  getCurrentBranch: vi.fn(),
}));

vi.mock('@/cli/git-history/history-writer.js', () => ({
  writeHistoryArtifacts: writeHistoryArtifactsMock,
}));

vi.mock('@/analysis/project-semantics-loader.js', () => ({
  loadProjectSemanticsSidecar: loadProjectSemanticsSidecarMock,
}));

vi.mock('fs-extra', () => ({
  default: {
    outputJson: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn(async (p: string) => memFiles.has(p)),
    readJson: vi.fn(async (p: string) => memFiles.get(p)),
    writeJson: vi.fn(async (p: string, data: unknown) => {
      memFiles.set(p, JSON.parse(JSON.stringify(data)));
    }),
    rename: vi.fn(async (from: string, to: string) => {
      memFiles.set(to, memFiles.get(from));
      memFiles.delete(from);
    }),
    ensureDir: vi.fn().mockResolvedValue(undefined),
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
  projectSemantics: undefined,
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
    memFiles.clear();
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
    mergeProjectSemanticsIntoPatternConfigMock.mockReset();
    testOutputWriterWriteMock.mockReset();
    readGitLogMock.mockReset();
    isGitRepoMock.mockReset();
    getGitRootMock.mockReset();
    writeHistoryArtifactsMock.mockReset();
    writeHistoryArtifactsMock.mockResolvedValue(undefined);
    loadProjectSemanticsSidecarMock.mockReset();
    metricsAppendMock.mockReset();
    metricsAppendMock.mockResolvedValue(true);

    baseConfig.projectSemantics = undefined;
    loadMock.mockResolvedValue({
      ...baseConfig,
      mermaid: { ...baseConfig.mermaid },
      cli: { ...baseConfig.cli },
      cache: { ...baseConfig.cache },
      diagrams: [...baseConfig.diagrams],
      projectSemantics: undefined,
    });
    getLastArchJsonMock.mockReturnValue(null);
    generateTestCoverageHeatmapMock.mockResolvedValue(undefined);
    testAnalyzerAnalyzeMock.mockResolvedValue({ metrics: { totalTestFiles: 0 } });
    mergeProjectSemanticsIntoPatternConfigMock.mockImplementation(
      (_patternConfig, projectSemantics) => ({
        testFileGlobs: projectSemantics?.additionalTestPatterns ?? [],
        customAssertionRegexes: projectSemantics?.customAssertionPatterns ?? [],
      })
    );
    testOutputWriterWriteMock.mockResolvedValue(undefined);
    readGitLogMock.mockReturnValue({
      commits: [{ sha: 'abc', authorEmail: 'dev@example.com', date: '2026-03-30', files: [] }],
      windowStart: '2026-03-30',
      windowEnd: '2026-03-30',
      truncated: false,
    });
    isGitRepoMock.mockReturnValue(true);
    getGitRootMock.mockReturnValue('/tmp/project');
    loadProjectSemanticsSidecarMock.mockResolvedValue(undefined);
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
          version: '1.1',
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
      expect.objectContaining({
        outputDir: '/tmp/project/.archguard/output',
        workDir: '/tmp/project/.archguard',
      }),
      { sources: ['./src'] },
      '/tmp/project',
      expect.any(Function)
    );
    expect(persistQueryScopesMock).toHaveBeenCalledWith(
      '/tmp/project/.archguard',
      expect.any(Array),
      expect.objectContaining({ preferredGlobalScopeKey: undefined })
    );
    expect(result.persistedScopeKeys).toEqual(['abcd1234']);
  });

  it('carries the persisted scope entries on RunAnalysisResult', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { sources: ['./src'] },
      reporter: silentReporter(),
    });

    expect(result.persistedScopes).toEqual([persistedEntry]);
    expect(result.persistedScopes?.map((e) => e.key)).toEqual(result.persistedScopeKeys);
  });

  it('surfaces normalize warnings on the result and through the reporter', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    normalizeToDiagramsMock.mockImplementation(async (_c, _o, _r, onWarning) => {
      onWarning?.('sources ignored because config.diagrams is set');
      return [{ name: 'class/all-classes', sources: ['/tmp/project/src'], level: 'class' }];
    });
    const reporter = silentReporter();

    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: { sources: ['./src'] },
      reporter,
    });

    expect(result.warnings).toEqual(['sources ignored because config.diagrams is set']);
    expect(reporter.warn).toHaveBeenCalledWith('sources ignored because config.diagrams is set');
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
          version: '1.1',
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
          version: '1.1',
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

  it('merges sidecar architecturalLayers into config.projectSemantics', async () => {
    loadProjectSemanticsSidecarMock.mockResolvedValue({
      nonProductionPatterns: ['examples'],
      barrelFiles: [],
      additionalTestPatterns: [],
      customAssertionPatterns: [],
      architecturalLayers: {
        'src/analysis': 'Analysis',
        'src/cli': 'CLI',
      },
      suggestedDepth: 2,
    });

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(result.config.projectSemantics).toEqual(
      expect.objectContaining({
        architecturalLayers: {
          'src/analysis': 'Analysis',
          'src/cli': 'CLI',
        },
        suggestedDepth: 2,
      })
    );
  });

  it('uses defaults when neither config nor sidecar provides project semantics', async () => {
    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    const result = await runAnalysis({
      sessionRoot: '/tmp/project',
      workDir: '/tmp/project/.archguard',
      cliOptions: {},
      reporter: silentReporter(),
    });

    expect(result.config.projectSemantics).toEqual({
      version: '1.0',
      nonProductionPatterns: [],
      barrelFiles: [],
      additionalTestPatterns: [],
      customAssertionPatterns: [],
    });
  });

  it('fails startup when the sidecar semantics file is malformed', async () => {
    loadProjectSemanticsSidecarMock.mockRejectedValue(
      new Error('Invalid project-semantics.json: suggestedDepth must be a number')
    );

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

    await expect(
      runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: {},
        reporter: silentReporter(),
      })
    ).rejects.toThrow(/project-semantics\.json/);
  });

  describe('runAnalysis — metrics history snapshot', () => {
    function cyclicArchJson(): ArchJSON {
      const entity = (id: string, name: string) => ({
        id,
        name,
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: `${id}.ts`, startLine: 1, endLine: 2 },
      });
      return {
        version: '1.1',
        language: 'typescript',
        timestamp: '2026-03-13T00:00:00Z',
        sourceFiles: [],
        entities: [entity('pkgA.A', 'A'), entity('pkgB.B', 'B'), entity('pkgC.C', 'C')],
        relations: [
          { id: 'r1', type: 'dependency', source: 'pkgA.A', target: 'pkgB.B' },
          { id: 'r2', type: 'dependency', source: 'pkgB.B', target: 'pkgA.A' },
          { id: 'r3', type: 'dependency', source: 'pkgC.C', target: 'pkgA.A' },
        ],
      } as any;
    }

    async function run(): Promise<void> {
      const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
      await runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: {},
        reporter: silentReporter(),
      });
    }

    it('records a positive cycleCount for packages in an A<->B cycle', async () => {
      const archJson = cyclicArchJson();
      getLastArchJsonMock.mockReturnValue(archJson);

      await run();

      expect(metricsAppendMock).toHaveBeenCalledTimes(1);
      const [packages] = metricsAppendMock.mock.calls[0];
      const byName = new Map(packages.map((p: any) => [p.name, p]));
      expect((byName.get('pkgA') as any).cycleCount).toBeGreaterThan(0);
      expect((byName.get('pkgB') as any).cycleCount).toBeGreaterThan(0);
      expect((byName.get('pkgC') as any).cycleCount).toBe(0);
    });

    it('records the scope key and sources of the scope that produced the ArchJSON', async () => {
      const archJson = cyclicArchJson();
      getLastArchJsonMock.mockReturnValue(archJson);
      getQuerySourceGroupsMock.mockReturnValue([
        {
          key: 'other',
          sources: ['/tmp/project/other'],
          kind: 'parsed',
          archJson: { ...archJson },
        },
        { key: 'mainKey', sources: ['/tmp/project/src'], kind: 'parsed', archJson },
      ]);

      await run();

      expect(metricsAppendMock.mock.calls[0][2]).toEqual({
        scopeKey: 'mainKey',
        sources: ['/tmp/project/src'],
      });
    });
  });

  describe('git history keyRoot / pathFilters (TASK-95)', () => {
    const commit = (files: string[]) => ({
      sha: 'abcdef1234',
      authorEmail: 'dev@example.com',
      date: '2026-03-30',
      files: files.map((path) => ({ path, added: 1, deleted: 0 })),
    });

    async function runGit(sources: string[][]) {
      normalizeToDiagramsMock.mockResolvedValue(
        sources.map((s, i) => ({ name: `d${i}`, sources: s, level: 'class' }))
      );
      const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
      await runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: { includeGit: true },
        reporter: silentReporter(),
      });
      expect(writeHistoryArtifactsMock).toHaveBeenCalledTimes(1);
      return writeHistoryArtifactsMock.mock.calls[0][1] as {
        manifest: { keyRoot: string; pathFilters: string[] };
        fileMetrics: Array<{ path: string; packagePath: string }>;
      };
    }

    function archJsonWithRoot(workspaceRoot: string): ArchJSON {
      return {
        version: '1.1',
        language: 'typescript',
        timestamp: '2026-03-07T00:00:00Z',
        sourceFiles: [],
        entities: [],
        relations: [],
        workspaceRoot,
      } as ArchJSON;
    }

    it('single source: keyRoot is the source path relative to the git root', async () => {
      readGitLogMock.mockReturnValue({
        commits: [commit(['src/a.ts'])],
        windowStart: '2026-03-30',
        windowEnd: '2026-03-30',
        truncated: false,
      });
      const artifacts = await runGit([['/tmp/project/src']]);

      expect(artifacts.manifest.keyRoot).toBe('src');
      expect(artifacts.manifest.pathFilters).toEqual(['src']);
      expect(readGitLogMock).toHaveBeenCalledWith(
        '/tmp/project',
        expect.objectContaining({ pathFilter: ['src'] })
      );
      expect(artifacts.fileMetrics.map((f) => f.path)).toEqual(['a.ts']);
    });

    it('multiple sources: keyRoot is their nearest common ancestor, independent of the last ArchJSON', async () => {
      readGitLogMock.mockReturnValue({
        commits: [commit(['pkgs/a/x.ts', 'pkgs/b/y.ts'])],
        windowStart: '2026-03-30',
        windowEnd: '2026-03-30',
        truncated: false,
      });
      const sources = [['/tmp/project/pkgs/a'], ['/tmp/project/pkgs/b']];

      // whichever scope "wins" as last ArchJSON must not change keyRoot
      getLastArchJsonMock.mockReturnValue(archJsonWithRoot('/tmp/project/pkgs/a'));
      const first = await runGit(sources);
      writeHistoryArtifactsMock.mockClear();
      getLastArchJsonMock.mockReturnValue(archJsonWithRoot('/tmp/project/pkgs/b'));
      const second = await runGit(sources);

      for (const a of [first, second]) {
        expect(a.manifest.keyRoot).toBe('pkgs');
        expect(a.manifest.pathFilters).toEqual(['pkgs/a', 'pkgs/b']);
        expect(a.fileMetrics.map((f) => f.path).sort()).toEqual(['a/x.ts', 'b/y.ts']);
      }
      expect(readGitLogMock).toHaveBeenCalledWith(
        '/tmp/project',
        expect.objectContaining({ pathFilter: ['pkgs/a', 'pkgs/b'] })
      );
    });

    it('monorepo sources plugin/ + packages/: keyRoot is the repo root and keys are repo-relative', async () => {
      readGitLogMock.mockReturnValue({
        commits: [commit(['plugin/scripts/driver-runtime.ts', 'packages/core/index.ts'])],
        windowStart: '2026-03-30',
        windowEnd: '2026-03-30',
        truncated: false,
      });
      const artifacts = await runGit([['/tmp/project/plugin'], ['/tmp/project/packages']]);

      expect(artifacts.manifest.keyRoot).toBe('');
      expect(artifacts.manifest.pathFilters).toEqual(['packages', 'plugin']);
      expect(artifacts.fileMetrics.map((f) => f.path).sort()).toEqual([
        'packages/core/index.ts',
        'plugin/scripts/driver-runtime.ts',
      ]);
      expect(artifacts.fileMetrics.map((f) => f.packagePath).sort()).toEqual([
        'packages',
        'plugin',
      ]);
    });

    it('source at the git root collects everything (no pathspec)', async () => {
      readGitLogMock.mockReturnValue({
        commits: [commit(['a.ts'])],
        windowStart: '2026-03-30',
        windowEnd: '2026-03-30',
        truncated: false,
      });
      const artifacts = await runGit([['/tmp/project']]);

      expect(artifacts.manifest.keyRoot).toBe('');
      expect(artifacts.manifest.pathFilters).toEqual(['']);
      expect(readGitLogMock).toHaveBeenCalledWith(
        '/tmp/project',
        expect.objectContaining({ pathFilter: undefined })
      );
    });
  });
});

describe('runAnalysis — test analysis workspaceRoot (Fix 1: Java workspaceRoot)', () => {
  beforeEach(() => {
    loadProjectSemanticsSidecarMock.mockReset();
    loadProjectSemanticsSidecarMock.mockResolvedValue(undefined);
  });

  function makeArchJsonForLanguage(language: string, workspaceRoot: string): ArchJSON {
    return {
      version: '1.1',
      language: language as any,
      timestamp: '2026-03-13T00:00:00Z',
      sourceFiles: [],
      entities: [],
      relations: [],
      workspaceRoot,
    } as any;
  }

  it('uses sessionRoot as test-discovery root for Java multi-module (not archJson.workspaceRoot)', async () => {
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

    // Test discovery must scan the project root (sessionRoot), NOT the first module
    // source (archJson.workspaceRoot) — otherwise other modules' src/test are missed.
    expect(testAnalyzerAnalyzeMock).toHaveBeenCalledWith(
      javaArchJson,
      expect.anything(),
      expect.objectContaining({ workspaceRoot: '/home/archguard' })
    );
    expect(testAnalyzerAnalyzeMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ workspaceRoot: externalRoot })
    );
  });

  it('falls back to sessionRoot when archJson.workspaceRoot is undefined', async () => {
    const archJsonNoRoot: ArchJSON = {
      version: '1.1',
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

  describe('arch-health (TASK-97)', () => {
    const HISTORY_PATH = '/tmp/project/.archguard/arch-health-history.json';
    const healthArchJson: ArchJSON = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-03-07T00:00:00Z',
      sourceFiles: [],
      entities: ['A', 'B', 'C'].map((id) => ({
        id,
        name: id,
        type: 'class' as const,
        visibility: 'public' as const,
        members: [],
        sourceLocation: { file: `${id}.ts`, startLine: 1, endLine: 1 },
      })),
      relations: [
        { id: 'r1', type: 'dependency' as const, source: 'A', target: 'B' },
        { id: 'r2', type: 'dependency' as const, source: 'B', target: 'C' },
      ],
    };

    beforeEach(() => {
      memFiles.clear();
      getLastArchJsonMock.mockReturnValue(healthArchJson);
      getQuerySourceGroupsMock.mockReturnValue([
        {
          key: 'abcd1234',
          sources: ['/tmp/project/src'],
          kind: 'parsed',
          role: 'primary',
          archJson: healthArchJson,
        },
      ]);
    });

    it('archHealth=true writes one scope-tagged snapshot to arch-health-history.json', async () => {
      const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

      const result = await runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: { sources: ['./src'], archHealth: true },
        reporter: silentReporter(),
      });

      const history = memFiles.get(HISTORY_PATH) as {
        schemaVersion: number;
        snapshots: Array<Record<string, unknown>>;
      };
      expect(history.schemaVersion).toBe(1);
      expect(history.snapshots).toHaveLength(1);
      expect(history.snapshots[0]).toMatchObject({
        entityCount: 3,
        entityIndex: ['A', 'B', 'C'],
        scopeKey: 'abcd1234',
        sources: ['/tmp/project/src'],
      });
      expect(result.archHealth?.persisted).toBe(true);
    });

    it('archHealth unset → no history file is written', async () => {
      const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

      const result = await runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: { sources: ['./src'] },
        reporter: silentReporter(),
      });

      expect(memFiles.has(HISTORY_PATH)).toBe(false);
      expect(result.archHealth).toBeUndefined();
    });

    it('archHealth=true without ArchJSON → nothing written, no throw', async () => {
      getLastArchJsonMock.mockReturnValue(null);
      const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');

      const result = await runAnalysis({
        sessionRoot: '/tmp/project',
        workDir: '/tmp/project/.archguard',
        cliOptions: { sources: ['./src'], archHealth: true },
        reporter: silentReporter(),
      });

      expect(memFiles.has(HISTORY_PATH)).toBe(false);
      expect(result.archHealth).toBeUndefined();
    });
  });
});

describe('runAnalysis — testSources (tests outside the analyzed source root)', () => {
  beforeEach(() => {
    loadProjectSemanticsSidecarMock.mockReset();
    loadProjectSemanticsSidecarMock.mockResolvedValue(undefined);
    testAnalyzerAnalyzeMock.mockReset();
    testAnalyzerAnalyzeMock.mockResolvedValue({ metrics: { totalTestFiles: 3 } });
  });

  const archJson = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-03-13T00:00:00Z',
    sourceFiles: [],
    entities: [],
    relations: [],
    workspaceRoot: '/repo/plugin/scripts',
  } as any;

  it('hands a sibling test directory to the test analyzer as an absolute testSource', async () => {
    getLastArchJsonMock.mockReturnValue(archJson);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/repo',
      workDir: '/repo/.archguard',
      cliOptions: { includeTests: true, testSources: ['plugin/test', '/elsewhere/tests'] },
      reporter: silentReporter(),
    });

    expect(testAnalyzerAnalyzeMock).toHaveBeenCalledWith(
      archJson,
      expect.anything(),
      expect.objectContaining({
        workspaceRoot: '/repo/plugin/scripts',
        testSources: ['/repo/plugin/test', '/elsewhere/tests'],
      })
    );
  });

  it('passes no testSources by default (inference unchanged)', async () => {
    getLastArchJsonMock.mockReturnValue(archJson);

    const { runAnalysis } = await import('@/cli/analyze/run-analysis.js');
    await runAnalysis({
      sessionRoot: '/repo',
      workDir: '/repo/.archguard',
      cliOptions: { includeTests: true },
      reporter: silentReporter(),
    });

    const options = testAnalyzerAnalyzeMock.mock.calls[0][2];
    expect(options.testSources).toBeUndefined();
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

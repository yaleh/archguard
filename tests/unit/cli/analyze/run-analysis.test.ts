import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/cli/config-loader.js';
import type { DiagramResult } from '@/cli/processors/diagram-processor.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

const loadMock = vi.fn();
const normalizeToDiagramsMock = vi.fn();
const readManifestMock = vi.fn();
const cleanStaleDiagramsMock = vi.fn();
const writeManifestMock = vi.fn();
const persistQueryScopesMock = vi.fn();
const processAllMock = vi.fn();
const getQuerySourceGroupsMock = vi.fn();
const indexGenerateMock = vi.fn();
const diagramProcessorCtorMock = vi.fn();

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
    indexGenerateMock.mockReset();
    diagramProcessorCtorMock.mockReset();

    loadMock.mockResolvedValue(baseConfig);
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

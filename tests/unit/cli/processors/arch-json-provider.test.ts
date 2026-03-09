/**
 * Unit tests for ArchJsonProvider
 *
 * Covers:
 * - Memory cache hit (no re-parse)
 * - Language routing: Go, C++, Python/Java plugin path, TypeScript Plugin (Path A), ParallelParser (Path B)
 * - Disk cache hits for Path A and Path B
 * - Parent-coverage derivation
 * - files.length === 0 error path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchJsonProvider } from '@/cli/processors/arch-json-provider.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';

// ---- Module mocks ----------------------------------------------------------

vi.mock('@/cli/utils/file-discovery-service.js');
vi.mock('@/parser/parallel-parser.js');
vi.mock('@/plugins/golang/source-scope.js', () => ({
  planGoAnalysisScope: vi.fn().mockResolvedValue({
    workspaceRoot: '/project',
    includePatterns: ['src/**/*.go'],
    excludePatterns: [],
  }),
}));
vi.mock('@/cli/cache/arch-json-disk-cache.js', () => ({
  ArchJsonDiskCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    computeKey: vi.fn().mockResolvedValue('mock-disk-key'),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---- Helpers ---------------------------------------------------------------

const makeArchJSON = (override: Partial<ArchJSON> = {}): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: '',
  sourceFiles: ['test.ts'],
  entities: [
    {
      id: 'Test',
      name: 'Test',
      type: 'class',
      visibility: 'public',
      members: [],
      sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
    },
  ],
  relations: [],
  ...override,
});

const makeGlobalConfig = (override: Partial<GlobalConfig> = {}): GlobalConfig => ({
  outputDir: './.archguard',
  format: 'mermaid',
  exclude: [],
  cli: { command: 'claude', args: [], timeout: 180000 },
  cache: { enabled: true, ttl: 3600 },
  concurrency: 4,
  verbose: false,
  ...override,
});

const makeDiagram = (override: Partial<DiagramConfig> = {}): DiagramConfig => ({
  name: 'test',
  sources: ['/project/src'],
  level: 'class',
  ...override,
});

// ---- Tests -----------------------------------------------------------------

describe('ArchJsonProvider', () => {
  let FileDiscoveryService: any;
  let ParallelParser: any;
  let ArchJsonDiskCache: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js'));
    ({ ParallelParser } = await import('@/parser/parallel-parser.js'));
    ({ ArchJsonDiskCache } = await import('@/cli/cache/arch-json-disk-cache.js'));
  });

  // ---- 1. Memory cache hit -------------------------------------------------

  it('returns cached archJson on second call without parsing', async () => {
    const archJson = makeArchJSON();
    const mockParseFiles = vi.fn().mockResolvedValue(archJson);
    ParallelParser.mockImplementation(() => ({ parseFiles: mockParseFiles }));
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue(['/src/a.ts']),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram();

    const result1 = await provider.get(diagram, { needsModuleGraph: false });
    const result2 = await provider.get(diagram, { needsModuleGraph: false });

    expect(result1.archJson).toBe(result2.archJson);
    // parseFiles called only once
    expect(mockParseFiles).toHaveBeenCalledTimes(1);
    expect(provider.cacheSize()).toBe(1);
  });

  // ---- 2. Go path ----------------------------------------------------------

  it('routes go language to parseGoProject (dynamic import fallback)', async () => {
    const goArchJson = makeArchJSON({ language: 'go' });
    const mockParseProject = vi.fn().mockResolvedValue(goArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/plugins/golang/atlas/index.js', () => ({
      GoAtlasPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ language: 'go' });

    const { archJson, kind } = await provider.get(diagram, { needsModuleGraph: false });

    expect(kind).toBe('parsed');
    expect(archJson.language).toBe('go');
    expect(provider.cacheSize()).toBe(1);

    vi.doUnmock('@/plugins/golang/atlas/index.js');
  });

  // ---- 3. C++ with no parent → parseCppProject ----------------------------

  it('routes cpp language to parseCppProject when no parent', async () => {
    const cppArchJson = makeArchJSON({ language: 'cpp' });
    const mockParseProject = vi.fn().mockResolvedValue(cppArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/plugins/cpp/index.js', () => ({
      CppPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ language: 'cpp', sources: ['/project/src'] });

    const { archJson, kind } = await provider.get(diagram, { needsModuleGraph: false });

    expect(kind).toBe('parsed');
    expect(archJson.language).toBe('cpp');
    expect(provider.cacheSize()).toBe(1);

    vi.doUnmock('@/plugins/cpp/index.js');
  });

  // ---- 4. C++ derived from parent -----------------------------------------

  it('derives cpp sub-module from parent', async () => {
    const parentArchJson = makeArchJSON({
      language: 'cpp',
      entities: [
        {
          id: 'src.A',
          name: 'A',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/project/src/a.h', startLine: 1, endLine: 5 },
        },
        {
          id: 'lib.B',
          name: 'B',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/project/lib/b.h', startLine: 1, endLine: 5 },
        },
      ],
      relations: [{ source: 'src.A', target: 'lib.B', type: 'dependency' }],
    });

    const mockParseProject = vi.fn().mockResolvedValue(parentArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/plugins/cpp/index.js', () => ({
      CppPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });

    // First: parse the parent (root)
    const rootDiagram = makeDiagram({ language: 'cpp', sources: ['/project'] });
    await provider.get(rootDiagram, { needsModuleGraph: false });

    // Second: derive sub-module
    const subDiagram = makeDiagram({ language: 'cpp', sources: ['/project/src'] });
    const { archJson: derived, kind } = await provider.get(subDiagram, { needsModuleGraph: false });

    expect(kind).toBe('derived');
    // src.A is in sub-module; lib.B becomes a stub
    const entityIds = derived.entities.map((e) => e.id);
    expect(entityIds).toContain('src.A');
    // parseProject called only once (for root)
    expect(mockParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/cpp/index.js');
  });

  // ---- 5. TS + needsModuleGraph=true + no language → parseTsPlugin --------

  it('routes typescript with needsModuleGraph=true and no language to parseTsPlugin', async () => {
    const tsArchJson = makeArchJSON();
    const mockParseProject = vi.fn().mockResolvedValue(tsArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/a.ts', '/src/b.ts']);

    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    vi.doMock('@/plugins/typescript/index.js', () => ({
      TypeScriptPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ level: 'package' }); // no language field

    const { kind } = await provider.get(diagram, { needsModuleGraph: true });

    expect(kind).toBe('parsed');
    expect(mockParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/typescript/index.js');
  });

  // ---- 6. TS + needsModuleGraph=true + language='typescript' → parseTsPlugin

  it("routes language='typescript' with needsModuleGraph=true to parseTsPlugin", async () => {
    const tsArchJson = makeArchJSON();
    const mockParseProject = vi.fn().mockResolvedValue(tsArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/a.ts']);

    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    vi.doMock('@/plugins/typescript/index.js', () => ({
      TypeScriptPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ language: 'typescript', level: 'package' });

    const { kind } = await provider.get(diagram, { needsModuleGraph: true });

    expect(kind).toBe('parsed');
    expect(mockParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/typescript/index.js');
  });

  // ---- 7. explicit non-TS plugin languages use plugin routing -------------

  it('routes java language with needsModuleGraph=true to the Java plugin', async () => {
    const javaArchJson = makeArchJSON({ language: 'java' });
    const mockParseProject = vi.fn().mockResolvedValue(javaArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/plugins/java/index.js', () => ({
      JavaPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ language: 'java', level: 'package' });

    const { kind } = await provider.get(diagram, { needsModuleGraph: true });

    expect(kind).toBe('parsed');
    expect(mockParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/java/index.js');
  });

  it('routes python language to the Python plugin', async () => {
    const pythonArchJson = makeArchJSON({ language: 'python' });
    const mockParseProject = vi.fn().mockResolvedValue(pythonArchJson);
    const mockInitialize = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/plugins/python/index.js', () => ({
      PythonPlugin: vi.fn().mockImplementation(() => ({
        initialize: mockInitialize,
        parseProject: mockParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ language: 'python', level: 'class' });

    const { kind } = await provider.get(diagram, { needsModuleGraph: false });

    expect(kind).toBe('parsed');
    expect(mockParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/python/index.js');
  });

  it('does not reuse cache entries across different languages on the same source root', async () => {
    const cppArchJson = makeArchJSON({ language: 'cpp' });
    const pythonArchJson = makeArchJSON({ language: 'python' });
    const mockCppParseProject = vi.fn().mockResolvedValue(cppArchJson);
    const mockPythonParseProject = vi.fn().mockResolvedValue(pythonArchJson);

    vi.doMock('@/plugins/cpp/index.js', () => ({
      CppPlugin: vi.fn().mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        parseProject: mockCppParseProject,
      })),
    }));
    vi.doMock('@/plugins/python/index.js', () => ({
      PythonPlugin: vi.fn().mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        parseProject: mockPythonParseProject,
      })),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    await provider.get(makeDiagram({ language: 'cpp', sources: ['/project'] }), {
      needsModuleGraph: false,
    });
    await provider.get(makeDiagram({ language: 'python', sources: ['/project'] }), {
      needsModuleGraph: false,
    });

    expect(mockCppParseProject).toHaveBeenCalledTimes(1);
    expect(mockPythonParseProject).toHaveBeenCalledTimes(1);

    vi.doUnmock('@/plugins/cpp/index.js');
    vi.doUnmock('@/plugins/python/index.js');
  });

  // ---- 8. TS + needsModuleGraph=false → ParallelParser path ---------------

  it('routes to ParallelParser when needsModuleGraph=false', async () => {
    const archJson = makeArchJSON();
    const mockParseFiles = vi.fn().mockResolvedValue(archJson);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/a.ts']);

    ParallelParser.mockImplementation(() => ({ parseFiles: mockParseFiles }));
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram();

    const { kind } = await provider.get(diagram, { needsModuleGraph: false });

    expect(kind).toBe('parsed');
    expect(mockParseFiles).toHaveBeenCalledTimes(1);
  });

  // ---- 9. Path A disk cache hit → populates memory cache -----------------

  it('path A disk cache hit populates memory cache for sub-group derivation', async () => {
    const cachedArchJson = makeArchJSON();
    const mockDiskGet = vi.fn().mockResolvedValue(cachedArchJson);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/a.ts']);

    ArchJsonDiskCache.mockImplementation(() => ({
      get: mockDiskGet,
      set: vi.fn().mockResolvedValue(undefined),
      computeKey: vi.fn().mockResolvedValue('disk-key-A'),
    }));
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram({ level: 'package' });

    // Need a fresh provider instance using the updated mock
    const { archJson, kind } = await provider.get(diagram, { needsModuleGraph: true });

    expect(kind).toBe('parsed');
    expect(archJson).toBe(cachedArchJson);
    // Path A disk hit must call cacheArchJson so sub-groups can derive from it
    expect(provider.cacheSize()).toBe(1);
  });

  // ---- 9a. Path A disk cache hit enables sub-group derivation -------------

  it('path A disk cache hit enables sub-group derivation via path index', async () => {
    // Build a parent ArchJSON whose entity id encodes the sub-path
    const parentEntity = {
      id: 'src/sub/module.ts.SubClass',
      name: 'SubClass',
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: 'src/sub/module.ts', startLine: 1, endLine: 10 },
    };
    const cachedArchJson = makeArchJSON({ entities: [parentEntity] });

    const mockDiskGet = vi.fn().mockResolvedValue(cachedArchJson);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/project/src/sub/module.ts']);

    ArchJsonDiskCache.mockImplementation(() => ({
      get: mockDiskGet,
      set: vi.fn().mockResolvedValue(undefined),
      computeKey: vi.fn().mockResolvedValue('disk-key-A'),
    }));
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });

    // Step 1: Path A disk cache hit for parent sources ['/project/src']
    const parentDiagram = makeDiagram({ sources: ['/project/src'], level: 'package' });
    await provider.get(parentDiagram, { needsModuleGraph: true });

    // Step 2: sub-group sources ['/project/src/sub'] should derive from parent
    const subDiagram = makeDiagram({ sources: ['/project/src/sub'], level: 'method' });
    const { kind } = await provider.get(subDiagram, { needsModuleGraph: false });

    // Should derive (not parse independently)
    expect(kind).toBe('derived');
  });

  // ---- 10. Path B disk cache hit → cacheSize increments -------------------

  it('path B disk cache hit populates memory cache (cacheSize becomes 1)', async () => {
    const cachedArchJson = makeArchJSON();
    const mockDiskGet = vi.fn().mockResolvedValue(cachedArchJson);
    const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/a.ts']);

    ArchJsonDiskCache.mockImplementation(() => ({
      get: mockDiskGet,
      set: vi.fn().mockResolvedValue(undefined),
      computeKey: vi.fn().mockResolvedValue('disk-key-B'),
    }));
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: mockDiscoverFiles,
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram(); // level='class', needsModuleGraph=false → Path B

    const { archJson, kind } = await provider.get(diagram, { needsModuleGraph: false });

    expect(kind).toBe('parsed');
    expect(archJson).toBe(cachedArchJson);
    // Path B calls cacheArchJson; memory cache should have 1 entry
    expect(provider.cacheSize()).toBe(1);
  });

  // ---- 11. files.length === 0 with no parent → throws ---------------------

  it('throws when no files found and no parent coverage', async () => {
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue([]),
    }));
    ArchJsonDiskCache.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      computeKey: vi.fn().mockResolvedValue('key'),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });
    const diagram = makeDiagram();

    await expect(provider.get(diagram, { needsModuleGraph: false })).rejects.toThrow(
      'No TypeScript files found in sources'
    );
  });

  // ---- 12. files.length === 0 with parent → derives successfully ----------

  it('derives from parent when files array is empty for sub-path (Path B)', async () => {
    const parentArchJson = makeArchJSON({
      entities: [
        {
          id: 'Test',
          name: 'Test',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/project/src/test.ts', startLine: 1, endLine: 10 },
        },
      ],
    });
    const mockParseFiles = vi.fn().mockResolvedValue(parentArchJson);

    // Parent gets files; sub-path gets empty
    let callCount = 0;
    FileDiscoveryService.mockImplementation(() => ({
      discoverFiles: vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? ['/project/src/test.ts'] : [];
      }),
    }));
    ParallelParser.mockImplementation(() => ({ parseFiles: mockParseFiles }));
    ArchJsonDiskCache.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      computeKey: vi.fn().mockResolvedValue('key'),
    }));

    const provider = new ArchJsonProvider({ globalConfig: makeGlobalConfig() });

    // Parse parent first (sources: ['/project/src'])
    const parentDiagram = makeDiagram({ sources: ['/project/src'] });
    await provider.get(parentDiagram, { needsModuleGraph: false });

    // Now get sub-path — no files but parent covers it
    const subDiagram = makeDiagram({ sources: ['/project/src/sub'] });
    const { kind } = await provider.get(subDiagram, { needsModuleGraph: false });

    expect(kind).toBe('derived');
    // parseFiles still called only once (for the parent)
    expect(mockParseFiles).toHaveBeenCalledTimes(1);
  });
});

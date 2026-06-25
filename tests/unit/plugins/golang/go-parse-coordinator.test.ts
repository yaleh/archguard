import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoParseCoordinator } from '@/plugins/golang/go-parse-coordinator.js';
import { GoplsInterfaceResolver } from '@/plugins/golang/gopls-interface-resolver.js';

vi.mock('glob', () => ({ glob: vi.fn() }));
vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('package foo'),
    existsSync: vi.fn().mockReturnValue(false),
  },
}));
vi.mock('@/plugins/golang/tree-sitter-bridge.js', () => ({
  TreeSitterBridge: vi.fn().mockImplementation(() => ({
    parseCode: vi.fn().mockReturnValue({
      name: 'foo',
      fullName: '',
      id: '',
      dirPath: '',
      sourceFiles: [],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    }),
  })),
}));
vi.mock('@/plugins/golang/archjson-mapper.js', () => ({
  ArchJsonMapper: vi.fn().mockImplementation(() => ({
    mapEntities: vi.fn().mockReturnValue([{ id: 'foo.Foo', name: 'Foo', type: 'class' }]),
    mapRelations: vi.fn().mockReturnValue([]),
    mapMissingInterfaceEntities: vi.fn().mockReturnValue([]),
    mapCallRelations: vi.fn().mockReturnValue([]),
  })),
}));
vi.mock('@/plugins/golang/gopls-interface-resolver.js', () => ({
  GoplsInterfaceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn().mockResolvedValue([]),
    resolveSync: vi.fn().mockReturnValue([]),
    initialize: vi.fn(),
    dispose: vi.fn(),
    isGoplsAvailable: vi.fn().mockReturnValue(false),
  })),
}));
vi.mock('@/plugins/golang/go-mod-reader.js', () => ({
  readModuleName: vi.fn().mockResolvedValue('github.com/test/mod'),
}));

describe('GoParseCoordinator', () => {
  let coordinator: GoParseCoordinator;
  let resolver: GoplsInterfaceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new GoplsInterfaceResolver();
    coordinator = new GoParseCoordinator(resolver);
  });

  it('parseToRawData returns empty packages when no files found', async () => {
    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue([] as any);
    const result = await coordinator.parseToRawData('/ws', { workspaceRoot: '/ws' });
    expect(result.packages).toEqual([]);
    expect(result.moduleName).toBe('github.com/test/mod');
  });

  it('buildArchJson returns non-empty entities and relations arrays', async () => {
    const rawData = {
      packages: [
        {
          name: 'foo',
          fullName: 'foo',
          id: 'foo',
          dirPath: '/ws',
          sourceFiles: ['/ws/foo.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [],
        },
      ],
      moduleRoot: '/ws',
      moduleName: 'github.com/test/mod',
    };
    const result = await coordinator.buildArchJson(rawData, '/ws');
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.relations)).toBe(true);
  });

  it('parseToRawData merges packages by fullName', async () => {
    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue(['/ws/pkg/a.go', '/ws/pkg/b.go'] as any);
    const result = await coordinator.parseToRawData('/ws', { workspaceRoot: '/ws' });
    expect(result.packages.length).toBe(1);
    expect(result.packages[0].fullName).toBe('pkg');
  });

  it('empty file list returns empty packages', async () => {
    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue([] as any);
    const result = await coordinator.parseToRawData('/ws', { workspaceRoot: '/ws' });
    expect(result.packages).toHaveLength(0);
  });
});

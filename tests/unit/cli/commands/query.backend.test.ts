/**
 * Unit tests for the query command's backend selection (TASK-22.4).
 *
 * Covers:
 *   - Phase A: --backend / --cbm-project parsing + default-unchanged behavior.
 *     With no --backend, the command must use the ArchGuard engine path and
 *     never touch the Codebase Memory adapter.
 *   - Phase B: codebase-memory / auto fallback wiring + provenance footer.
 *
 * The Codebase Memory adapter is mocked so these tests never spawn a
 * subprocess or depend on the external binary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entity, Relation, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';

// Mock engine-loader before importing the command.
vi.mock('@/cli/query/engine-loader.js', () => ({
  resolveArchDir: vi.fn((dir?: string) => dir ?? '.archguard'),
  loadEngine: vi.fn(),
  readManifest: vi.fn(),
}));

// Mock the backend factory so we control adapter behavior without subprocess.
vi.mock('@/cli/query/query-backend.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/cli/query/query-backend.js')>();
  return {
    ...actual,
    createCodebaseMemoryAdapter: vi.fn(),
  };
});

import { createQueryCommand, resolveQueryBackend } from '@/cli/commands/query.js';
import { resolveArchDir, loadEngine } from '@/cli/query/engine-loader.js';
import { createCodebaseMemoryAdapter } from '@/cli/query/query-backend.js';

// -- Fixtures --

function makeEntity(
  id: string,
  name: string,
  type: string = 'class',
  file: string = 'src/foo.ts'
): Entity {
  return {
    id,
    name,
    type,
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

const entities: Entity[] = [
  makeEntity('cm', 'CacheManager', 'class', 'src/cache.ts'),
  makeEntity('dp', 'DiagramProcessor', 'class', 'src/processor.ts'),
];

const relations: Relation[] = [{ id: 'dp->cm', source: 'dp', target: 'cm', type: 'dependency' }];

const parsedScope: QueryScopeEntry = {
  key: 'abc123',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 2,
  relationCount: 1,
  hasAtlasExtension: false,
};

function makeArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
  };
}

function createTestEngine(scope: QueryScopeEntry = parsedScope): QueryEngine {
  const archJson = makeArchJson();
  const archIndex = buildArchIndex(archJson, 'testhash');
  return new QueryEngine({ archJson, archIndex, scopeEntry: scope });
}

function wrapEngine(engine: QueryEngine, scope: QueryScopeEntry = parsedScope) {
  return {
    engine,
    extensionAccessor: {} as any,
    scopeEntry: scope,
    relationQueryService: engine.relationQueryService,
  };
}

/** Build a mock adapter exposing only the methods query.ts uses. */
function mockAdapter(overrides: Record<string, any> = {}) {
  return {
    findEntity: vi.fn(),
    getFileEntities: vi.fn(),
    findCallers: vi.fn(),
    getArchitecture: vi.fn(),
    ...overrides,
  };
}

// -- Console / exit capture --

let consoleOutput: string[];
let consoleErrorOutput: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalExit: typeof process.exit;

beforeEach(() => {
  consoleOutput = [];
  consoleErrorOutput = [];
  originalLog = console.log;
  originalError = console.error;
  originalExit = process.exit;

  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    consoleErrorOutput.push(args.map(String).join(' '));
  };
  process.exit = vi.fn() as unknown as typeof process.exit;

  vi.mocked(resolveArchDir).mockClear();
  vi.mocked(loadEngine).mockClear();
  vi.mocked(createCodebaseMemoryAdapter).mockReset();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
});

async function runQuery(...args: string[]): Promise<void> {
  const cmd = createQueryCommand();
  await cmd.parseAsync(['node', 'query', ...args]);
}

// ===========================================================================
// Phase A: option parsing + default unchanged
// ===========================================================================

describe('query backend options', () => {
  it('registers --backend and --cbm-project', () => {
    const cmd = createQueryCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--backend');
    expect(optionNames).toContain('--cbm-project');
  });
});

describe('resolveQueryBackend precedence', () => {
  it('defaults to archguard when nothing is specified', () => {
    expect(resolveQueryBackend(undefined, undefined)).toBe('archguard');
  });

  it('uses config primary when no explicit flag', () => {
    expect(resolveQueryBackend(undefined, { primary: 'auto' })).toBe('auto');
    expect(resolveQueryBackend(undefined, { primary: 'codebase-memory' })).toBe('codebase-memory');
  });

  it('explicit flag overrides config', () => {
    expect(resolveQueryBackend('archguard', { primary: 'codebase-memory' })).toBe('archguard');
    expect(resolveQueryBackend('codebase-memory', { primary: 'archguard' })).toBe(
      'codebase-memory'
    );
  });

  it('rejects an invalid backend value', () => {
    expect(() => resolveQueryBackend('nope' as any, undefined)).toThrow(/Invalid --backend/);
  });
});

describe('default backend (no --backend) preserves ArchGuard path', () => {
  it('--entity uses the engine and never builds the adapter', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--entity', 'CacheManager');

    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(loadEngine).toHaveBeenCalledTimes(1);
    expect(createCodebaseMemoryAdapter).not.toHaveBeenCalled();
    // No provenance footer for the default backend.
    expect(output).not.toContain('Backend:');
  });

  it('--summary uses the engine and never builds the adapter', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--summary');

    const output = consoleOutput.join('\n');
    expect(output).toContain('Scope Summary');
    expect(createCodebaseMemoryAdapter).not.toHaveBeenCalled();
  });

  it('explicit --backend archguard also stays on the engine path', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    await runQuery('--entity', 'CacheManager', '--backend', 'archguard');

    expect(loadEngine).toHaveBeenCalledTimes(1);
    expect(createCodebaseMemoryAdapter).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Phase B: codebase-memory + auto fallback + provenance footer
// ===========================================================================

describe('--backend codebase-memory', () => {
  it('--entity routes to the adapter and prints a provenance footer', async () => {
    const adapter = mockAdapter({
      findEntity: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: {
          results: [
            { name: 'OrderHandler', kind: 'Class', file: 'src/order.ts', line: 5, raw: {} },
          ],
        },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery(
      '--entity',
      'OrderHandler',
      '--backend',
      'codebase-memory',
      '--cbm-project',
      'my-repo'
    );

    expect(createCodebaseMemoryAdapter).toHaveBeenCalledTimes(1);
    // cbm-project flows into adapter construction.
    const optsArg = vi.mocked(createCodebaseMemoryAdapter).mock.calls[0][0];
    expect(optsArg.project).toBe('my-repo');
    expect(adapter.findEntity).toHaveBeenCalledWith('OrderHandler');
    // Engine should NOT be loaded for a pure codebase-memory entity query.
    expect(loadEngine).not.toHaveBeenCalled();

    const output = consoleOutput.join('\n');
    expect(output).toContain('OrderHandler');
    expect(output).toContain('Backend: codebase-memory');
    expect(output).toContain('my-repo');
  });

  it('--file routes to the adapter', async () => {
    const adapter = mockAdapter({
      getFileEntities: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: { file: 'src/order.ts', results: [{ name: 'OrderHandler', raw: {} }] },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--file', 'src/order.ts', '--backend', 'codebase-memory');

    expect(adapter.getFileEntities).toHaveBeenCalledWith('src/order.ts');
    expect(consoleOutput.join('\n')).toContain('Backend: codebase-memory');
  });

  it('--callers routes to the adapter with depth', async () => {
    const adapter = mockAdapter({
      findCallers: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: { callers: [{ from: 'A.run', to: 'OrderHandler.handle', raw: {} }] },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery(
      '--callers',
      'OrderHandler.handle',
      '--backend',
      'codebase-memory',
      '--callers-depth',
      '2'
    );

    expect(adapter.findCallers).toHaveBeenCalledWith('OrderHandler.handle', { depth: 2 });
    expect(consoleOutput.join('\n')).toContain('Backend: codebase-memory');
  });

  it('surfaces adapter diagnostics in the footer', async () => {
    const adapter = mockAdapter({
      findEntity: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        data: { results: [] },
        diagnostics: [
          {
            code: 'project-not-indexed',
            severity: 'error',
            message: 'repo not indexed',
            nextSteps: ['index_repository ...'],
          },
        ],
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--entity', 'OrderHandler', '--backend', 'codebase-memory');

    const output = [...consoleOutput, ...consoleErrorOutput].join('\n');
    expect(output).toContain('repo not indexed');
  });
});

describe('--backend auto', () => {
  it('uses ArchGuard when the engine returns results (no adapter call)', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    const adapter = mockAdapter();
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--entity', 'CacheManager', '--backend', 'auto');

    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(adapter.findEntity).not.toHaveBeenCalled();
    expect(output).toContain('Backend: archguard');
  });

  it('falls back to codebase-memory when ArchGuard yields no results', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    const adapter = mockAdapter({
      findEntity: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: { results: [{ name: 'Nonexistent', raw: {} }] },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--entity', 'Nonexistent', '--backend', 'auto');

    expect(adapter.findEntity).toHaveBeenCalledWith('Nonexistent');
    const output = consoleOutput.join('\n');
    expect(output).toContain('Backend: codebase-memory');
    expect(output).toContain('fell back');
  });

  it('falls back to codebase-memory when ArchGuard artifacts are missing', async () => {
    vi.mocked(loadEngine).mockRejectedValue(
      new Error('No query data found. Run `archguard analyze` first.')
    );
    const adapter = mockAdapter({
      findEntity: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: { results: [{ name: 'OrderHandler', raw: {} }] },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--entity', 'OrderHandler', '--backend', 'auto');

    expect(adapter.findEntity).toHaveBeenCalled();
    expect(consoleOutput.join('\n')).toContain('Backend: codebase-memory');
  });
});

describe('--summary enrichment only', () => {
  it('always uses the engine summary even with --backend codebase-memory', async () => {
    vi.mocked(loadEngine).mockResolvedValue(wrapEngine(createTestEngine()));
    const adapter = mockAdapter({
      getArchitecture: vi.fn().mockResolvedValue({
        backend: 'codebase-memory',
        projectRoot: '/project',
        codebaseMemoryProject: 'my-repo',
        data: { raw: { packages: [] } },
      }),
    });
    vi.mocked(createCodebaseMemoryAdapter).mockReturnValue(adapter as any);

    await runQuery('--summary', '--backend', 'codebase-memory');

    const output = consoleOutput.join('\n');
    // ArchGuard summary stays authoritative.
    expect(output).toContain('Scope Summary');
    expect(loadEngine).toHaveBeenCalled();
  });
});

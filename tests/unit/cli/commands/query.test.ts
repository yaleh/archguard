/**
 * Unit tests for the query command.
 * Mocks engine-loader to avoid filesystem access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entity, Relation, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';

// Mock engine-loader before importing the command
vi.mock('@/cli/query/engine-loader.js', () => ({
  resolveArchDir: vi.fn((dir?: string) => dir ?? '.archguard'),
  loadEngine: vi.fn(),
  readManifest: vi.fn(),
}));

import { createQueryCommand } from '@/cli/commands/query.js';
import { resolveArchDir, loadEngine, readManifest } from '@/cli/query/engine-loader.js';

// -- Test fixtures --

function makeEntity(id: string, name: string, type: string = 'class', file: string = 'src/foo.ts'): Entity {
  return {
    id,
    name,
    type: type as Entity['type'],
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

const entities: Entity[] = [
  makeEntity('cm', 'CacheManager', 'class', 'src/cache.ts'),
  makeEntity('dp', 'DiagramProcessor', 'class', 'src/processor.ts'),
  makeEntity('ilp', 'ILanguagePlugin', 'interface', 'src/plugin.ts'),
  makeEntity('tsp', 'TypeScriptPlugin', 'class', 'src/ts-plugin.ts'),
  makeEntity('orphan', 'OrphanClass', 'class', 'src/orphan.ts'),
];

const relations: Relation[] = [
  { id: 'dp->cm', source: 'dp', target: 'cm', type: 'dependency' },
  { id: 'dp->ilp', source: 'dp', target: 'ilp', type: 'dependency' },
  { id: 'tsp->ilp', source: 'tsp', target: 'ilp', type: 'implementation' },
  { id: 'cm->dp', source: 'cm', target: 'dp', type: 'dependency' }, // cycle cm <-> dp
];

const parsedScope: QueryScopeEntry = {
  key: 'abc123',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 5,
  relationCount: 4,
  hasAtlasExtension: false,
};

const derivedScope: QueryScopeEntry = {
  key: 'def456',
  label: 'src/sub (typescript)',
  language: 'typescript',
  kind: 'derived',
  sources: ['/project/src/sub'],
  entityCount: 5,
  relationCount: 4,
  hasAtlasExtension: false,
};

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
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

// -- Console capture --

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
  vi.mocked(readManifest).mockClear();
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

// -- Tests --

describe('createQueryCommand', () => {
  it('registers with correct name and description', () => {
    const cmd = createQueryCommand();
    expect(cmd.name()).toBe('query');
    expect(cmd.description()).toContain('Query');
  });

  it('has all expected options registered', () => {
    const cmd = createQueryCommand();
    const optionNames = cmd.options.map(o => o.long);

    expect(optionNames).toContain('--arch-dir');
    expect(optionNames).toContain('--scope');
    expect(optionNames).toContain('--format');
    expect(optionNames).toContain('--entity');
    expect(optionNames).toContain('--deps-of');
    expect(optionNames).toContain('--used-by');
    expect(optionNames).toContain('--implementers-of');
    expect(optionNames).toContain('--subclasses-of');
    expect(optionNames).toContain('--file');
    expect(optionNames).toContain('--depth');
    expect(optionNames).toContain('--cycles');
    expect(optionNames).toContain('--summary');
    expect(optionNames).toContain('--list-scopes');
    expect(optionNames).toContain('--type');
    expect(optionNames).toContain('--high-coupling');
    expect(optionNames).toContain('--threshold');
    expect(optionNames).toContain('--orphans');
    expect(optionNames).toContain('--in-cycles');
    expect(optionNames).toContain('--verbose');
  });

  it('does NOT expose --calls', () => {
    const cmd = createQueryCommand();
    const optionNames = cmd.options.map(o => o.long);
    expect(optionNames).not.toContain('--calls');
  });
});

describe('query --list-scopes', () => {
  it('reads manifest and displays scopes', async () => {
    vi.mocked(readManifest).mockResolvedValue({
      version: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      scopes: [parsedScope, derivedScope],
    });

    await runQuery('--list-scopes');

    const output = consoleOutput.join('\n');
    expect(output).toContain('abc123');
    expect(output).toContain('parsed');
    expect(output).toContain('def456');
    expect(output).toContain('derived');
    expect(loadEngine).not.toHaveBeenCalled();
  });
});

describe('query --entity', () => {
  it('finds entity and outputs text', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
  });

  it('reports when not found', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'NonExistent');
    const output = consoleOutput.join('\n');
    expect(output).toContain('none');
  });

  it('outputs summary JSON by default', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeUndefined();
    expect(parsed[0].methodCount).toBeDefined();
  });

  it('outputs full entities when --verbose is set', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json', '--verbose');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeDefined();
  });
});

describe('query --deps-of', () => {
  it('calls getDependencies', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getDependencies');
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--deps-of', 'DiagramProcessor', '--depth', '2');
    expect(spy).toHaveBeenCalledWith('DiagramProcessor', 2);
  });
});

describe('query --used-by', () => {
  it('calls getDependents', async () => {
    const engine = createTestEngine();
    const spy = vi.spyOn(engine, 'getDependents');
    vi.mocked(loadEngine).mockResolvedValue(engine);
    await runQuery('--used-by', 'CacheManager');
    expect(spy).toHaveBeenCalledWith('CacheManager', 1);
  });
});

describe('query --implementers-of', () => {
  it('finds implementers', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--implementers-of', 'ILanguagePlugin');
    const output = consoleOutput.join('\n');
    expect(output).toContain('TypeScriptPlugin');
  });
});

describe('query --file', () => {
  it('finds entities in file', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--file', 'src/cache.ts');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
  });
});

describe('query --cycles', () => {
  it('shows cycles', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--cycles');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(output).toContain('DiagramProcessor');
  });
});

describe('query --summary', () => {
  it('shows summary', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--summary');
    const output = consoleOutput.join('\n');
    expect(output).toContain('5'); // entities
    expect(output).toContain('4'); // relations
  });
});

describe('query --type', () => {
  it('filters by type', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--type', 'interface');
    const output = consoleOutput.join('\n');
    expect(output).toContain('ILanguagePlugin');
    expect(output).not.toContain('CacheManager');
  });
});

describe('query --orphans', () => {
  it('finds orphans', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--orphans');
    const output = consoleOutput.join('\n');
    expect(output).toContain('OrphanClass');
  });
});

describe('query --in-cycles', () => {
  it('finds entities in cycles', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--in-cycles');
    const output = consoleOutput.join('\n');
    expect(output).toContain('CacheManager');
    expect(output).toContain('DiagramProcessor');
    expect(output).not.toContain('OrphanClass');
  });
});

describe('query --format json', () => {
  it('outputs JSON for --entity', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'CacheManager', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('CacheManager');
  });

  it('outputs JSON for --summary', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--summary', '--format', 'json');
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.entityCount).toBe(5);
  });
});

describe('derived scope warning', () => {
  it('shows note when scope is derived', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine(derivedScope));
    await runQuery('--summary');
    const output = consoleOutput.join('\n');
    expect(output).toContain('derived');
    expect(output).toContain('partial');
  });
});

describe('error handling', () => {
  it('exits 1 when loadEngine fails (multiple scopes)', async () => {
    vi.mocked(loadEngine).mockRejectedValue(
      new Error('Multiple scopes found. Use --scope to select one'),
    );
    await runQuery('--summary');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Multiple scopes');
  });

  it('passes --arch-dir and --scope to loadEngine', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'Foo', '--arch-dir', '/custom', '--scope', 'my-scope');
    expect(resolveArchDir).toHaveBeenCalledWith('/custom');
    expect(loadEngine).toHaveBeenCalledWith(expect.any(String), 'my-scope');
  });

  it('rejects conflicting primary query options', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--entity', 'Foo', '--summary');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Specify exactly one primary query option');
  });

  it('rejects invalid depth values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--deps-of', 'Foo', '--depth', 'abc');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --depth');
  });

  it('rejects out-of-range depth values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--deps-of', 'Foo', '--depth', '7');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --depth');
  });

  it('rejects invalid threshold values', async () => {
    vi.mocked(loadEngine).mockResolvedValue(createTestEngine());
    await runQuery('--high-coupling', '--threshold', 'abc');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(consoleErrorOutput.join('\n')).toContain('Invalid --threshold');
  });
});

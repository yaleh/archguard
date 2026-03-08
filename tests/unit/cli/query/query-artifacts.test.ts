import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ArchJSON } from '@/types/index.js';
import {
  atomicWriteFile,
  generateScopeLabel,
  buildManifestEntry,
  persistQueryScopes,
} from '@/cli/query/query-artifacts.js';
import type { QueryScopeInput } from '@/cli/query/query-artifacts.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-test-'));
}

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['src/a.ts'],
    entities: [
      {
        id: 'ClassA',
        name: 'ClassA',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 10 },
      },
      {
        id: 'ClassB',
        name: 'ClassB',
        type: 'interface',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 20 },
      },
    ],
    relations: [
      {
        id: 'r1',
        type: 'dependency',
        source: 'ClassA',
        target: 'ClassB',
      },
    ],
    ...overrides,
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs) {
    await fs.remove(d);
  }
  tmpDirs.length = 0;
});

describe('atomicWriteFile', () => {
  it('writes content correctly', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'test.json');

    await atomicWriteFile(filePath, '{"hello":"world"}');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('{"hello":"world"}');
  });

  it('does not leave tmp files on success', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'test.json');

    await atomicWriteFile(filePath, 'data');

    const files = await fs.readdir(dir);
    expect(files).toEqual(['test.json']);
    expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'sub', 'deep', 'test.txt');

    await atomicWriteFile(filePath, 'nested');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('nested');
  });
});

describe('generateScopeLabel', () => {
  it('produces human-readable labels from sources', () => {
    const label = generateScopeLabel(['/home/user/project/src'], 'typescript');
    expect(label).toBe('src (typescript)');
  });

  it('uses first source basename when multiple sources given', () => {
    const label = generateScopeLabel(['/home/user/project/lib', '/home/user/project/src'], 'go');
    expect(label).toBe('lib (go)');
  });

  it('handles single-segment paths', () => {
    const label = generateScopeLabel(['src'], 'java');
    expect(label).toBe('src (java)');
  });
});

describe('buildManifestEntry', () => {
  it('extracts correct entity and relation counts', () => {
    const archJson = makeArchJson();
    const scope: QueryScopeInput = {
      key: 'test-scope',
      sources: ['/home/user/project/src'],
      archJson,
      kind: 'parsed',
    };

    const entry = buildManifestEntry(scope);

    expect(entry.key).toBe('test-scope');
    expect(entry.entityCount).toBe(2);
    expect(entry.relationCount).toBe(1);
    expect(entry.kind).toBe('parsed');
    expect(entry.sources).toEqual(['/home/user/project/src']);
    expect(entry.hasAtlasExtension).toBe(false);
  });

  it('detects goAtlas extension', () => {
    const archJson = makeArchJson({
      extensions: {
        goAtlas: {
          version: '1.0',
          metadata: {} as any,
          layers: {} as any,
        },
      },
    });
    const scope: QueryScopeInput = {
      key: 'go-scope',
      sources: ['/home/user/go-project/cmd'],
      archJson,
      kind: 'parsed',
    };

    const entry = buildManifestEntry(scope);

    expect(entry.hasAtlasExtension).toBe(true);
  });

  it('generates a label from sources and language', () => {
    const archJson = makeArchJson({ language: 'python' });
    const scope: QueryScopeInput = {
      key: 'py-scope',
      sources: ['/workspace/app'],
      archJson,
      kind: 'derived',
    };

    const entry = buildManifestEntry(scope);

    expect(entry.label).toBe('app (python)');
    expect(entry.language).toBe('python');
    expect(entry.kind).toBe('derived');
  });
});

describe('persistQueryScopes', () => {
  it('creates manifest.json', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const scopes: QueryScopeInput[] = [
      {
        key: 'scope-a',
        sources: ['/project/src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ];

    await persistQueryScopes(dir, scopes);

    const manifestPath = path.join(dir, 'query', 'manifest.json');
    expect(await fs.pathExists(manifestPath)).toBe(true);

    const manifest = await fs.readJson(manifestPath);
    expect(manifest.scopes).toHaveLength(1);
    expect(manifest.scopes[0].key).toBe('scope-a');
    expect(manifest.globalScopeKey).toBe('scope-a');
  });

  it('selects a global scope key for multi-scope manifests', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    await persistQueryScopes(dir, [
      {
        key: 'derived-small',
        sources: ['/project/src/feature'],
        archJson: makeArchJson({
          entities: [makeArchJson().entities[0]],
          relations: [],
        }),
        kind: 'derived',
      },
      {
        key: 'parsed-large',
        sources: ['/project/src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.globalScopeKey).toBe('parsed-large');
  });

  it('merges new scopes with existing manifest entries by default', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    await persistQueryScopes(dir, [
      {
        key: 'scope-a',
        sources: ['/project/src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    await persistQueryScopes(dir, [
      {
        key: 'scope-b',
        sources: ['/project/gguf-py'],
        archJson: makeArchJson({ language: 'python' }),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.scopes.map((scope: { key: string }) => scope.key)).toEqual([
      'scope-a',
      'scope-b',
    ]);
  });

  it('preserves the existing global scope key when adding non-primary scopes', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    await persistQueryScopes(
      dir,
      [
        {
          key: 'cpp-core',
          sources: ['/project'],
          archJson: makeArchJson({ language: 'cpp' }),
          kind: 'parsed',
        },
      ],
      { preferredGlobalScopeKey: 'cpp-core' }
    );

    await persistQueryScopes(dir, [
      {
        key: 'python-tools',
        sources: ['/project/gguf-py'],
        archJson: makeArchJson({ language: 'python' }),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.globalScopeKey).toBe('cpp-core');
  });

  it('creates <key>/arch.json for each scope', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const scopes: QueryScopeInput[] = [
      {
        key: 'scope-a',
        sources: ['/project/src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
      {
        key: 'scope-b',
        sources: ['/project/lib'],
        archJson: makeArchJson({ language: 'go' }),
        kind: 'derived',
      },
    ];

    await persistQueryScopes(dir, scopes);

    for (const scope of scopes) {
      const archPath = path.join(dir, 'query', scope.key, 'arch.json');
      expect(await fs.pathExists(archPath)).toBe(true);
      const loaded = await fs.readJson(archPath);
      expect(loaded.entities).toHaveLength(2);
    }
  });

  it('skips scopes with write errors without crashing', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    // Create a file where a directory is expected, to cause a write error
    const badScopeDirPath = path.join(dir, 'query', 'bad-scope');
    await fs.ensureDir(path.join(dir, 'query'));
    // Create a regular file at the path where ensureDir would need to create a directory
    await fs.writeFile(path.join(dir, 'query', 'bad-scope'), 'blocker');

    const scopes: QueryScopeInput[] = [
      {
        key: 'bad-scope/nested', // will fail because bad-scope is a file, not a dir
        sources: ['/project/src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
      {
        key: 'good-scope',
        sources: ['/project/lib'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ];

    // Should not throw
    await persistQueryScopes(dir, scopes);

    // good-scope should still have been written
    const goodPath = path.join(dir, 'query', 'good-scope', 'arch.json');
    expect(await fs.pathExists(goodPath)).toBe(true);
  });

  it('defaults workDir to .archguard when undefined', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    // We test the default by passing undefined and checking the function
    // handles it (uses .archguard). We override cwd for safety.
    const origCwd = process.cwd();
    try {
      process.chdir(dir);

      await persistQueryScopes(undefined as unknown as string, [
        {
          key: 'default-scope',
          sources: ['./src'],
          archJson: makeArchJson(),
          kind: 'parsed',
        },
      ]);

      const manifestPath = path.join(dir, '.archguard', 'query', 'manifest.json');
      expect(await fs.pathExists(manifestPath)).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('manifest version is "1.0"', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    await persistQueryScopes(dir, [
      {
        key: 's1',
        sources: ['./src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.version).toBe('1.0');
  });

  it('no .tmp. files remain after successful persist', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    await persistQueryScopes(dir, [
      {
        key: 'clean-scope',
        sources: ['./src'],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    // Recursively check for .tmp. files
    const allFiles: string[] = [];
    const walk = async (d: string) => {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else allFiles.push(e.name);
      }
    };
    await walk(path.join(dir, 'query'));

    const tmpFiles = allFiles.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toEqual([]);
  });
});

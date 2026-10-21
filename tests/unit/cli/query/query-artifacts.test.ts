import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import type { ArchJSON } from '@/types/index.js';
import {
  atomicWriteFile,
  generateScopeLabel,
  buildManifestEntry,
  persistQueryScopes,
} from '@/cli/query/query-artifacts.js';
import type { QueryScopeInput } from '@/cli/query/query-artifacts.js';
import { hashSources } from '@/cli/processors/arch-json-utils.js';
import { loadEngine } from '@/cli/query/engine-loader.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-test-'));
}

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.1',
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
          version: '1.1',
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
    const projectSrc = path.join(dir, 'sources', 'project-src');
    const pythonSrc = path.join(dir, 'sources', 'gguf-py');
    fs.ensureDirSync(projectSrc);
    fs.ensureDirSync(pythonSrc);
    const projectKey = hashSources([fs.realpathSync(projectSrc)], 'typescript');
    const pythonKey = hashSources([fs.realpathSync(pythonSrc)], 'python');

    await persistQueryScopes(dir, [
      {
        key: projectKey,
        sources: [projectSrc],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    await persistQueryScopes(dir, [
      {
        key: pythonKey,
        sources: [pythonSrc],
        archJson: makeArchJson({ language: 'python' }),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.scopes.map((scope: { key: string }) => scope.key)).toEqual(
      [projectKey, pythonKey].sort()
    );
  });

  it('preserves the existing global scope key when adding non-primary scopes', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const cppSrc = path.join(dir, 'sources', 'cpp-core');
    const pythonSrc = path.join(dir, 'sources', 'gguf-py');
    fs.ensureDirSync(cppSrc);
    fs.ensureDirSync(pythonSrc);
    const cppKey = hashSources([fs.realpathSync(cppSrc)], 'cpp');
    const pythonKey = hashSources([fs.realpathSync(pythonSrc)], 'python');

    await persistQueryScopes(
      dir,
      [
        {
          key: cppKey,
          sources: [cppSrc],
          archJson: makeArchJson({ language: 'cpp' }),
          kind: 'parsed',
          role: 'primary',
        },
      ],
      { preferredGlobalScopeKey: cppKey }
    );

    await persistQueryScopes(dir, [
      {
        key: pythonKey,
        sources: [pythonSrc],
        archJson: makeArchJson({ language: 'python' }),
        kind: 'parsed',
      },
    ]);

    const manifest = await fs.readJson(path.join(dir, 'query', 'manifest.json'));
    expect(manifest.globalScopeKey).toBe(cppKey);
  });

  describe('global scope selection without a primary scope', () => {
    const entity = (id: string) => ({
      ...makeArchJson().entities[0],
      id,
      name: id,
    });
    const archWith = (n: number) =>
      makeArchJson({
        entities: Array.from({ length: n }, (_, i) => entity(`E${i}`)),
        relations: [],
      });
    // Persist now re-derives existing entries' identity from the filesystem, so
    // every scope that must survive a second persist needs a real source dir and
    // the canonical key a fresh analysis would compute for it.
    const sourceOf = (dir: string, name: string) => path.join(dir, 'sources', name);
    const keyOf = (dir: string, name: string) =>
      hashSources([fs.realpathSync(sourceOf(dir, name))], 'typescript');
    const scope = (dir: string, name: string, n: number, role?: 'primary' | 'secondary') => {
      const source = sourceOf(dir, name);
      fs.ensureDirSync(source);
      return {
        key: keyOf(dir, name),
        sources: [source],
        archJson: archWith(n),
        kind: 'parsed' as const,
        ...(role ? { role } : {}),
      };
    };
    const readManifest = async (dir: string) =>
      fs.readJson(path.join(dir, 'query', 'manifest.json'));

    it('keeps the wider scope, then switches when a wider non-primary scope arrives', async () => {
      const dir = makeTmpDir();
      tmpDirs.push(dir);

      await persistQueryScopes(dir, [scope(dir, 'big', 10, 'primary')], {
        preferredGlobalScopeKey: keyOf(dir, 'big'),
      });
      await persistQueryScopes(dir, [scope(dir, 'small', 3)]);
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'big'));

      await persistQueryScopes(dir, [scope(dir, 'wider', 20)]);
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'wider'));
    });

    it('does not carry over an old global key that is now narrower than the new scope', async () => {
      const dir = makeTmpDir();
      tmpDirs.push(dir);

      await persistQueryScopes(dir, [scope(dir, 'old', 5)]);
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'old'));

      await persistQueryScopes(dir, [scope(dir, 'new', 8)]);
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'new'));
    });

    it('still honors the primary scope when one is provided', async () => {
      const dir = makeTmpDir();
      tmpDirs.push(dir);

      await persistQueryScopes(dir, [scope(dir, 'wide', 20)]);
      await persistQueryScopes(dir, [scope(dir, 'narrow-primary', 2, 'primary')], {
        preferredGlobalScopeKey: keyOf(dir, 'narrow-primary'),
      });
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'narrow-primary'));
    });

    it('breaks an entityCount tie in favor of a previously primary scope', async () => {
      const dir = makeTmpDir();
      tmpDirs.push(dir);

      await persistQueryScopes(dir, [scope(dir, 'zzz', 4, 'primary')], {
        preferredGlobalScopeKey: keyOf(dir, 'zzz'),
      });
      await persistQueryScopes(dir, [scope(dir, 'aaa', 4)]);
      expect((await readManifest(dir)).globalScopeKey).toBe(keyOf(dir, 'zzz'));
    });

    it('stamps generatedAt on each written scope entry', async () => {
      const dir = makeTmpDir();
      tmpDirs.push(dir);

      await persistQueryScopes(dir, [scope(dir, 'a', 1)]);
      const manifest = await readManifest(dir);
      expect(new Date(manifest.scopes[0].generatedAt).toISOString()).toBe(
        manifest.scopes[0].generatedAt
      );
    });
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
    const _badScopeDirPath = path.join(dir, 'query', 'bad-scope');
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

describe('persistQueryScopes identity normalization', () => {
  const HEX_KEY = /^[0-9a-f]{8}$/;

  const readManifest = async (workDir: string) =>
    fs.readJson(path.join(workDir, 'query', 'manifest.json'));

  const scopeDirs = async (workDir: string): Promise<string[]> =>
    (await fs.readdir(path.join(workDir, 'query'), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && HEX_KEY.test(e.name))
      .map((e) => e.name)
      .sort();

  /**
   * Seed a manifest entry plus its on-disk arch.json payload. This is the shape
   * older analyze runs left behind: the key was not derived from a realpath.
   */
  const seedEntry = async (
    workDir: string,
    entry: {
      key: string;
      sources: string[];
      entityCount: number;
      generatedAt?: string;
      label?: string;
    }
  ) => {
    await fs.outputJson(path.join(workDir, 'query', entry.key, 'arch.json'), makeArchJson());
    const manifestPath = path.join(workDir, 'query', 'manifest.json');
    const manifest = (await fs.readJson(manifestPath).catch(() => null)) as {
      version: string;
      generatedAt: string;
      globalScopeKey?: string;
      scopes: unknown[];
    } | null;
    const next = manifest ?? {
      version: '1.0',
      generatedAt: '2026-09-01T00:00:00.000Z',
      scopes: [],
    };
    next.scopes.push({
      key: entry.key,
      label: entry.label ?? `${path.basename(entry.sources[0])} (typescript)`,
      language: 'typescript',
      kind: 'parsed',
      sources: entry.sources,
      entityCount: entry.entityCount,
      relationCount: 0,
      hasAtlasExtension: false,
      ...(entry.generatedAt ? { generatedAt: entry.generatedAt } : {}),
    });
    await fs.outputJson(manifestPath, next);
  };

  it('collapses relative / symlinked / absolute routes onto one canonical identity', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const project = path.join(root, 'project');
    const realSrc = path.join(project, 'src');
    fs.ensureDirSync(realSrc);
    await fs.writeFile(path.join(realSrc, 'a.ts'), 'export const a = 1;\n');

    // `/home` vs `/data`-style route: a symlink to the same directory.
    const linkSrc = path.join(project, 'src-link');
    fs.symlinkSync(realSrc, linkSrc, 'dir');

    const workDir = path.join(project, '.archguard');
    // The canonical key a fresh analysis of this directory would compute.
    const canonicalKey = hashSources([fs.realpathSync(realSrc)], 'typescript');

    await seedEntry(workDir, {
      key: 'aaaa0001',
      sources: ['src'], // legacy relative route
      entityCount: 5,
      generatedAt: '2026-09-30T00:00:00.000Z',
    });
    await seedEntry(workDir, {
      key: 'bbbb0002',
      sources: [linkSrc], // legacy symlinked route
      entityCount: 7,
      generatedAt: '2026-10-01T00:00:00.000Z',
    });
    await seedEntry(workDir, {
      key: canonicalKey,
      sources: [realSrc],
      entityCount: 11,
      generatedAt: '2026-10-20T00:00:00.000Z',
      label: 'src (typescript)',
    });

    // A re-analysis pass that produced no new payloads still normalizes the manifest.
    await persistQueryScopes(workDir, []);

    const manifest = await readManifest(workDir);
    expect(manifest.scopes).toHaveLength(1);
    const [entry] = manifest.scopes;
    expect(entry.key).toBe(canonicalKey);
    expect(entry.sources).toEqual([fs.realpathSync(realSrc)]);
    // Newest/richest entry wins the metadata.
    expect(entry.entityCount).toBe(11);
    expect(entry.generatedAt).toBe('2026-10-20T00:00:00.000Z');

    // Manifest and disk agree one-to-one: the superseded dirs are gone.
    expect(await scopeDirs(workDir)).toEqual([canonicalKey]);
  });

  it('keeps scopes with genuinely different source sets independent (negative control)', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const project = path.join(root, 'project');
    const packages = path.join(project, 'packages');
    const pluginScripts = path.join(project, 'plugin', 'scripts');
    fs.ensureDirSync(packages);
    fs.ensureDirSync(pluginScripts);

    const workDir = path.join(project, '.archguard');
    const packagesKey = hashSources([fs.realpathSync(packages)], 'typescript');
    const scriptsKey = hashSources([fs.realpathSync(pluginScripts)], 'typescript');
    await seedEntry(workDir, { key: packagesKey, sources: [packages], entityCount: 3 });
    await seedEntry(workDir, { key: scriptsKey, sources: [pluginScripts], entityCount: 4 });

    await persistQueryScopes(workDir, []);

    const manifest = await readManifest(workDir);
    expect(manifest.scopes.map((s: { key: string }) => s.key).sort()).toEqual(
      [packagesKey, scriptsKey].sort()
    );
    // Both remain loadable through the same path archguard_summary uses.
    for (const key of [packagesKey, scriptsKey]) {
      expect(await fs.pathExists(path.join(workDir, 'query', key, 'arch.json'))).toBe(true);
      const ctx = await loadEngine(workDir, key);
      expect(ctx.scopeEntry.key).toBe(key);
      expect(ctx.availableScopes.map((s) => s.key).sort()).toEqual(
        [packagesKey, scriptsKey].sort()
      );
    }
  });

  it('drops entries whose sources no longer exist', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const project = path.join(root, 'project');
    const live = path.join(project, 'live');
    fs.ensureDirSync(live);
    const workDir = path.join(project, '.archguard');

    const liveKey = hashSources([fs.realpathSync(live)], 'typescript');
    await seedEntry(workDir, { key: liveKey, sources: [live], entityCount: 2 });
    await seedEntry(workDir, {
      key: 'dead0001',
      sources: [path.join(project, 'vanished')],
      entityCount: 9,
    });

    await persistQueryScopes(workDir, []);

    const manifest = await readManifest(workDir);
    expect(manifest.scopes.map((s: { key: string }) => s.key)).toEqual([liveKey]);
    // The stale entry is gone from disk too.
    expect(await fs.pathExists(path.join(workDir, 'query', 'dead0001'))).toBe(false);
    expect(await scopeDirs(workDir)).toEqual([liveKey]);
    // And it is no longer advertised to query consumers.
    const ctx = await loadEngine(workDir);
    expect(ctx.availableScopes.map((s) => s.key)).toEqual([liveKey]);
  });

  it('lets a freshly written scope replace its legacy aliases', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const project = path.join(root, 'project');
    const realSrc = path.join(project, 'src');
    fs.ensureDirSync(realSrc);
    const linkSrc = path.join(project, 'src-link');
    fs.symlinkSync(realSrc, linkSrc, 'dir');
    const workDir = path.join(project, '.archguard');

    await seedEntry(workDir, { key: 'cccc0003', sources: [linkSrc], entityCount: 1 });

    const key = hashSources([fs.realpathSync(realSrc)], 'typescript');
    await persistQueryScopes(workDir, [
      {
        key,
        sources: [realSrc],
        archJson: makeArchJson(),
        kind: 'parsed',
      },
    ]);

    const manifest = await readManifest(workDir);
    expect(manifest.scopes.map((s: { key: string }) => s.key)).toEqual([key]);
    expect(manifest.scopes[0].entityCount).toBe(2);
    expect(await scopeDirs(workDir)).toEqual([key]);
    expect(await fs.pathExists(path.join(workDir, 'query', key, 'arch.json'))).toBe(true);
  });

  it('leaves auxiliary query directories (duplicates/git-history) untouched', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const project = path.join(root, 'project');
    const src = path.join(project, 'src');
    fs.ensureDirSync(src);
    const workDir = path.join(project, '.archguard');
    for (const aux of ['duplicates', 'git-history', 'shape-smells']) {
      await fs.outputJson(path.join(workDir, 'query', aux, 'data.json'), {});
    }

    const key = hashSources([fs.realpathSync(src)], 'typescript');
    await seedEntry(workDir, { key, sources: [src], entityCount: 1 });

    await persistQueryScopes(workDir, []);

    for (const aux of ['duplicates', 'git-history', 'shape-smells']) {
      expect(await fs.pathExists(path.join(workDir, 'query', aux, 'data.json'))).toBe(true);
    }
  });
});

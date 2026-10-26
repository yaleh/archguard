import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { detectDuplicates, groupDuplicates, isTestFile } from '@/analysis/duplicates/group.js';
import { persistDuplicates, loadDuplicates } from '@/analysis/duplicates/persistence.js';
import type { FunctionFingerprint } from '@/parser/function-fingerprint.js';

function body(prefix: string, extra = 0): string {
  const lines = [
    `  const ${prefix}Items = [];`,
    `  for (const ${prefix}Entry of source) {`,
    `    if (${prefix}Entry.length > 3) ${prefix}Items.push(normalize(${prefix}Entry));`,
    `  }`,
    `  const ${prefix}Total = ${prefix}Items.length;`,
    `  console.log('total', ${prefix}Total);`,
    `  return ${prefix}Items;`,
  ];
  for (let i = 0; i < extra; i++) lines.push(`  audit(${i}, source);`);
  return lines.join('\n');
}

const fn = (name: string, prefix: string, extra = 0): string =>
  `export function ${name}(source: string[]) {\n${body(prefix, extra)}\n}\n`;

describe('duplicate detection', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dup-test-'));
    await fs.outputFile(path.join(root, 'src/a.ts'), fn('collectA', 'a'));
    await fs.outputFile(path.join(root, 'src/b.ts'), fn('collectB', 'b'));
    await fs.outputFile(path.join(root, 'src/unique.ts'), `export function u(x) { return x; }\n`);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('reports one group for two identical function bodies', async () => {
    const { groups, manifest } = await detectDuplicates(root, ['src']);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.file)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(groups[0].members.map((m) => m.name)).toEqual(['collectA', 'collectB']);
    expect(groups[0].savableLines).toBe(groups[0].lineCount);
    expect(manifest.scannedFiles).toBe(3);
    expect(manifest.totalGroups).toBe(1);
  });

  it('does not report functions below minStatements / minTokens', async () => {
    expect((await detectDuplicates(root, ['src'], { minStatements: 50 })).groups).toHaveLength(0);
    expect((await detectDuplicates(root, ['src'], { minTokens: 100000 })).groups).toHaveLength(0);
  });

  it('excludes test files by default and includes them with includeTests', async () => {
    await fs.outputFile(path.join(root, 'src/c.test.ts'), fn('collectC', 'c'));
    await fs.outputFile(path.join(root, 'src/tests/d.ts'), fn('collectD', 'd'));

    const dflt = await detectDuplicates(root, ['src']);
    expect(dflt.groups[0].members).toHaveLength(2);

    const withTests = await detectDuplicates(root, ['src'], { includeTests: true });
    expect(withTests.groups[0].members).toHaveLength(4);
  });

  it('orders groups by savable lines descending and honours topN', async () => {
    // Second group: 3 copies of a shorter body → (3-1)*n; first group: 2 copies of a longer body.
    for (const p of ['x', 'y', 'z']) {
      await fs.outputFile(
        path.join(root, `src/short-${p}.ts`),
        `export function s${p}(v) {\n${[1, 2, 3, 4, 5, 6, 7].map((i) => `  const l${i} = process(v, ${i}, 'k');`).join('\n')}\n}\n`
      );
    }
    for (const p of ['a', 'b']) {
      await fs.outputFile(path.join(root, `src/${p}.ts`), fn(`collect${p}`, p, 40));
    }

    const { groups } = await detectDuplicates(root, ['src']);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].savableLines).toBeGreaterThanOrEqual(groups[i].savableLines);
    }

    const top1 = await detectDuplicates(root, ['src'], { topN: 1 });
    expect(top1.groups).toHaveLength(1);
    expect(top1.groups[0].hash).toBe(groups[0].hash);
    expect(top1.manifest.totalGroups).toBe(groups.length);
  });

  it('throws a clear error when a source path does not exist', async () => {
    await expect(detectDuplicates(root, ['nope'])).rejects.toThrow(/does not exist/);
  });

  it('trackedOnly drops __ residual files while the default scan keeps them', async () => {
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', 'src/a.ts', 'src/b.ts', 'src/unique.ts']);
    // Untracked, not ignored leftover scaffolding that duplicates collectA's body verbatim.
    await fs.outputFile(
      path.join(root, 'src/__criterion-falsify-attempt-id-1276453.ts'),
      fn('collectResidual', 'a')
    );

    const dflt = await detectDuplicates(root, ['src']);
    expect(dflt.manifest.options.trackedOnly).toBe(false);
    expect(dflt.manifest.scannedFiles).toBe(4);
    expect(dflt.groups[0].members).toHaveLength(3);
    expect(dflt.groups[0].members.map((m) => m.file)).toContain(
      'src/__criterion-falsify-attempt-id-1276453.ts'
    );

    const tracked = await detectDuplicates(root, ['src'], { trackedOnly: true });
    expect(tracked.manifest.options.trackedOnly).toBe(true);
    expect(tracked.manifest.scannedFiles).toBe(3);
    expect(tracked.groups[0].members.map((m) => m.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('trackedOnly excludes files that git ignores', async () => {
    execFileSync('git', ['init', '-q', root]);
    await fs.outputFile(path.join(root, '.gitignore'), 'src/generated/\n');
    execFileSync('git', ['-C', root, 'add', 'src/a.ts', 'src/b.ts', 'src/unique.ts', '.gitignore']);
    await fs.outputFile(path.join(root, 'src/generated/gen.ts'), fn('collectGen', 'a'));

    const dflt = await detectDuplicates(root, ['src']);
    expect(dflt.manifest.scannedFiles).toBe(4);

    const tracked = await detectDuplicates(root, ['src'], { trackedOnly: true });
    expect(tracked.manifest.scannedFiles).toBe(3);
    expect(tracked.groups.flatMap((g) => g.members.map((m) => m.file))).not.toContain(
      'src/generated/gen.ts'
    );
  });

  it('drops groups fully nested inside a larger duplicate group', () => {
    const mk = (over: Partial<FunctionFingerprint>): FunctionFingerprint => ({
      hash: 'h',
      tokenCount: 100,
      statementCount: 10,
      name: 'f',
      kind: 'function',
      file: 'a.ts',
      startLine: 1,
      endLine: 20,
      ...over,
    });
    const groups = groupDuplicates([
      mk({ hash: 'outer', tokenCount: 300, file: 'a.ts', startLine: 1, endLine: 40 }),
      mk({ hash: 'outer', tokenCount: 300, file: 'b.ts', startLine: 1, endLine: 40 }),
      mk({ hash: 'inner', tokenCount: 100, file: 'a.ts', startLine: 5, endLine: 20 }),
      mk({ hash: 'inner', tokenCount: 100, file: 'b.ts', startLine: 5, endLine: 20 }),
    ]);
    expect(groups.map((g) => g.hash)).toEqual(['outer']);
  });

  it('classifies test files', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('tests/unit/a.ts')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/a.ts')).toBe(false);
  });

  it('round-trips through persistence', async () => {
    const analysis = await detectDuplicates(
      root,
      ['src'],
      {},
      {
        key: 'deadbeef',
        label: 'src (typescript)',
      }
    );
    const archDir = path.join(root, '.archguard');
    expect(await loadDuplicates(archDir)).toBeNull();
    await persistDuplicates(archDir, analysis);
    expect(await loadDuplicates(archDir, 'deadbeef')).toEqual(analysis);
    // Omitting the key is unambiguous while exactly one scope is persisted.
    expect(await loadDuplicates(archDir)).toEqual(analysis);
  });

  it('persists each scope in its own directory without overwriting the other', async () => {
    await fs.outputFile(path.join(root, 'other/x.ts'), fn('collectX', 'x'));
    await fs.outputFile(path.join(root, 'other/y.ts'), fn('collectY', 'y'));
    const archDir = path.join(root, '.archguard');
    const srcAnalysis = await detectDuplicates(
      root,
      ['src'],
      {},
      {
        key: 'aaaaaaaa',
        label: 'src (typescript)',
      }
    );
    const otherAnalysis = await detectDuplicates(
      root,
      ['other'],
      {},
      {
        key: 'bbbbbbbb',
        label: 'other (typescript)',
      }
    );

    await persistDuplicates(archDir, srcAnalysis);
    await persistDuplicates(archDir, otherAnalysis);

    const dupRoot = path.join(archDir, 'query/duplicates');
    const a = (await fs.readJson(path.join(dupRoot, 'aaaaaaaa/manifest.json'))) as {
      scopeKey: string;
      label: string;
      sources: string[];
    };
    const b = (await fs.readJson(path.join(dupRoot, 'bbbbbbbb/manifest.json'))) as {
      scopeKey: string;
      label: string;
      sources: string[];
    };
    expect(a).toMatchObject({ scopeKey: 'aaaaaaaa', label: 'src (typescript)', sources: ['src'] });
    expect(b).toMatchObject({
      scopeKey: 'bbbbbbbb',
      label: 'other (typescript)',
      sources: ['other'],
    });

    expect((await loadDuplicates(archDir, 'aaaaaaaa'))?.manifest.sources).toEqual(['src']);
    expect((await loadDuplicates(archDir, 'bbbbbbbb'))?.manifest.sources).toEqual(['other']);
  });

  it('indexes every persisted scope one-to-one with its directory', async () => {
    const archDir = path.join(root, '.archguard');
    for (const [key, sources, label] of [
      ['aaaaaaaa', ['src'], 'src (typescript)'],
      ['bbbbbbbb', ['src'], 'other label (typescript)'],
    ] as const) {
      await persistDuplicates(
        archDir,
        await detectDuplicates(root, [...sources], {}, { key, label })
      );
    }

    const dupRoot = path.join(archDir, 'query/duplicates');
    const dirs = (await fs.readdir(dupRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const index = (await fs.readJson(path.join(dupRoot, 'index.json'))) as {
      version: string;
      entries: Array<{
        scopeKey: string;
        label: string;
        sources: string[];
        generatedAt: string;
      }>;
    };

    expect(index.version).toBe('1');
    expect(index.entries.map((e) => e.scopeKey).sort()).toEqual(dirs);
    for (const entry of index.entries) {
      const manifest = (await fs.readJson(path.join(dupRoot, entry.scopeKey, 'manifest.json'))) as {
        label: string;
        sources: string[];
        generatedAt: string;
      };
      expect(entry.label).toBe(manifest.label);
      expect(entry.sources).toEqual(manifest.sources);
      expect(entry.generatedAt).toBe(manifest.generatedAt);
    }
  });

  it('stops writing the legacy flat files and pins the no-scopeKey load contract', async () => {
    const archDir = path.join(root, '.archguard');
    const analysis = await detectDuplicates(
      root,
      ['src'],
      {},
      {
        key: 'aaaaaaaa',
        label: 'src (typescript)',
      }
    );
    await persistDuplicates(archDir, analysis);

    const dupRoot = path.join(archDir, 'query/duplicates');
    expect(await fs.pathExists(path.join(dupRoot, 'manifest.json'))).toBe(false);
    expect(await fs.pathExists(path.join(dupRoot, 'groups.json'))).toBe(false);

    // Explicit key that was never persisted → null.
    expect(await loadDuplicates(archDir, 'ffffffff')).toBeNull();
    // No key with exactly one persisted scope → that scope.
    expect(await loadDuplicates(archDir)).toEqual(analysis);

    // No key with several persisted scopes → the caller must choose.
    await persistDuplicates(
      archDir,
      await detectDuplicates(root, ['src'], {}, { key: 'bbbbbbbb', label: 'other (typescript)' })
    );
    await expect(loadDuplicates(archDir)).rejects.toThrow(/Multiple duplicate scopes/);

    // Nothing persisted at all → null.
    await fs.remove(dupRoot);
    expect(await loadDuplicates(archDir)).toBeNull();
  });

  it('refuses to persist an analysis whose manifest has no scopeKey', async () => {
    const analysis = await detectDuplicates(root, ['src']);
    expect(analysis.manifest.scopeKey).toBeUndefined();
    await expect(persistDuplicates(path.join(root, '.archguard'), analysis)).rejects.toThrow(
      /no scopeKey/
    );
  });
});

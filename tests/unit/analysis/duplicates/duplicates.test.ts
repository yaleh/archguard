import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
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
    const analysis = await detectDuplicates(root, ['src']);
    const archDir = path.join(root, '.archguard');
    expect(await loadDuplicates(archDir)).toBeNull();
    await persistDuplicates(archDir, analysis);
    expect(await loadDuplicates(archDir)).toEqual(analysis);
  });
});

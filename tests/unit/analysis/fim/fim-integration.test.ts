import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { computeImportApproximationFIM } from '@/analysis/fim/fim-analysis.js';
import type { ArchJSON } from '@/types/index.js';

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-fim-int-'));
  tempDirs.push(dir);
  await fs.ensureDir(path.join(dir, 'src/pkg-a'));
  await fs.ensureDir(path.join(dir, 'src/pkg-b'));
  await fs.ensureDir(path.join(dir, 'tests'));
  await fs.writeFile(path.join(dir, 'src/pkg-a/a.ts'), 'export const a = 1;');
  await fs.writeFile(path.join(dir, 'src/pkg-b/b.ts'), 'export const b = 2;');
  await fs.writeFile(path.join(dir, 'tests/a.test.ts'), 'import "../src/pkg-a/a.ts";');
  await fs.writeFile(path.join(dir, 'tests/b.test.ts'), 'import "../src/pkg-b/b.ts";');
  return dir;
}

function makeArchJson(workspaceRoot: string): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-03-30T00:00:00Z',
    workspaceRoot,
    sourceFiles: [
      path.join(workspaceRoot, 'src/pkg-a/a.ts'),
      path.join(workspaceRoot, 'src/pkg-b/b.ts'),
    ],
    entities: [
      {
        id: 'A',
        name: 'A',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: path.join(workspaceRoot, 'src/pkg-a/a.ts'), startLine: 1, endLine: 1 },
      },
      {
        id: 'B',
        name: 'B',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: path.join(workspaceRoot, 'src/pkg-b/b.ts'), startLine: 1, endLine: 1 },
      },
    ],
    relations: [{ id: 'r1', type: 'dependency', source: 'A', target: 'B' }],
  } as any;
}

function makePlugin(workspaceRoot: string): any {
  return {
    metadata: { fileExtensions: ['.ts'] },
    isTestFile: (filePath: string) => /\.test\.ts$/.test(filePath),
    extractTestStructure: (filePath: string) => ({
      filePath,
      frameworks: ['vitest'],
      testTypeHint: 'unit',
      testCases: [{ name: 'works', isSkipped: false, assertionCount: 1 }],
      importedSourceFiles: filePath.endsWith('a.test.ts')
        ? [path.join(workspaceRoot, 'src/pkg-a/a.ts')]
        : [path.join(workspaceRoot, 'src/pkg-b/b.ts')],
    }),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
});

describe('computeImportApproximationFIM', () => {
  it('computes file-level and package-level FIM data from a synthetic workspace', async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJson(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
    });

    expect(result.artifact.fileIds).toEqual(['src/pkg-a/a.ts', 'src/pkg-b/b.ts']);
    expect(result.artifact.fileResult.testCount).toBe(2);
    expect(result.artifact.packageNames).toEqual(['src/pkg-a', 'src/pkg-b']);
    expect(result.artifact.packageResult.fileCount).toBe(2);
  });

  it('captures a snapshot with normalized top eigenvalue shares', async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJson(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
    });

    expect(result.snapshot.source).toBe('import-approximation');
    expect(result.snapshot.topEigenvalueShares.length).toBeGreaterThan(0);
    expect(result.snapshot.topEigenvalueShares[0]).toBeLessThanOrEqual(1);
  });
});

async function makeWorkspaceWithNonProduction(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-fim-int-np-'));
  tempDirs.push(dir);
  await fs.ensureDir(path.join(dir, 'src/a'));
  await fs.ensureDir(path.join(dir, 'src/b'));
  await fs.ensureDir(path.join(dir, 'examples/x'));
  await fs.ensureDir(path.join(dir, 'tests'));
  await fs.writeFile(path.join(dir, 'src/a/a.ts'), 'export const a = 1;');
  await fs.writeFile(path.join(dir, 'src/b/b.ts'), 'export const b = 2;');
  await fs.writeFile(path.join(dir, 'examples/x/x.ts'), 'export const x = 99;');
  await fs.writeFile(path.join(dir, 'tests/a.test.ts'), 'import "../src/a/a.ts";');
  await fs.writeFile(path.join(dir, 'tests/b.test.ts'), 'import "../src/b/b.ts";');
  return dir;
}

function makeArchJsonWithNonProduction(workspaceRoot: string): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-03-30T00:00:00Z',
    workspaceRoot,
    sourceFiles: [
      path.join(workspaceRoot, 'src/a/a.ts'),
      path.join(workspaceRoot, 'src/b/b.ts'),
      path.join(workspaceRoot, 'examples/x/x.ts'),
    ],
    entities: [
      {
        id: 'A',
        name: 'A',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: path.join(workspaceRoot, 'src/a/a.ts'), startLine: 1, endLine: 1 },
      },
      {
        id: 'B',
        name: 'B',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: path.join(workspaceRoot, 'src/b/b.ts'), startLine: 1, endLine: 1 },
      },
      {
        id: 'X',
        name: 'X',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: path.join(workspaceRoot, 'examples/x/x.ts'),
          startLine: 1,
          endLine: 1,
        },
      },
    ],
    relations: [{ id: 'r1', type: 'dependency', source: 'A', target: 'B' }],
  } as any;
}

function makePluginWithNonProduction(workspaceRoot: string): any {
  return {
    metadata: { fileExtensions: ['.ts'] },
    isTestFile: (filePath: string) => /\.test\.ts$/.test(filePath),
    extractTestStructure: (filePath: string) => ({
      filePath,
      frameworks: ['vitest'],
      testTypeHint: 'unit',
      testCases: [{ name: 'works', isSkipped: false, assertionCount: 1 }],
      importedSourceFiles: filePath.endsWith('a.test.ts')
        ? [path.join(workspaceRoot, 'src/a/a.ts')]
        : [path.join(workspaceRoot, 'src/b/b.ts')],
    }),
  };
}

describe('packageNames and packageResult diagonal ordering consistency', () => {
  it('packageNames[i] matches packageResult.diagonal[i].fileId for all i', async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJson(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
    });

    // Guard against clampCoverageByPackage and derivePackageNames ordering diverging
    result.artifact.packageNames.forEach((name, i) => {
      expect(result.artifact.packageResult.diagonal[i]?.fileId).toBe(name);
    });
  });
});

describe('FIMSnapshot filteredTopEigenvalueShares consistency', () => {
  it('snapshot includes filteredTopEigenvalueShares field', async () => {
    const workspaceRoot = await makeWorkspaceWithNonProduction();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithNonProduction(workspaceRoot),
      plugin: makePluginWithNonProduction(workspaceRoot),
      workspaceRoot,
    });

    expect(result.snapshot.filteredTopEigenvalueShares).toBeDefined();
  });

  it('filteredTopEigenvalueShares sums to 1.0', async () => {
    const workspaceRoot = await makeWorkspaceWithNonProduction();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithNonProduction(workspaceRoot),
      plugin: makePluginWithNonProduction(workspaceRoot),
      workspaceRoot,
    });

    const shares = result.snapshot.filteredTopEigenvalueShares!;
    expect(shares.length).toBeGreaterThan(0);
    const sum = shares.reduce((acc, v) => acc + v, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('filteredTopEigenvalueShares differs from topEigenvalueShares when non-production packages exist', async () => {
    const workspaceRoot = await makeWorkspaceWithNonProduction();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithNonProduction(workspaceRoot),
      plugin: makePluginWithNonProduction(workspaceRoot),
      workspaceRoot,
    });

    // topEigenvalueShares comes from the unfiltered package result (includes examples/x)
    // filteredTopEigenvalueShares comes from the filtered production-only result (excludes examples/x)
    // Both must be defined and describe different manifolds — so they must differ.
    expect(result.snapshot.filteredTopEigenvalueShares).toBeDefined();
    expect(result.snapshot.topEigenvalueShares).toBeDefined();
    // The unfiltered result has 3 packages (src/a, src/b, examples/x); the filtered result
    // has only 2 production packages (src/a, src/b). Different sizes → different distributions.
    expect(result.snapshot.filteredTopEigenvalueShares!.length).not.toBe(
      result.snapshot.topEigenvalueShares.length
    );
  });
});

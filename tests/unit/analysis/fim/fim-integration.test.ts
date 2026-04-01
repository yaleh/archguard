import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { computeImportApproximationFIM, validateFIMAgainstGit } from '@/analysis/fim/fim-analysis.js';
import type { ArchJSON } from '@/types/index.js';
import type { FIMCurrentArtifact } from '@/analysis/fim/types.js';

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
    expect(result.artifact.packageNames).toEqual(['src']);
    expect(result.artifact.packageResult.fileCount).toBe(1);
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

  it('treats additional test globs as test-like paths during FIM coverage building', async () => {
    const workspaceRoot = await makeWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, 'src/pkg-a/a.integration.ts'),
      'import "./a.ts";'
    );

    const archJson = makeArchJson(workspaceRoot);
    archJson.sourceFiles = [
      ...archJson.sourceFiles,
      path.join(workspaceRoot, 'src/pkg-a/a.integration.ts'),
    ];

    const plugin = {
      metadata: { fileExtensions: ['.ts'] },
      isTestFile: (filePath: string) => /\.test\.ts$/.test(filePath),
      extractTestStructure: (filePath: string) => ({
        filePath,
        frameworks: ['vitest'],
        testTypeHint: 'unit',
        testCases: [{ name: 'works', isSkipped: false, assertionCount: 1 }],
        importedSourceFiles: [path.join(workspaceRoot, 'src/pkg-a/a.ts')],
      }),
    };

    const result = await computeImportApproximationFIM({
      archJson,
      plugin,
      workspaceRoot,
      patternConfig: {
        testFileGlobs: ['**/*.integration.ts'],
      },
    });

    expect(result.artifact.fileIds).not.toContain('src/pkg-a/a.integration.ts');
    expect(result.artifact.fileIds).toContain('src/pkg-a/a.ts');
  });
});

async function makeDeepWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-fim-int-deep-'));
  tempDirs.push(dir);
  await fs.ensureDir(path.join(dir, 'src/app/orders'));
  await fs.ensureDir(path.join(dir, 'src/app/payments'));
  await fs.ensureDir(path.join(dir, 'tests'));
  await fs.writeFile(path.join(dir, 'src/app/orders/service.ts'), 'export const orders = 1;');
  await fs.writeFile(path.join(dir, 'src/app/payments/service.ts'), 'export const payments = 1;');
  await fs.writeFile(path.join(dir, 'tests/orders.test.ts'), 'import "../src/app/orders/service.ts";');
  await fs.writeFile(path.join(dir, 'tests/payments.test.ts'), 'import "../src/app/payments/service.ts";');
  return dir;
}

function makeDeepArchJson(workspaceRoot: string): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-03-30T00:00:00Z',
    workspaceRoot,
    sourceFiles: [
      path.join(workspaceRoot, 'src/app/orders/service.ts'),
      path.join(workspaceRoot, 'src/app/payments/service.ts'),
    ],
    entities: [
      {
        id: 'OrdersService',
        name: 'OrdersService',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: path.join(workspaceRoot, 'src/app/orders/service.ts'),
          startLine: 1,
          endLine: 1,
        },
      },
      {
        id: 'PaymentsService',
        name: 'PaymentsService',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: {
          file: path.join(workspaceRoot, 'src/app/payments/service.ts'),
          startLine: 1,
          endLine: 1,
        },
      },
    ],
    relations: [
      {
        id: 'r1',
        type: 'dependency',
        source: 'OrdersService',
        target: 'PaymentsService',
      },
    ],
  } as any;
}

function makeDeepPlugin(workspaceRoot: string): any {
  return {
    metadata: { fileExtensions: ['.ts'] },
    isTestFile: (filePath: string) => /\.test\.ts$/.test(filePath),
    extractTestStructure: (filePath: string) => ({
      filePath,
      frameworks: ['vitest'],
      testTypeHint: 'unit',
      testCases: [{ name: 'works', isSkipped: false, assertionCount: 1 }],
      importedSourceFiles: filePath.endsWith('orders.test.ts')
        ? [path.join(workspaceRoot, 'src/app/orders/service.ts')]
        : [path.join(workspaceRoot, 'src/app/payments/service.ts')],
    }),
  };
}

describe('computeImportApproximationFIM depth suggestion', () => {
  it('defaults to depth 1 when no suggestedDepth is provided', async () => {
    const workspaceRoot = await makeDeepWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeDeepArchJson(workspaceRoot),
      plugin: makeDeepPlugin(workspaceRoot),
      workspaceRoot,
    });

    expect(result.artifact.packageNames).toEqual(['src']);
  });

  it('uses suggestedDepth for package derivation and exposes multi-depth comparison fields', async () => {
    const workspaceRoot = await makeDeepWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeDeepArchJson(workspaceRoot),
      plugin: makeDeepPlugin(workspaceRoot),
      workspaceRoot,
      suggestedDepth: 3,
    });

    expect(result.artifact.packageNames).toEqual(['src/app/orders', 'src/app/payments']);
    expect(result.artifact.depth1?.packageNames).toEqual(['src']);
    expect(result.artifact.depthN?.packageNames).toEqual(['src/app/orders', 'src/app/payments']);
    expect(result.artifact.depthComparison).toEqual(
      expect.objectContaining({
        defaultDepth: 1,
        suggestedDepth: 3,
      })
    );
    expect(
      result.artifact.depthComparison?.conditionNumberDelta === null ||
        typeof result.artifact.depthComparison?.conditionNumberDelta === 'number'
    ).toBe(true);
  });
});

async function makeWorkspaceWithBarrelRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-fim-int-barrel-'));
  tempDirs.push(dir);
  await fs.ensureDir(path.join(dir, 'src/pkg-a'));
  await fs.ensureDir(path.join(dir, 'src/pkg-b'));
  await fs.ensureDir(path.join(dir, 'tests'));
  await fs.writeFile(
    path.join(dir, 'src/index.ts'),
    ['/** package barrel */', 'export * from "./pkg-a/a.ts";', 'export * from "./pkg-b/b.ts";', ''].join('\n')
  );
  await fs.writeFile(path.join(dir, 'src/pkg-a/a.ts'), 'export const a = 1;');
  await fs.writeFile(path.join(dir, 'src/pkg-b/b.ts'), 'export const b = 2;');
  await fs.writeFile(path.join(dir, 'tests/a.test.ts'), 'import "../src/pkg-a/a.ts";');
  await fs.writeFile(path.join(dir, 'tests/b.test.ts'), 'import "../src/pkg-b/b.ts";');
  return dir;
}

function makeArchJsonWithBarrelRoot(workspaceRoot: string): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-03-30T00:00:00Z',
    workspaceRoot,
    sourceFiles: [
      path.join(workspaceRoot, 'src/index.ts'),
      path.join(workspaceRoot, 'src/pkg-a/a.ts'),
      path.join(workspaceRoot, 'src/pkg-b/b.ts'),
    ],
    entities: [
      {
        id: 'RootIndex',
        name: 'RootIndex',
        type: 'module',
        visibility: 'public',
        members: [],
        sourceLocation: { file: path.join(workspaceRoot, 'src/index.ts'), startLine: 1, endLine: 3 },
      },
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

describe('computeImportApproximationFIM barrel file semantics', () => {
  it('excludes verified barrel-only packages from filtered package FIM when barrelFiles are provided', async () => {
    const workspaceRoot = await makeWorkspaceWithBarrelRoot();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithBarrelRoot(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
      suggestedDepth: 2,
      barrelFiles: ['src/index.ts'],
    });

    expect(result.artifact.packageNames).toEqual(['src', 'src/pkg-a', 'src/pkg-b']);
    expect(result.artifact.filteredPackageResult.diagonal.map((entry) => entry.fileId)).toEqual([
      'src/pkg-a',
      'src/pkg-b',
    ]);
    expect(result.artifact.filteredPackageMatrix).toHaveLength(2);
  });

  it('does not exclude a candidate barrel package when the file contains real logic', async () => {
    const workspaceRoot = await makeWorkspaceWithBarrelRoot();
    await fs.writeFile(
      path.join(workspaceRoot, 'src/index.ts'),
      ['export * from "./pkg-a/a.ts";', 'export const runtimeFlag = true;', ''].join('\n')
    );

    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithBarrelRoot(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
      suggestedDepth: 2,
      barrelFiles: ['src/index.ts'],
    });

    expect(result.artifact.filteredPackageResult.diagonal.map((entry) => entry.fileId)).toEqual([
      'src',
      'src/pkg-a',
      'src/pkg-b',
    ]);
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

describe('FIMCurrentArtifact filteredPackageMatrix', () => {
  it('artifact has filteredPackageMatrix field (type-level guard)', async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJson(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
    });

    // TypeScript will error if FIMCurrentArtifact does not declare filteredPackageMatrix
    const artifact: FIMCurrentArtifact = result.artifact;
    expect(artifact.filteredPackageMatrix).toBeDefined();
  });

  it('filteredPackageMatrix is n_prod × n_prod when all packages are production', async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJson(workspaceRoot),
      plugin: makePlugin(workspaceRoot),
      workspaceRoot,
    });

    // All packages are production (src/pkg-a, src/pkg-b) → 2×2
    const n = result.artifact.filteredPackageResult.fileCount;
    expect(result.artifact.filteredPackageMatrix).toHaveLength(n);
    result.artifact.filteredPackageMatrix.forEach((row) => expect(row).toHaveLength(n));
  });

  it('filteredPackageMatrix is smaller than packageMatrix when non-production packages exist', async () => {
    const workspaceRoot = await makeWorkspaceWithNonProduction();
    const result = await computeImportApproximationFIM({
      archJson: makeArchJsonWithNonProduction(workspaceRoot),
      plugin: makePluginWithNonProduction(workspaceRoot),
      workspaceRoot,
    });

    // Default depth=1 aggregates to src + examples.
    // Filtering excludes examples, leaving only src.
    expect(result.artifact.packageMatrix.length).toBe(2);
    expect(result.artifact.filteredPackageMatrix.length).toBe(1);
  });
});

describe('validateFIMAgainstGit Mantel scope (filtered vs full)', () => {
  it('returns a 2×2 packageCochangeMatrix when only 2 production packageNames are passed', () => {
    // Simulate: 2 production packages + 1 non-production
    // When caller passes only the 2 filtered packageNames, the co-change matrix must be 2×2
    const coverage = {
      matrix: [
        [1, 0, 0], // test covering src/a only
        [0, 1, 0], // test covering src/b only
      ],
      testIds: ['t0', 't1'],
      fileIds: ['src/a/a.ts', 'src/b/b.ts', 'examples/x/x.ts'],
    };

    // A single commit touching src/a and src/b
    const commits = [
      {
        sha: 'abc',
        date: '2026-01-01',
        files: [
          { path: 'src/a/a.ts', insertions: 1, deletions: 0 },
          { path: 'src/b/b.ts', insertions: 1, deletions: 0 },
        ],
      },
    ];

    // 2×2 filtered Gram matrix for [src/a, src/b]
    const filteredPackageMatrix = [
      [1, 0],
      [0, 1],
    ];

    const { packageCochangeMatrix } = validateFIMAgainstGit({
      coverage,
      packageNames: ['src/a', 'src/b'], // filtered — 2 only
      packageMatrix: filteredPackageMatrix,
      commits,
      permutations: 10,
      seed: 42,
    });

    expect(packageCochangeMatrix).toHaveLength(2);
    packageCochangeMatrix.forEach((row) => expect(row).toHaveLength(2));
  });

  it('returns a 3×3 packageCochangeMatrix when all 3 packageNames are passed (demonstrating the pre-fix bug)', () => {
    const coverage = {
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      testIds: ['t0', 't1'],
      fileIds: ['src/a/a.ts', 'src/b/b.ts', 'examples/x/x.ts'],
    };

    const commits = [
      {
        sha: 'abc',
        date: '2026-01-01',
        files: [
          { path: 'src/a/a.ts', insertions: 1, deletions: 0 },
          { path: 'src/b/b.ts', insertions: 1, deletions: 0 },
        ],
      },
    ];

    // 3×3 full Gram matrix (includes examples/x with zero row/col)
    const fullPackageMatrix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];

    const { packageCochangeMatrix } = validateFIMAgainstGit({
      coverage,
      packageNames: ['src/a', 'src/b', 'examples/x'], // all 3
      packageMatrix: fullPackageMatrix,
      commits,
      permutations: 10,
      seed: 42,
    });

    // Full scope: 3×3 — trivially-zero pairs inflate the correlation
    expect(packageCochangeMatrix).toHaveLength(3);
  });
});

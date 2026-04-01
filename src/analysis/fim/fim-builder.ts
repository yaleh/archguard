import path from 'path';
import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import type { CoverageMatrix, FisherInformationResult, PackageFIM } from './types.js';

const EIGENVALUE_EPSILON = 1e-10;
const DEFAULT_FRAGILITY_THRESHOLD = 3;

function normalizeFileId(fileId: string): string {
  return fileId.replace(/\\/g, '/');
}

function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0) return [];
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex] ?? 0));
}

function multiply(left: number[][], right: number[][]): number[][] {
  if (left.length === 0 || right.length === 0) return [];

  const rightT = transpose(right);
  return left.map((leftRow) =>
    rightT.map((rightColumn) =>
      leftRow.reduce((sum, value, index) => sum + value * (rightColumn[index] ?? 0), 0)
    )
  );
}

function normalizeEigenvalues(values: number[]): number[] {
  return [...values]
    .map((value) => (Math.abs(value) <= EIGENVALUE_EPSILON ? 0 : value))
    .sort((a, b) => b - a);
}

function packageNameForFile(fileId: string, depth: number): string {
  const dir = path.dirname(normalizeFileId(fileId));
  if (dir === '.' || dir === '') return '.';

  const parts = dir.split('/').filter(Boolean);
  return parts.slice(0, Math.max(1, depth)).join('/');
}

export function computeGramMatrix(coverage: CoverageMatrix): number[][] {
  const { matrix } = coverage;
  if (matrix.length === 0 || coverage.fileIds.length === 0) {
    return coverage.fileIds.map(() => coverage.fileIds.map(() => 0));
  }

  const testCount = matrix.length;
  const fileCount = coverage.fileIds.length;
  const gram = Array.from({ length: fileCount }, () => new Array<number>(fileCount).fill(0));

  for (let testIndex = 0; testIndex < testCount; testIndex++) {
    const row = matrix[testIndex] ?? [];
    for (let left = 0; left < fileCount; left++) {
      if (!row[left]) continue;
      for (let right = left; right < fileCount; right++) {
        if (!row[right]) continue;
        gram[left][right] += row[left] * row[right];
        if (left !== right) {
          gram[right][left] = gram[left][right];
        }
      }
    }
  }

  return gram;
}

export function computeFisherInformation(
  coverage: CoverageMatrix,
  fragilityThreshold: number = DEFAULT_FRAGILITY_THRESHOLD
): FisherInformationResult {
  const gram = computeGramMatrix(coverage);
  const diagonal = coverage.fileIds.map((fileId, index) => ({
    fileId,
    selfInfo: gram[index]?.[index] ?? 0,
  }));

  const eigenvalues =
    gram.length === 0
      ? []
      : normalizeEigenvalues(
          new SingularValueDecomposition(new Matrix(gram), {
            autoTranspose: true,
          }).diagonal
        );
  const positiveEigenvalues = eigenvalues.filter((value) => value > EIGENVALUE_EPSILON);
  const hasRankDeficiency = eigenvalues.length > positiveEigenvalues.length;
  const conditionNumber =
    positiveEigenvalues.length === 0
      ? Number.POSITIVE_INFINITY
      : hasRankDeficiency
        ? Number.POSITIVE_INFINITY
        : positiveEigenvalues[0] / positiveEigenvalues[positiveEigenvalues.length - 1];

  const eigenvalueSum = eigenvalues.reduce((sum, value) => sum + value, 0);
  const eigenvalueSquareSum = eigenvalues.reduce((sum, value) => sum + value * value, 0);
  const effectiveDimension =
    eigenvalueSquareSum > 0 ? (eigenvalueSum * eigenvalueSum) / eigenvalueSquareSum : 0;

  const uncoveredFiles = diagonal.filter((entry) => entry.selfInfo === 0).map((entry) => entry.fileId);
  const fragilityHotspots = diagonal
    .filter((entry) => entry.selfInfo > 0 && entry.selfInfo < fragilityThreshold)
    .map((entry) => ({
      fileId: entry.fileId,
      selfInfo: entry.selfInfo,
      crb: 1 / entry.selfInfo,
    }));

  return {
    eigenvalues,
    conditionNumber,
    effectiveDimension,
    fileCount: coverage.fileIds.length,
    testCount: coverage.testIds.length,
    diagonal,
    uncoveredFiles,
    fragilityHotspots,
  };
}

export function aggregateToPackageLevel(
  coverage: CoverageMatrix,
  fileIds: string[] = coverage.fileIds,
  depth: number = 1
): PackageFIM {
  const packageNames: string[] = [];
  const packageIndex = new Map<string, number>();

  for (const fileId of fileIds) {
    const packageName = packageNameForFile(fileId, depth);
    if (!packageIndex.has(packageName)) {
      packageIndex.set(packageName, packageNames.length);
      packageNames.push(packageName);
    }
  }

  const packageCoverage = coverage.matrix.map((row) => {
    const pkgRow = new Array<number>(packageNames.length).fill(0);
    row.forEach((value, fileIndex) => {
      if (!value) return;
      const packageName = packageNameForFile(fileIds[fileIndex], depth);
      const pkgIndex = packageIndex.get(packageName);
      if (pkgIndex !== undefined) {
        pkgRow[pkgIndex] = 1;
      }
    });
    return pkgRow;
  });

  const pkgCoverageMatrix: CoverageMatrix = {
    matrix: packageCoverage,
    testIds: coverage.testIds,
    fileIds: packageNames,
  };

  return {
    matrix: computeGramMatrix(pkgCoverageMatrix),
    packageNames,
  };
}

/**
 * Top-level directory prefixes that indicate non-production code.
 * Uses a denylist (rather than an allowlist) so that any project layout works:
 * Go (cmd/, internal/, pkg/), Java (app/), Python (mypackage/), etc.
 */
const NON_PRODUCTION_PREFIXES = [
  'test',      // test/, tests/, testing/, testdata/
  '__test',    // __tests__/
  'example',   // example/, examples/
  'template',  // template/, templates/
  'script',    // script/, scripts/
  'vendor',    // vendor/ (Go)
  'doc',       // doc/, docs/
  'fixture',   // fixture/, fixtures/
  'mock',      // mock/, mocks/
  'bench',     // bench/, benchmark/, benchmarks/
];

/**
 * Returns true if the package name looks like a production source package.
 *
 * Uses a denylist so that any project layout is supported: TypeScript (src/, lib/),
 * Go (cmd/, internal/, pkg/), Java (app/), Python (project-name/), etc.
 * Excluded top-level prefixes: test*, __test*, example*, template*, script*,
 * vendor*, doc*, fixture*, mock*, bench*, and the bare root ".".
 */
export function isProductionPackage(name: string, extraPatterns: string[] = []): boolean {
  if (name === '.') return false;
  const first = name.split('/')[0]?.toLowerCase() ?? '';
  return ![...NON_PRODUCTION_PREFIXES, ...extraPatterns]
    .map((prefix) => prefix.toLowerCase())
    .some((prefix) => first.startsWith(prefix));
}

/**
 * Extracts the sub-CoverageMatrix restricted to production packages only.
 *
 * @param coverage The package-level CoverageMatrix (fileIds are package names).
 */
export function filterProductionCoverage(
  coverage: CoverageMatrix,
  extraPatterns: string[] = [],
  exactPackageExclusions: string[] = []
): CoverageMatrix {
  const keepIndices: number[] = [];
  const excludedPackages = new Set(exactPackageExclusions.map((name) => name.toLowerCase()));
  for (let i = 0; i < coverage.fileIds.length; i++) {
    const fileId = coverage.fileIds[i] ?? '';
    if (!excludedPackages.has(fileId.toLowerCase()) && isProductionPackage(fileId, extraPatterns)) {
      keepIndices.push(i);
    }
  }

  const subMatrix = coverage.matrix.map((row) => keepIndices.map((col) => row[col] ?? 0));
  const subFileIds = keepIndices.map((i) => coverage.fileIds[i] ?? '');
  return { matrix: subMatrix, testIds: coverage.testIds, fileIds: subFileIds };
}

/**
 * Returns a FisherInformationResult restricted to production packages only.
 *
 * Extracts the sub-coverage-matrix for packages passing `isProductionPackage`,
 * then re-runs SVD via `computeFisherInformation` on that sub-matrix. This
 * ensures κ and N_eff reflect the true geometry of the production manifold —
 * not diagonal selfInfo values, and not inflated by test/example/vendor packages.
 *
 * @param coverage The package-level CoverageMatrix (fileIds are package names).
 */
export function filterProductionPackages(
  coverage: CoverageMatrix,
  extraPatterns: string[] = [],
  exactPackageExclusions: string[] = []
): FisherInformationResult {
  return computeFisherInformation(
    filterProductionCoverage(coverage, extraPatterns, exactPackageExclusions)
  );
}

export function clampCoverageByPackage(
  coverage: CoverageMatrix,
  fileIds: string[] = coverage.fileIds,
  depth: number = 1
): number[][] {
  const packageNames: string[] = [];
  const packageIndex = new Map<string, number>();

  for (const fileId of fileIds) {
    const packageName = packageNameForFile(fileId, depth);
    if (!packageIndex.has(packageName)) {
      packageIndex.set(packageName, packageNames.length);
      packageNames.push(packageName);
    }
  }

  const indicator = fileIds.map((fileId) => {
    const row = new Array<number>(packageNames.length).fill(0);
    const pkgIndex = packageIndex.get(packageNameForFile(fileId, depth));
    if (pkgIndex !== undefined) {
      row[pkgIndex] = 1;
    }
    return row;
  });

  return multiply(coverage.matrix, indicator).map((row) => row.map((value) => (value > 0 ? 1 : 0)));
}

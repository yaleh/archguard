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
 * Returns true if the package name looks like a production source package.
 * Non-production packages (examples, templates, scripts, root) are excluded
 * from filtered κ/N_eff calculations to avoid spurious rank deficiency.
 */
export function isProductionPackage(name: string): boolean {
  if (name === '.') return false;
  if (name.startsWith('examples')) return false;
  if (name.startsWith('templates')) return false;
  if (name.startsWith('scripts')) return false;
  return name.startsWith('src/') || name.startsWith('lib/') || name.startsWith('core/');
}

/**
 * Filters out non-production zero-coverage packages from a FisherInformationResult
 * and re-computes conditionNumber and effectiveDimension from the remaining diagonal.
 */
export function filterProductionPackages(result: FisherInformationResult): FisherInformationResult {
  const filtered = result.diagonal.filter(
    (entry) => entry.selfInfo > 0 || isProductionPackage(entry.fileId)
  );

  const filteredEigenvalues = filtered.map((e) => e.selfInfo);
  const positiveFiltered = filteredEigenvalues.filter((v) => v > EIGENVALUE_EPSILON);
  const hasDeficiency = filteredEigenvalues.length > positiveFiltered.length;
  const conditionNumber =
    positiveFiltered.length === 0
      ? Number.POSITIVE_INFINITY
      : hasDeficiency
        ? Number.POSITIVE_INFINITY
        : positiveFiltered[0] / positiveFiltered[positiveFiltered.length - 1];

  const sum = filteredEigenvalues.reduce((s, v) => s + v, 0);
  const sumSq = filteredEigenvalues.reduce((s, v) => s + v * v, 0);
  const effectiveDimension = sumSq > 0 ? (sum * sum) / sumSq : 0;

  return {
    ...result,
    diagonal: filtered,
    eigenvalues: filteredEigenvalues,
    conditionNumber,
    effectiveDimension,
    fileCount: filtered.length,
    uncoveredFiles: filtered.filter((e) => e.selfInfo === 0).map((e) => e.fileId),
    fragilityHotspots: filtered
      .filter((e) => e.selfInfo > 0 && e.selfInfo < (result.fragilityHotspots[0]?.crb ?? 3))
      .map((e) => ({ fileId: e.fileId, selfInfo: e.selfInfo, crb: 1 / e.selfInfo })),
  };
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

export interface MantelTestResult {
  observedCorrelation: number;
  permutations: number;
  pValue: number;
  isValidProxy: boolean;
}

export interface MantelTestOptions {
  permutations?: number;
  seed?: number;
}

export interface MantelTestWithNullModelOptions extends MantelTestOptions {
  nullModelIterations?: number;
}

export interface MantelTestWithNullModelResult extends MantelTestResult {
  nullModelMeanR: number;
  nullModelMaxR: number;
  nullModelStdR: number;
  /** (observedR - nullMeanR) / nullStdR — how many σ above the null */
  separationScore: number;
  /** true when separationScore > 2.0 */
  isSignificantOverNull: boolean;
}

function assertSquareSymmetric(matrix: number[][], label: string): void {
  const size = matrix.length;
  for (let rowIndex = 0; rowIndex < size; rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    if (row.length !== size) {
      throw new Error(`${label} must be a square matrix.`);
    }
    for (let columnIndex = 0; columnIndex < size; columnIndex++) {
      if (Math.abs((matrix[rowIndex][columnIndex] ?? 0) - (matrix[columnIndex]?.[rowIndex] ?? 0)) > 1e-10) {
        throw new Error(`${label} must be symmetric.`);
      }
    }
  }
}

function strictUpperTriangle(matrix: number[][]): number[] {
  const values: number[] = [];
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    for (let columnIndex = rowIndex + 1; columnIndex < matrix.length; columnIndex++) {
      values.push(matrix[rowIndex][columnIndex] ?? 0);
    }
  }
  return values;
}

function rankValues(values: number[]): number[] {
  if (values.length === 0) return [];

  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);

  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[start].value) {
      end++;
    }

    const averageRank = (start + end + 2) / 2;
    for (let cursor = start; cursor <= end; cursor++) {
      ranks[sorted[cursor].index] = averageRank;
    }
    start = end + 1;
  }

  return ranks;
}

function buildRankMatrix(matrix: number[][]): number[][] {
  const size = matrix.length;
  if (size === 0) return [];

  const upper = strictUpperTriangle(matrix);
  const ranks = rankValues(upper);
  const maxRank = Math.max(...ranks, 1);
  const ranked: number[][] = Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  );

  let rankIndex = 0;
  for (let rowIndex = 0; rowIndex < size; rowIndex++) {
    for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex++) {
      const normalizedRank = ranks[rankIndex] / maxRank;
      ranked[rowIndex][columnIndex] = normalizedRank;
      ranked[columnIndex][rowIndex] = normalizedRank;
      rankIndex++;
    }
  }

  return ranked;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function permuteMatrix(matrix: number[][], permutation: number[]): number[][] {
  return permutation.map((rowIndex) => permutation.map((columnIndex) => matrix[rowIndex][columnIndex] ?? 0));
}

export function normalizeMatrix(matrix: number[][]): number[][] {
  assertSquareSymmetric(matrix, 'Matrix');
  return buildRankMatrix(matrix);
}

export function upperTriCorrelation(left: number[][], right: number[][]): number {
  if (left.length !== right.length) {
    throw new Error('Matrices must have the same dimensions.');
  }

  const leftValues = strictUpperTriangle(left);
  const rightValues = strictUpperTriangle(right);
  if (leftValues.length === 0) return 0;

  const meanLeft = leftValues.reduce((sum, value) => sum + value, 0) / leftValues.length;
  const meanRight = rightValues.reduce((sum, value) => sum + value, 0) / rightValues.length;

  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftValues.length; index++) {
    const leftDelta = leftValues[index] - meanLeft;
    const rightDelta = rightValues[index] - meanRight;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }

  if (leftVariance === 0 || rightVariance === 0) {
    return 0;
  }

  return numerator / Math.sqrt(leftVariance * rightVariance);
}

export function mantelTest(
  fimMatrix: number[][],
  cochangeMatrix: number[][],
  options: MantelTestOptions = {}
): MantelTestResult {
  const permutations = options.permutations ?? 999;
  if (fimMatrix.length === 0 && cochangeMatrix.length === 0) {
    return {
      observedCorrelation: 0,
      permutations,
      pValue: 1,
      isValidProxy: false,
    };
  }

  if (fimMatrix.length !== cochangeMatrix.length) {
    throw new Error('Matrices must have the same dimensions.');
  }

  assertSquareSymmetric(fimMatrix, 'FIM matrix');
  assertSquareSymmetric(cochangeMatrix, 'Co-change matrix');

  const size = fimMatrix.length;
  const left = normalizeMatrix(fimMatrix);
  const right = normalizeMatrix(cochangeMatrix);
  const observedCorrelation = upperTriCorrelation(left, right);
  const random = options.seed === undefined ? Math.random : createSeededRandom(options.seed);

  let greaterOrEqualCount = 0;
  for (let iteration = 0; iteration < permutations; iteration++) {
    const permutation = Array.from({ length: size }, (_, index) => index);
    for (let index = size - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [permutation[index], permutation[swapIndex]] = [permutation[swapIndex], permutation[index]];
    }

    const permuted = permuteMatrix(right, permutation);
    const permutedCorrelation = upperTriCorrelation(left, permuted);
    if (permutedCorrelation >= observedCorrelation) {
      greaterOrEqualCount++;
    }
  }

  const pValue = (greaterOrEqualCount + 1) / (permutations + 1);
  return {
    observedCorrelation,
    permutations,
    pValue,
    isValidProxy: pValue < 0.05,
  };
}

/**
 * Generates a random positive-definite symmetric matrix of the given size.
 * Uses M = A^T * A + ε*I where A is a random matrix.
 */
export function generateRandomPositiveDefiniteMatrix(size: number, seed?: number): number[][] {
  const random = seed === undefined ? Math.random : createSeededRandom(seed);
  const epsilon = 0.01;

  const a: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => random())
  );

  return Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => {
      let sum = 0;
      for (let k = 0; k < size; k++) {
        sum += (a[k]?.[rowIndex] ?? 0) * (a[k]?.[columnIndex] ?? 0);
      }
      return rowIndex === columnIndex ? sum + epsilon : sum;
    })
  );
}

/**
 * Runs the Mantel test and augments the result with a null-model baseline.
 * K random positive-definite matrices are compared against the co-change matrix.
 * If r(FIM, cochange) is not > 2σ above the null distribution, the signal is
 * likely spurious (e.g. because the co-change matrix is near-constant).
 */
export function mantelTestWithNullModel(
  fimMatrix: number[][],
  cochangeMatrix: number[][],
  options: MantelTestWithNullModelOptions = {}
): MantelTestWithNullModelResult {
  const nullModelIterations = options.nullModelIterations ?? 10;
  const base = mantelTest(fimMatrix, cochangeMatrix, options);

  const size = fimMatrix.length;
  if (size === 0) {
    return { ...base, nullModelMeanR: 0, nullModelMaxR: 0, nullModelStdR: 0, separationScore: 0, isSignificantOverNull: false };
  }

  const nullRs: number[] = [];
  for (let iteration = 0; iteration < nullModelIterations; iteration++) {
    const iterSeed = options.seed === undefined ? undefined : options.seed * 1000 + iteration + 1;
    const randomMatrix = generateRandomPositiveDefiniteMatrix(size, iterSeed);
    const nullResult = mantelTest(randomMatrix, cochangeMatrix, { permutations: options.permutations, seed: iterSeed });
    nullRs.push(nullResult.observedCorrelation);
  }

  const nullMeanR = nullRs.reduce((sum, r) => sum + r, 0) / nullRs.length;
  const nullMaxR = Math.max(...nullRs);
  const variance = nullRs.reduce((sum, r) => sum + (r - nullMeanR) ** 2, 0) / nullRs.length;
  const nullStdR = Math.sqrt(variance);
  const separationScore = nullStdR > 0 ? (base.observedCorrelation - nullMeanR) / nullStdR : 0;

  return {
    ...base,
    nullModelMeanR: nullMeanR,
    nullModelMaxR: nullMaxR,
    nullModelStdR: nullStdR,
    separationScore,
    isSignificantOverNull: separationScore > 2.0,
  };
}

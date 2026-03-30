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

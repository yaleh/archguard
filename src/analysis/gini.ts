/**
 * Computes the Gini coefficient for a distribution of values.
 *
 * Formula (1-indexed, sorted ascending):
 *   G = (2 * Σ(i * v[i])) / (n * Σv[i]) - (n+1)/n
 *
 * @param values - Array of non-negative numbers
 * @returns Gini coefficient in [0, 1]; 0 means perfect equality
 */
export function giniCoefficient(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  if (sum === 0) return 0;

  // 1-indexed: i runs from 1 to n
  const weightedSum = sorted.reduce((acc, v, idx) => acc + (idx + 1) * v, 0);

  return (2 * weightedSum) / (n * sum) - (n + 1) / n;
}

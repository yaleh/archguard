import path from 'path';
import fs from 'fs-extra';
import type { FIMSnapshot } from './types.js';

function encodeNonFiniteNumbers(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (value === Number.POSITIVE_INFINITY) return 'Infinity';
    if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeNonFiniteNumbers(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        encodeNonFiniteNumbers(entry),
      ])
    );
  }
  return value;
}

function decodeNonFiniteNumbers(value: unknown): unknown {
  if (value === 'Infinity') return Number.POSITIVE_INFINITY;
  if (value === '-Infinity') return Number.NEGATIVE_INFINITY;
  if (Array.isArray(value)) {
    return value.map((entry) => decodeNonFiniteNumbers(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        decodeNonFiniteNumbers(entry),
      ])
    );
  }
  return value;
}

function historyFilePath(outputDir: string): string {
  return path.join(outputDir, 'query', 'fim', 'fim-history.json');
}

export async function readFIMHistory(outputDir: string): Promise<FIMSnapshot[]> {
  const filePath = historyFilePath(outputDir);
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  return decodeNonFiniteNumbers(await fs.readJson(filePath)) as FIMSnapshot[];
}

export async function appendFIMSnapshot(outputDir: string, snapshot: FIMSnapshot): Promise<void> {
  const filePath = historyFilePath(outputDir);
  const history = await readFIMHistory(outputDir);
  history.push(snapshot);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, encodeNonFiniteNumbers(history), { spaces: 2 });
}

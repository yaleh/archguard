import path from 'path';
import fs from 'fs-extra';
import type { FIMCurrentArtifact } from './types.js';

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

function fimDir(archguardDir: string): string {
  return path.join(archguardDir, 'query', 'fim');
}

function currentFilePath(archguardDir: string): string {
  return path.join(fimDir(archguardDir), 'current.json');
}

export async function writeFIMCurrentArtifact(
  archguardDir: string,
  artifact: FIMCurrentArtifact
): Promise<void> {
  const filePath = currentFilePath(archguardDir);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, encodeNonFiniteNumbers(artifact), { spaces: 2 });
}

export async function readFIMCurrentArtifact(
  archguardDir: string
): Promise<FIMCurrentArtifact | null> {
  const filePath = currentFilePath(archguardDir);
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  return decodeNonFiniteNumbers(await fs.readJson(filePath)) as FIMCurrentArtifact;
}

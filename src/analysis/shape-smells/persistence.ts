/**
 * Persistence layer for shape-smell analysis results.
 *
 * Writes and reads literal dispersion results under
 * .archguard/query/shape-smells/.
 */

import fs from 'fs-extra';
import path from 'path';
import type { ShapeSmellAnalysis, LiteralDispersionSmell } from './types.js';
import { errorMessage } from '@/utils/error-message.js';

const SHAPE_SMELLS_SUBDIR = 'query/shape-smells';
const MANIFEST_FILE = 'manifest.json';
const LITERAL_DISPERSION_FILE = 'literal-dispersion.json';

function shapeSmellsDir(outputDir: string): string {
  return path.join(outputDir, SHAPE_SMELLS_SUBDIR);
}

/**
 * Persist full shape-smell analysis results to disk.
 *
 * Writes `manifest.json` and `literal-dispersion.json` under
 * `<archDir>/query/shape-smells/`.
 */
export async function persistResults(archDir: string, analysis: ShapeSmellAnalysis): Promise<void> {
  const dir = shapeSmellsDir(archDir);
  await fs.ensureDir(dir);

  await fs.writeJson(path.join(dir, MANIFEST_FILE), analysis.manifest, { spaces: 2 });

  // Write literal-dispersion results separately for convenience
  const literalResult = analysis.results.find((r) => r.layer === 'literal-dispersion');
  if (literalResult) {
    await fs.writeJson(path.join(dir, LITERAL_DISPERSION_FILE), literalResult.smells, {
      spaces: 2,
    });
  }
}

/**
 * Load shape-smell analysis results from disk.
 *
 * Returns null when the directory or files don't exist. Throws a
 * descriptive error on malformed JSON.
 */
export async function loadResults(archDir: string): Promise<ShapeSmellAnalysis | null> {
  const dir = shapeSmellsDir(archDir);

  if (!(await fs.pathExists(dir))) {
    return null;
  }

  const manifestPath = path.join(dir, MANIFEST_FILE);
  const literalPath = path.join(dir, LITERAL_DISPERSION_FILE);

  if (!(await fs.pathExists(manifestPath))) {
    return null;
  }

  try {
    const manifest = (await fs.readJson(manifestPath)) as ShapeSmellAnalysis['manifest'];
    let smells: LiteralDispersionSmell[] = [];

    if (await fs.pathExists(literalPath)) {
      smells = (await fs.readJson(literalPath)) as LiteralDispersionSmell[];
    }

    return {
      manifest,
      results: [
        {
          layer: 'literal-dispersion',
          smells,
        },
      ],
    };
  } catch (err: unknown) {
    const message = errorMessage(err);
    throw new Error(`Failed to load shape-smell results from ${dir}: ${message}`);
  }
}

/**
 * Load just the literal-dispersion smells from disk.
 */
export async function loadLiteralDispersion(
  archDir: string
): Promise<LiteralDispersionSmell[] | null> {
  const results = await loadResults(archDir);
  if (!results) return null;

  const literalResult = results.results.find((r) => r.layer === 'literal-dispersion');
  return literalResult?.smells ?? null;
}

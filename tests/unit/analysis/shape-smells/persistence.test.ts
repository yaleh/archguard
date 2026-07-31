/**
 * Phase C: Persistence tests for shape-smell analysis results.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  persistResults,
  loadResults,
  loadLiteralDispersion,
} from '@/analysis/shape-smells/persistence';
import type { ShapeSmellAnalysis } from '@/analysis/shape-smells/types';

function makeAnalysis(): ShapeSmellAnalysis {
  return {
    manifest: {
      version: '1',
      generatedAt: '2026-07-31T00:00:00Z',
      totalSmells: 2,
      bySeverity: { info: 1, warning: 1 },
    },
    results: [
      {
        layer: 'literal-dispersion',
        smells: [
          {
            typeName: 'AppKind',
            value: 'web',
            files: ['capture.ts', 'types.ts'],
            dispersion: 2,
            severity: 'info',
            locations: [
              { file: 'capture.ts', line: 10 },
              { file: 'types.ts', line: 1 },
            ],
          },
          {
            typeName: 'AppKind',
            value: 'mobile',
            files: ['capture.ts', 'query.ts', 'types.ts'],
            dispersion: 3,
            severity: 'warning',
            locations: [
              { file: 'capture.ts', line: 15 },
              { file: 'query.ts', line: 5 },
              { file: 'types.ts', line: 2 },
            ],
          },
        ],
      },
    ],
  };
}

describe('persistence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `archguard-shape-smells-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('persistResults', () => {
    it('writes manifest.json and literal-dispersion.json under .archguard/query/shape-smells/', async () => {
      const analysis = makeAnalysis();

      await persistResults(tmpDir, analysis);

      const outDir = path.join(tmpDir, 'query', 'shape-smells');
      expect(await fs.pathExists(outDir)).toBe(true);
      expect(await fs.pathExists(path.join(outDir, 'manifest.json'))).toBe(true);
      expect(await fs.pathExists(path.join(outDir, 'literal-dispersion.json'))).toBe(true);
    });

    it('writes correct manifest content', async () => {
      const analysis = makeAnalysis();

      await persistResults(tmpDir, analysis);

      const outDir = path.join(tmpDir, 'query', 'shape-smells');
      const manifest = (await fs.readJson(path.join(outDir, 'manifest.json'))) as {
        totalSmells: number;
        bySeverity: { info: number; warning: number };
      };
      expect(manifest.totalSmells).toBe(2);
      expect(manifest.bySeverity.info).toBe(1);
      expect(manifest.bySeverity.warning).toBe(1);
    });

    it('writes correct literal-dispersion content', async () => {
      const analysis = makeAnalysis();

      await persistResults(tmpDir, analysis);

      const outDir = path.join(tmpDir, 'query', 'shape-smells');
      const smells = (await fs.readJson(path.join(outDir, 'literal-dispersion.json'))) as Array<{
        value: string;
      }>;
      expect(smells).toHaveLength(2);
      expect(smells[0].value).toBe('web');
      expect(smells[1].value).toBe('mobile');
    });

    it('creates the directory if it does not exist', async () => {
      const freshDir = path.join(tmpDir, 'fresh');
      const analysis = makeAnalysis();

      await persistResults(freshDir, analysis);

      const outDir = path.join(freshDir, 'query', 'shape-smells');
      expect(await fs.pathExists(outDir)).toBe(true);
    });
  });

  describe('loadResults', () => {
    it('reads back persisted analysis faithfully', async () => {
      const analysis = makeAnalysis();
      await persistResults(tmpDir, analysis);

      const loaded = await loadResults(tmpDir);
      expect(loaded).not.toBeNull();
      if (!loaded) throw new Error('expected loaded to be non-null');

      expect(loaded.manifest.totalSmells).toBe(2);
      expect(loaded.manifest.bySeverity).toEqual({ info: 1, warning: 1 });

      const literalResult = loaded.results.find((r) => r.layer === 'literal-dispersion');
      expect(literalResult).toBeDefined();
      if (!literalResult) throw new Error('expected literalResult to be defined');
      expect(literalResult.smells).toHaveLength(2);
      expect(literalResult.smells[0].value).toBe('web');
      expect(literalResult.smells[1].value).toBe('mobile');
    });

    it('returns null when directory does not exist', async () => {
      const result = await loadResults(path.join(tmpDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('returns null when manifest.json does not exist', async () => {
      const outDir = path.join(tmpDir, 'query', 'shape-smells');
      await fs.ensureDir(outDir);

      const result = await loadResults(tmpDir);
      expect(result).toBeNull();
    });

    it('throws descriptive error on malformed JSON', async () => {
      const outDir = path.join(tmpDir, 'query', 'shape-smells');
      await fs.ensureDir(outDir);
      await fs.writeFile(path.join(outDir, 'manifest.json'), 'not valid json {{{');

      await expect(loadResults(tmpDir)).rejects.toThrow(/Failed to load shape-smell results/);
    });
  });

  describe('loadLiteralDispersion', () => {
    it('returns only literal-dispersion smells', async () => {
      const analysis = makeAnalysis();
      await persistResults(tmpDir, analysis);

      const smells = await loadLiteralDispersion(tmpDir);
      expect(smells).toHaveLength(2);
      expect(smells[0].typeName).toBe('AppKind');
    });

    it('returns null when no results persisted', async () => {
      const result = await loadLiteralDispersion(path.join(tmpDir, 'nonexistent'));
      expect(result).toBeNull();
    });
  });
});

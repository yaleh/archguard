/**
 * Architectural inversion guard: ARCH-INVERSION-001 / DIR-001
 *
 * `src/types` must be a foundational leaf package with no imports from
 * `src/analysis`. This test will fail if any file under src/types imports
 * from the analysis package — preventing the types<->analysis bidirectional
 * dependency cycle (fixed on master by fd0733c, which moved FitnessConfig to
 * `src/types/fitness-rules.ts`) from silently returning.
 *
 * Ported from the superseded branch `milestones/archguard/ARCH-INVERSION-001`
 * (commit e086e65) and adapted to master: the assertion is a generic
 * structural check (independent of which file holds FitnessConfig) and covers
 * every import form into src/analysis — alias (`@/analysis/...` and the bare
 * index form `@/analysis`), relative paths at any depth (`../analysis/...`),
 * side-effect imports, and dynamic `import(...)` calls.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('ARCH-INVERSION-001: src/types must not import from src/analysis', () => {
  const typesDir = join(__dirname, '../../src/types');
  const tsFiles = collectTsFiles(typesDir);

  it('should have at least one .ts file in src/types', () => {
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it('should have no imports crossing into src/analysis from src/types', () => {
    // Matches any import specifier that resolves into src/analysis:
    //   - alias forms:      from '@/analysis/...'  and  from '@/analysis'
    //   - relative forms:   from '../analysis/...' (any depth of ../)
    //   - side-effect:      import '@/analysis/...'
    //   - dynamic imports:  import('@/analysis/...')
    const analysisImportPattern =
      /(?:from\s+|import\s*\(?\s*)(["'])((?:(?:\.\.\/)+analysis|@\/analysis)(?:\/|\1))/;

    const violations: string[] = [];

    for (const file of tsFiles) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        if (analysisImportPattern.test(line)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

/**
 * Cross-module scope filter for literal dispersion smells.
 *
 * Filters smells to only those whose files span at least two distinct
 * module directories under `src/` (first path segment).
 */

import type { LiteralDispersionSmell } from './types.js';

/**
 * Compute the module span for a smell's file set.
 *
 * Parses each file path's first segment under `srcRoot` as the module name.
 * Files directly at the root (no subdirectory) are ignored for
 * cross-module purposes.
 *
 * @returns `modules` set of distinct module names and `crossesBoundary` flag.
 */
export function computeModuleSpan(
  files: string[],
  srcRoot: string
): { modules: string[]; crossesBoundary: boolean } {
  const modules = new Set<string>();

  for (const file of files) {
    // Normalize: strip leading srcRoot path
    let relative = file;
    if (file.startsWith(srcRoot)) {
      relative = file.slice(srcRoot.length);
    }
    // Strip leading slash
    if (relative.startsWith('/')) {
      relative = relative.slice(1);
    }

    // First path segment is the module
    const segments = relative.split('/');
    if (segments.length > 1) {
      // File is inside a module directory
      modules.add(segments[0]);
    }
    // Root-level files are skipped (don't add to modules)
  }

  const modulesArr = [...modules].sort();
  return { modules: modulesArr, crossesBoundary: modulesArr.length >= 2 };
}

/**
 * Filter dispersion smells to only those that cross module boundaries.
 *
 * When `srcRoot` is not provided, returns all smells unchanged (no scope
 * boundary to check). When provided, drops smells whose files are all in
 * the same module directory. Root-level files are ignored for
 * boundary-crossing detection.
 */
export function filterCrossModule(
  smells: LiteralDispersionSmell[],
  srcRoot?: string
): LiteralDispersionSmell[] {
  if (!srcRoot) {
    return smells;
  }

  return smells.filter((smell) => {
    const { crossesBoundary } = computeModuleSpan(smell.files, srcRoot);
    return crossesBoundary;
  });
}

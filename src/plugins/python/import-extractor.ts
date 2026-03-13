/**
 * PythonImportExtractor
 *
 * Extracts inter-package import relations from Python module imports.
 * Filters to only known module IDs, resolves relative imports, and
 * deduplicates the result.
 */
import type { PythonRawImport } from './types.js';

export interface ImportRelation {
  sourceModuleId: string;
  targetModuleId: string;
}

export class PythonImportExtractor {
  /**
   * Extract inter-package import relations from a module's imports.
   *
   * @param imports - Raw imports extracted from the Python module
   * @param currentModuleId - Dotted module ID of the file being processed (e.g. lmdeploy.pytorch.models)
   * @param knownModuleIds - Set of all known dotted module IDs in the project
   * @returns Deduplicated list of import relations that connect known modules
   */
  extract(
    imports: PythonRawImport[],
    currentModuleId: string,
    knownModuleIds: Set<string>
  ): ImportRelation[] {
    const seen = new Set<string>();
    const result: ImportRelation[] = [];

    for (const imp of imports) {
      const module = imp.module;
      if (!module) continue;

      // Skip __future__ imports early
      if (module === '__future__' || module.startsWith('__future__.')) continue;

      let targetModuleId: string | null;

      if (!module.startsWith('.')) {
        // Absolute import: use resolveToKnown which handles project-root prefix stripping
        targetModuleId = this.resolveToKnown(module, knownModuleIds);
      } else {
        // Relative import: resolve to dotted path first, then check knownModuleIds
        const resolved = this.resolveModuleId(module, currentModuleId);
        if (!resolved) continue;
        targetModuleId = knownModuleIds.has(resolved) ? resolved : null;
      }

      if (!targetModuleId) continue;

      // Skip self-imports
      if (targetModuleId === currentModuleId) continue;

      // Deduplicate
      if (seen.has(targetModuleId)) continue;
      seen.add(targetModuleId);

      result.push({ sourceModuleId: currentModuleId, targetModuleId });
    }

    return result;
  }

  /**
   * Resolve a module string to a known module ID, with project-root prefix stripping.
   *
   * For absolute imports, tries:
   *   1. Direct match against knownModuleIds
   *   2. Right-side truncation (strip last component): "a.b.c" → "a.b" → "a"
   *   3. Left-side stripping (remove project root prefix): "pkg.a.b" → "a.b" → "a"
   *      combined with right-side truncation at each level
   *
   * This fixes the case where sources are at /project/mypackage/ so known IDs
   * have no "mypackage." prefix, but code uses `from mypackage.sub import X`.
   */
  private resolveToKnown(
    absoluteModule: string,
    knownModuleIds: Set<string>
  ): string | null {
    const parts = absoluteModule.split('.');
    // Try all left-prefix strip levels (0 = no strip, 1 = strip first component, etc.)
    for (let leftStrip = 0; leftStrip < parts.length; leftStrip++) {
      const remaining = parts.slice(leftStrip);
      // Try all right-side truncations
      for (let rightLen = remaining.length; rightLen > 0; rightLen--) {
        const candidate = remaining.slice(0, rightLen).join('.');
        if (knownModuleIds.has(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * Resolve a module string to an absolute dotted module ID.
   *
   * Handles:
   *   - Absolute: 'lmdeploy.messages' → 'lmdeploy.messages'
   *   - Relative single dot: '.utils' in 'lmdeploy.pytorch.models' → 'lmdeploy.pytorch.utils'
   *   - Relative single dot only: '.' in 'lmdeploy.pytorch.models' → 'lmdeploy.pytorch'
   *   - Relative double dot: '..messages' in 'lmdeploy.pytorch.models' → 'lmdeploy.messages'
   *   - Relative double dot only: '..' in 'lmdeploy.pytorch.models' → 'lmdeploy'
   */
  private resolveModuleId(module: string, currentModuleId: string): string | null {
    if (!module.startsWith('.')) {
      // Absolute import — return as-is
      return module;
    }

    // Count leading dots to determine how many levels to go up
    let dotCount = 0;
    while (dotCount < module.length && module[dotCount] === '.') {
      dotCount++;
    }
    const suffix = module.slice(dotCount); // the part after the dots

    // Split the current module into parts
    const parts = currentModuleId.split('.');

    // Go up (dotCount) levels: 1 dot = stay in same package (remove last component),
    // 2 dots = go up one more level, etc.
    const basePartsCount = parts.length - dotCount;
    if (basePartsCount < 0) {
      // Can't go up that many levels
      return null;
    }

    const baseParts = parts.slice(0, basePartsCount);

    if (suffix) {
      return [...baseParts, suffix].join('.');
    } else {
      // '.' alone → parent package (or empty string if at root)
      return baseParts.join('.') || null;
    }
  }
}

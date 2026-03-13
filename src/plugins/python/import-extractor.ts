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

      // Resolve the target module ID (handles relative imports)
      const targetModuleId = this.resolveModuleId(module, currentModuleId);
      if (!targetModuleId) continue;

      // Skip __future__ imports
      if (targetModuleId === '__future__' || targetModuleId.startsWith('__future__.')) continue;

      // Skip self-imports
      if (targetModuleId === currentModuleId) continue;

      // Skip modules not in the known set
      if (!knownModuleIds.has(targetModuleId)) continue;

      // Deduplicate
      if (seen.has(targetModuleId)) continue;
      seen.add(targetModuleId);

      result.push({ sourceModuleId: currentModuleId, targetModuleId });
    }

    return result;
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

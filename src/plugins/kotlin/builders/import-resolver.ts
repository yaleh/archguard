/**
 * ImportResolver — classifies Kotlin imports as internal (same module) or external,
 * and converts internal import paths to relative path segments.
 *
 * "Internal" means the import starts with the module's root package prefix.
 * Example: moduleRoot = 'com.example.app'
 *   - 'com.example.app.data.UserRepository' → internal
 *   - 'com.example.other.Foo'               → external (different subtree)
 *   - 'android.os.Bundle'                   → external
 */
export class ImportResolver {
  /**
   * Returns true when `importPath` belongs to `moduleRoot`.
   *
   * The check requires that the import starts with `moduleRoot + '.'` so that
   * a module `com.example.app` does NOT match `com.example.apptools.Foo`.
   */
  isInternal(importPath: string, moduleRoot: string): boolean {
    return importPath.startsWith(moduleRoot + '.');
  }

  /**
   * Strips the `moduleRoot.` prefix from an internal import path and converts
   * the remaining dot-separated segments to a slash-separated relative path.
   *
   * Example:
   *   importPath  = 'com.example.app.data.UserRepository'
   *   moduleRoot  = 'com.example.app'
   *   → 'data/UserRepository'
   *
   * Callers must ensure `isInternal()` returns true before calling this method.
   */
  toRelativePath(importPath: string, moduleRoot: string): string {
    // Remove the moduleRoot prefix and the following dot
    const suffix = importPath.slice(moduleRoot.length + 1);
    return suffix.replace(/\./g, '/');
  }
}

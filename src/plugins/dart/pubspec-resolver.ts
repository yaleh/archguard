/**
 * Dart `package:` import resolution.
 *
 * Dart packages are declared by a `pubspec.yaml` whose `name:` field is the
 * package identifier. A `package:<name>/<rest>` import resolves to
 * `<pubspec-dir>/lib/<rest>` (Dart's implicit `lib/` source root), so a melos
 * monorepo's `package:mower_common/common/product_factory.dart` maps to
 * `packages/biz_projects/mower_common/lib/common/product_factory.dart`.
 *
 * This is Dart-specific knowledge (pubspec format + lib/ convention), so it
 * lives in the Dart plugin rather than in the language-agnostic TestAnalyzer.
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';

/** Directories that never contain user-authored pubspec.yaml files. */
const PUBSPEC_IGNORE = ['**/build/**', '**/.dart_tool/**', '**/node_modules/**', '**/coverage/**'];

/**
 * Scan a workspace for `pubspec.yaml` files and build a `package name →
 * absolute directory` map. A package may be the workspace root itself
 * (single-package project) or a sub-package in a melos monorepo.
 */
export async function buildPackageMap(workspaceRoot: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pubspecs = await glob('**/pubspec.yaml', {
    cwd: workspaceRoot,
    absolute: true,
    ignore: PUBSPEC_IGNORE,
  });

  await Promise.all(
    pubspecs.map(async (pubspecPath) => {
      try {
        const content = await fs.readFile(pubspecPath, 'utf-8');
        const match = content.match(/^name:\s*["']?([A-Za-z0-9_]+)["']?/m);
        if (match) {
          map.set(match[1], path.dirname(pubspecPath));
        }
      } catch {
        // unreadable pubspec — skip
      }
    })
  );

  return map;
}

/**
 * Resolve a single Dart import URI to an absolute source path, or null when it
 * is not project-internal:
 *
 * - `dart:*` core libraries → null
 * - `package:*` with an unknown package name (external deps like flutter,
 *   test, mocktail) → null
 * - `package:*` with a known workspace package → `<pkg-dir>/lib/<rest>`
 * - relative (`./`, `../`) → resolved against the test file's directory
 *
 * Synchronous: the package map is built once at plugin initialization.
 */
export function resolveImportUri(
  packageMap: ReadonlyMap<string, string>,
  importUri: string,
  testFilePath: string
): string | null {
  if (importUri.startsWith('dart:')) return null;

  if (importUri.startsWith('package:')) {
    const rest = importUri.slice('package:'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null; // bare `package:foo` with no path
    const packageName = rest.slice(0, slash);
    const subPath = rest.slice(slash + 1);
    const packageDir = packageMap.get(packageName);
    if (!packageDir) return null; // external dependency
    return path.join(packageDir, 'lib', subPath);
  }

  // Relative import (`./foo.dart`, `../foo.dart`) — project-internal by definition.
  return path.resolve(path.dirname(testFilePath), importUri);
}

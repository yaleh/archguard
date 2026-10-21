/**
 * Single source of truth for ArchGuard's built-in default exclusions.
 *
 * Before this module existed the same idea was hardcoded in three places
 * (file discovery, the config schema default, and the TypeScript plugin's
 * `builtinExcludes`) with three different rule lists — none of which excluded
 * build output or historical archives, so `dist/`, `vendor/` and `archive/`
 * trees were parsed as source and inflated every downstream metric.
 *
 * Semantics:
 * - Applied only when the caller supplies no explicit `exclude` list
 *   (CLI `-e`, config `exclude`, diagram-level `exclude`). An explicit list
 *   REPLACES this set — it is not unioned with it.
 * - When the user explicitly selects a directory that a directory rule would
 *   exclude (e.g. `-s ./dist`), that rule is dropped for this analysis:
 *   `defaultExcludesForSource()` implements that escape hatch.
 */

/**
 * Built-in default exclusion globs. Keep the entries ordered and free of
 * duplicates: `isDefaultExcludePatterns()` compares against this exact set.
 */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = Object.freeze([
  '**/*.{test,spec}.{ts,tsx,js,jsx}',
  '**/node_modules/**',
  '**/dist/**',
  '**/vendor/**',
  '**/archive/**',
]);

/**
 * Directory-name rules (a whole `<name>` directory segment), mapped to `<name>`.
 * Only these rules can be neutralized by an explicit source selection; file
 * rules like the test/spec glob never exclude a whole directory.
 */
const DIRECTORY_RULE_NAMES: ReadonlyMap<string, string> = new Map(
  DEFAULT_EXCLUDE_PATTERNS.flatMap((pattern) => {
    const match = /^\*\*\/([^/*{}]+)\/\*\*$/.exec(pattern);
    return match ? [[pattern, match[1]] as const] : [];
  })
);

function pathSegments(value: string): string[] {
  return value.replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * Directory names covered by the built-in defaults (`node_modules`, `dist`,
 * `vendor`, `archive`). Auto-detection uses this so it does not mint
 * per-module diagrams for trees the defaults are meant to keep out.
 */
export function defaultExcludeDirectoryNames(): string[] {
  return [...new Set(DIRECTORY_RULE_NAMES.values())];
}

/**
 * Default excludes that still apply when `source` is the root of the analysis.
 *
 * A user who explicitly points the analyzer at a default-excluded directory
 * (`-s ./dist`, `-s ./node_modules/pkg`) must still get that directory parsed:
 * drop directory rules whose name is already part of the selected path.
 */
export function defaultExcludesForSource(source: string): string[] {
  const segments = new Set(pathSegments(source));
  return DEFAULT_EXCLUDE_PATTERNS.filter((pattern) => {
    const dirName = DIRECTORY_RULE_NAMES.get(pattern);
    return dirName === undefined || !segments.has(dirName);
  });
}

/**
 * Negated absolute globs for callers that glob relative to a workspace root
 * (the TypeScript plugin / ts-morph). Patterns are rooted at `workspaceRoot`,
 * which makes the escape hatch implicit: with a workspace root ending in
 * `dist`, the rooted directory rule requires a *nested* dist to match, leaving
 * the selected directory itself analyzable.
 */
export function defaultExcludeNegations(workspaceRoot: string): string[] {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return defaultExcludesForSource(root).map((pattern) => `!${root}/${pattern}`);
}

/**
 * True when `patterns` is an explicit restatement of the default set
 * (typically the config schema default flowing through the CLI). Such a list
 * is treated as "defaults", so default-only behavior — including the
 * explicit-source escape hatch and verbose visibility — still applies.
 */
export function isDefaultExcludePatterns(patterns: readonly string[]): boolean {
  if (patterns.length !== DEFAULT_EXCLUDE_PATTERNS.length) return false;
  const expected = new Set(DEFAULT_EXCLUDE_PATTERNS);
  return patterns.every((pattern) => expected.has(pattern));
}

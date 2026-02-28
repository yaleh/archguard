/**
 * tsconfig-finder - locate the nearest tsconfig.json and extract path alias configuration.
 *
 * Used by TypeScriptParser.parseProject() and TypeScriptPlugin.initTsProject() so that
 * ts-morph is configured with the project's path aliases (e.g. @/*) when resolving
 * cross-file imports via getModuleSpecifierSourceFile().
 *
 * IMPORTANT: Only `baseUrl` and `paths` are extracted from tsconfig.json.
 * Other compiler options (e.g. moduleResolution, target) are NOT inherited so that
 * ts-morph's own defaults are used — in particular to preserve .js → .ts resolution
 * which would break under `moduleResolution: "node"`.
 */

import path from 'node:path';
import fs from 'node:fs';

export interface PathAliasConfig {
  /** Absolute path used as base for resolving `paths` entries. */
  baseUrl: string;
  /** Raw paths map from tsconfig compilerOptions.paths, e.g. { "@/*": ["src/*"] }. */
  paths: Record<string, string[]>;
}

/**
 * Search upward from startDir for the nearest tsconfig.json.
 * Returns the absolute path of the first match, or undefined if none is found.
 */
export function findTsConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);

  while (true) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = path.dirname(dir);
  }
}

/**
 * Read only the `baseUrl` and `paths` from a tsconfig.json file.
 * Returns undefined if neither is present or if the file cannot be parsed.
 *
 * `baseUrl` is resolved to an absolute path relative to the tsconfig file's directory.
 */
export function loadPathAliases(tsConfigFilePath: string): PathAliasConfig | undefined {
  try {
    const tsDir = path.dirname(tsConfigFilePath);
    const raw = JSON.parse(fs.readFileSync(tsConfigFilePath, 'utf8')) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const co = raw.compilerOptions ?? {};
    if (!co.paths && !co.baseUrl) return undefined;
    return {
      baseUrl: co.baseUrl ? path.resolve(tsDir, co.baseUrl) : tsDir,
      paths: co.paths ?? {},
    };
  } catch {
    return undefined;
  }
}

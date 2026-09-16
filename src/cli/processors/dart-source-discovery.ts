import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import micromatch from 'micromatch';
import { DART_DEFAULT_IGNORE, DART_VENDORED_IGNORE } from '@/plugins/dart/ignore-patterns.js';

export interface DartSourceDiscoveryOptions {
  /** User glob patterns to exclude, ADDED on top of the Dart defaults. */
  exclude?: string[];
  /** Working directory for resolving relative `--sources` entries. */
  cwd?: string;
}

/**
 * The default exclusion set applied to every Dart source scan (CLI/MCP). These
 * are the same rules `DartPlugin.parseProject()` uses, so a directory analysed
 * via `analyze -s <dir> --lang dart` yields the same file set as a direct plugin
 * call. User `--exclude` / `config.exclude` only APPENDS — it cannot un-ignore a
 * generated or vendored file.
 */
const DART_IGNORE = [...DART_DEFAULT_IGNORE, ...DART_VENDORED_IGNORE];

function isExcludedPath(absPath: string, exclude: string[]): boolean {
  return exclude.length > 0 && micromatch.isMatch(absPath, exclude, { dot: true });
}

/** Path separator-agnostic common ancestor of a set of absolute directories. */
function commonAncestor(dirs: string[]): string {
  if (dirs.length === 0) return process.cwd();
  if (dirs.length === 1) return dirs[0];
  const split = dirs.map((d) => path.resolve(d).split(path.sep));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every((s) => s[i] === first[i])) i++;
  const common = first.slice(0, i).join(path.sep);
  return common === '' ? path.parse(first[0]).root : common;
}

/** Walk up from `dir` to the nearest directory containing a `pubspec.yaml`. */
function findNearestPubspec(dir: string): string | null {
  let cur = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(cur, 'pubspec.yaml'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached the filesystem root
    cur = parent;
  }
}

/**
 * Resolve the analysis root for a list of Dart `--sources` entries.
 *
 * The plugin's `parseFiles()` must not derive the root from the first file
 * (that would be `<project>/lib` instead of `<project>`), otherwise the root
 * `pubspec.yaml` is missed and `package:` imports / package IDs / cross-file
 * relations degrade. Instead:
 *   - a directory source contributes itself; a file source its directory;
 *   - the common ancestor of all candidates is the starting point;
 *   - walk up to the nearest `pubspec.yaml` so a single-package project or a
 *     melos sub-package file resolves to its actual package root.
 */
export function resolveDartWorkspaceRoot(sources: string[], cwd = process.cwd()): string {
  const candidates: string[] = [];
  for (const s of sources) {
    const abs = path.resolve(cwd, s);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) candidates.push(abs);
    else if (stat.isFile()) candidates.push(path.dirname(abs));
  }
  if (candidates.length === 0) return cwd;
  const common = commonAncestor(candidates);
  return findNearestPubspec(common) ?? common;
}

/**
 * Collect every `.dart` file reachable from a list of CLI `--sources` entries.
 *
 * Each source may be a single file (matched by extension) or a directory
 * (recursively globbed for `*.dart`). Unlike the old `sources[0]`-only
 * behavior, this merges files from EVERY source so single-file, multi-directory,
 * and mixed
 * file/directory inputs all count — a missing source or an empty directory is
 * silently skipped, matching the other language providers. Returns an empty
 * array when no `.dart` file is found.
 *
 * This exists so the Dart plugin can call `parseFiles(files)` with the entire
 * input set instead of forcing the whole analysis through a single
 * `sources[0]` workspace root (which broke when that root was a file, and
 * dropped all sources past the first when it was a directory).
 */
export async function discoverDartSourceFiles(
  sources: string[],
  options: DartSourceDiscoveryOptions = {}
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const exclude = [...DART_IGNORE, ...(options.exclude ?? [])];
  const files = new Set<string>();

  for (const source of sources) {
    const abs = path.resolve(cwd, source);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(abs);
    } catch {
      // Unresolvable / missing source — skip, consistent with other languages.
      continue;
    }

    if (stat.isFile()) {
      if (abs.endsWith('.dart') && !isExcludedPath(abs, exclude)) files.add(abs);
      continue;
    }

    if (stat.isDirectory()) {
      const found = await glob('**/*.dart', { cwd: abs, absolute: true, ignore: exclude });
      for (const f of found) files.add(f);
    }
  }

  return [...files];
}

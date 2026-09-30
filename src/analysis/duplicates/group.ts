/**
 * Duplicate grouping and scanning.
 *
 * Fingerprints every function under the requested sources (parser layer), groups them by
 * structural hash, applies the false-positive filters and ranks groups by savable lines.
 */

import fs from 'fs-extra';
import path from 'path';
import { globbySync } from 'globby';
import { fingerprintSourceText, type FunctionFingerprint } from '@/parser/function-fingerprint.js';
import {
  DEFAULT_DUPLICATE_OPTIONS,
  type DuplicateAnalysis,
  type DuplicateGroup,
  type DuplicateOptions,
} from './types.js';

const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts'];
const ALWAYS_IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
];

/** Test files: *.test.*, *.spec.*, or any path segment named tests / __tests__. */
export function isTestFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.split('/').some((seg) => seg === 'tests' || seg === '__tests__')
  );
}

/** Fill unspecified options with the defaults. */
export function resolveDuplicateOptions(options: Partial<DuplicateOptions> = {}): DuplicateOptions {
  return {
    minStatements: options.minStatements ?? DEFAULT_DUPLICATE_OPTIONS.minStatements,
    minTokens: options.minTokens ?? DEFAULT_DUPLICATE_OPTIONS.minTokens,
    includeTests: options.includeTests ?? DEFAULT_DUPLICATE_OPTIONS.includeTests,
    topN: options.topN,
  };
}

/**
 * Group fingerprints by hash. Only groups of ≥2 members that pass `minStatements` / `minTokens`
 * are returned, ordered by savable lines (descending; ties broken by hash for determinism).
 *
 * A group is dropped when every one of its members lies inside a member of a larger retained
 * group — the outer duplicate already covers it.
 */
export function groupDuplicates(
  fingerprints: FunctionFingerprint[],
  options: Partial<DuplicateOptions> = {}
): DuplicateGroup[] {
  const opts = resolveDuplicateOptions(options);
  const byHash = new Map<string, FunctionFingerprint[]>();

  for (const fp of fingerprints) {
    if (fp.statementCount < opts.minStatements || fp.tokenCount < opts.minTokens) continue;
    if (!opts.includeTests && isTestFile(fp.file)) continue;
    const bucket = byHash.get(fp.hash);
    if (bucket) bucket.push(fp);
    else byHash.set(fp.hash, [fp]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [hash, bucket] of byHash) {
    if (bucket.length < 2) continue;
    const members = bucket
      .map((fp) => ({
        file: fp.file,
        startLine: fp.startLine,
        endLine: fp.endLine,
        name: fp.name,
        kind: fp.kind,
      }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
    const lineCount = Math.max(...bucket.map((fp) => fp.endLine - fp.startLine + 1));
    groups.push({
      hash,
      tokenCount: bucket[0].tokenCount,
      statementCount: bucket[0].statementCount,
      lineCount,
      savableLines: (members.length - 1) * lineCount,
      members,
    });
  }

  groups.sort((a, b) => b.savableLines - a.savableLines || a.hash.localeCompare(b.hash));
  return dropSubsumed(groups);
}

/** Drop groups fully contained in members of larger, already-retained groups. */
function dropSubsumed(sorted: DuplicateGroup[]): DuplicateGroup[] {
  const bySize = [...sorted].sort((a, b) => b.tokenCount - a.tokenCount);
  const kept: DuplicateGroup[] = [];
  for (const group of bySize) {
    const subsumed = group.members.every((m) =>
      kept.some(
        (k) =>
          k.tokenCount > group.tokenCount &&
          k.members.some(
            (o) => o.file === m.file && o.startLine <= m.startLine && o.endLine >= m.endLine
          )
      )
    );
    if (!subsumed) kept.push(group);
  }
  const keptHashes = new Set(kept.map((g) => g.hash));
  return sorted.filter((g) => keptHashes.has(g.hash));
}

/**
 * Expand `sources` (files or directories, absolute or relative to `root`) into TypeScript files.
 * Throws when a source does not exist.
 */
export function collectSourceFiles(
  root: string,
  sources: string[],
  includeTests: boolean
): string[] {
  const files = new Set<string>();
  const extGlob = `**/*.{${SOURCE_EXTENSIONS.join(',')}}`;

  for (const source of sources) {
    const abs = path.isAbsolute(source) ? source : path.resolve(root, source);
    if (!fs.pathExistsSync(abs)) {
      throw new Error(`Source path does not exist: ${abs}`);
    }
    if (fs.statSync(abs).isFile()) {
      files.add(abs);
      continue;
    }
    // `glob` has no way to exclude symlinked *files*, so a symlink was scanned as a second
    // copy of its target and fabricated duplicate groups (real file + its link). globby can
    // be told not to follow them — same guarantee FileDiscoveryService relies on.
    for (const f of globbySync(extGlob, {
      cwd: abs,
      absolute: true,
      ignore: ALWAYS_IGNORED,
      followSymbolicLinks: false,
    })) {
      files.add(f);
    }
  }

  return [...files]
    .filter((f) => !f.endsWith('.d.ts') && (includeTests || !isTestFile(path.relative(root, f))))
    .sort();
}

/**
 * Scan `sources` under `root` and return the duplicate analysis.
 * Paths on members are relative to `root`, POSIX-style.
 */
export async function detectDuplicates(
  root: string,
  sources: string[],
  options: Partial<DuplicateOptions> = {}
): Promise<DuplicateAnalysis> {
  const opts = resolveDuplicateOptions(options);
  const files = collectSourceFiles(root, sources, opts.includeTests);
  const fingerprints: FunctionFingerprint[] = [];

  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    try {
      fingerprints.push(...fingerprintSourceText(await fs.readFile(file, 'utf-8'), rel));
    } catch {
      // Unreadable file: skip, the scan is best-effort per file.
    }
  }

  const all = groupDuplicates(fingerprints, opts);
  const groups = opts.topN !== undefined ? all.slice(0, opts.topN) : all;

  return {
    manifest: {
      version: '1',
      generatedAt: new Date().toISOString(),
      sources,
      scannedFiles: files.length,
      scannedFunctions: fingerprints.length,
      totalGroups: all.length,
      options: opts,
    },
    groups,
  };
}

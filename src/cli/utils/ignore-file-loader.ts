/**
 * Ignore-file loader - reads `.gitignore` and `.archguardignore` (gitignore syntax)
 * from a project root and exposes a matcher plus a human-readable report.
 */

import path from 'path';
import fs from 'fs-extra';
import ignore, { type Ignore } from 'ignore';

export type IgnoreSource = '.gitignore' | '.archguardignore';

export interface IgnoreRuleSet {
  source: IgnoreSource;
  /** Absolute directory the rules are relative to */
  root: string;
  rules: string[];
  matcher: Ignore;
}

export interface ExcludeReportEntry {
  source: IgnoreSource | 'config exclude';
  count: number;
  rules: string[];
  /** Files dropped by this source (relative to project root) */
  excludedFiles?: number;
}

/**
 * Find the project root for a source directory: nearest ancestor containing
 * `.git`, `.archguardignore` or `.gitignore`; falls back to the source directory.
 */
export async function findIgnoreRoot(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);
  for (;;) {
    if (await fs.pathExists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = path.resolve(startDir);
  for (;;) {
    if (
      (await fs.pathExists(path.join(dir, '.archguardignore'))) ||
      (await fs.pathExists(path.join(dir, '.gitignore')))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

async function loadOne(root: string, source: IgnoreSource): Promise<IgnoreRuleSet | null> {
  const file = path.join(root, source);
  if (!(await fs.pathExists(file))) return null;
  const content = await fs.readFile(file, 'utf-8');
  const rules = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (rules.length === 0) return null;
  return { source, root, rules, matcher: ignore().add(rules) };
}

/** Load `.gitignore` and `.archguardignore` rule sets found in `root`. */
export async function loadIgnoreRuleSets(root: string): Promise<IgnoreRuleSet[]> {
  const sets = await Promise.all([loadOne(root, '.gitignore'), loadOne(root, '.archguardignore')]);
  return sets.filter((s): s is IgnoreRuleSet => s !== null);
}

/** Returns the first rule set that ignores the absolute file path, or null. */
export function findIgnoringSet(sets: IgnoreRuleSet[], absFile: string): IgnoreRuleSet | null {
  for (const set of sets) {
    const rel = path.relative(set.root, absFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (set.matcher.ignores(rel.split(path.sep).join('/'))) return set;
  }
  return null;
}

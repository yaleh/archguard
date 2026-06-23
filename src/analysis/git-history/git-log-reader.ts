/**
 * Git log reader — runs `git log --numstat` and parses the output into
 * structured CommitRecord objects.
 */

import { execSync } from 'child_process';
import path from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
}

export interface CommitRecord {
  sha: string;
  authorEmail: string;
  date: string; // YYYY-MM-DD
  files: FileChange[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReadGitLogOptions {
  sinceDays: number;
  maxCommits: number;
  includeMerges: boolean;
  /** Optional path filter — limits git log to commits touching this subdirectory (relative to git root) */
  pathFilter?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Read git log for the given repo root and return parsed commit records.
 *
 * Uses --numstat to get per-file line change counts.
 * Format: %H (full sha), %ae (author email), %cd (commit date).
 *
 * @param repoRoot  Absolute path to the git repository root.
 * @param options   Filtering options.
 * @returns Array of CommitRecord, newest-first (git default).
 */
export function readGitLog(repoRoot: string, options: ReadGitLogOptions): CommitRecord[] {
  const { sinceDays, maxCommits, includeMerges, pathFilter } = options;

  const mergeFlag = includeMerges ? '--merges' : '--no-merges';
  // Use a unique separator prefix so commit boundaries are unambiguous regardless of numstat layout.
  const parts = [
    'git',
    'log',
    '--numstat',
    mergeFlag,
    `--format=COMMIT_START%n%H%n%ae%n%cd`,
    '--date=short',
    `--since=${sinceDays}.days.ago`,
    `--max-count=${maxCommits}`,
  ];
  if (pathFilter) {
    parts.push('--', pathFilter);
  }
  const cmd = parts.join(' ');

  let rawOutput: string;
  try {
    rawOutput = execSync(cmd, {
      cwd: repoRoot,
      encoding: 'utf8',
      // Suppress stderr
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git log failed in ${repoRoot}: ${message}`);
  }

  return parseGitLogOutput(rawOutput);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the raw output of `git log --numstat --format=%H%n%ae%n%cd --date=short`.
 *
 * The format alternates between a commit header block (sha / email / date)
 * and a series of numstat lines (added\tdeleted\tpath), separated by blank lines.
 *
 * Example chunk:
 *   <sha>
 *   <email>
 *   <date>
 *
 *   10\t3\tsrc/foo.ts
 *   2\t0\tsrc/bar.ts
 *
 */
/**
 * Parse the raw output of `git log --numstat --format='COMMIT_START%n%H%n%ae%n%cd' --date=short`.
 *
 * Each commit block starts with the literal line "COMMIT_START", followed by sha, email, date,
 * an optional blank line, and then zero or more numstat lines. The COMMIT_START marker makes
 * commit boundaries unambiguous regardless of how git lays out the numstat section.
 *
 * Example:
 *   COMMIT_START
 *   <sha>
 *   <email>
 *   <date>
 *
 *   10\t3\tsrc/foo.ts
 *   2\t0\tsrc/bar.ts
 *   COMMIT_START
 *   ...
 */
export function parseGitLogOutput(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  // Split on the COMMIT_START sentinel to get one block per commit.
  // Filter empty leading/trailing strings.
  const blocks = raw.split(/^COMMIT_START\s*$/m).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split('\n');
    let i = 0;

    // Skip leading blank lines within the block
    while (i < lines.length && lines[i].trim() === '') i++;

    const sha = lines[i++]?.trim() ?? '';
    if (!sha || sha.length < 7) continue;

    const authorEmail = lines[i++]?.trim() ?? '';
    const date = lines[i++]?.trim() ?? '';

    // Validate date format YYYY-MM-DD
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    const files: FileChange[] = [];

    // Remaining non-blank lines are numstat entries
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;

      const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (numstatMatch) {
        const added = numstatMatch[1] === '-' ? 0 : parseInt(numstatMatch[1], 10);
        const deleted = numstatMatch[2] === '-' ? 0 : parseInt(numstatMatch[2], 10);
        const filePath = numstatMatch[3].trim();

        // Skip renames expressed with brace notation (e.g. src/{old => new}/file.ts)
        if (filePath && !filePath.includes('{')) {
          files.push({ path: filePath, added, deleted });
        }
      }
    }

    commits.push({ sha, authorEmail, date, files });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// Git utilities
// ---------------------------------------------------------------------------

/**
 * Get the short HEAD SHA for the given repo root.
 * Returns 'unknown' if git is unavailable or this is not a repo.
 */
export function getHeadRef(repoRoot: string): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get the current branch name for the given repo root.
 * Returns 'HEAD' if detached or unavailable.
 */
export function getCurrentBranch(repoRoot: string): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return branch || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

/**
 * Check whether the given directory is inside a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the absolute path of the git repo root for the given directory,
 * or null if the directory is not inside a git repo.
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

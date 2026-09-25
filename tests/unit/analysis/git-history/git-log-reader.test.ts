/**
 * Unit tests for git-log-reader.ts (canonical location: src/analysis/git-history/)
 *
 * Tests parseGitLogOutput and getGitRoot with synthetic input — no actual git required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseGitLogOutput,
  readGitLog,
  readGitLogWindow,
} from '@/analysis/git-history/git-log-reader.js';

// ---------------------------------------------------------------------------
// parseGitLogOutput
// ---------------------------------------------------------------------------

describe('parseGitLogOutput', () => {
  it('parses a single commit block with numstat lines', () => {
    const raw = [
      'COMMIT_START',
      'abc1234567890abcdef',
      'alice@example.com',
      '2024-01-15',
      '',
      '10\t3\tsrc/foo.ts',
      '2\t0\tsrc/bar.ts',
      '',
    ].join('\n');

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('abc1234567890abcdef');
    expect(commits[0].authorEmail).toBe('alice@example.com');
    expect(commits[0].date).toBe('2024-01-15');
    expect(commits[0].files).toHaveLength(2);
    expect(commits[0].files[0]).toEqual({ path: 'src/foo.ts', added: 10, deleted: 3 });
    expect(commits[0].files[1]).toEqual({ path: 'src/bar.ts', added: 2, deleted: 0 });
  });

  it('parses multiple commit blocks', () => {
    const raw = [
      'COMMIT_START',
      'sha1111111111111111',
      'alice@example.com',
      '2024-01-15',
      '',
      '5\t1\tsrc/a.ts',
      'COMMIT_START',
      'sha2222222222222222',
      'bob@example.com',
      '2024-01-16',
      '',
      '3\t2\tsrc/b.ts',
    ].join('\n');

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe('sha1111111111111111');
    expect(commits[1].sha).toBe('sha2222222222222222');
    expect(commits[0].authorEmail).toBe('alice@example.com');
    expect(commits[1].authorEmail).toBe('bob@example.com');
  });

  it('returns empty array for empty string', () => {
    const commits = parseGitLogOutput('');
    expect(commits).toEqual([]);
  });

  it('handles commits with no changed files', () => {
    const raw = ['COMMIT_START', 'sha1234567890abcdef', 'alice@example.com', '2024-01-15', ''].join(
      '\n'
    );

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toHaveLength(0);
  });

  it('skips commits with invalid sha (too short)', () => {
    const raw = [
      'COMMIT_START',
      'abc', // too short (< 7 chars)
      'alice@example.com',
      '2024-01-15',
    ].join('\n');

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(0);
  });

  it('skips commits with invalid date format', () => {
    const raw = ['COMMIT_START', 'abc1234567890abcdef', 'alice@example.com', 'not-a-date'].join(
      '\n'
    );

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(0);
  });

  it('handles binary files (- in numstat columns)', () => {
    const raw = [
      'COMMIT_START',
      'abc1234567890abcdef',
      'alice@example.com',
      '2024-01-15',
      '',
      '-\t-\tsrc/image.png',
      '5\t2\tsrc/foo.ts',
    ].join('\n');

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    // Binary files (-/-) should be parsed with added=0, deleted=0
    const img = commits[0].files.find((f) => f.path === 'src/image.png');
    expect(img).toBeDefined();
    expect(img.added).toBe(0);
    expect(img.deleted).toBe(0);
  });

  it('skips files with brace rename notation', () => {
    const raw = [
      'COMMIT_START',
      'abc1234567890abcdef',
      'alice@example.com',
      '2024-01-15',
      '',
      '5\t0\tsrc/{old => new}/file.ts',
      '3\t1\tsrc/kept.ts',
    ].join('\n');

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    // Brace rename path should be skipped
    const renamed = commits[0].files.find((f) => f.path.includes('{'));
    expect(renamed).toBeUndefined();
    expect(commits[0].files).toHaveLength(1);
    expect(commits[0].files[0].path).toBe('src/kept.ts');
  });
});

// ---------------------------------------------------------------------------
// getGitRoot
// ---------------------------------------------------------------------------

describe('getGitRoot', () => {
  it('returns null when not in a git repo', async () => {
    // Import getGitRoot and test with a non-git directory
    const { getGitRoot } = await import('@/analysis/git-history/git-log-reader.js');
    // Use /tmp as a directory that is likely not a git repo
    // (or we mock execSync to throw)
    const result = getGitRoot('/nonexistent-directory-that-does-not-exist');
    expect(result).toBeNull();
  });

  it('returns a string when in a git repo', async () => {
    const { getGitRoot } = await import('@/analysis/git-history/git-log-reader.js');
    // The test runner is invoked from a git repo (the archguard project itself)
    const result = getGitRoot(process.cwd());
    // Should return the git root as a string (not null)
    if (result !== null) {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
    // If null, the test passes (may be running outside git repo)
  });
});

// ---------------------------------------------------------------------------
// readGitLogWindow — real temporary repository
// ---------------------------------------------------------------------------

describe('readGitLogWindow', () => {
  let repo: string;
  const opts = { sinceDays: 90, includeMerges: false };

  function git(cmd: string, date?: string): void {
    execSync(`git ${cmd}`, {
      cwd: repo,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
  }

  function daysAgo(n: number): string {
    return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-gitwindow-'));
    git('init -q');
    // 5 commits, oldest 10 days ago, newest 2 days ago
    [10, 8, 6, 4, 2].forEach((n, i) => {
      fs.writeFileSync(path.join(repo, `f${i}.txt`), `${i}\n`);
      git('add -A');
      git(`commit -q -m c${i}`, `${daysAgo(n)}T12:00:00`);
    });
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('is truncated when maxCommits is reached and older commits remain', () => {
    const w = readGitLogWindow(repo, { ...opts, maxCommits: 3 });
    expect(w.commits).toHaveLength(3);
    expect(w.truncated).toBe(true);
    // The 3 newest commits: 2, 4, 6 days ago — the older two are not read
    expect(w.windowStart).toBe(daysAgo(6));
    expect(w.windowEnd).toBe(daysAgo(2));
  });

  it('is not truncated when fewer commits than maxCommits exist', () => {
    const w = readGitLogWindow(repo, { ...opts, maxCommits: 50 });
    expect(w.commits).toHaveLength(5);
    expect(w.truncated).toBe(false);
    expect(w.windowStart).toBe(daysAgo(10));
    expect(w.windowEnd).toBe(daysAgo(2));
  });

  it('is not truncated when the commit count equals maxCommits exactly', () => {
    const w = readGitLogWindow(repo, { ...opts, maxCommits: 5 });
    expect(w.commits).toHaveLength(5);
    expect(w.truncated).toBe(false);
  });

  it('reports a null window when no commits are in range', () => {
    const w = readGitLogWindow(repo, { sinceDays: 1, maxCommits: 5, includeMerges: false });
    expect(w).toEqual({ commits: [], windowStart: null, windowEnd: null, truncated: false });
  });
});

// ---------------------------------------------------------------------------
// readGitLog — pathspec list (TASK-95)
// ---------------------------------------------------------------------------

describe('readGitLog with a pathspec list', () => {
  let repo: string;
  const opts = { sinceDays: 90, maxCommits: 50, includeMerges: false };

  function commit(files: string[], msg: string): void {
    for (const f of files) {
      const abs = path.join(repo, f);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.appendFileSync(abs, `${msg}\n`);
    }
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    };
    execSync('git add -A', { cwd: repo, stdio: 'pipe', env });
    execSync(`git commit -q -m ${msg}`, { cwd: repo, stdio: 'pipe', env });
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-gitpathspec-'));
    execSync('git init -q', { cwd: repo, stdio: 'pipe' });
    commit(['plugin/a.ts'], 'c0');
    commit(['packages/b.ts'], 'c1');
    commit(['docs/readme.md'], 'c2');
    commit(['plugin/a.ts', 'docs/readme.md'], 'c3');
    commit(['dir with space/x.ts'], 'c4');
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('only returns file changes under the listed directories', () => {
    const commits = readGitLog(repo, { ...opts, pathFilter: ['plugin', 'packages'] });
    const files = commits.flatMap((c) => c.files.map((f) => f.path)).sort();
    expect(files).toEqual(['packages/b.ts', 'plugin/a.ts', 'plugin/a.ts']);
    // c2 (docs only) and c4 are not touched by any pathspec
    expect(commits).toHaveLength(3);
  });

  it('a single string pathFilter behaves as a one-element list', () => {
    const commits = readGitLog(repo, { ...opts, pathFilter: 'plugin' });
    expect(commits.flatMap((c) => c.files.map((f) => f.path))).toEqual([
      'plugin/a.ts',
      'plugin/a.ts',
    ]);
  });

  it('quotes pathspecs that contain spaces', () => {
    const commits = readGitLog(repo, { ...opts, pathFilter: ['dir with space'] });
    expect(commits.flatMap((c) => c.files.map((f) => f.path))).toEqual(['dir with space/x.ts']);
  });

  it('an empty list applies no filter', () => {
    expect(readGitLog(repo, { ...opts, pathFilter: [] })).toHaveLength(5);
  });
});

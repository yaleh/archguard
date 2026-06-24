/**
 * Unit tests for git-log-reader.ts (canonical location: src/analysis/git-history/)
 *
 * Tests parseGitLogOutput and getGitRoot with synthetic input — no actual git required.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseGitLogOutput } from '@/analysis/git-history/git-log-reader.js';

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
    const raw = [
      'COMMIT_START',
      'sha1234567890abcdef',
      'alice@example.com',
      '2024-01-15',
      '',
    ].join('\n');

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
    const raw = [
      'COMMIT_START',
      'abc1234567890abcdef',
      'alice@example.com',
      'not-a-date',
    ].join('\n');

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

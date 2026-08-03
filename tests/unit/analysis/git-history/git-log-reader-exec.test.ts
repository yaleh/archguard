/**
 * Unit tests for git-log-reader execSync helpers (getHeadRef, getCurrentBranch, isGitRepo, getGitRoot, readGitLog).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({ execSync: (...args: unknown[]) => mockExecSync(...args) }));

import {
  getHeadRef,
  getCurrentBranch,
  isGitRepo,
  getGitRoot,
  readGitLog,
} from '@/analysis/git-history/git-log-reader.js';

beforeEach(() => {
  mockExecSync.mockReset();
});

describe('getHeadRef', () => {
  it('returns the trimmed HEAD sha', () => {
    mockExecSync.mockReturnValue('abc1234\n');
    expect(getHeadRef('/repo')).toBe('abc1234');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --short HEAD',
      expect.objectContaining({ cwd: '/repo' })
    );
  });
  it('returns unknown on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('no repo');
    });
    expect(getHeadRef('/repo')).toBe('unknown');
  });
});

describe('getCurrentBranch', () => {
  it('returns the branch name', () => {
    mockExecSync.mockReturnValue('feature/x\n');
    expect(getCurrentBranch('/repo')).toBe('feature/x');
  });
  it('returns HEAD when empty', () => {
    mockExecSync.mockReturnValue('');
    expect(getCurrentBranch('/repo')).toBe('HEAD');
  });
  it('returns HEAD on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('no repo');
    });
    expect(getCurrentBranch('/repo')).toBe('HEAD');
  });
});

describe('isGitRepo', () => {
  it('returns true on success', () => {
    mockExecSync.mockReturnValue('.git\n');
    expect(isGitRepo('/repo')).toBe(true);
  });
  it('returns false on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });
    expect(isGitRepo('/repo')).toBe(false);
  });
});

describe('getGitRoot', () => {
  it('returns the toplevel path', () => {
    mockExecSync.mockReturnValue('/home/repo\n');
    expect(getGitRoot('/home/repo/src')).toBe('/home/repo');
  });
  it('returns null on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });
    expect(getGitRoot('/nope')).toBeNull();
  });
});

describe('readGitLog', () => {
  it('builds the git command with merge flag and parses output', () => {
    mockExecSync.mockReturnValue(
      ['COMMIT_START', 'sha1234567', 'a@x.com', '2026-01-01', '', '1\t2\tfile.ts'].join('\n')
    );
    const commits = readGitLog('/repo', { sinceDays: 7, maxCommits: 10, includeMerges: true });
    expect(commits).toHaveLength(1);
    expect(mockExecSync.mock.calls[0][0]).toContain('--merges');
    expect(mockExecSync.mock.calls[0][0]).toContain('--since=7.days.ago');
    expect(mockExecSync.mock.calls[0][0]).toContain('--max-count=10');
  });

  it('adds path filter when provided', () => {
    mockExecSync.mockReturnValue('');
    readGitLog('/repo', {
      sinceDays: 7,
      maxCommits: 10,
      includeMerges: false,
      pathFilter: 'src/cli',
    });
    const cmd = mockExecSync.mock.calls[0][0];
    expect(cmd).toContain('--no-merges');
    expect(cmd).toContain('-- src/cli');
  });

  it('throws a wrapped error when git fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() =>
      readGitLog('/repo', { sinceDays: 7, maxCommits: 10, includeMerges: false })
    ).toThrow(/git log failed in \/repo/);
  });
});

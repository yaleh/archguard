import { describe, expect, it } from 'vitest';
import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';
import {
  buildFullCochangeMatrix,
  buildPackageCochangeMatrix,
} from '@/analysis/fim/cochange-matrix-builder.js';

function makeCommit(sha: string, files: string[]): CommitRecord {
  return {
    sha,
    authorEmail: 'dev@example.com',
    date: '2026-03-30',
    files: files.map((file) => ({ path: file, added: 1, deleted: 0 })),
  };
}

describe('buildFullCochangeMatrix', () => {
  it('returns Jaccard 1.0 for files that always change together', () => {
    const matrix = buildFullCochangeMatrix(
      [
        makeCommit('a', ['src/a.ts', 'src/b.ts']),
        makeCommit('b', ['src/a.ts', 'src/b.ts']),
      ],
      ['src/a.ts', 'src/b.ts']
    );

    expect(matrix[0][1]).toBe(1);
    expect(matrix[1][0]).toBe(1);
  });

  it('returns Jaccard 0.0 for files that never change together', () => {
    const matrix = buildFullCochangeMatrix(
      [makeCommit('a', ['src/a.ts']), makeCommit('b', ['src/b.ts'])],
      ['src/a.ts', 'src/b.ts']
    );

    expect(matrix[0][1]).toBe(0);
  });

  it('computes the expected Jaccard value for known commit counts', () => {
    const commits = [
      makeCommit('a', ['src/a.ts', 'src/b.ts']),
      makeCommit('b', ['src/a.ts']),
      makeCommit('c', ['src/a.ts', 'src/b.ts']),
      makeCommit('d', ['src/b.ts']),
      makeCommit('e', ['src/b.ts']),
      makeCommit('f', ['src/b.ts']),
    ];

    const matrix = buildFullCochangeMatrix(commits, ['src/a.ts', 'src/b.ts']);
    expect(matrix[0][1]).toBeCloseTo(2 / 6, 8);
  });

  it('returns a symmetric matrix', () => {
    const matrix = buildFullCochangeMatrix(
      [makeCommit('a', ['src/a.ts', 'src/b.ts', 'src/c.ts'])],
      ['src/a.ts', 'src/b.ts', 'src/c.ts']
    );

    expect(matrix[0][1]).toBe(matrix[1][0]);
    expect(matrix[0][2]).toBe(matrix[2][0]);
  });

  it('sets the diagonal to 1 for files with commits', () => {
    const matrix = buildFullCochangeMatrix([makeCommit('a', ['src/a.ts'])], ['src/a.ts']);
    expect(matrix[0][0]).toBe(1);
  });

  it('sets the diagonal to 0 for files with zero commits', () => {
    const matrix = buildFullCochangeMatrix([makeCommit('a', ['src/a.ts'])], ['src/a.ts', 'src/b.ts']);
    expect(matrix[1][1]).toBe(0);
  });
});

describe('buildPackageCochangeMatrix', () => {
  it('aggregates commits at package level before computing Jaccard', () => {
    const commits = [
      makeCommit('a', ['src/pkg-a/a.ts', 'src/pkg-b/b.ts']),
      makeCommit('b', ['src/pkg-a/c.ts']),
      makeCommit('c', ['src/pkg-a/a.ts', 'src/pkg-b/d.ts']),
    ];
    const packageNames = ['src/pkg-a', 'src/pkg-b'];
    const fileToPackage = new Map([
      ['src/pkg-a/a.ts', 'src/pkg-a'],
      ['src/pkg-a/c.ts', 'src/pkg-a'],
      ['src/pkg-b/b.ts', 'src/pkg-b'],
      ['src/pkg-b/d.ts', 'src/pkg-b'],
    ]);

    const matrix = buildPackageCochangeMatrix(commits, packageNames, fileToPackage);

    expect(matrix).toEqual([
      [1, 2 / 3],
      [2 / 3, 1],
    ]);
  });
});

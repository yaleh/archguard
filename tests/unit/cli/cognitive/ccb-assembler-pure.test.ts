/**
 * Unit tests for ccb-assembler pure helper exports (filePathToId, computeDocFreshnessGap).
 */

import { describe, it, expect } from 'vitest';
import { filePathToId, computeDocFreshnessGap } from '@/cli/cognitive/ccb-assembler.js';

describe('filePathToId', () => {
  it('strips the file extension and replaces separators/dots with dashes', () => {
    expect(filePathToId('src/cli/query/query-engine.ts')).toBe('src-cli-query-query-engine');
  });
  it('normalizes windows backslashes to slashes before converting', () => {
    expect(filePathToId('src\\parser\\index.ts')).toBe('src-parser-index');
  });
  it('handles dot-separated ids', () => {
    expect(filePathToId('src/index.ts')).toBe('src-index');
  });
  it('handles files without an extension', () => {
    expect(filePathToId('README')).toBe('README');
  });
});

describe('computeDocFreshnessGap', () => {
  it('returns null for an empty cochange list', () => {
    expect(computeDocFreshnessGap([])).toBeNull();
  });
  it('returns the fraction of documentation files', () => {
    expect(computeDocFreshnessGap(['src/a.ts', 'docs/a.md'])).toBe(0.5);
  });
  it('handles .rst/.txt/.adoc extensions', () => {
    expect(computeDocFreshnessGap(['docs/x.rst', 'docs/y.txt', 'docs/z.adoc'])).toBe(1);
  });
  it('returns 0 when no doc files are present', () => {
    expect(computeDocFreshnessGap(['src/a.ts', 'src/b.ts'])).toBe(0);
  });
  it('is case-insensitive on extensions', () => {
    expect(computeDocFreshnessGap(['docs/X.MD'])).toBe(1);
  });
});

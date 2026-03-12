import type { PackageCoverage } from '@/types/extensions.js';
import { describe, it, expect } from 'vitest';

describe('PackageCoverage interface', () => {
  it('can be instantiated with required fields', () => {
    const entry: PackageCoverage = {
      package: 'lmdeploy/pytorch',
      totalEntities: 100,
      coveredEntities: 15,
      coverageRatio: 0.15,
      testFileIds: ['tests/pytorch/test_ops.py'],
    };
    expect(entry.package).toBe('lmdeploy/pytorch');
    expect(entry.coverageRatio).toBe(0.15);
  });

  it('accepts top-level package with dot notation', () => {
    const entry: PackageCoverage = {
      package: '.',
      totalEntities: 10,
      coveredEntities: 5,
      coverageRatio: 0.5,
      testFileIds: [],
    };
    expect(entry.package).toBe('.');
    expect(entry.testFileIds).toHaveLength(0);
  });

  it('stores multiple test file IDs', () => {
    const entry: PackageCoverage = {
      package: 'src/utils',
      totalEntities: 20,
      coveredEntities: 20,
      coverageRatio: 1.0,
      testFileIds: ['tests/unit/utils/foo.test.ts', 'tests/unit/utils/bar.test.ts'],
    };
    expect(entry.testFileIds).toHaveLength(2);
    expect(entry.coveredEntities).toBe(entry.totalEntities);
  });
});

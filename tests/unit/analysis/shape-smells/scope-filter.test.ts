/**
 * Phase B: Cross-module scope filter.
 */

import { describe, it, expect } from 'vitest';
import { filterCrossModule, computeModuleSpan } from '@/analysis/shape-smells/scope-filter';
import type { LiteralDispersionSmell } from '@/analysis/shape-smells/types';

function makeSmell(overrides: Partial<LiteralDispersionSmell> = {}): LiteralDispersionSmell {
  return {
    typeName: 'AppKind',
    value: 'web',
    files: ['src/capture/index.ts', 'src/query/index.ts'],
    dispersion: 2,
    severity: 'info',
    locations: [
      { file: 'src/capture/index.ts', line: 10 },
      { file: 'src/query/index.ts', line: 5 },
    ],
    ...overrides,
  };
}

describe('computeModuleSpan', () => {
  it('returns modules and crossesBoundary=true when files span 2+ modules', () => {
    const files = ['src/capture/index.ts', 'src/query/index.ts'];
    const result = computeModuleSpan(files, 'src');
    expect(result.modules).toEqual(['capture', 'query']);
    expect(result.crossesBoundary).toBe(true);
  });

  it('returns crossesBoundary=false when all files are in the same module', () => {
    const files = ['src/capture/index.ts', 'src/capture/rule.ts'];
    const result = computeModuleSpan(files, 'src');
    expect(result.modules).toEqual(['capture']);
    expect(result.crossesBoundary).toBe(false);
  });

  it('ignores root-level files (not under any module)', () => {
    const files = ['src/main.ts', 'src/capture/index.ts'];
    const result = computeModuleSpan(files, 'src');
    // main.ts is root-level, so only capture module is counted
    expect(result.modules).toEqual(['capture']);
    expect(result.crossesBoundary).toBe(false);
  });

  it('works with absolute paths and explicit srcRoot', () => {
    const files = ['/proj/src/capture/a.ts', '/proj/src/query/b.ts'];
    const result = computeModuleSpan(files, '/proj/src');
    expect(result.modules).toEqual(['capture', 'query']);
    expect(result.crossesBoundary).toBe(true);
  });

  it('returns empty modules when no files are under a module dir', () => {
    const files = ['src/main.ts', 'src/app.ts'];
    const result = computeModuleSpan(files, 'src');
    expect(result.modules).toEqual([]);
    expect(result.crossesBoundary).toBe(false);
  });
});

describe('filterCrossModule', () => {
  it('passes through unchanged when no srcRoot is provided (no scope boundary)', () => {
    const smells = [makeSmell()];
    const result = filterCrossModule(smells, undefined);
    expect(result).toEqual(smells);
  });

  it('drops smells confined to one module directory under src/', () => {
    const smells = [
      makeSmell({
        files: ['src/capture/a.ts', 'src/capture/b.ts'],
        locations: [
          { file: 'src/capture/a.ts', line: 1 },
          { file: 'src/capture/b.ts', line: 1 },
        ],
      }),
    ];
    const result = filterCrossModule(smells, 'src');
    expect(result).toEqual([]);
  });

  it('keeps smells spanning 2+ modules', () => {
    const smells = [
      makeSmell({
        files: ['src/capture/a.ts', 'src/query/b.ts'],
        locations: [
          { file: 'src/capture/a.ts', line: 1 },
          { file: 'src/query/b.ts', line: 1 },
        ],
      }),
    ];
    const result = filterCrossModule(smells, 'src');
    expect(result).toHaveLength(1);
  });

  it('does not filter root-level files as crossing', () => {
    const smells = [
      makeSmell({
        files: ['src/main.ts', 'src/capture/a.ts'],
        locations: [
          { file: 'src/main.ts', line: 1 },
          { file: 'src/capture/a.ts', line: 1 },
        ],
      }),
    ];
    const result = filterCrossModule(smells, 'src');
    // main.ts is root-level, only capture module counted → not crossing
    expect(result).toEqual([]);
  });

  it('handles mixed smells, keeping only those that cross', () => {
    const crossSmell = makeSmell({
      value: 'web',
      files: ['src/capture/a.ts', 'src/query/b.ts'],
      locations: [
        { file: 'src/capture/a.ts', line: 1 },
        { file: 'src/query/b.ts', line: 1 },
      ],
    });
    const sameSmell = makeSmell({
      value: 'mobile',
      files: ['src/capture/a.ts', 'src/capture/b.ts'],
      locations: [
        { file: 'src/capture/a.ts', line: 1 },
        { file: 'src/capture/b.ts', line: 1 },
      ],
    });

    const result = filterCrossModule([crossSmell, sameSmell], 'src');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('web');
  });
});

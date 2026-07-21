import { describe, it, expect } from 'vitest';
import {
  extractPackageName,
  computePackageFanMetricsFromRelations,
  computeCycleMetrics,
} from '@/analysis/package-metrics-analysis.js';
import type { Relation, CycleInfo } from '@/types/index.js';

// ---------------------------------------------------------------------------
// extractPackageName
// ---------------------------------------------------------------------------

describe('extractPackageName', () => {
  it('returns the path prefix for Go-style entity IDs (slash separator)', () => {
    expect(extractPackageName('internal/filter/FilterEngine')).toBe('internal/filter');
  });

  it('returns the full input when there is no separator', () => {
    expect(extractPackageName('standalone')).toBe('standalone');
  });

  it('handles OO-style dot-separated IDs', () => {
    expect(extractPackageName('com.example.service.UserService')).toBe(
      'com.example.service'
    );
  });

  it('handles a single-level OO package', () => {
    expect(extractPackageName('mypackage.MyClass')).toBe('mypackage');
  });

  it('uses last slash as the separator when both slashes and dots are present', () => {
    // lastIndexOf('/') in 'pkg/sub/Type.Method' is at position 7 ('pkg/sub')
    // the dot is NOT used when a slash is found
    expect(extractPackageName('pkg/sub/Type.Method')).toBe('pkg/sub');
  });
});

// ---------------------------------------------------------------------------
// computePackageFanMetricsFromRelations
// ---------------------------------------------------------------------------

function makeRelation(source: string, target: string): Relation {
  return { source, target, type: 'dependency' } as Relation;
}

describe('computePackageFanMetricsFromRelations', () => {
  it('returns zero fan-in and fan-out for an empty relation list', () => {
    const pkgs = new Set(['pkgA', 'pkgB']);
    const { fanIn, fanOut } = computePackageFanMetricsFromRelations([], pkgs);
    expect(fanIn.get('pkgA')).toBe(0);
    expect(fanOut.get('pkgB')).toBe(0);
  });

  it('counts cross-package relations correctly', () => {
    // pkgA.Foo → pkgB.Bar (cross-package)
    const relations = [makeRelation('pkgA.Foo', 'pkgB.Bar')];
    const pkgs = new Set(['pkgA', 'pkgB']);
    const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, pkgs);
    expect(fanOut.get('pkgA')).toBe(1);
    expect(fanIn.get('pkgB')).toBe(1);
    expect(fanIn.get('pkgA')).toBe(0);
    expect(fanOut.get('pkgB')).toBe(0);
  });

  it('ignores self (intra-package) relations', () => {
    const relations = [makeRelation('pkgA.Foo', 'pkgA.Bar')];
    const pkgs = new Set(['pkgA']);
    const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, pkgs);
    expect(fanIn.get('pkgA')).toBe(0);
    expect(fanOut.get('pkgA')).toBe(0);
  });

  it('accumulates multiple cross-package relations for the same package', () => {
    const relations = [
      makeRelation('pkgA.Foo', 'pkgB.Bar'),
      makeRelation('pkgA.Baz', 'pkgB.Qux'),
      makeRelation('pkgA.Foo', 'pkgC.X'),
    ];
    const pkgs = new Set(['pkgA', 'pkgB', 'pkgC']);
    const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, pkgs);
    expect(fanOut.get('pkgA')).toBe(3);
    expect(fanIn.get('pkgB')).toBe(2);
    expect(fanIn.get('pkgC')).toBe(1);
  });

  it('does not count relations for packages not in the packageNames set', () => {
    const relations = [makeRelation('unknown.Foo', 'pkgA.Bar')];
    const pkgs = new Set(['pkgA']);
    const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, pkgs);
    // pkgA is the target → fanIn incremented; unknown is not in set so no fanOut recorded
    expect(fanIn.get('pkgA')).toBe(1);
    expect(fanOut.has('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeCycleMetrics
// ---------------------------------------------------------------------------

function makeCycle(members: string[], memberNames: string[]): CycleInfo {
  return { members, memberNames } as unknown as CycleInfo;
}

describe('computeCycleMetrics', () => {
  it('initialises all known packages to zero when there are no cycles', () => {
    const pkgs = new Set(['pkgA', 'pkgB']);
    const result = computeCycleMetrics([], pkgs);
    expect(result.get('pkgA')).toEqual({ cycleCount: 0, cyclesWith: [] });
    expect(result.get('pkgB')).toEqual({ cycleCount: 0, cyclesWith: [] });
  });

  it('increments cycleCount and collects cyclesWith for participating packages', () => {
    const cycle = makeCycle(['pkgA.Foo', 'pkgB.Bar'], ['pkgA', 'pkgB']);
    const pkgs = new Set(['pkgA', 'pkgB']);
    const result = computeCycleMetrics([cycle], pkgs);
    expect(result.get('pkgA')!.cycleCount).toBe(1);
    expect(result.get('pkgB')!.cycleCount).toBe(1);
  });

  it('deduplicates cyclesWith entries across multiple cycles', () => {
    // Two cycles share the same memberName
    const cycle1 = makeCycle(['pkgA.Foo', 'pkgB.Bar'], ['Shared']);
    const cycle2 = makeCycle(['pkgA.Baz', 'pkgB.Qux'], ['Shared']);
    const pkgs = new Set(['pkgA', 'pkgB']);
    const result = computeCycleMetrics([cycle1, cycle2], pkgs);
    // cycleCount should be 2 (appears in both cycles)
    expect(result.get('pkgA')!.cycleCount).toBe(2);
    // 'Shared' should appear only once despite being in two cycles
    expect(result.get('pkgA')!.cyclesWith).toEqual(['Shared']);
  });

  it('ignores cycles whose members do not belong to any known package', () => {
    const cycle = makeCycle(['unknown.Foo', 'other.Bar'], ['unknown', 'other']);
    const pkgs = new Set(['pkgA']);
    const result = computeCycleMetrics([cycle], pkgs);
    expect(result.get('pkgA')).toEqual({ cycleCount: 0, cyclesWith: [] });
  });
});

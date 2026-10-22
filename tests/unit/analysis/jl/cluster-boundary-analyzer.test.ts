/**
 * Unit tests for BoundaryAlignmentScorer and ClusterBoundaryAnalyzer
 * (TASK-66 Phases B & C).
 */

import { describe, it, expect } from 'vitest';
import {
  BoundaryAlignmentScorer,
  ClusterBoundaryAnalyzer,
} from '@/analysis/jl/cluster-boundary-analyzer.js';

// ---------------------------------------------------------------------------
// Fixture helpers — one-hot "structural signatures". Identical rows = same
// structural role, so K-Means (fixed seed) deterministically separates them.
// ---------------------------------------------------------------------------

function oneHot(d: number, active: number): number[] {
  return Array.from({ length: d }, (_, i) => (i === active ? 1 : 0));
}

function rowFor(signature: number, dim: number): number[] {
  return oneHot(dim, signature);
}

/** 3 packages × 20 entities, one distinct signature per package (well-aligned). */
function alignedFixture(): { entities: string[]; matrix: number[][] } {
  const entities: string[] = [];
  const matrix: number[][] = [];
  const packages = ['aa.core', 'bb.core', 'cc.core'];
  packages.forEach((pkg, p) => {
    for (let i = 1; i <= 20; i++) {
      entities.push(`${pkg}.C${String(i).padStart(2, '0')}`);
      matrix.push(rowFor(p, 3));
    }
  });
  return { entities, matrix };
}

/** pkgA splits across 3 signatures; pkgB / pkgC each own one signature. */
function splitFixture(): { entities: string[]; matrix: number[][] } {
  const entities: string[] = [];
  const matrix: number[][] = [];
  for (let i = 0; i < 5; i++) {
    entities.push(`aa.core.SA${i}`);
    matrix.push(rowFor(0, 5));
    entities.push(`aa.core.SB${i}`);
    matrix.push(rowFor(1, 5));
    entities.push(`aa.core.SC${i}`);
    matrix.push(rowFor(2, 5));
  }
  for (let i = 0; i < 5; i++) {
    entities.push(`bb.core.T${i}`);
    matrix.push(rowFor(3, 5));
    entities.push(`cc.core.U${i}`);
    matrix.push(rowFor(4, 5));
  }
  return { entities, matrix };
}

/** One cluster (signature 0) mixed 2/2/2 across 3 packages → fusion. */
function fusionFixture(): { entities: string[]; matrix: number[][] } {
  const entities: string[] = [];
  const matrix: number[][] = [];
  const packages = ['aa.core', 'bb.core', 'cc.core'];
  packages.forEach((pkg) => {
    for (let i = 0; i < 2; i++) {
      entities.push(`${pkg}.F${i}`);
      matrix.push(rowFor(0, 4)); // shared signature → fusion cluster
    }
  });
  packages.forEach((pkg, p) => {
    entities.push(`${pkg}.Own`);
    matrix.push(rowFor(p + 1, 4)); // package-private signature
  });
  return { entities, matrix };
}

/** One cluster 80% single-dominant → NOT a fusion. */
function dominantFixture(): { entities: string[]; matrix: number[][] } {
  const entities: string[] = [];
  const matrix: number[][] = [];
  for (let i = 0; i < 8; i++) {
    entities.push(`aa.core.D${i}`);
    matrix.push(rowFor(0, 3));
  }
  for (let i = 0; i < 2; i++) {
    entities.push(`bb.core.E${i}`);
    matrix.push(rowFor(0, 3));
  }
  entities.push('aa.core.DX');
  matrix.push(rowFor(1, 3));
  entities.push('bb.core.EX');
  matrix.push(rowFor(2, 3));
  return { entities, matrix };
}

// ---------------------------------------------------------------------------
// Phase B — BoundaryAlignmentScorer
// ---------------------------------------------------------------------------

describe('BoundaryAlignmentScorer', () => {
  it('holds entities/assignments injected at construction', () => {
    const scorer = new BoundaryAlignmentScorer(['a.core.X1', 'a.core.X2'], [0, 0], {
      minPackageSize: 1,
    });
    expect(scorer.score()).toEqual(scorer.score());
    expect(scorer.score()[0].purity).toBe(1.0);
  });

  it('extractPackage honours packageDepth (2 → two segments, 1 → one)', () => {
    const name = 'cli.commands.analyze.AnalyzeCommand';
    expect(BoundaryAlignmentScorer.extractPackage(name, 2)).toBe('cli.commands');
    expect(BoundaryAlignmentScorer.extractPackage(name, 1)).toBe('cli');
    expect(BoundaryAlignmentScorer.extractPackage('RootOnly', 2)).toBe('RootOnly');
  });

  it('purity = 1.0 / BAS = 1.0 when a package dominates its cluster', () => {
    const scores = new BoundaryAlignmentScorer(['a.core.X1', 'a.core.X2'], [0, 0], {
      minPackageSize: 1,
    }).score();
    expect(scores).toHaveLength(1);
    expect(scores[0].purity).toBe(1.0);
    expect(scores[0].coverage).toBe(1.0);
    expect(scores[0].bas).toBe(1.0);
  });

  it('purity = 0.25 when a package is split evenly across K=4 clusters', () => {
    const entities = Array.from({ length: 8 }, (_, i) => `a.core.E${i}`);
    const assignments = [0, 0, 1, 1, 2, 2, 3, 3];
    const scores = new BoundaryAlignmentScorer(entities, assignments, {
      minPackageSize: 1,
    }).score();
    expect(scores[0].purity).toBe(0.25);
  });

  it('single-entity package → purity 1.0 (never split)', () => {
    const scores = new BoundaryAlignmentScorer(['a.core.Solo'], [0], { minPackageSize: 1 }).score();
    expect(scores[0].purity).toBe(1.0);
    expect(scores[0].entityCount).toBe(1);
  });

  it('minPackageSize filter omits small packages', () => {
    const scores = new BoundaryAlignmentScorer(
      ['a.core.A', 'a.core.B', 'a.core.C', 'b.other.Lone'],
      [0, 0, 0, 1],
      { minPackageSize: 3 }
    ).score();
    expect(scores.map((s) => s.packageName)).toEqual(['a.core']);
  });

  it('globalBAS is the entity-count-weighted mean (hand-verified)', () => {
    // pkgA: 2 entities, BAS 1.0 · pkgB: 4 entities, BAS 0.75
    // expected = (2·1.0 + 4·0.75) / 6 = 5/6 = 0.8333
    const entities = ['a.core.A1', 'a.core.A2', 'b.core.B1', 'b.core.B2', 'b.core.B3', 'b.core.B4'];
    const assignments = [0, 0, 1, 1, 2, 2];
    const scorer = new BoundaryAlignmentScorer(entities, assignments, { minPackageSize: 1 });
    const scores = scorer.score();
    const byName = new Map(scores.map((s) => [s.packageName, s]));
    expect(byName.get('a.core')?.bas).toBe(1.0);
    expect(byName.get('b.core')?.bas).toBe(0.75);
    expect(scorer.globalBAS(scores)).toBeCloseTo(5 / 6, 4);
  });

  it('all scores stay in [0,1]', () => {
    const entities = ['a.core.A1', 'a.core.A2', 'a.core.A3', 'b.core.B1', 'b.core.B2', 'c.core.C1'];
    const assignments = [0, 0, 1, 1, 2, 2];
    const scores = new BoundaryAlignmentScorer(entities, assignments, {
      minPackageSize: 1,
    }).score();
    for (const s of scores) {
      expect(s.purity).toBeGreaterThanOrEqual(0);
      expect(s.purity).toBeLessThanOrEqual(1);
      expect(s.coverage).toBeGreaterThanOrEqual(0);
      expect(s.coverage).toBeLessThanOrEqual(1);
      expect(s.bas).toBeGreaterThanOrEqual(0);
      expect(s.bas).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase C — ClusterBoundaryAnalyzer + issue detectors
// ---------------------------------------------------------------------------

describe('ClusterBoundaryAnalyzer', () => {
  it('integration: 3 packages × 20 entities → globalBAS 1.0, no splits/fusions', () => {
    const { entities, matrix } = alignedFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    expect(report.mode).toBe('direct');
    expect(report.entityCount).toBe(60);
    expect(report.packageCount).toBe(3);
    expect(report.globalBAS).toBe(1.0);
    expect(report.splitPackages).toEqual([]);
    expect(report.crossDomainFusions).toEqual([]);
    expect(report.orphanEntities).toEqual([]);
    for (const cluster of report.clusters) {
      expect(cluster.dominantPackageRatio).toBeGreaterThanOrEqual(0);
      expect(cluster.dominantPackageRatio).toBeLessThanOrEqual(1);
    }
    // Every package is perfectly aligned.
    for (const s of report.packageScores) {
      expect(s.purity).toBe(1.0);
      expect(s.bas).toBe(1.0);
    }
  });

  it('split-package detector: purity < 0.5 && size ≥ 3 → flagged; small split not', () => {
    const { entities, matrix } = splitFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    const split = report.splitPackages.find((s) => s.packageName === 'aa.core');
    expect(split).toBeDefined();
    expect(split.purity).toBeLessThan(0.5);
    // clusterDistribution ratios sum to 1.0 (within float tolerance)
    const sum = split.clusterDistribution.reduce((acc, d) => acc + d.ratio, 0);
    expect(sum).toBeCloseTo(1.0, 9);
    // bb.core / cc.core are pure → not flagged.
    expect(report.splitPackages.some((s) => s.packageName === 'bb.core')).toBe(false);
    expect(report.splitPackages.some((s) => s.packageName === 'cc.core')).toBe(false);
  });

  it('minPackageSize guard: a small split package is omitted from splitPackages', () => {
    // 2 entities of pkgA in different clusters → purity 0.5 but size 2 < 3.
    const entities = ['aa.core.S1', 'aa.core.S2', 'bb.core.A1', 'bb.core.B1'];
    const matrix = [rowFor(0, 2), rowFor(1, 2), rowFor(0, 2), rowFor(1, 2)];
    const report = new ClusterBoundaryAnalyzer(matrix, entities, {
      seed: 42,
      minPackageSize: 3,
    }).analyze();
    expect(report.splitPackages.some((s) => s.packageName === 'aa.core')).toBe(false);
  });

  it('cross-domain fusion: mixed 2/2/2 cluster flagged; package-private clusters not', () => {
    const { entities, matrix } = fusionFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    expect(report.crossDomainFusions.length).toBeGreaterThanOrEqual(1);
    const fusion = report.crossDomainFusions.find((f) => f.representativeEntities.length === 6);
    expect(fusion).toBeDefined();
    expect(fusion.involvedPackages.map((p) => p.packageName).sort()).toEqual([
      'aa.core',
      'bb.core',
      'cc.core',
    ]);
    for (const p of fusion.involvedPackages) expect(p.ratio).toBeCloseTo(1 / 3, 3);
  });

  it('cross-domain fusion: 80% single-dominant cluster is NOT flagged', () => {
    const { entities, matrix } = dominantFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    // The 10-entity cluster is 80% aa.core → dominant coverage 0.8 ≥ 0.5.
    expect(report.crossDomainFusions).toEqual([]);
  });

  it('orphan detector: zero rows listed under includeOrphans; empty when false (still excluded)', () => {
    const entities = ['aa.core.A1', 'aa.core.A2', 'aa.core.A3', 'zz.isolated.Orphan'];
    const matrix = [rowFor(0, 2), rowFor(0, 2), rowFor(0, 2), [0, 0]];
    const withOrphans = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    expect(withOrphans.orphanEntities).toEqual(['zz.isolated.Orphan']);
    expect(withOrphans.entityCount).toBe(3);
    expect(withOrphans.packageScores.map((s) => s.packageName)).not.toContain('zz.isolated');

    const withoutOrphans = new ClusterBoundaryAnalyzer(matrix, entities, {
      seed: 42,
      includeOrphans: false,
    }).analyze();
    expect(withoutOrphans.orphanEntities).toEqual([]);
  });

  it('errors on fewer than 2 non-orphan entities', () => {
    const entities = ['a.core.Solo'];
    const matrix = [[1, 0]];
    expect(() => new ClusterBoundaryAnalyzer(matrix, entities).analyze()).toThrow();
  });

  it('errors on entity/matrix length mismatch', () => {
    const entities = ['a.core.A1', 'a.core.A2'];
    const matrix = [[1, 0]];
    expect(() => new ClusterBoundaryAnalyzer(matrix, entities).analyze()).toThrow(
      /length mismatch/
    );
  });
});

describe('ClusterBoundaryAnalyzer — packageOf (TASK-96)', () => {
  /** 3 directories × 6 undotted entities, one structural signature per directory. */
  function undottedFixture(): { entities: string[]; matrix: number[][]; packageOf: string[] } {
    const entities: string[] = [];
    const matrix: number[][] = [];
    const packageOf: string[] = [];
    ['parser', 'cli', 'mermaid'].forEach((dir, p) => {
      for (let i = 0; i < 6; i++) {
        entities.push(`${dir}Fn${i}`);
        matrix.push(rowFor(p, 3));
        packageOf.push(dir);
      }
    });
    return { entities, matrix, packageOf };
  }

  it('groups by packageOf: packageCount = distinct directories, not entity count', () => {
    const { entities, matrix, packageOf } = undottedFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }, packageOf).analyze();
    expect(report.entityCount).toBe(18);
    expect(report.packageCount).toBe(3);
    expect(report.globalBAS).toBe(1.0);
    expect(report.packageScores.map((s) => s.packageName)).toEqual(['cli', 'mermaid', 'parser']);
    for (const c of report.clusters)
      expect(['cli', 'mermaid', 'parser']).toContain(c.dominantPackage);
  });

  it('without packageOf, undotted names each become their own package (pre-fix behaviour)', () => {
    const { entities, matrix } = undottedFixture();
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    expect(report.packageCount).toBe(entities.length);
    expect(report.globalBAS).toBe(0);
  });

  it('omitting packageOf is identical to the name-prefix split (regression)', () => {
    const { entities, matrix } = alignedFixture();
    const implicit = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }).analyze();
    const explicit = new ClusterBoundaryAnalyzer(
      matrix,
      entities,
      { seed: 42 },
      undefined
    ).analyze();
    expect(explicit).toEqual(implicit);
    const named = entities.map((n) => BoundaryAlignmentScorer.extractPackage(n, 2));
    expect(new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }, named).analyze()).toEqual(
      implicit
    );
  });

  it('packageOf stays aligned with entities after orphan removal', () => {
    const { entities, matrix, packageOf } = undottedFixture();
    entities.unshift('lonelyFn');
    packageOf.unshift('orphanDir');
    matrix.unshift([0, 0, 0]);
    const report = new ClusterBoundaryAnalyzer(matrix, entities, { seed: 42 }, packageOf).analyze();
    expect(report.orphanEntities).toEqual(['lonelyFn']);
    expect(report.packageCount).toBe(3);
    expect(report.globalBAS).toBe(1.0);
  });

  it('errors when packageOf length does not match entityNames', () => {
    const { entities, matrix } = undottedFixture();
    expect(() => new ClusterBoundaryAnalyzer(matrix, entities, {}, ['only-one']).analyze()).toThrow(
      /length mismatch/
    );
  });
});

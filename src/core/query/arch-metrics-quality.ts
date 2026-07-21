import path from 'path';
import type { ArchJSON } from '@/types/index.js';
import type { PackageCoverage, TestFileInfo } from '@/types/extensions/test-analysis.js';
import type { ExtensionAccessor } from './extension-accessor.js';

// ── QualityMetrics ───────────────────────────────────────────────────────────

export class QualityMetrics {
  constructor(
    private readonly archJson: ArchJSON,
    private readonly ext: ExtensionAccessor
  ) {}

  getPackageCoverage(): PackageCoverage[] {
    const analysis = this.ext.getTestAnalysis();
    if (!analysis) return [];

    const linkByEntity = new Map<string, { score: number; testIds: string[] }>(
      analysis.coverageMap.map((l) => [
        l.sourceEntityId,
        { score: l.coverageScore, testIds: l.coveredByTestIds },
      ])
    );

    const ws = this.archJson.workspaceRoot ?? '';
    const buckets = new Map<string, { total: number; covered: number; testIds: Set<string> }>();

    for (const entity of this.archJson.entities) {
      const rawFile = entity.sourceLocation?.file ?? '';
      const relFile = ws && path.isAbsolute(rawFile) ? path.relative(ws, rawFile) : rawFile;
      const pkg = path.dirname(relFile) || '.';

      if (!buckets.has(pkg)) {
        buckets.set(pkg, { total: 0, covered: 0, testIds: new Set() });
      }
      const bucket = buckets.get(pkg);
      bucket.total++;

      const link = linkByEntity.get(entity.id);
      if (link && link.score > 0) {
        bucket.covered++;
        for (const tid of link.testIds) bucket.testIds.add(tid);
      }
    }

    return Array.from(buckets.entries())
      .map(([pkg, b]) => ({
        package: pkg,
        totalEntities: b.total,
        coveredEntities: b.covered,
        coverageRatio: b.total > 0 ? b.covered / b.total : 0,
        testFileIds: Array.from(b.testIds),
      }))
      .sort((a, b) => a.coverageRatio - b.coverageRatio);
  }

  getEntityCoverage(entityId: string): {
    entityId: string;
    coverageScore: number;
    coveredByTestIds: string[];
    testFileDetails: Array<{
      id: string;
      testType: TestFileInfo['testType'];
      testCaseCount: number;
      assertionCount: number;
      assertionDensity: number;
      frameworks: string[];
    }>;
    found: boolean;
  } {
    const analysis = this.ext.getTestAnalysis();
    if (!analysis) {
      return {
        entityId,
        coverageScore: 0,
        coveredByTestIds: [],
        testFileDetails: [],
        found: false,
      };
    }

    const link = analysis.coverageMap.find((l) => l.sourceEntityId === entityId);
    if (!link || link.coverageScore === 0) {
      return {
        entityId,
        coverageScore: link?.coverageScore ?? 0,
        coveredByTestIds: link?.coveredByTestIds ?? [],
        testFileDetails: [],
        found: link !== undefined,
      };
    }

    const testFileSet = new Set(link.coveredByTestIds);
    const testFileDetails = analysis.testFiles
      .filter((f) => testFileSet.has(f.id))
      .map((f) => ({
        id: f.id,
        testType: f.testType,
        testCaseCount: f.testCaseCount,
        assertionCount: f.assertionCount,
        assertionDensity: f.assertionDensity,
        frameworks: f.frameworks,
      }));

    return {
      entityId,
      coverageScore: link.coverageScore,
      coveredByTestIds: link.coveredByTestIds,
      testFileDetails,
      found: true,
    };
  }
}

import path from 'path';
import type { TestFileInfo, CoverageLink } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

export class TestCoverageMapper {
  buildCoverageMap(testFiles: TestFileInfo[], archJson: ArchJSON, workspaceRoot: string): CoverageLink[] {
    const linkMap = new Map<string, { testIds: Set<string>; score: number }>();

    for (const testFile of testFiles) {
      // Import-analysis layer: confidence weight 0.85
      for (const entityId of testFile.coveredEntityIds) {
        if (!linkMap.has(entityId)) {
          linkMap.set(entityId, { testIds: new Set(), score: 0 });
        }
        const link = linkMap.get(entityId)!;
        link.testIds.add(testFile.id);
        link.score = Math.min(1.0, link.score + 0.85 * 0.5);
      }

      // Path-convention layer: confidence weight 0.6
      // e.g. foo.test.ts → foo.ts convention
      const testNameWithoutExt = path
        .basename(testFile.id)
        .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '')
        .replace(/\.(test|spec)$/, '');

      for (const entity of archJson.entities) {
        if (!entity.sourceLocation?.file) continue;

        const relEntity = path.isAbsolute(entity.sourceLocation.file)
          ? path.relative(workspaceRoot, entity.sourceLocation.file)
          : entity.sourceLocation.file;

        const nameWithoutExt = path.basename(relEntity, path.extname(relEntity));

        if (nameWithoutExt === testNameWithoutExt) {
          if (!linkMap.has(entity.id)) {
            linkMap.set(entity.id, { testIds: new Set(), score: 0 });
          }
          const link = linkMap.get(entity.id)!;
          link.testIds.add(testFile.id);
          link.score = Math.min(1.0, link.score + 0.6 * 0.5);
        }
      }
    }

    return Array.from(linkMap.entries()).map(([entityId, data]) => ({
      sourceEntityId: entityId,
      coveredByTestIds: Array.from(data.testIds),
      coverageScore: data.score,
    }));
  }
}

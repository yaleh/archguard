import path from 'path';
import type { TestFileInfo, CoverageLink } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

export class TestCoverageMapper {
  buildCoverageMap(testFiles: TestFileInfo[], archJson: ArchJSON, workspaceRoot: string): CoverageLink[] {
    // Initialise with ALL entities at score 0 so callers can query uncovered entities
    const linkMap = new Map<string, { testIds: Set<string>; score: number }>(
      archJson.entities.map((e) => [e.id, { testIds: new Set<string>(), score: 0 }])
    );

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
      // TypeScript: foo.test.ts → foo, Python: test_foo.py or foo_test.py → foo
      // Go: foo_test.go → foo
      const testBasename = path.basename(testFile.id);
      let testNameWithoutExt = testBasename
        .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '')
        .replace(/\.(test|spec)$/, '');
      // Python convention: strip .py extension and test_ prefix / _test suffix
      if (testNameWithoutExt === testBasename && testBasename.endsWith('.py')) {
        testNameWithoutExt = testBasename
          .replace(/\.py$/, '')
          .replace(/^test_/, '')
          .replace(/_test$/, '');
      }
      // Go convention: foo_test.go → foo
      if (testNameWithoutExt === testBasename && testBasename.endsWith('_test.go')) {
        testNameWithoutExt = testBasename.replace(/_test\.go$/, '');
      }
      // C++ convention: test-foo.cpp → foo, test_foo.cpp → foo, foo_test.cpp → foo
      if (
        testNameWithoutExt === testBasename &&
        /\.(?:cpp|cc|cxx)$/.test(testBasename)
      ) {
        testNameWithoutExt = testBasename
          .replace(/\.(?:cpp|cc|cxx)$/, '')
          .replace(/^test[-_]/, '')
          .replace(/[-_]test$/, '');
      }

      // Go directory-match layer (confidence weight 0.35):
      // Any _test.go file in the same directory as an entity's source file is linked to that entity.
      // This covers cases where a package has multiple test files but the entity's sourceLocation
      // points to only one representative source file (Go Atlas package-level entity model).
      if (testBasename.endsWith('_test.go')) {
        const testDir = path.dirname(testFile.id);
        for (const entity of archJson.entities) {
          if (!entity.sourceLocation?.file) continue;
          const relEntityFile = path.isAbsolute(entity.sourceLocation.file)
            ? path.relative(workspaceRoot, entity.sourceLocation.file)
            : entity.sourceLocation.file;
          if (path.dirname(relEntityFile) === testDir) {
            if (!linkMap.has(entity.id)) {
              linkMap.set(entity.id, { testIds: new Set(), score: 0 });
            }
            const link = linkMap.get(entity.id)!;
            link.testIds.add(testFile.id);
            link.score = Math.min(1.0, link.score + 0.35 * 0.5);
          }
        }
      }

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

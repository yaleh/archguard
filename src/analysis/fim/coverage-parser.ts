import type { CoverageMatrix } from './types.js';

const DEFAULT_TRANSITIVE_DEPTH = 3;

function normalizeFileId(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isTestLikePath(filePath: string): boolean {
  const normalized = normalizeFileId(filePath);
  return /(^|\/)(?:tests?|__tests__)\//.test(normalized) || /(?:^|[._-])(test|spec)\.[^.]+$/.test(normalized);
}

function collectReachableSources(
  rootId: string,
  importGraph: Map<string, Set<string>>,
  allowedSources: Set<string>,
  maxDepth: number
): Set<string> {
  const visited = new Set<string>();
  const reachable = new Set<string>();
  const queue: Array<{ fileId: string; depth: number }> = [{ fileId: rootId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const imports = importGraph.get(current.fileId);
    if (!imports) continue;

    for (const importedFile of imports) {
      if (visited.has(importedFile)) continue;
      visited.add(importedFile);

      if (allowedSources.has(importedFile)) {
        reachable.add(importedFile);
      }

      if (current.depth + 1 < maxDepth) {
        queue.push({ fileId: importedFile, depth: current.depth + 1 });
      }
    }
  }

  return reachable;
}

export function buildCoverageMatrixFromImports(
  testFiles: string[],
  sourceFiles: string[],
  importGraph: Map<string, Set<string>>,
  maxDepth: number = DEFAULT_TRANSITIVE_DEPTH
): CoverageMatrix {
  const fileIds = sourceFiles.filter((fileId) => !isTestLikePath(fileId));
  const sourceSet = new Set(fileIds);
  const fileIndex = new Map(fileIds.map((fileId, index) => [fileId, index]));

  const matrix = testFiles.map((testFile) => {
    const row = new Array<number>(fileIds.length).fill(0);
    const reachableSources = collectReachableSources(testFile, importGraph, sourceSet, maxDepth);

    for (const fileId of reachableSources) {
      const index = fileIndex.get(fileId);
      if (index !== undefined) {
        row[index] = 1;
      }
    }

    return row;
  });

  return {
    matrix,
    testIds: [...testFiles],
    fileIds,
  };
}

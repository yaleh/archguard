import path from 'path';
import { promises as fs } from 'fs';
import { globby } from 'globby';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';
import {
  clampCoverageByPackage,
  computeGramMatrix,
  computeFisherInformation,
  filterProductionPackages,
} from './fim-builder.js';
import { buildCoverageMatrixFromImports } from './coverage-parser.js';
import { buildPackageCochangeMatrix } from './cochange-matrix-builder.js';
import { mantelTestWithNullModel, type MantelTestWithNullModelResult } from './mantel-test.js';
import type { CoverageMatrix, FIMCurrentArtifact, FIMSnapshot } from './types.js';

export interface ComputeImportApproximationFIMOptions {
  archJson: ArchJSON;
  plugin: ILanguagePlugin;
  workspaceRoot: string;
  patternConfig?: TestPatternConfig;
}

export interface ValidateFIMAgainstGitOptions {
  coverage: CoverageMatrix;
  packageNames: string[];
  packageMatrix: number[][];
  commits: CommitRecord[];
  permutations?: number;
  seed?: number;
  /** Workspace root for the analyzed project (used to resolve git-relative paths) */
  workspaceRoot?: string;
  /** Git repo root (parent of workspaceRoot when project is a git subdir) */
  gitRoot?: string;
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function relativeFilePath(filePath: string, workspaceRoot: string): string {
  const normalizedRoot = normalizeFilePath(workspaceRoot);
  const normalizedFile = normalizeFilePath(filePath);
  if (path.isAbsolute(filePath)) {
    return normalizeFilePath(path.relative(normalizedRoot, normalizedFile));
  }
  return normalizedFile;
}

async function inferTestDirs(workspaceRoot: string): Promise<string[]> {
  const candidates = ['tests', '__tests__', 'test', 'spec', 'autotest', 'src'];
  const results: string[] = [];
  for (const candidate of candidates) {
    const testDir = path.join(workspaceRoot, candidate);
    try {
      await fs.access(testDir);
      results.push(testDir);
    } catch {
      // skip
    }
  }
  return results.length > 0 ? results : [workspaceRoot];
}

async function discoverTestFiles(
  workspaceRoot: string,
  plugin: ILanguagePlugin,
  patternConfig?: TestPatternConfig
): Promise<string[]> {
  if (plugin.metadata.fileExtensions.includes('.go')) {
    return globby(`${workspaceRoot}/**/*_test.go`, { onlyFiles: true, absolute: true });
  }

  if (patternConfig?.testFileGlobs?.length) {
    return globby(patternConfig.testFileGlobs.map((glob) => `${workspaceRoot}/${glob}`), {
      onlyFiles: true,
      absolute: true,
    });
  }

  if (plugin.metadata.fileExtensions.includes('.java')) {
    const allJavaFiles = await globby(`${workspaceRoot}/**/*.java`, {
      onlyFiles: true,
      absolute: true,
      ignore: ['**/target/**', '**/build/**', '**/node_modules/**'],
    });
    return plugin.isTestFile ? allJavaFiles.filter((file) => plugin.isTestFile(file, patternConfig)) : allJavaFiles;
  }

  const candidateDirs = await inferTestDirs(workspaceRoot);
  const allFiles: string[] = [];
  for (const dir of candidateDirs) {
    const files = await globby(`${dir}/**/*`, {
      onlyFiles: true,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });
    allFiles.push(...files);
  }

  if (plugin.isTestFile) {
    return allFiles.filter((file) => plugin.isTestFile(file, patternConfig));
  }

  return allFiles.filter(
    (file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || /_test\.(go|ts)$/.test(file)
  );
}

async function collectRawTestFiles(
  filePaths: string[],
  plugin: ILanguagePlugin,
  patternConfig?: TestPatternConfig
): Promise<RawTestFile[]> {
  const rawFiles: RawTestFile[] = [];
  for (const filePath of filePaths) {
    try {
      const code = await fs.readFile(filePath, 'utf8');
      const raw = plugin.extractTestStructure?.(filePath, code, patternConfig);
      if (raw) {
        rawFiles.push(raw);
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return rawFiles;
}

function collectSourceFiles(archJson: ArchJSON, workspaceRoot: string): string[] {
  const sourceFiles = new Set<string>();

  for (const sourceFile of archJson.sourceFiles ?? []) {
    sourceFiles.add(relativeFilePath(sourceFile, workspaceRoot));
  }
  for (const entity of archJson.entities) {
    if (entity.sourceLocation?.file) {
      sourceFiles.add(relativeFilePath(entity.sourceLocation.file, workspaceRoot));
    }
  }

  return [...sourceFiles].filter(Boolean).sort();
}

function buildSourceImportGraph(archJson: ArchJSON, workspaceRoot: string): Map<string, Set<string>> {
  const entityToFile = new Map<string, string>();
  for (const entity of archJson.entities) {
    if (entity.sourceLocation?.file) {
      entityToFile.set(entity.id, relativeFilePath(entity.sourceLocation.file, workspaceRoot));
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const relation of archJson.relations) {
    const sourceFile = entityToFile.get(relation.source);
    const targetFile = entityToFile.get(relation.target);
    if (!sourceFile || !targetFile || sourceFile === targetFile) {
      continue;
    }
    if (!graph.has(sourceFile)) {
      graph.set(sourceFile, new Set());
    }
    graph.get(sourceFile)?.add(targetFile);
  }

  return graph;
}

function buildImportGraph(
  rawFiles: RawTestFile[],
  archJson: ArchJSON,
  workspaceRoot: string
): Map<string, Set<string>> {
  const graph = buildSourceImportGraph(archJson, workspaceRoot);

  for (const rawFile of rawFiles) {
    const testId = relativeFilePath(rawFile.filePath, workspaceRoot);
    if (!graph.has(testId)) {
      graph.set(testId, new Set());
    }
    for (const importedFile of rawFile.importedSourceFiles) {
      graph.get(testId)?.add(relativeFilePath(importedFile, workspaceRoot));
    }
  }

  return graph;
}

function packageNamesFromCoverage(packageCoverage: number[][], coverage: CoverageMatrix): string[] {
  const packageNames: string[] = [];
  if (packageCoverage.length === 0) return packageNames;

  for (let packageIndex = 0; packageIndex < packageCoverage[0].length; packageIndex++) {
    packageNames.push(`package-${packageIndex}`);
  }

  return packageNames;
}

function derivePackageNames(fileIds: string[], depth: number = 2): string[] {
  const packageNames: string[] = [];
  const seen = new Set<string>();
  for (const fileId of fileIds) {
    const dir = path.dirname(normalizeFilePath(fileId));
    const pkg = dir === '.' ? '.' : dir.split('/').filter(Boolean).slice(0, depth).join('/');
    if (!seen.has(pkg)) {
      seen.add(pkg);
      packageNames.push(pkg);
    }
  }
  return packageNames;
}

function topEigenvalueShares(eigenvalues: number[], limit: number = 20): number[] {
  const total = eigenvalues.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return eigenvalues.slice(0, limit).map((value) => value / total);
}

export async function computeImportApproximationFIM(
  options: ComputeImportApproximationFIMOptions
): Promise<{ artifact: FIMCurrentArtifact; snapshot: FIMSnapshot; coverage: CoverageMatrix }> {
  const rawFiles = await collectRawTestFiles(
    await discoverTestFiles(options.workspaceRoot, options.plugin, options.patternConfig),
    options.plugin,
    options.patternConfig
  );
  const sourceFiles = collectSourceFiles(options.archJson, options.workspaceRoot);
  const testIds = rawFiles.map((rawFile) => relativeFilePath(rawFile.filePath, options.workspaceRoot));
  const importGraph = buildImportGraph(rawFiles, options.archJson, options.workspaceRoot);
  const coverage = buildCoverageMatrixFromImports(testIds, sourceFiles, importGraph);
  const fileResult = computeFisherInformation(coverage);

  const packageNames = derivePackageNames(coverage.fileIds, 2);
  const packageCoverage = clampCoverageByPackage(coverage, coverage.fileIds, 2);
  const packageCoverageMatrix: CoverageMatrix = {
    matrix: packageCoverage,
    testIds: coverage.testIds,
    fileIds: packageNames,
  };
  const packageResult = computeFisherInformation(packageCoverageMatrix);
  const filteredPackageResult = filterProductionPackages(packageResult);

  const artifact: FIMCurrentArtifact = {
    timestamp: new Date().toISOString(),
    source: 'import-approximation',
    descriptionLength: options.archJson.entities.length + options.archJson.relations.length,
    fileIds: coverage.fileIds,
    packageNames,
    fileMatrix: coverage.matrix,
    packageMatrix: computeGramMatrix(packageCoverageMatrix),
    fileResult,
    packageResult,
    filteredPackageResult,
  };

  const snapshot: FIMSnapshot = {
    timestamp: artifact.timestamp,
    source: artifact.source,
    fileCount: fileResult.fileCount,
    testCount: fileResult.testCount,
    descriptionLength: artifact.descriptionLength,
    conditionNumber: packageResult.conditionNumber,
    effectiveDimension: packageResult.effectiveDimension,
    filteredConditionNumber: filteredPackageResult.conditionNumber,
    filteredEffectiveDimension: filteredPackageResult.effectiveDimension,
    topEigenvalueShares: topEigenvalueShares(packageResult.eigenvalues),
    uncoveredFileCount: fileResult.uncoveredFiles.length,
  };

  return { artifact, snapshot, coverage };
}

export function validateFIMAgainstGit(
  options: ValidateFIMAgainstGitOptions
): { mantel: MantelTestWithNullModelResult; packageCochangeMatrix: number[][] } {
  // Compute the subdirectory prefix: when workspaceRoot is a subdirectory of the git repo root,
  // commit file paths include the prefix (e.g. "workspace/app/src/foo.ts") while
  // coverage fileIds are relative to workspaceRoot (e.g. "src/foo.ts").
  let subDirPrefix = '';
  if (options.workspaceRoot && options.gitRoot) {
    const relativeSubDir = normalizeFilePath(path.relative(options.gitRoot, options.workspaceRoot));
    if (relativeSubDir && relativeSubDir !== '.') {
      subDirPrefix = relativeSubDir + '/';
    }
  }

  const fileToPackage = new Map(
    options.coverage.fileIds.flatMap((fileId) => {
      const packageName = path.dirname(normalizeFilePath(fileId)).split('/').filter(Boolean).slice(0, 2).join('/') || '.';
      const entries: [string, string][] = [[fileId, packageName]];
      if (subDirPrefix) {
        entries.push([subDirPrefix + fileId, packageName]);
      }
      return entries;
    })
  );
  const packageCochangeMatrix = buildPackageCochangeMatrix(
    options.commits,
    options.packageNames,
    fileToPackage
  );
  const mantel = mantelTestWithNullModel(options.packageMatrix, packageCochangeMatrix, {
    permutations: options.permutations,
    seed: options.seed,
  });
  return { mantel, packageCochangeMatrix };
}

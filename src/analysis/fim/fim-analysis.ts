/**
 * @experimental
 * FIM (Fisher Information Matrix) analysis for ArchGuard.
 *
 * This module implements import-approximation FIM computation and Mantel test
 * validation against git co-change matrices. It is no longer invoked by
 * `archguard analyze` but remains accessible via the `archguard_get_fim` MCP tool.
 *
 * Key finding: package-level FIM correlates significantly with git co-change
 * (Mantel r≈0.77, p<0.02). See docs/spikes/fim-experiment-report.md.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { globby } from 'globby';
import ts from 'typescript';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';
import {
  clampCoverageByPackage,
  computeGramMatrix,
  computeFisherInformation,
  filterProductionPackages,
  filterProductionCoverage,
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
  nonProductionPatterns?: string[];
  barrelFiles?: string[];
  suggestedDepth?: number;
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
  packageDepth?: number;
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
  const extraMatches =
    patternConfig?.testFileGlobs?.length
      ? await globby(patternConfig.testFileGlobs.map((globPattern) => `${workspaceRoot}/${globPattern}`), {
          onlyFiles: true,
          absolute: true,
        })
      : [];

  if (plugin.metadata.fileExtensions.includes('.go')) {
    const defaultMatches = await globby(`${workspaceRoot}/**/*_test.go`, { onlyFiles: true, absolute: true });
    return [...new Set([...defaultMatches, ...extraMatches])];
  }

  if (plugin.metadata.fileExtensions.includes('.java')) {
    const allJavaFiles = await globby(`${workspaceRoot}/**/*.java`, {
      onlyFiles: true,
      absolute: true,
      ignore: ['**/target/**', '**/build/**', '**/node_modules/**'],
    });
    return plugin.isTestFile
      ? [...new Set([...allJavaFiles.filter((file) => plugin.isTestFile(file, patternConfig)), ...extraMatches])]
      : [...new Set([...allJavaFiles, ...extraMatches])];
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
    return [...new Set([...allFiles.filter((file) => plugin.isTestFile(file, patternConfig)), ...extraMatches])];
  }

  return [
    ...new Set([
      ...allFiles.filter(
        (file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || /_test\.(go|ts)$/.test(file)
      ),
      ...extraMatches,
    ]),
  ];
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

function packageNameForFile(fileId: string, depth: number): string {
  const dir = path.dirname(normalizeFilePath(fileId));
  return dir === '.' ? '.' : dir.split('/').filter(Boolean).slice(0, Math.max(1, depth)).join('/');
}

function normalizeRelativePath(filePath: string): string {
  return normalizeFilePath(filePath).replace(/^\.\/+/, '');
}

function isSupportedBarrelExtension(filePath: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(path.extname(filePath));
}

function isVerifiedTypeScriptBarrel(content: string, filePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  if (sourceFile.statements.length === 0) {
    return false;
  }

  return sourceFile.statements.every((statement) => ts.isExportDeclaration(statement));
}

export async function resolveVerifiedBarrelPackages(
  workspaceRoot: string,
  fileIds: string[],
  barrelFiles: string[] | undefined,
  depth: number
): Promise<string[]> {
  if (!barrelFiles?.length) {
    return [];
  }

  const normalizedFileIds = fileIds.map((fileId) => normalizeRelativePath(fileId));
  const fileIdSet = new Set(normalizedFileIds);
  const packageFiles = new Map<string, string[]>();

  for (const fileId of normalizedFileIds) {
    const packageName = packageNameForFile(fileId, depth);
    const files = packageFiles.get(packageName);
    if (files) {
      files.push(fileId);
    } else {
      packageFiles.set(packageName, [fileId]);
    }
  }

  const verifiedBarrelFiles = new Set<string>();
  for (const candidate of barrelFiles.map((filePath) => normalizeRelativePath(filePath))) {
    if (!fileIdSet.has(candidate) || !isSupportedBarrelExtension(candidate)) {
      continue;
    }

    try {
      const content = await fs.readFile(path.join(workspaceRoot, candidate), 'utf8');
      if (isVerifiedTypeScriptBarrel(content, candidate)) {
        verifiedBarrelFiles.add(candidate);
      }
    } catch {
      // Ignore unreadable candidates.
    }
  }

  const excludedPackages: string[] = [];
  for (const [packageName, packageFileIds] of packageFiles) {
    if (
      packageFileIds.length > 0 &&
      packageFileIds.every((fileId) => verifiedBarrelFiles.has(fileId))
    ) {
      excludedPackages.push(packageName);
    }
  }

  return excludedPackages.sort();
}

interface PackageAnalysis {
  depth: number;
  packageNames: string[];
  packageMatrix: number[][];
  filteredPackageMatrix: number[][];
  packageResult: FIMCurrentArtifact['packageResult'];
  filteredPackageResult: FIMCurrentArtifact['filteredPackageResult'];
}

function buildPackageAnalysis(
  coverage: CoverageMatrix,
  depth: number,
  nonProductionPatterns: string[],
  exactPackageExclusions: string[] = []
): PackageAnalysis {
  const packageDepth = Math.max(1, depth);
  const packageNames = derivePackageNames(coverage.fileIds, packageDepth);
  const packageCoverage = clampCoverageByPackage(coverage, coverage.fileIds, packageDepth);
  const packageCoverageMatrix: CoverageMatrix = {
    matrix: packageCoverage,
    testIds: coverage.testIds,
    fileIds: packageNames,
  };
  const packageResult = computeFisherInformation(packageCoverageMatrix);
  const filteredPackageCoverageMatrix = filterProductionCoverage(
    packageCoverageMatrix,
    nonProductionPatterns,
    exactPackageExclusions
  );
  const filteredPackageResult = filterProductionPackages(
    packageCoverageMatrix,
    nonProductionPatterns,
    exactPackageExclusions
  );

  return {
    depth: packageDepth,
    packageNames,
    packageMatrix: computeGramMatrix(packageCoverageMatrix),
    filteredPackageMatrix: computeGramMatrix(filteredPackageCoverageMatrix),
    packageResult,
    filteredPackageResult,
  };
}

function topEigenvalueShares(eigenvalues: number[], limit: number = 20): number[] {
  const total = eigenvalues.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return eigenvalues.slice(0, limit).map((value) => value / total);
}

function safeDelta(left: number, right: number): number | null {
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
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
  const coverage = buildCoverageMatrixFromImports(
    testIds,
    sourceFiles,
    importGraph,
    undefined,
    options.patternConfig?.testFileGlobs
  );
  const fileResult = computeFisherInformation(coverage);
  const defaultDepth = 1;
  const selectedDepth = Math.max(defaultDepth, options.suggestedDepth ?? defaultDepth);
  const nonProductionPatterns = options.nonProductionPatterns ?? [];
  const selectedDepthBarrelPackages = await resolveVerifiedBarrelPackages(
    options.workspaceRoot,
    coverage.fileIds,
    options.barrelFiles,
    selectedDepth
  );
  const defaultDepthBarrelPackages =
    selectedDepth === defaultDepth
      ? selectedDepthBarrelPackages
      : await resolveVerifiedBarrelPackages(
          options.workspaceRoot,
          coverage.fileIds,
          options.barrelFiles,
          defaultDepth
        );
  const defaultPackageAnalysis =
    selectedDepth === defaultDepth
      ? buildPackageAnalysis(coverage, selectedDepth, [...nonProductionPatterns], selectedDepthBarrelPackages)
      : buildPackageAnalysis(coverage, defaultDepth, [
          ...nonProductionPatterns,
        ], defaultDepthBarrelPackages);
  const effectiveSelectedPackageAnalysis = buildPackageAnalysis(coverage, selectedDepth, [
    ...nonProductionPatterns,
  ], selectedDepthBarrelPackages);

  const artifact: FIMCurrentArtifact = {
    timestamp: new Date().toISOString(),
    source: 'import-approximation',
    descriptionLength: options.archJson.entities.length + options.archJson.relations.length,
    fileIds: coverage.fileIds,
    packageDepth: effectiveSelectedPackageAnalysis.depth,
    packageNames: effectiveSelectedPackageAnalysis.packageNames,
    fileMatrix: coverage.matrix,
    packageMatrix: effectiveSelectedPackageAnalysis.packageMatrix,
    filteredPackageMatrix: effectiveSelectedPackageAnalysis.filteredPackageMatrix,
    fileResult,
    packageResult: effectiveSelectedPackageAnalysis.packageResult,
    filteredPackageResult: effectiveSelectedPackageAnalysis.filteredPackageResult,
  };

  if (selectedDepth !== defaultDepth) {
    artifact.depth1 = {
      depth: defaultPackageAnalysis.depth,
      packageNames: defaultPackageAnalysis.packageNames,
      packageMatrix: defaultPackageAnalysis.packageMatrix,
      filteredPackageMatrix: defaultPackageAnalysis.filteredPackageMatrix,
      packageResult: defaultPackageAnalysis.packageResult,
      filteredPackageResult: defaultPackageAnalysis.filteredPackageResult,
    };
    artifact.depthN = {
      depth: effectiveSelectedPackageAnalysis.depth,
      packageNames: effectiveSelectedPackageAnalysis.packageNames,
      packageMatrix: effectiveSelectedPackageAnalysis.packageMatrix,
      filteredPackageMatrix: effectiveSelectedPackageAnalysis.filteredPackageMatrix,
      packageResult: effectiveSelectedPackageAnalysis.packageResult,
      filteredPackageResult: effectiveSelectedPackageAnalysis.filteredPackageResult,
    };
    artifact.depthComparison = {
      defaultDepth,
      suggestedDepth: selectedDepth,
      conditionNumberDelta: safeDelta(
        effectiveSelectedPackageAnalysis.filteredPackageResult.conditionNumber,
        defaultPackageAnalysis.filteredPackageResult.conditionNumber
      ),
      effectiveDimensionDelta:
        effectiveSelectedPackageAnalysis.filteredPackageResult.effectiveDimension -
        defaultPackageAnalysis.filteredPackageResult.effectiveDimension,
      uncoveredFileCountDelta:
        effectiveSelectedPackageAnalysis.filteredPackageResult.uncoveredFiles.length -
        defaultPackageAnalysis.filteredPackageResult.uncoveredFiles.length,
    };
  }

  const snapshot: FIMSnapshot = {
    timestamp: artifact.timestamp,
    source: artifact.source,
    fileCount: fileResult.fileCount,
    testCount: fileResult.testCount,
    descriptionLength: artifact.descriptionLength,
    conditionNumber: effectiveSelectedPackageAnalysis.packageResult.conditionNumber,
    effectiveDimension: effectiveSelectedPackageAnalysis.packageResult.effectiveDimension,
    filteredConditionNumber: effectiveSelectedPackageAnalysis.filteredPackageResult.conditionNumber,
    filteredEffectiveDimension: effectiveSelectedPackageAnalysis.filteredPackageResult.effectiveDimension,
    topEigenvalueShares: topEigenvalueShares(effectiveSelectedPackageAnalysis.packageResult.eigenvalues),
    filteredTopEigenvalueShares: topEigenvalueShares(
      effectiveSelectedPackageAnalysis.filteredPackageResult.eigenvalues
    ),
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
      const packageName =
        path
          .dirname(normalizeFilePath(fileId))
          .split('/')
          .filter(Boolean)
          .slice(0, Math.max(1, options.packageDepth ?? 1))
          .join('/') || '.';
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

import path from 'path';
import { promises as fs } from 'fs';
import { globby } from 'globby';
import type { ILanguagePlugin, RawTestFile } from '@/core/interfaces/language-plugin.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestAnalysis, TestFileInfo, TestPatternConfig, TestMetrics } from '@/types/extensions.js';
import { TEST_ANALYSIS_VERSION } from '@/types/extensions.js';
import { TestCoverageMapper } from './test-coverage-mapper.js';
import { TestIssueDetector } from './test-issue-detector.js';

export interface TestAnalyzerOptions {
  workspaceRoot: string;
  patternConfig?: TestPatternConfig;
}

export class TestAnalyzer {
  private mapper = new TestCoverageMapper();
  private issueDetector = new TestIssueDetector();

  async analyze(
    archJson: ArchJSON,
    plugin: ILanguagePlugin,
    options: TestAnalyzerOptions
  ): Promise<TestAnalysis> {
    const { workspaceRoot, patternConfig } = options;
    const testFilePaths = await this.discoverTestFiles(workspaceRoot, plugin, patternConfig);
    const rawFiles = await this.collectRawTestFiles(testFilePaths, plugin, patternConfig);
    const testFiles = this.buildTestFileInfos(rawFiles, archJson, workspaceRoot);
    const coverageMap = this.mapper.buildCoverageMap(testFiles, archJson, workspaceRoot);
    const issues = this.issueDetector.detect(testFiles, coverageMap);
    const metrics = this.computeMetrics(testFiles, coverageMap, issues, archJson);

    return {
      version: TEST_ANALYSIS_VERSION,
      patternConfigSource: patternConfig ? 'user' : 'auto',
      testFiles,
      coverageMap,
      issues,
      metrics,
    };
  }

  private async discoverTestFiles(
    workspaceRoot: string,
    plugin: ILanguagePlugin,
    patternConfig?: TestPatternConfig
  ): Promise<string[]> {
    // Go: scan entire workspace since _test.go files live beside source
    if (plugin.metadata.fileExtensions.includes('.go')) {
      return globby(`${workspaceRoot}/**/*_test.go`, { onlyFiles: true, absolute: true });
    }

    // Use testFileGlobs from patternConfig if provided
    if (patternConfig?.testFileGlobs && patternConfig.testFileGlobs.length > 0) {
      return globby(
        patternConfig.testFileGlobs.map((g) => `${workspaceRoot}/${g}`),
        { onlyFiles: true, absolute: true }
      );
    }

    // Default: walk candidate dirs and filter with plugin.isTestFile
    const candidateDirs = await this.inferTestDirs(workspaceRoot);
    const allFiles: string[] = [];
    for (const dir of candidateDirs) {
      const files = await globby(`${dir}/**/*`, { onlyFiles: true, absolute: true });
      allFiles.push(...files);
    }
    if (plugin.isTestFile) {
      return allFiles.filter((f) => plugin.isTestFile!(f, patternConfig));
    }
    return allFiles.filter(
      (f) =>
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f) || /_test\.(go|ts)$/.test(f)
    );
  }

  private async inferTestDirs(workspaceRoot: string): Promise<string[]> {
    const candidates = ['tests', '__tests__', 'test', 'spec', 'src'];
    const results: string[] = [];
    for (const c of candidates) {
      const p = path.join(workspaceRoot, c);
      try {
        await fs.access(p);
        results.push(p);
      } catch {
        // dir not found; skip
      }
    }
    return results.length > 0 ? results : [workspaceRoot];
  }

  private async collectRawTestFiles(
    filePaths: string[],
    plugin: ILanguagePlugin,
    patternConfig?: TestPatternConfig
  ): Promise<RawTestFile[]> {
    const results: RawTestFile[] = [];
    for (const filePath of filePaths) {
      try {
        const code = await fs.readFile(filePath, 'utf-8');
        if (plugin.extractTestStructure) {
          const raw = plugin.extractTestStructure(filePath, code, patternConfig);
          if (raw) results.push(raw);
        }
      } catch {
        // skip unreadable files
      }
    }
    return results;
  }

  private buildTestFileInfos(
    rawFiles: RawTestFile[],
    archJson: ArchJSON,
    workspaceRoot: string
  ): TestFileInfo[] {
    return rawFiles.map((raw) => {
      const assertionCount = raw.testCases.reduce((s, c) => s + c.assertionCount, 0);
      const testCaseCount = raw.testCases.length;
      const skipCount = raw.testCases.filter((c) => c.isSkipped).length;

      // Behaviour-first: zero assertions with at least one test case → 'debug'
      // Exception: performance-hinted files (JMH benchmarks etc.) never have assertions by design
      const testType: TestFileInfo['testType'] =
        assertionCount === 0 && testCaseCount > 0 && raw.testTypeHint !== 'performance'
          ? 'debug'
          : raw.testTypeHint !== 'unknown'
            ? raw.testTypeHint
            : 'unknown';

      const coveredEntityIds = this.resolveImportedEntityIds(
        raw.importedSourceFiles,
        archJson,
        workspaceRoot
      );

      return {
        id: path.relative(workspaceRoot, raw.filePath),
        filePath: raw.filePath,
        frameworks: raw.frameworks,
        testType,
        testCaseCount,
        assertionCount,
        skipCount,
        assertionDensity: testCaseCount > 0 ? assertionCount / testCaseCount : 0,
        coveredEntityIds,
      };
    });
  }

  private resolveImportedEntityIds(
    importedSourceFiles: string[],
    archJson: ArchJSON,
    workspaceRoot: string
  ): string[] {
    const result: string[] = [];
    for (const srcFile of importedSourceFiles) {
      const relSrc = path.isAbsolute(srcFile)
        ? path.relative(workspaceRoot, srcFile)
        : srcFile;
      for (const entity of archJson.entities) {
        const entityFile = entity.sourceLocation?.file;
        if (!entityFile) continue;
        const relEntity = path.isAbsolute(entityFile)
          ? path.relative(workspaceRoot, entityFile)
          : entityFile;
        if (relEntity === relSrc) {
          result.push(entity.id);
        }
      }
    }
    return [...new Set(result)];
  }

  private computeMetrics(
    testFiles: TestFileInfo[],
    coverageMap: any[],
    issues: any[],
    archJson: ArchJSON
  ): TestMetrics {
    const byType: Record<TestFileInfo['testType'], number> = {
      unit: 0,
      integration: 0,
      e2e: 0,
      performance: 0,
      debug: 0,
      unknown: 0,
    };
    let totalAssertions = 0;
    let totalCases = 0;
    let totalSkips = 0;

    for (const f of testFiles) {
      byType[f.testType]++;
      totalAssertions += f.assertionCount;
      totalCases += f.testCaseCount;
      totalSkips += f.skipCount;
    }

    const coveredEntities = new Set(
      coverageMap.filter((l: any) => l.coverageScore > 0).map((l: any) => l.sourceEntityId)
    );
    const totalEntities = archJson.entities.length;

    const issueCount: Record<string, number> = {
      zero_assertion: 0,
      orphan_test: 0,
      skip_accumulation: 0,
      assertion_poverty: 0,
    };
    for (const issue of issues) {
      issueCount[issue.type] = (issueCount[issue.type] ?? 0) + 1;
    }

    return {
      totalTestFiles: testFiles.length,
      byType,
      entityCoverageRatio: totalEntities > 0 ? coveredEntities.size / totalEntities : 0,
      assertionDensity: totalCases > 0 ? totalAssertions / totalCases : 0,
      skipRatio: totalCases > 0 ? totalSkips / totalCases : 0,
      issueCount: issueCount as any,
    };
  }
}

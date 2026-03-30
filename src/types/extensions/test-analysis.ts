/**
 * Test analysis extension types
 *
 * Defined in ADR-002: ArchJSON Extensions v1.2
 * Domain: Static test analysis — coverage, issues, metrics
 */

// ========== Test Analysis Extension ==========

export const TEST_ANALYSIS_VERSION = '1.0';

export interface TestPatternConfig {
  assertionPatterns?: string[];
  customAssertionRegexes?: string[];
  testCasePatterns?: string[];
  skipPatterns?: string[];
  testFileGlobs?: string[];
  typeClassificationRules?: Array<{
    pathPattern: string;
    type: 'unit' | 'integration' | 'e2e' | 'performance';
  }>;
}

export interface DetectedTestPatterns {
  detectedFrameworks: Array<{
    name: string;
    confidence: 'high' | 'medium' | 'low';
    evidenceFiles: string[];
  }>;
  suggestedPatternConfig: TestPatternConfig;
  notes: string[];
}

export interface TestAnalysis {
  version: string;
  patternConfigSource: 'auto' | 'user';
  testFiles: TestFileInfo[];
  coverageMap: CoverageLink[];
  issues: TestIssue[];
  metrics: TestMetrics;
}

export interface TestFileInfo {
  id: string;
  filePath: string;
  frameworks: string[];
  testType: 'unit' | 'integration' | 'e2e' | 'performance' | 'debug' | 'unknown';
  testCaseCount: number;
  assertionCount: number;
  skipCount: number;
  assertionDensity: number;
  coveredEntityIds: string[];
}

export interface CoverageLink {
  sourceEntityId: string;
  coveredByTestIds: string[];
  coverageScore: number;
}

export interface TestIssue {
  type: 'zero_assertion' | 'orphan_test' | 'skip_accumulation' | 'assertion_poverty';
  severity: 'warning' | 'info';
  testFileId: string;
  message: string;
  suggestion?: string;
}

export interface TestMetrics {
  totalTestFiles: number;
  byType: Record<TestFileInfo['testType'], number>;
  entityCoverageRatio: number;
  assertionDensity: number;
  skipRatio: number;
  issueCount: Record<TestIssue['type'], number>;
}

export interface PackageCoverage {
  /** Package path derived from entity sourceLocation.file, e.g. "lmdeploy/pytorch/models" */
  package: string;
  /** Total number of entities whose sourceLocation.file falls under this package */
  totalEntities: number;
  /** Number of those entities with coverageScore > 0 in the coverageMap */
  coveredEntities: number;
  /** coveredEntities / totalEntities, 0 when totalEntities === 0 */
  coverageRatio: number;
  /** IDs of test files that contribute at least one coverage link to this package */
  testFileIds: string[];
}

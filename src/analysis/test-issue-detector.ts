import type { TestFileInfo, CoverageLink, TestIssue } from '@/types/extensions.js';

export class TestIssueDetector {
  detect(testFiles: TestFileInfo[], coverageMap: CoverageLink[]): TestIssue[] {
    const issues: TestIssue[] = [];

    for (const file of testFiles) {
      // zero_assertion: has test cases but zero assertions (only for non-debug types)
      if (file.testCaseCount > 0 && file.assertionCount === 0 && file.testType !== 'debug') {
        issues.push({
          type: 'zero_assertion',
          severity: 'warning',
          testFileId: file.id,
          message: `Test file has ${file.testCaseCount} test case(s) but no assertions.`,
          suggestion: 'Add assertion calls (expect, assert) to verify behaviour.',
        });
      }

      // orphan_test: non-debug test with no covered entities
      if (file.testType !== 'debug' && file.coveredEntityIds.length === 0) {
        issues.push({
          type: 'orphan_test',
          severity: 'warning',
          testFileId: file.id,
          message: 'Test file has no detected coverage links to source entities.',
          suggestion: 'Ensure test imports source files being tested.',
        });
      }

      // skip_accumulation: more than 30% of tests skipped
      if (file.testCaseCount > 0 && file.skipCount / file.testCaseCount > 0.3) {
        issues.push({
          type: 'skip_accumulation',
          severity: 'warning',
          testFileId: file.id,
          message: `${file.skipCount} of ${file.testCaseCount} tests are skipped (${Math.round((file.skipCount / file.testCaseCount) * 100)}%).`,
          suggestion: 'Review skipped tests and either fix or remove them.',
        });
      }

      // assertion_poverty: fewer than 1 assertion per test case on average
      if (file.testCaseCount > 0 && file.assertionDensity < 1 && file.testType !== 'debug') {
        issues.push({
          type: 'assertion_poverty',
          severity: 'info',
          testFileId: file.id,
          message: `Low assertion density: ${file.assertionDensity.toFixed(2)} assertions per test case.`,
          suggestion: 'Consider adding more assertions to increase test thoroughness.',
        });
      }
    }

    return issues;
  }
}

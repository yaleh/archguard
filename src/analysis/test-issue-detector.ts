import type { TestFileInfo, CoverageLink, TestIssue } from '@/types/extensions.js';

export class TestIssueDetector {
  detect(testFiles: TestFileInfo[], coverageMap: CoverageLink[]): TestIssue[] {
    const issues: TestIssue[] = [];

    // Build a set of test file IDs that appear in the coverage map with score > 0.
    // This covers path-convention matches that do not produce coveredEntityIds entries.
    const filesWithMapLinks = new Set<string>();
    for (const link of coverageMap) {
      if (link.coverageScore > 0) {
        for (const testId of link.coveredByTestIds) {
          filesWithMapLinks.add(testId);
        }
      }
    }

    for (const file of testFiles) {
      // zero_assertion: has test cases but zero assertions — emitted for ALL types including debug
      // Exception: performance files (JMH benchmarks etc.) intentionally have no assertions
      // (testType 'debug' means behaviour-first classification already applied; issue still surfaces it)
      if (file.testCaseCount > 0 && file.assertionCount === 0 && file.testType !== 'performance') {
        issues.push({
          type: 'zero_assertion',
          severity: 'warning',
          testFileId: file.id,
          message: `Test file has ${file.testCaseCount} test case(s) but no assertions (classified as '${file.testType}').`,
          suggestion:
            'Add assertions to verify behaviour. If using custom helpers, correct assertionPatterns via archguard_detect_test_patterns first.',
        });
      }

      // orphan_test: non-debug test with no covered entities via either import-analysis or
      // path-convention (coverage map). We check both sources to avoid false positives when
      // path-convention matches succeed but do not produce coveredEntityIds entries.
      if (file.testType !== 'debug' && file.coveredEntityIds.length === 0 && !filesWithMapLinks.has(file.id)) {
        issues.push({
          type: 'orphan_test',
          severity: 'info',
          testFileId: file.id,
          message: 'Test file has no detected coverage links to source entities.',
          suggestion: 'Ensure test imports source files being tested.',
        });
      }

      // skip_accumulation: more than 20% of tests skipped (severity 'info')
      if (file.testCaseCount > 0 && file.skipCount / file.testCaseCount > 0.2) {
        issues.push({
          type: 'skip_accumulation',
          severity: 'info',
          testFileId: file.id,
          message: `${file.skipCount} of ${file.testCaseCount} tests are skipped (${Math.round((file.skipCount / file.testCaseCount) * 100)}%).`,
          suggestion: 'Review skipped tests and either fix or remove them.',
        });
      }

      // assertion_poverty: fewer than 1 assertion per test case on average
      // Exempt debug (already covered by zero_assertion) and performance (benchmarks never assert)
      if (file.testCaseCount > 0 && file.assertionDensity < 1 && file.testType !== 'debug' && file.testType !== 'performance') {
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

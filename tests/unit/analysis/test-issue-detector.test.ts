import { describe, it, expect } from 'vitest';
import type { TestFileInfo, CoverageLink } from '@/types/extensions.js';

function makeTestFile(overrides: Partial<TestFileInfo> = {}): TestFileInfo {
  return {
    id: 'foo.test.ts',
    filePath: '/workspace/foo.test.ts',
    frameworks: ['vitest'],
    testType: 'unit',
    testCaseCount: 2,
    assertionCount: 4,
    skipCount: 0,
    assertionDensity: 2,
    coveredEntityIds: ['entity-1'],
    ...overrides,
  };
}

describe('TestIssueDetector', () => {
  it('detects zero_assertion for test file with 0 assertions and testType != debug', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ assertionCount: 0, testCaseCount: 1, testType: 'unit' })];
    const issues = detector.detect(files, []);
    const zeroAssertion = issues.filter(i => i.type === 'zero_assertion');
    expect(zeroAssertion.length).toBeGreaterThan(0);
  });

  it('does NOT detect orphan_test for debug-type files', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ testType: 'debug', coveredEntityIds: [] })];
    const issues = detector.detect(files, []);
    const orphan = issues.filter(i => i.type === 'orphan_test');
    expect(orphan).toHaveLength(0);
  });

  it('detects orphan_test for unit file with no coverage', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ testType: 'unit', coveredEntityIds: [] })];
    const issues = detector.detect(files, []);
    const orphan = issues.filter(i => i.type === 'orphan_test');
    expect(orphan.length).toBeGreaterThan(0);
  });

  it('detects skip_accumulation when skipCount > 30% of testCaseCount', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ skipCount: 5, testCaseCount: 10 })];
    const issues = detector.detect(files, []);
    const skip = issues.filter(i => i.type === 'skip_accumulation');
    expect(skip.length).toBeGreaterThan(0);
  });

  it('does NOT detect skip_accumulation below threshold (1/10 = 10%)', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ skipCount: 1, testCaseCount: 10 })];
    const issues = detector.detect(files, []);
    const skip = issues.filter(i => i.type === 'skip_accumulation');
    expect(skip).toHaveLength(0);
  });

  it('detects assertion_poverty when assertionDensity < 1 and testType is not debug', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({
      testCaseCount: 5,
      assertionCount: 3,
      assertionDensity: 0.6,
      testType: 'unit',
    })];
    const issues = detector.detect(files, []);
    const poverty = issues.filter(i => i.type === 'assertion_poverty');
    expect(poverty.length).toBeGreaterThan(0);
  });

  // Deviation 1 fix: debug files MUST emit zero_assertion (proposal: "同步输出 issue")
  it('detects zero_assertion for debug-type files (behaviour-first)', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ assertionCount: 0, testCaseCount: 1, testType: 'debug' })];
    const issues = detector.detect(files, []);
    const zeroAssertion = issues.filter(i => i.type === 'zero_assertion');
    expect(zeroAssertion).toHaveLength(1);
  });

  // Deviation 2: orphan_test severity must be 'info'
  it('orphan_test has severity info', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ testType: 'unit', coveredEntityIds: [] })];
    const issues = detector.detect(files, []);
    const orphan = issues.find(i => i.type === 'orphan_test');
    expect(orphan?.severity).toBe('info');
  });

  // Deviation 3a: skip_accumulation triggers at >20% threshold (not >30%)
  it('detects skip_accumulation when skipCount > 20% (3/14 ≈ 21%)', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ skipCount: 3, testCaseCount: 14 })]; // 21.4%
    const issues = detector.detect(files, []);
    const skip = issues.filter(i => i.type === 'skip_accumulation');
    expect(skip).toHaveLength(1);
  });

  // Deviation 3b: skip_accumulation severity must be 'info'
  it('skip_accumulation has severity info', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ skipCount: 5, testCaseCount: 10 })]; // 50%
    const issues = detector.detect(files, []);
    const skip = issues.find(i => i.type === 'skip_accumulation');
    expect(skip?.severity).toBe('info');
  });

  it('does NOT emit assertion_poverty for performance-typed files (JMH benchmarks)', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({
      testCaseCount: 4,
      assertionCount: 0,
      assertionDensity: 0,
      testType: 'performance',
    })];
    const issues = detector.detect(files, []);
    expect(issues.filter(i => i.type === 'assertion_poverty')).toHaveLength(0);
    expect(issues.filter(i => i.type === 'zero_assertion')).toHaveLength(0);
  });

  it('returns empty array for healthy test files', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({
      assertionCount: 5,
      testCaseCount: 3,
      assertionDensity: 1.67,
      skipCount: 0,
      coveredEntityIds: ['entity-1'],
      testType: 'unit',
    })];
    const issues = detector.detect(files, []);
    expect(issues).toHaveLength(0);
  });

  // Fix 3: orphan_test must use coverage MAP (path-convention links), not just coveredEntityIds
  it('does NOT flag orphan_test when test is linked via coverage map (path-convention)', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const file = makeTestFile({
      assertionCount: 5,
      testCaseCount: 3,
      assertionDensity: 1.67,
      skipCount: 0,
      coveredEntityIds: [],  // no import-based links
      testType: 'unit',
    });
    // But the coverage MAP has a link for this test (via path-convention)
    const coverageMap = [{
      sourceEntityId: 'internal/filter.Filter',
      coveredByTestIds: [file.id],
      coverageScore: 0.3,
    }];
    const issues = detector.detect([file], coverageMap);
    expect(issues.filter(i => i.type === 'orphan_test')).toHaveLength(0);
  });

  it('still flags orphan_test when test has no links in the coverage map either', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const file = makeTestFile({
      assertionCount: 5,
      testCaseCount: 3,
      assertionDensity: 1.67,
      skipCount: 0,
      coveredEntityIds: [],
      testType: 'unit',
    });
    // Coverage map exists but does NOT include this test
    const coverageMap = [{
      sourceEntityId: 'other.Entity',
      coveredByTestIds: ['other_test.go'],
      coverageScore: 0.3,
    }];
    const issues = detector.detect([file], coverageMap);
    expect(issues.filter(i => i.type === 'orphan_test')).toHaveLength(1);
  });
});

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

  it('does NOT detect zero_assertion for debug-type files', async () => {
    const { TestIssueDetector } = await import('@/analysis/test-issue-detector.js');
    const detector = new TestIssueDetector();
    const files = [makeTestFile({ assertionCount: 0, testCaseCount: 1, testType: 'debug' })];
    const issues = detector.detect(files, []);
    const zeroAssertion = issues.filter(i => i.type === 'zero_assertion');
    expect(zeroAssertion).toHaveLength(0);
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
});

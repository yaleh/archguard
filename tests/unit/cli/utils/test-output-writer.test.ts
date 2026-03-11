import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { TestOutputWriter } from '@/cli/utils/test-output-writer.js';
import type { TestAnalysis } from '@/types/extensions.js';

const makeAnalysis = (overrides: Partial<TestAnalysis> = {}): TestAnalysis => ({
  version: '1.0',
  patternConfigSource: 'auto',
  testFiles: [],
  coverageMap: [],
  issues: [],
  metrics: {
    totalTestFiles: 3,
    byType: { unit: 2, integration: 1, e2e: 0, performance: 0, debug: 0, unknown: 0 },
    entityCoverageRatio: 0.75,
    assertionDensity: 4.5,
    skipRatio: 0.1,
    issueCount: {
      zero_assertion: 0,
      orphan_test: 1,
      skip_accumulation: 0,
      assertion_poverty: 0,
    },
  },
  ...overrides,
});

describe('TestOutputWriter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-output-writer-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates test/metrics.md and test/issues.md', async () => {
    const writer = new TestOutputWriter();
    await writer.write(makeAnalysis(), tmpDir);

    expect(await fs.pathExists(path.join(tmpDir, 'test', 'metrics.md'))).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, 'test', 'issues.md'))).toBe(true);
  });

  it('metrics.md contains total test files count', async () => {
    const writer = new TestOutputWriter();
    await writer.write(makeAnalysis(), tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'test', 'metrics.md'), 'utf-8');
    expect(content).toContain('3');
    expect(content).toContain('Test Metrics');
  });

  it('metrics.md contains coverage ratio as percentage', async () => {
    const writer = new TestOutputWriter();
    await writer.write(makeAnalysis(), tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'test', 'metrics.md'), 'utf-8');
    expect(content).toContain('75.0%');
  });

  it('issues.md contains "No issues detected." when there are no issues', async () => {
    const writer = new TestOutputWriter();
    await writer.write(makeAnalysis({ issues: [] }), tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'test', 'issues.md'), 'utf-8');
    expect(content).toContain('No issues detected.');
  });

  it('issues.md contains warning section when warnings present', async () => {
    const analysis = makeAnalysis({
      issues: [
        {
          type: 'zero_assertion',
          severity: 'warning',
          testFileId: 'tests/unit/foo.test.ts',
          message: 'No assertions found',
          suggestion: 'Add at least one assertion',
        },
      ],
    });
    const writer = new TestOutputWriter();
    await writer.write(analysis, tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'test', 'issues.md'), 'utf-8');
    expect(content).toContain('Warnings');
    expect(content).toContain('zero_assertion');
    expect(content).toContain('No assertions found');
    expect(content).toContain('Add at least one assertion');
  });

  it('issues.md contains info section when info issues present', async () => {
    const analysis = makeAnalysis({
      issues: [
        {
          type: 'orphan_test',
          severity: 'info',
          testFileId: 'tests/unit/bar.test.ts',
          message: 'Test file has no coverage links',
        },
      ],
    });
    const writer = new TestOutputWriter();
    await writer.write(analysis, tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'test', 'issues.md'), 'utf-8');
    expect(content).toContain('Info');
    expect(content).toContain('orphan_test');
  });
});

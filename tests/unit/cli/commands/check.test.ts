/**
 * Unit tests for the `archguard check` command.
 * Mocks loadSnapshots, evaluateAllRules, and ConfigLoader to avoid filesystem access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import type { RuleResult } from '@/analysis/fitness/rule-types.js';
import type { MetricVector } from '@/types/metric-vector.js';

// Mock snapshot-store before importing the command
vi.mock('@/analysis/snapshot-store.js', () => ({
  loadSnapshots: vi.fn(),
}));

// Mock rule-evaluator
vi.mock('@/analysis/fitness/rule-evaluator.js', () => ({
  evaluateAllRules: vi.fn(),
}));

// Mock config-loader
vi.mock('@/cli/config-loader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
  })),
}));

import { createCheckCommand } from '@/cli/commands/check.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { evaluateAllRules } from '@/analysis/fitness/rule-evaluator.js';
import { ConfigLoader } from '@/cli/config-loader.js';

// -- Helpers --

function makeVector(overrides: Partial<MetricVector> = {}): MetricVector {
  return {
    schemaVersion: 1,
    totalEntities: 10,
    totalRelations: 5,
    inferredRelationRatio: 0.1,
    sccCount: 0,
    relationTypeBreakdown: {},
    maxInDegree: 5,
    maxOutDegree: 5,
    maxPackageSize: 10,
    giniInDegree: 0.2,
    giniPackageSize: 0.3,
    packageCount: 3,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    schemaVersion: 1,
    commitSha: 'abc1234def',
    branch: 'main',
    timestamp: '2024-01-01T00:00:00.000Z',
    archguardVersion: '0.1.0',
    metricVector: makeVector(),
    ...overrides,
  };
}

function makePassResult(): RuleResult {
  return {
    rule: { metric: 'sccCount', op: '<=', value: 0, message: 'No cyclic dependencies allowed' },
    passed: true,
    actual: 0,
  };
}

function makeFailResult(actual = 25): RuleResult {
  return {
    rule: { metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' },
    passed: false,
    actual,
  };
}

// -- Tests --

describe('createCheckCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let mockLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      return undefined as never;
    });

    // Set up default mock for ConfigLoader
    mockLoad = vi.fn();
    vi.mocked(ConfigLoader).mockImplementation(
      () =>
        ({
          load: mockLoad,
        }) as unknown as InstanceType<typeof ConfigLoader>
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('all rules pass → exits with 0 (or no exit call)', async () => {
    mockLoad.mockResolvedValue({
      fitness: {
        rules: [
          { metric: 'sccCount', op: '<=', value: 0, message: 'No cyclic dependencies allowed' },
        ],
        failOnViolation: true,
      },
    });
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot()]);
    vi.mocked(evaluateAllRules).mockReturnValue([makePassResult()]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    // process.exit should not be called with 1
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
  });

  it('one rule fails + failOnViolation=true → exits with code 1', async () => {
    mockLoad.mockResolvedValue({
      fitness: {
        rules: [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }],
        failOnViolation: true,
      },
    });
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot()]);
    vi.mocked(evaluateAllRules).mockReturnValue([makeFailResult()]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('one rule fails + failOnViolation=false → exits with code 0', async () => {
    mockLoad.mockResolvedValue({
      fitness: {
        rules: [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }],
        failOnViolation: false,
      },
    });
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot()]);
    vi.mocked(evaluateAllRules).mockReturnValue([makeFailResult()]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    expect(processExitSpy).not.toHaveBeenCalledWith(1);
  });

  it('no fitness config in loaded config → prints "No fitness rules configured" and exits 0', async () => {
    mockLoad.mockResolvedValue({
      // no fitness field
      outputDir: '.archguard',
    });
    vi.mocked(loadSnapshots).mockResolvedValue([]);
    vi.mocked(evaluateAllRules).mockReturnValue([]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    const allOutput = [
      ...consoleLogSpy.mock.calls.map((c) => c.join(' ')),
      ...consoleErrorSpy.mock.calls.map((c) => c.join(' ')),
    ].join('\n');
    expect(allOutput).toContain('No fitness rules configured');
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
    expect(evaluateAllRules).not.toHaveBeenCalled();
  });

  it('output includes rule message and actual value for failed rules', async () => {
    mockLoad.mockResolvedValue({
      fitness: {
        rules: [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }],
        failOnViolation: false,
      },
    });
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot()]);
    vi.mocked(evaluateAllRules).mockReturnValue([makeFailResult(25)]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    const allOutput = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('FAIL');
    expect(allOutput).toContain('No god files');
    expect(allOutput).toContain('25');
  });
});

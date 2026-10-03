/**
 * Unit tests for the `archguard check` command.
 *
 * Only the snapshot store (metric vector) and the config loader are mocked.
 * The rule evaluator, dependency checker, and relations loader are exercised
 * for real against temp-dir analyze artifacts, so the `no-dependency` cases
 * prove the whole load → evaluate → report chain rather than a stubbed seam.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import type { MetricVector } from '@/types/metric-vector.js';

// Mock snapshot-store before importing the command
vi.mock('@/analysis/snapshot-store.js', () => ({
  loadSnapshots: vi.fn(),
}));

// Mock config-loader
vi.mock('@/cli/config-loader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
  })),
}));

import { createCheckCommand } from '@/cli/commands/check.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
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

/** Write the analyze artifacts a real run would leave under `<workDir>/query/`. */
async function writeQueryArtifacts(
  workDir: string,
  edges: Array<[string, string]>,
  scopeKey = 'scope0001'
): Promise<void> {
  const queryDir = path.join(workDir, 'query');
  await fs.ensureDir(path.join(queryDir, scopeKey));
  await fs.writeJson(path.join(queryDir, 'manifest.json'), {
    version: '1.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    globalScopeKey: scopeKey,
    scopes: [
      {
        key: scopeKey,
        label: 'src (typescript)',
        language: 'typescript',
        kind: 'parsed',
        sources: ['src'],
        entityCount: 2,
        relationCount: edges.length,
        hasAtlasExtension: false,
      },
    ],
  });
  await fs.writeJson(path.join(queryDir, scopeKey, 'arch.json'), {
    version: '1.0',
    language: 'typescript',
    timestamp: '2024-01-01T00:00:00.000Z',
    sourceFiles: [],
    entities: [],
    relations: edges.map(([source, target], i) => ({
      id: `rel-${i}`,
      type: 'dependency',
      source,
      target,
    })),
  });
}

const FORBIDDEN_RULE = {
  type: 'no-dependency' as const,
  from: 'src/parser/**',
  to: 'src/cli/**',
  message: 'Parser must not depend on CLI',
};

// -- Tests --

describe('createCheckCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let mockLoad: ReturnType<typeof vi.fn>;
  let tmpDirs: string[];

  function allOutput(): string {
    return [
      ...consoleLogSpy.mock.calls.map((c) => c.join(' ')),
      ...consoleErrorSpy.mock.calls.map((c) => c.join(' ')),
    ].join('\n');
  }

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-check-'));
    tmpDirs.push(dir);
    return dir;
  }

  /** Config the command would load: work dir (query artifacts) + output dir (snapshots). */
  function mockConfig(workDir: string, rules: unknown[], failOnViolation = true): void {
    mockLoad.mockResolvedValue({
      workDir,
      outputDir: workDir,
      fitness: { rules, failOnViolation },
    });
  }

  async function runCheck(rules: unknown[], failOnViolation = true): Promise<string> {
    const dir = await makeTmpDir();
    mockConfig(dir, rules, failOnViolation);
    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });
    return dir;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    tmpDirs = [];
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

    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot()]);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    await Promise.all(tmpDirs.map((d) => fs.remove(d)));
  });

  // -- no-dependency: real relations from the analyze artifact --

  it('no-dependency: forbidden from→to edge exists → FAIL, prints the edge, exits 1', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [FORBIDDEN_RULE]);
    await writeQueryArtifacts(dir, [['src/parser/p.ts.P', 'src/cli/c.ts.C']]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    const output = allOutput();
    expect(output).toContain('FAIL');
    expect(output).toContain('Parser must not depend on CLI');
    expect(output).toContain('src/parser/p.ts.P → src/cli/c.ts.C');
    expect(output).not.toContain('NOT-EVALUATED');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(2);
  });

  it('no-dependency: no such edge in the graph → PASS, does not exit non-zero', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [FORBIDDEN_RULE]);
    // Only the reverse direction exists — the rule must not fire.
    await writeQueryArtifacts(dir, [['src/cli/c.ts.C', 'src/parser/p.ts.P']]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    const output = allOutput();
    expect(output).toContain('PASS');
    expect(output).not.toContain('NOT-EVALUATED');
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(2);
  });

  it('no-dependency with no analyze artifact → NOT-EVALUATED (not PASS), exits 2', async () => {
    await runCheck([FORBIDDEN_RULE]);

    const output = allOutput();
    expect(output).toContain('NOT-EVALUATED');
    expect(output).toContain('Parser must not depend on CLI');
    expect(output).toContain('Relation data unavailable');
    expect(output).not.toContain('PASS');
    expect(processExitSpy).toHaveBeenCalledWith(2);
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
  });

  it('no-dependency with an artifact that has zero edges → NOT-EVALUATED, exits 2', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [FORBIDDEN_RULE]);
    await writeQueryArtifacts(dir, []);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    const output = allOutput();
    expect(output).toContain('NOT-EVALUATED');
    expect(output).toContain('has no relation edges');
    expect(output).not.toContain('PASS');
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('violation outranks not-evaluated when both are present → exits 1', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [
      FORBIDDEN_RULE,
      { metric: 'sccCount', op: '<=', value: -1, message: 'Impossible' },
    ]);
    await writeQueryArtifacts(dir, [['src/parser/p.ts.P', 'src/cli/c.ts.C']]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(2);
  });

  // -- directory resolution (analyze writes snapshots to <outputDir>, query to <workDir>) --

  it('reads snapshots from config.outputDir when --output-dir is omitted', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [{ metric: 'sccCount', op: '<=', value: 0, message: 'No cycles' }]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(loadSnapshots).toHaveBeenCalledWith(dir);
  });

  it('--output-dir overrides config.outputDir for snapshot discovery', async () => {
    const dir = await makeTmpDir();
    const override = await makeTmpDir();
    mockConfig(dir, [{ metric: 'sccCount', op: '<=', value: 0, message: 'No cycles' }]);

    const cmd = createCheckCommand();
    await cmd.parseAsync(['--output-dir', override], { from: 'user' });

    expect(loadSnapshots).toHaveBeenCalledWith(override);
  });

  // -- metric rules / command plumbing --

  it('all rules pass → exits with 0 (or no exit call)', async () => {
    await runCheck([
      { metric: 'sccCount', op: '<=', value: 0, message: 'No cyclic dependencies allowed' },
    ]);

    expect(processExitSpy).not.toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(2);
  });

  it('one metric rule fails + failOnViolation=true → exits with code 1', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }]);
    vi.mocked(loadSnapshots).mockResolvedValue([
      makeSnapshot({ metricVector: makeVector({ maxInDegree: 25 }) }),
    ]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('one rule fails + failOnViolation=false → exits with code 0', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }], false);
    vi.mocked(loadSnapshots).mockResolvedValue([
      makeSnapshot({ metricVector: makeVector({ maxInDegree: 25 }) }),
    ]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(processExitSpy).not.toHaveBeenCalledWith(1);
  });

  it('no fitness config in loaded config → prints "No fitness rules configured" and exits 0', async () => {
    const dir = await makeTmpDir();
    mockLoad.mockResolvedValue({ workDir: dir, outputDir: dir });

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    const output = allOutput();
    expect(output).toContain('No fitness rules configured');
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
  });

  it('output includes rule message and actual value for failed rules', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [{ metric: 'maxInDegree', op: '<', value: 20, message: 'No god files' }], false);
    vi.mocked(loadSnapshots).mockResolvedValue([
      makeSnapshot({ metricVector: makeVector({ maxInDegree: 25 }) }),
    ]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    const output = allOutput();
    expect(output).toContain('FAIL');
    expect(output).toContain('No god files');
    expect(output).toContain('25');
  });

  it('no snapshots → asks the user to analyze first, does not exit non-zero', async () => {
    const dir = await makeTmpDir();
    mockConfig(dir, [FORBIDDEN_RULE]);
    vi.mocked(loadSnapshots).mockResolvedValue([]);

    const cmd = createCheckCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(allOutput()).toContain('No snapshots found');
    expect(processExitSpy).not.toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(2);
  });
});

/**
 * Unit tests for the analyze --arch-health flag (TASK-64 Phase D).
 *
 * - --arch-health flag is registered on the analyze command.
 * - Handler: flag absent → runArchHealth (arch-health output) never appears;
 *   flag present → arch-health output appears exactly once.
 * - runArchHealth output includes Mode / d_int / d_int_norm / Trend, and with
 *   no prior history prints 'Previous: none' + STABLE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { Config } from '@/cli/config-loader.js';
import type { ArchJSON } from '@/types/index.js';

// Mock runAnalysis so the handler does not touch the real parser pipeline.
vi.mock('@/cli/analyze/run-analysis.js', () => ({
  runAnalysis: vi.fn(),
}));

import { runAnalysis } from '@/cli/analyze/run-analysis.js';
import {
  createAnalyzeCommand,
  analyzeCommandHandler,
  runArchHealth,
} from '@/cli/commands/analyze.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jl-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['a.ts', 'b.ts', 'c.ts'],
    entities: ['A', 'B', 'C'].map((id) => ({
      id,
      name: id,
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: `${id}.ts`, startLine: 1, endLine: 1 },
    })),
    relations: [
      { id: 'r1', type: 'dependency' as const, source: 'A', target: 'B' },
      { id: 'r2', type: 'dependency' as const, source: 'B', target: 'C' },
    ],
  };
}

function makeConfig(workDir: string): Config {
  return {
    diagrams: [],
    workDir,
    outputDir: workDir,
    format: 'json',
    exclude: [],
    cli: { command: 'claude', args: [], timeout: 60000 },
    cache: { enabled: true, ttl: 86400 },
    concurrency: 1,
    verbose: false,
  } as unknown as Config;
}

function mockRunAnalysis(workDir: string, archJson: ArchJSON | null) {
  vi.mocked(runAnalysis).mockResolvedValue({
    config: makeConfig(workDir),
    diagrams: [{ name: 'overview/package', sources: ['./src'], level: 'package' }],
    results: [],
    queryScopesPersisted: 0,
    persistedScopeKeys: [],
    hasDiagramFailures: false,
    lastArchJson: archJson,
  });
}

describe('analyze --arch-health command flag', () => {
  it('registers the --arch-health option', () => {
    const command = createAnalyzeCommand();
    const option = command.options.find((opt) => opt.long === '--arch-health');
    expect(option).toBeDefined();
    expect(option?.description).toContain('intrinsic dimension');
  });
});

describe('analyzeCommandHandler arch-health wiring', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  it('flag absent → arch-health output is never produced (runArchHealth not called)', async () => {
    const workDir = makeTempDir();
    mockRunAnalysis(workDir, makeArchJson());

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await analyzeCommandHandler({});

    expect(vi.mocked(runAnalysis)).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).not.toContain('Architecture Intrinsic Dimension');
    // No history file written either.
    expect(fs.existsSync(path.join(workDir, 'arch-health-history.json'))).toBe(false);
  });

  it('flag present → arch-health output produced once', async () => {
    const workDir = makeTempDir();
    mockRunAnalysis(workDir, makeArchJson());

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await analyzeCommandHandler({ archHealth: true });

    expect(vi.mocked(runAnalysis)).toHaveBeenCalledTimes(1);
    const output = logs.join('\n');
    expect(output).toContain('Architecture Intrinsic Dimension');
    expect(output.match(/Architecture Intrinsic Dimension/g)).toHaveLength(1);
  });

  it('flag present but no ArchJSON → does not throw', async () => {
    const workDir = makeTempDir();
    mockRunAnalysis(workDir, null);

    await expect(analyzeCommandHandler({ archHealth: true })).resolves.toBeUndefined();
    // No history file is written when there is nothing to analyze.
    expect(fs.existsSync(path.join(workDir, 'arch-health-history.json'))).toBe(false);
  });
});

describe('runArchHealth output', () => {
  it('includes Mode / d_int / d_int_norm / Trend and Previous: none + STABLE on first run', async () => {
    const workDir = makeTempDir();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runArchHealth(makeArchJson(), workDir);

    const output = logs.join('\n');
    expect(output).toContain('Architecture Intrinsic Dimension');
    expect(output).toContain('Mode:');
    expect(output).toMatch(/d_int:\s+\d+ \/ 3 entities/);
    expect(output).toContain('d_int_norm:');
    expect(output).toContain('Previous:   none');
    expect(output).toContain('Trend:      STABLE');

    // A snapshot was persisted.
    const history = await fs.readJson(path.join(workDir, 'arch-health-history.json'));
    expect(history.schemaVersion).toBe(1);
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0].entityCount).toBe(3);
  });

  it('prints RISING trend when d_int_norm increases beyond the threshold', async () => {
    const workDir = makeTempDir();
    // Prior snapshot with dIntNormalized 0.01.
    const prior = {
      timestamp: '2026-01-01T00:00:00Z',
      entityCount: 3,
      mode: 'direct' as const,
      featureVersion: '1.0',
      k: null,
      dInt: 1,
      dIntNormalized: 0.01,
      varianceExplained: [1.0],
      epsilon: null,
    };
    await fs.ensureDir(workDir);
    await fs.writeJson(path.join(workDir, 'arch-health-history.json'), {
      schemaVersion: 1,
      language: 'typescript',
      snapshots: [prior],
    });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runArchHealth(makeArchJson(), workDir);

    const output = logs.join('\n');
    expect(output).toContain('Trend:      RISING');
  });
});

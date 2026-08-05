/**
 * CLI user-entry contract E2E tests (TASK-73).
 *
 * A 类（用户可见契约 → 端到端）: the analyze / init / cache command family is
 * the user-facing entry of the CLI. This file stabilizes the E2E contract —
 * exit codes, output existence, and key output content — for all three
 * commands.
 *
 * It complements the unit-level registration/parsing tests in
 * tests/unit/cli/command.test.ts by driving the real command handlers through
 * createCLI().parseAsync() against throwaway fixture directories. This is the
 * same in-process E2E pattern used by tests/integration/cli-mcp/analyze-equivalence.test.ts
 * (no dist build required, deterministic, fast).
 *
 * Contract basis (from src/cli/commands/*.ts, read-only audit):
 *  - analyze: analyzeCommandHandler ends with process.exit(hasDiagramFailures ? 1 : 0);
 *             displayResults() prints "Analysis complete!" and "Output directory";
 *             runAnalysis writes <workDir>/output/<name>.json (ArchJSON) + index.md.
 *  - init:    loader.init() writes archguard.config.{json,js}; success prints
 *             "Created archguard.config.json"; an existing file is a ValidationError
 *             path that deliberately exits 0 (per the handler, not a hard failure).
 *  - cache:   stats prints "Cache Statistics:" with Directory/Hits/Misses/Hit Rate/
 *             Total Size; clear removes the cache dir and prints "Cache cleared
 *             successfully"; both handlers exit 0 on success.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { createCLI } from '@/cli/index';
import { ConfigLoader } from '@/cli/config-loader.js';

interface CliRun {
  stdout: string;
  stderr: string;
  exitCodes: Array<number | string>;
}

/** Minimal ArchJSON shape asserted by the analyze contract. */
interface ContractArchJson {
  version?: string;
  language?: string;
  entities?: Array<{ name?: string }>;
  relations?: unknown[];
}

/**
 * Simulates a real `process.exit()` — which terminates the process immediately —
 * by throwing. This is what makes the in-process harness faithful: a handler
 * that calls `process.exit(0)` then keeps executing (a fallthrough that could
 * reach `process.exit(1)`) is a behavior that only exists because the mock made
 * exit a no-op. Throwing models the real "the process stops right here" contract.
 */
class CliExitSignal extends Error {
  constructor(public readonly code: number | string) {
    super(`CLI exited with code ${code}`);
    this.name = 'CliExitSignal';
  }
}

/**
 * Effective exit code of a real process: the first (and, with throw-based
 * simulation, only) explicit `process.exit()` payload, or 0 when the process
 * runs to completion without one.
 */
function effectiveExitCode(exitCodes: Array<number | string>): number {
  return typeof exitCodes[0] === 'number' ? exitCodes[0] : 0;
}

/**
 * Run the real CLI program in-process against `cwd` and capture everything a
 * user would see: the process.exit payloads, stdout, and stderr.
 */
async function runCli(args: string[], cwd: string): Promise<CliRun> {
  const previousCwd = process.cwd();
  const exitCodes: Array<number | string> = [];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string) => {
    exitCodes.push(code ?? 0);
    throw new CliExitSignal(code ?? 0);
  }) as never);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    process.chdir(cwd);
    const program = createCLI();
    try {
      await program.parseAsync(['node', 'archguard', ...args]);
    } catch (error) {
      if (!(error instanceof CliExitSignal)) throw error;
      // The CLI explicitly exited — treat that as normal termination.
    }
    return {
      stdout: logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n'),
      stderr: errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n'),
      exitCodes,
    };
  } finally {
    process.chdir(previousCwd);
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

/** Strip chalk ANSI color sequences so output assertions are color-agnostic. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Collect every ArchJSON artifact under <workDir>/output (skip snapshots). */
async function collectJsonOutput(workDir: string): Promise<string[]> {
  const outputRoot = path.join(workDir, 'output');
  if (!(await fs.pathExists(outputRoot))) return [];
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'snapshots') continue;
        await walk(full);
      } else if (entry.name.endsWith('.json')) {
        files.push(full);
      }
    }
  }
  await walk(outputRoot);
  return files;
}

/** Create a minimal TypeScript fixture project (auto-detectable by analyze). */
async function writeTsFixture(root: string): Promise<void> {
  await fs.writeJson(path.join(root, 'package.json'), {
    name: 'cli-contract-fixture',
    private: true,
    type: 'module',
  });
  await fs.ensureDir(path.join(root, 'src'));
  await fs.writeFile(
    path.join(root, 'src', 'index.ts'),
    [
      'export class App {',
      "  run(): string { return 'ok'; }",
      '}',
      '',
      'export interface Helper {',
      '  assist(): void;',
      '}',
      '',
    ].join('\n')
  );
}

/** Seed a cache entry under <root>/.archguard/cache so stats/clear see data. */
async function seedCacheEntry(root: string): Promise<void> {
  const cacheFile = path.join(root, '.archguard', 'cache', 'ab', 'abcdef.json');
  await fs.ensureDir(path.dirname(cacheFile));
  await fs.writeJson(cacheFile, { data: {}, timestamp: 1, ttl: 86400 });
}

describe('CLI user-entry contract (analyze / init / cache)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await fs.remove(dir).catch(() => {});
    }
    tempDirs.length = 0;
  });

  async function fixtureDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-contract-'));
    tempDirs.push(dir);
    return dir;
  }

  describe('analyze', () => {
    it('analyze -f json: exit 0, writes ArchJSON artifacts, prints summary', async () => {
      const root = await fixtureDir();
      await writeTsFixture(root);

      const { stdout, exitCodes } = await runCli(['analyze', '-f', 'json', '--no-cache'], root);

      // Contract: success → exit 0.
      expect(effectiveExitCode(exitCodes)).toBe(0);

      // Contract: key summary output from displayResults().
      const text = stripAnsi(stdout);
      expect(text).toContain('Analysis complete!');
      expect(text).toContain('Output directory');

      // Contract: work dir + index + ArchJSON artifacts exist on disk.
      const workDir = path.join(root, '.archguard');
      expect(await fs.pathExists(workDir)).toBe(true);
      expect(await fs.pathExists(path.join(workDir, 'output', 'index.md'))).toBe(true);

      const jsonFiles = await collectJsonOutput(workDir);
      expect(jsonFiles.length).toBeGreaterThan(0);

      // Contract: ArchJSON schema fields (version, language, entities, relations).
      const archJson = (await fs.readJson(jsonFiles[0])) as ContractArchJson;
      expect(archJson.version).toBe('1.1');
      expect(archJson.language).toBe('typescript');
      expect(Array.isArray(archJson.entities)).toBe(true);
      expect(archJson.entities?.length).toBeGreaterThan(0);
      expect(Array.isArray(archJson.relations)).toBe(true);

      // Contract: fixture source entities actually surface in the output.
      const names = archJson.entities?.map((e) => e.name) ?? [];
      expect(names).toContain('App');
      expect(names).toContain('Helper');
    });
  });

  describe('init', () => {
    it('init creates archguard.config.json with documented defaults', async () => {
      const root = await fixtureDir();

      const { stdout, exitCodes } = await runCli(['init'], root);

      // Contract: success → exit 0, key confirmation output.
      expect(effectiveExitCode(exitCodes)).toBe(0);
      expect(stripAnsi(stdout)).toContain('Created archguard.config.json');

      // Contract: the generated config file exists and round-trips through ConfigLoader.
      const configPath = path.join(root, 'archguard.config.json');
      expect(await fs.pathExists(configPath)).toBe(true);
      const loaded = await new ConfigLoader(root).load({}, configPath);
      expect(loaded.format).toBe('mermaid');
      expect(loaded.workDir).toBe('./.archguard');
      expect(loaded.diagrams).toEqual([]);
    });

    it('init -f js creates a JS module config file', async () => {
      const root = await fixtureDir();

      const { stdout, exitCodes } = await runCli(['init', '-f', 'js'], root);

      expect(effectiveExitCode(exitCodes)).toBe(0);
      expect(stripAnsi(stdout)).toContain('Created archguard.config.js');
      expect(await fs.pathExists(path.join(root, 'archguard.config.js'))).toBe(true);
      const jsContent = await fs.readFile(path.join(root, 'archguard.config.js'), 'utf-8');
      expect(jsContent).toContain('export default');
    });

    it('init on an existing config reports "already exists" and exits 0', async () => {
      const root = await fixtureDir();
      await fs.writeJson(path.join(root, 'archguard.config.json'), { format: 'mermaid' });

      const { stderr, exitCodes } = await runCli(['init'], root);

      // Contract: an existing file is a ValidationError path that deliberately
      // exits 0 (createInitCommand), so a user re-run is not a hard failure.
      expect(effectiveExitCode(exitCodes)).toBe(0);
      expect(stripAnsi(stderr)).toContain('Configuration file already exists');
    });
  });

  describe('cache', () => {
    it('cache stats on an empty cache prints zeroed statistics', async () => {
      const root = await fixtureDir();

      const { stdout, exitCodes } = await runCli(['cache', 'stats'], root);

      expect(effectiveExitCode(exitCodes)).toBe(0);
      const text = stripAnsi(stdout);
      expect(text).toContain('Cache Statistics:');
      expect(text).toContain('Directory:');
      expect(text).toContain('Hits: 0');
      expect(text).toContain('Misses: 0');
      expect(text).toContain('Hit Rate: 0.00%');
      expect(text).toContain('Total Size: 0 Bytes');
    });

    it('cache stats reports non-zero size when cache entries exist', async () => {
      const root = await fixtureDir();
      await seedCacheEntry(root);

      const { stdout, exitCodes } = await runCli(['cache', 'stats'], root);

      expect(effectiveExitCode(exitCodes)).toBe(0);
      const text = stripAnsi(stdout);
      expect(text).toContain('Total Size:');
      expect(text).not.toContain('Total Size: 0 Bytes');
      expect(text).toMatch(/Total Size: [1-9]\d*\.\d{2} Bytes/);
    });

    it('cache clear removes the cache directory and confirms', async () => {
      const root = await fixtureDir();
      await seedCacheEntry(root);
      expect(await fs.pathExists(path.join(root, '.archguard', 'cache'))).toBe(true);

      const { stdout, exitCodes } = await runCli(['cache', 'clear'], root);

      expect(effectiveExitCode(exitCodes)).toBe(0);
      expect(stripAnsi(stdout)).toContain('Cache cleared successfully');
      expect(await fs.pathExists(path.join(root, '.archguard', 'cache'))).toBe(false);
    });
  });
});

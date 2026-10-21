/**
 * End-to-end PlantUML emission contract (task DoD).
 *
 * Drives the real CLI in-process (`analyze -s <fixture> -f plantuml`) and
 * asserts the produced `.puml`:
 *  (a) is byte-identical to `tests/fixtures/plantuml/golden-cli.puml`, and
 *  (b) passes `PlantUmlStructuralValidator` with zero undefined endpoints and
 *      zero illegal generic declarations.
 *
 * The fixture project deliberately contains a generic base class
 * (`BaseEntity<T>`), a `Map<string, string>` field, and a class name with a
 * special character (`Money$`) so the golden exercises sanitization and alias
 * quoting — the three things a deterministic emitter must normalize.
 *
 * No dist build is required: this uses the same in-process `createCLI()`
 * pattern as tests/integration/cli/user-entry-contract.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createCLI } from '@/cli/index';
import { PlantUmlStructuralValidator } from '@/plantuml/validator-structural.js';

const FIXTURE_SRC = path.resolve('tests/fixtures/plantuml/src');
const GOLDEN_PATH = path.resolve('tests/fixtures/plantuml/golden-cli.puml');

class CliExitSignal extends Error {
  constructor(public readonly code: number | string) {
    super(`CLI exited with code ${code}`);
    this.name = 'CliExitSignal';
  }
}

interface CliRun {
  stdout: string;
  stderr: string;
  exitCodes: Array<number | string>;
}

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
    try {
      await createCLI().parseAsync(['node', 'archguard', ...args]);
    } catch (error) {
      if (!(error instanceof CliExitSignal)) throw error;
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

describe('PlantUML CLI emission (analyze -f plantuml)', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-puml-cli-'));
  });

  afterAll(async () => {
    if (workDir) await fs.remove(workDir);
  });

  it('emits a .puml byte-identical to the golden file and structurally valid', async () => {
    const outputDir = path.join(workDir, 'out');
    const run = await runCli(
      ['analyze', '-s', FIXTURE_SRC, '-f', 'plantuml', '--output-dir', outputDir],
      workDir
    );

    // A successful process terminates on its first explicit exit; later calls
    // only exist because the mock turns exit into a throw (see the harness above).
    expect(run.exitCodes[0] ?? 0, `stderr:\n${run.stderr}\nstdout:\n${run.stdout}`).toBe(0);

    const producedPath = path.join(outputDir, 'architecture.puml');
    expect(await fs.pathExists(producedPath)).toBe(true);

    const produced = await fs.readFile(producedPath, 'utf-8');
    const golden = await fs.readFile(GOLDEN_PATH, 'utf-8');
    expect(produced).toBe(golden);

    // The first run populated `.archguard/cache/archjson` with a canonicalized
    // ArchJSON; a second run takes the warm-cache path. Emission must not
    // depend on which ordering the pipeline happened to hand the generator.
    const warmOutputDir = path.join(workDir, 'out-warm');
    const warmRun = await runCli(
      ['analyze', '-s', FIXTURE_SRC, '-f', 'plantuml', '--output-dir', warmOutputDir],
      workDir
    );
    expect(warmRun.exitCodes[0] ?? 0).toBe(0);
    const warmProduced = await fs.readFile(path.join(warmOutputDir, 'architecture.puml'), 'utf-8');
    expect(warmProduced).toBe(produced);

    const result = new PlantUmlStructuralValidator().validate(produced);
    expect(result.issues).toEqual([]);
    expect(result.undefinedEndpoints).toEqual([]);
    expect(result.invalidGenericDeclarations).toEqual([]);
    expect(result.valid).toBe(true);

    // Generic sanitization: no `Map<K, V>` or `BaseEntity<T>` syntax survives.
    expect(produced).not.toMatch(/Map\s*</);
    expect(produced).not.toMatch(/(class|interface|enum)\s+"?[\w ]+</);
    // Special-character class name is quoted and aliased.
    expect(produced).toContain('class "Money$" as Money_');
  });
});

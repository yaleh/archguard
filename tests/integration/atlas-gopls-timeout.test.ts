/**
 * TASK-44 — optional integration test for the Atlas gopls timeout budget
 * against a REAL gopls binary.
 *
 * The gopls-dependent test is skipped gracefully when gopls is not installed
 * (the suite must stay green on machines without gopls). It forces a tiny
 * budget so the real binary trips the bound quickly, then asserts:
 *   - analysis completes (bounded, no hang)
 *   - the output is marked degraded
 *   - tree-sitter results are still produced
 *
 * A non-skipped sanity block verifies the timeout-budget configuration surface
 * so the file always exercises *something* regardless of the environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

let goplsAvailable = false;
try {
  execSync('which gopls', { stdio: 'ignore' });
  goplsAvailable = true;
} catch {
  goplsAvailable = false;
}

import {
  resolveGoplsTimeoutMs,
  DEFAULT_GOPLS_TIMEOUT_MS,
  GOPLS_TIMEOUT_ENV,
  resetGoplsPoison,
} from '../../src/plugins/golang/gopls-client.js';

describe('atlas-gopls-timeout configuration surface (always runs)', () => {
  it('exposes a 120s default budget and env override', () => {
    expect(DEFAULT_GOPLS_TIMEOUT_MS).toBe(120_000);
    expect(GOPLS_TIMEOUT_ENV).toBe('ARCHGUARD_GOPLS_TIMEOUT_MS');
    expect(resolveGoplsTimeoutMs({})).toBe(120_000);
    expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '250' })).toBe(250);
  });
});

describe.skipIf(!goplsAvailable)('atlas-gopls-timeout with real gopls', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    resetGoplsPoison();
    savedEnv = process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    tmpDir = await mkdtemp(path.join(tmpdir(), 'atlas-gopls-real-'));
    await writeFile(path.join(tmpDir, 'go.mod'), 'module github.com/example/timeout\n\ngo 1.21\n');
    await writeFile(
      path.join(tmpDir, 'main.go'),
      [
        'package main',
        '',
        'type Runner interface { Start() }',
        '',
        'type Service struct{}',
        '',
        'func (s *Service) Start() {}',
        '',
        'func main() { (&Service{}).Start() }',
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    } else {
      process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = savedEnv;
    }
    resetGoplsPoison();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('bounds a real gopls startup and completes degraded (no hang, no orphan)', async () => {
    const { GoPlugin } = await import('../../src/plugins/golang/index.js');
    const { nativeParserBackend } =
      await import('../../src/plugins/shared/native-parser-backend.js');

    // A 1ms budget guarantees the real binary trips the bound immediately.
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '1';

    const plugin = new GoPlugin(nativeParserBackend);
    const start = Date.now();
    await plugin.initialize({ workspaceRoot: tmpDir });
    const result = await plugin.parseProject(tmpDir, {
      workspaceRoot: tmpDir,
      excludePatterns: [],
    });
    const elapsed = Date.now() - start;

    // Bounded completion — never approaches a CLI-scale timeout.
    expect(elapsed).toBeLessThan(20000);

    // Degraded marking present; tree-sitter results survive.
    expect(result.metadata?.goGoplsDegraded).toBe(true);
    expect(result.entities.map((e) => e.name)).toContain('Service');

    await plugin.dispose();
  }, 30000);
});

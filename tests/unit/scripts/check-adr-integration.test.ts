/**
 * Integration tests for scripts/check-adr.ts
 *
 * These tests exercise the checker against fixture directories to verify
 * end-to-end behavior: violations detected, suppressions honoured, clean exit.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-adr-integ-'));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

/**
 * Run check-adr.ts against a fixture directory.
 * Returns { exitCode, stdout, stderr }.
 *
 * We invoke the script programmatically using the exported functions
 * to avoid spawning a subprocess (which would be slow and require a build).
 */
async function runChecker(
  mcpDir: string,
  queryFile: string
): Promise<{ violations: import('../../../scripts/check-adr.js').Violation[] }> {
  const { checkAdr006, checkAdr007, filterViolations } = await import('../../../scripts/check-adr.js');
  const raw006 = checkAdr006(mcpDir);
  const raw007 = checkAdr007(mcpDir, queryFile);
  const violations = filterViolations([...raw006, ...raw007]);
  return { violations };
}

// We need a minimal query.ts fixture with at least some flags for ADR-007 checks.
const MINIMAL_QUERY_TS = `
new Command('query')
  .option('--entity <name>', 'Find entity')
  .option('--summary', 'Show summary')
`;

describe('check-adr integration tests', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fixture with description: "Get something" → detects violation (exit 1 equivalent)', async () => {
    writeFile(
      tmpDir,
      'mcp/tools/bad-tool.ts',
      `
server.tool(
  'archguard_get_something',
  'Get something from somewhere.',
  {},
  async () => {}
);
`
    );
    const queryFile = writeFile(tmpDir, 'query.ts', MINIMAL_QUERY_TS);
    const { violations } = await runChecker(path.join(tmpDir, 'mcp'), queryFile);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.adr === 'ADR-006')).toBe(true);
  });

  it('fixture with valid suppression → no violations (exit 0 equivalent)', async () => {
    writeFile(
      tmpDir,
      'mcp/tools/suppressed-tool.ts',
      `
server.tool(
  'archguard_get_something',
  // adr-ok: ADR-006 — legacy description, low priority fix
  'Get something from somewhere.',
  {},
  async () => {}
);
`
    );
    const queryFile = writeFile(tmpDir, 'query.ts', MINIMAL_QUERY_TS);
    const { violations } = await runChecker(path.join(tmpDir, 'mcp'), queryFile);
    // ADR-007 may still flag archguard_get_something if no CLI flag matches,
    // but ADR-006 violation should be suppressed
    const adr006Violations = violations.filter((v) => v.adr === 'ADR-006');
    expect(adr006Violations).toHaveLength(0);
  });

  it('clean fixture (compliant tool + matching flag) → "all checks passed" (exit 0 equivalent)', async () => {
    writeFile(
      tmpDir,
      'mcp/tools/clean-tool.ts',
      `
server.tool(
  'archguard_find_entity',
  'Find entities by name or type.',
  {},
  async () => {}
);
`
    );
    const queryFile = writeFile(
      tmpDir,
      'query.ts',
      `
new Command('query')
  .option('--entity <name>', 'Find entity')
`
    );
    const { violations } = await runChecker(path.join(tmpDir, 'mcp'), queryFile);
    expect(violations).toHaveLength(0);
  });
});

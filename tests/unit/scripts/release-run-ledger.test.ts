/**
 * Unit tests for the release-run ledger tooling (GOAL-001 / AC-005).
 *
 * The AC is a claim about three mechanisms, so the tests are about behaviour on disk, not about the
 * existence of files:
 *   - scripts/record-release-run.mjs   — the writer (append-only, fail-closed on bad args)
 *   - scripts/check-release-ledger.sh  — the reader/verdict (`carrier-absent` / `carrier-empty` /
 *                                        `release-run-incomplete` / ok)
 *   - scripts/verify-release-install.sh — the real-install verifier (`--dry-run` branch here; the
 *                                        networked branch is exercised by the DoD by hand)
 * Every test runs the scripts as a subprocess against a temp directory, so nothing here touches the
 * repo's real `.quay/release-runs.jsonl` (which is gitignored and local by design).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RECORD = path.join(REPO_ROOT, 'scripts/record-release-run.mjs');
const CHECK = path.join(REPO_ROOT, 'scripts/check-release-ledger.sh');
const VERIFY = path.join(REPO_ROOT, 'scripts/verify-release-install.sh');

const VALID_STATUS = 'success';

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(argv: string[]): RunResult {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function record(args: string[], ledger: string): RunResult {
  return run([process.execPath, RECORD, '--ledger', ledger, ...args]);
}

function completeArgs(overrides: Partial<Record<string, string>> = {}): string[] {
  const args: Record<string, string> = {
    '--tag': 'v1.2.3',
    '--cli-publish': VALID_STATUS,
    '--plugin-publish': VALID_STATUS,
    '--install-verify': VALID_STATUS,
    ...overrides,
  };
  return Object.entries(args).flatMap(([flag, value]) => (value === '' ? [flag] : [flag, value]));
}

function rows(ledger: string): string[] {
  return fs
    .readFileSync(ledger, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

describe('scripts/record-release-run.mjs', () => {
  let dir: string;
  let ledger: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-run-ledger-'));
    ledger = path.join(dir, 'nested', 'release-runs.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends exactly one row carrying all five fields', () => {
    const r = record(completeArgs(), ledger);

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(rows(ledger)).toHaveLength(1);

    const row = JSON.parse(rows(ledger)[0]) as Record<string, string>;
    expect(Object.keys(row).sort()).toEqual(
      ['cli-publish', 'install-verify', 'plugin-publish', 'tag', 'ts'].sort()
    );
    expect(row.tag).toBe('v1.2.3');
    expect(row['cli-publish']).toBe('success');
    expect(row['plugin-publish']).toBe('success');
    expect(row['install-verify']).toBe('success');
    // `ts` is a real ISO-8601 instant, not a placeholder.
    expect(Number.isNaN(Date.parse(row.ts))).toBe(false);
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates the ledger parent directory on demand', () => {
    expect(fs.existsSync(path.dirname(ledger))).toBe(false);
    expect(record(completeArgs(), ledger).status).toBe(0);
    expect(fs.existsSync(ledger)).toBe(true);
  });

  it('appends a second row and leaves the first byte-identical (append-only)', () => {
    expect(record(completeArgs(), ledger).status).toBe(0);
    const firstRowBytes = rows(ledger)[0];

    const r = record(completeArgs({ '--tag': 'v1.2.4', '--install-verify': 'failure' }), ledger);
    expect(r.status).toBe(0);

    const all = rows(ledger);
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(firstRowBytes);

    const second = JSON.parse(all[1]) as Record<string, string>;
    expect(second.tag).toBe('v1.2.4');
    expect(second['install-verify']).toBe('failure');
  });

  it('accepts every status in the closed set', () => {
    for (const status of ['success', 'failure', 'skipped']) {
      expect(record(completeArgs({ '--cli-publish': status }), ledger).status).toBe(0);
    }
    expect(rows(ledger)).toHaveLength(3);
  });

  const rejected: Array<[string, string[]]> = [
    ['an unknown status', completeArgs({ '--cli-publish': 'maybe' })],
    ['a status outside the closed set', completeArgs({ '--install-verify': 'OK' })],
    ['a tag without the v prefix', completeArgs({ '--tag': '1.2.3' })],
    ['a tag that is not semver', completeArgs({ '--tag': 'v1.2' })],
    ['a missing status flag', completeArgs({ '--install-verify': '' })],
    ['a missing tag', completeArgs({ '--tag': '' })],
    ['an unknown flag', completeArgs({ '--cli-publish': 'success' }).concat(['--nope', 'x'])],
  ];

  it.each(rejected)(
    'rejects %s with CAUSE=invalid-release-run-args and writes nothing',
    (_name, args) => {
      const r = record(args, ledger);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('CAUSE=invalid-release-run-args');
      // The rejection must not leave a carrier behind: an empty ledger would later read as
      // `carrier-empty` instead of `carrier-absent`, hiding "no release ever recorded".
      expect(fs.existsSync(ledger)).toBe(false);
      expect(fs.existsSync(path.dirname(ledger))).toBe(false);
    }
  );
});

describe('scripts/check-release-ledger.sh', () => {
  let dir: string;
  let ledger: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-ledger-'));
    ledger = path.join(dir, 'release-runs.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 with CAUSE=carrier-absent when the ledger does not exist', () => {
    const r = run(['bash', CHECK, ledger]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=carrier-absent');
  });

  it('exits 1 with CAUSE=carrier-empty when the ledger holds no records', () => {
    fs.writeFileSync(ledger, '', 'utf-8');

    const r = run(['bash', CHECK, ledger]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=carrier-empty');
  });

  it('exits 1 with CAUSE=release-run-incomplete when the last row has a failure', () => {
    expect(record(completeArgs(), ledger).status).toBe(0);
    expect(record(completeArgs({ '--install-verify': 'failure' }), ledger).status).toBe(0);

    const r = run(['bash', CHECK, ledger]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=release-run-incomplete');
    expect(r.stderr).toContain('install-verify=failure');
  });

  it('exits 1 with CAUSE=release-run-incomplete when the last row is a skipped publish', () => {
    expect(record(completeArgs({ '--plugin-publish': 'skipped' }), ledger).status).toBe(0);

    const r = run(['bash', CHECK, ledger]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=release-run-incomplete');
  });

  it('exits 0 when the last row is all-success even though the previous row is a failure', () => {
    expect(
      record(completeArgs({ '--tag': 'v1.2.3', '--cli-publish': 'failure' }), ledger).status
    ).toBe(0);
    expect(record(completeArgs({ '--tag': 'v1.2.4' }), ledger).status).toBe(0);

    const r = run(['bash', CHECK, ledger]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('reads the writer’s own output back (record → check round-trip)', () => {
    expect(record(completeArgs(), ledger).status).toBe(0);

    expect(run(['bash', CHECK, ledger]).status).toBe(0);
  });
});

describe('scripts/verify-release-install.sh --dry-run', () => {
  it('exits 0 for a well-formed version and reports install-verify=success', () => {
    const r = run(['bash', VERIFY, '1.2.3', '--dry-run']);

    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n').pop()).toBe('install-verify=success');
  });

  it('exits 1 for a malformed version and reports install-verify=failure', () => {
    const r = run(['bash', VERIFY, 'not-a-version', '--dry-run']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=install-verify-failed');
    expect(r.stdout.trim().split('\n').pop()).toBe('install-verify=failure');
  });

  it('exits 1 when the version is missing', () => {
    const r = run(['bash', VERIFY, '--dry-run']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=install-verify-failed');
  });

  it('exits 1 when the version carries a v prefix (the ledger tag form is not a version)', () => {
    const r = run(['bash', VERIFY, 'v1.2.3', '--dry-run']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=install-verify-failed');
  });
});

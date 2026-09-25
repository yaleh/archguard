/**
 * Unit tests for scripts/check-version-has-tag.sh (GOAL-001 / AC-002).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-version-has-tag.sh');

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function runCheck(root: string) {
  return spawnSync('bash', [SCRIPT, root], { encoding: 'utf-8' });
}

describe('check-version-has-tag.sh', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-tag-check-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'tag.gpgsign', 'false');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function commitPackageJson(content: string): void {
    fs.writeFileSync(path.join(dir, 'package.json'), content, 'utf-8');
    git(dir, 'add', 'package.json');
    git(dir, 'commit', '-q', '-m', 'init');
  }

  it('exits 0 when the version has a same-named v* tag', () => {
    commitPackageJson(JSON.stringify({ name: 'x', version: '1.2.3' }));
    git(dir, 'tag', 'v1.2.3');
    const r = runCheck(dir);
    expect(r.status).toBe(0);
  });

  it('exits 1 with CAUSE=published-version-without-a-tag when the tag is missing', () => {
    commitPackageJson(JSON.stringify({ name: 'x', version: '1.2.3' }));
    git(dir, 'tag', 'v1.2.2');
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=published-version-without-a-tag');
  });

  it('exits 1 with CAUSE=package-version-unreadable when package.json is missing', () => {
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=package-version-unreadable');
  });

  it('exits 1 with CAUSE=package-version-unreadable when package.json has no version', () => {
    commitPackageJson(JSON.stringify({ name: 'x' }));
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=package-version-unreadable');
  });

  it('is wired into the repo prepublishOnly script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.prepublishOnly).toContain('scripts/check-version-has-tag.sh');
  });
});

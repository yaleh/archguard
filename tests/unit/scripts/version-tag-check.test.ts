/**
 * Unit tests for scripts/check-version-has-tag.sh (GOAL-001 / AC-002), plus the release-window
 * guard added by gap-ac002-release-window-untagged-bump.
 *
 * AC-002 reads the MAIN checkout's working tree. A release that bumps package.json there and
 * tags it only afterwards opens a window in which the tree shows a version whose tag does not
 * exist — the goal driver samples every ~40s and went red in the 0.1.38 and 0.1.39 releases.
 * The fix is two mechanisms, both pinned here:
 *   - scripts/release.sh refuses to run in the main worktree and, in a linked worktree, makes
 *     bump + commit + tag atomic in the tree (the working tree never shows an untagged version);
 *   - .githooks/pre-commit refuses a MAIN-worktree commit that bumps package.json to a version
 *     with no tag (linked worktree, an existing tag, and ordinary commits all pass).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-version-has-tag.sh');
const RELEASE = path.join(REPO_ROOT, 'scripts/release.sh');
const HOOK = path.join(REPO_ROOT, '.githooks/pre-commit');

/** The scripts scripts/release.sh shells out to, copied into a fixture so it self-locates. */
const RELEASE_SCRIPTS = [
  'release.sh',
  'check-version-carriers.sh',
  'sync-version-carriers.mjs',
  'sync-plugin-core-pin.mjs',
];

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r;
}

function gitMaybe(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' });
}

function runCheck(root: string) {
  return spawnSync('bash', [SCRIPT, root], { encoding: 'utf-8' });
}

function runRelease(cwd: string, ...args: string[]) {
  return spawnSync('bash', ['scripts/release.sh', ...args], { cwd, encoding: 'utf-8' });
}

function readVersion(dir: string, rel = 'package.json'): string | undefined {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'));
    return typeof doc.version === 'string' ? doc.version : undefined;
  } catch {
    return undefined;
  }
}

function bumpVersion(dir: string, rel: string, version: string): void {
  const file = path.join(dir, rel);
  const doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
  doc.version = version;
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
}

function hasTag(dir: string, version: string): boolean {
  return gitMaybe(dir, 'rev-parse', '-q', '--verify', `refs/tags/v${version}`).status === 0;
}

function writeJson(dir: string, rel: string, doc: unknown, indent = '  '): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(doc, null, indent)}\n`, 'utf-8');
}

/** A fixture whose six carriers AND VERSION all equal `version` (the healthy tree). */
function writeCarriers(dir: string, version: string): void {
  writeJson(dir, 'package.json', { name: 'fixture', version });
  writeJson(dir, 'package-lock.json', {
    name: 'fixture',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'fixture', version } },
  });
  writeJson(dir, '.claude-plugin/marketplace.json', {
    name: 'fixture',
    plugins: [{ name: 'fixture', source: { source: 'npm', package: 'fixture', version } }],
  });
  writeJson(dir, 'plugin/package.json', { name: 'fixture-plugin', version });
  writeJson(dir, 'plugin/.claude-plugin/plugin.json', { name: 'fixture-plugin', version }, '\t');
  fs.writeFileSync(path.join(dir, 'VERSION'), `${version}\n`, 'utf-8');
}

/**
 * Build a MAIN worktree git repo holding the release scripts + carrier fixture, committed once
 * and tagged `v<version>` (so the initial tree is already AC-002-healthy).
 */
function buildBaseRepo(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  writeCarriers(dir, version);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const name of RELEASE_SCRIPTS) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', name), path.join(dir, 'scripts', name));
  }
  fs.chmodSync(path.join(dir, 'scripts/release.sh'), 0o755);
  fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, '.githooks/pre-commit'));
  fs.chmodSync(path.join(dir, '.githooks/pre-commit'), 0o755);

  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', `v${version}`);
}

function addLinkedWorktree(main: string, wt: string, branch: string): void {
  git(main, 'worktree', 'add', '-q', '-b', branch, wt);
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

  it('passes on the real repository — the version-tag invariant is STANDING, not only at the publish boundary', () => {
    // GOAL-001 / AC-002: this guard used to run only at the publish boundary
    // (`prepublishOnly`), so a version bumped past its tag could sit in the tree
    // indefinitely — `npm test` stayed green because no test ran the guard on the
    // real repository. Running it here makes `npm test` (and therefore CI) the gate:
    // if package.json's version has no same-named `v*` tag, this test goes red.
    const r = runCheck(REPO_ROOT);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('is wired into the repo prepublishOnly script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.prepublishOnly).toContain('scripts/check-version-has-tag.sh');
  });
});

describe('scripts/release.sh — atomic bump+commit+tag', () => {
  let tmp: string;
  let main: string;
  let wt: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-window-'));
    main = path.join(tmp, 'main');
    wt = path.join(tmp, 'wt');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('--help exits 0 without touching a repository', () => {
    const r = spawnSync('bash', [RELEASE, '--help'], { encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('scripts/release.sh');
  });

  it('cuts the release: tag vX.Y.Z exists and the last commit is `release: X.Y.Z`', () => {
    buildBaseRepo(main, '1.2.3');
    addLinkedWorktree(main, wt, 'rel');

    const r = runRelease(wt, '9.9.9');

    expect(r.status, r.stderr).toBe(0);
    expect(hasTag(wt, '9.9.9')).toBe(true);
    expect(git(wt, 'log', '--format=%s', '-1').stdout.trim()).toBe('release: 9.9.9');
    // The seven carriers all moved to the released version.
    expect(readVersion(wt)).toBe('9.9.9');
    expect(fs.readFileSync(path.join(wt, 'VERSION'), 'utf-8').trim()).toBe('9.9.9');
  });

  it('never exposes a version whose tag is missing — a sampler polling package.json + tags sees no untagged window', async () => {
    buildBaseRepo(main, '1.2.3');
    addLinkedWorktree(main, wt, 'rel');

    const child = spawn('bash', ['scripts/release.sh', '9.9.9'], { cwd: wt });
    let stderr = '';
    let code: number | null = null;
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    let done = false;
    child.on('exit', (c) => {
      done = true;
      code = c;
    });

    const violations: string[] = [];
    const sample = (): void => {
      // An unparseable read is a mid-write sample of a file that is never the version
      // carrier's committed state; it is not a "version present without a tag" reading.
      const v = readVersion(wt);
      if (!v) return;
      if (!hasTag(wt, v)) violations.push(v);
    };

    while (!done) {
      sample();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    sample();

    expect(code, stderr).toBe(0);
    expect(violations).toEqual([]);
    expect(hasTag(wt, '9.9.9')).toBe(true);
  });

  it('refuses to run in the MAIN worktree with CAUSE=release-must-run-in-a-linked-worktree', () => {
    buildBaseRepo(main, '1.2.3');

    const before = git(main, 'log', '--format=%s', '-1').stdout.trim();
    const r = runRelease(main, '9.9.9');

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('CAUSE=release-must-run-in-a-linked-worktree');
    // Nothing happened: no tag, no commit.
    expect(hasTag(main, '9.9.9')).toBe(false);
    expect(git(main, 'log', '--format=%s', '-1').stdout.trim()).toBe(before);
  });

  it('refuses a version that already has a tag', () => {
    buildBaseRepo(main, '1.2.3');
    addLinkedWorktree(main, wt, 'rel');

    const r = runRelease(wt, '1.2.3');

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('CAUSE=release-tag-already-exists');
  });

  it('is wired as an npm script alias', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.release).toContain('scripts/release.sh');
  });

  it('ships an executable .githooks/pre-commit', () => {
    const st = fs.statSync(HOOK);
    expect(st.mode & 0o111).not.toBe(0);
  });
});

describe('.githooks/pre-commit — release-window guard', () => {
  let tmp: string;
  let main: string;
  let wt: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-hook-'));
    main = path.join(tmp, 'main');
    wt = path.join(tmp, 'wt');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function installHook(dir: string): void {
    git(dir, 'config', 'core.hooksPath', '.githooks');
  }

  function headSubject(dir: string): string {
    return git(dir, 'log', '--format=%s', '-1').stdout.trim();
  }

  it('refuses a MAIN-worktree commit that bumps package.json to an untagged version', () => {
    buildBaseRepo(main, '1.2.3');
    installHook(main);

    bumpVersion(main, 'package.json', '1.2.4');
    git(main, 'add', 'package.json');
    const r = gitMaybe(main, 'commit', '-m', 'bump');

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('CAUSE=untagged-version-bump-in-main-worktree');
    // The commit did not land.
    expect(headSubject(main)).toBe('base');
  });

  it('allows the same bump once the tag exists', () => {
    buildBaseRepo(main, '1.2.3');
    installHook(main);

    bumpVersion(main, 'package.json', '1.2.4');
    git(main, 'add', 'package.json');
    git(main, 'tag', 'v1.2.4');
    const r = gitMaybe(main, 'commit', '-m', 'bump');

    expect(r.status, r.stderr).toBe(0);
    expect(headSubject(main)).toBe('bump');
  });

  it('allows the same untagged bump inside a LINKED worktree', () => {
    buildBaseRepo(main, '1.2.3');
    installHook(main);
    addLinkedWorktree(main, wt, 'rel');

    bumpVersion(wt, 'package.json', '1.2.5');
    git(wt, 'add', 'package.json');
    const r = gitMaybe(wt, 'commit', '-m', 'bump');

    expect(r.status, r.stderr).toBe(0);
    expect(headSubject(wt)).toBe('bump');
  });

  it('does not obstruct a commit that leaves package.json alone', () => {
    buildBaseRepo(main, '1.2.3');
    installHook(main);

    fs.writeFileSync(path.join(main, 'notes.txt'), 'unrelated task change\n', 'utf-8');
    git(main, 'add', 'notes.txt');
    const r = gitMaybe(main, 'commit', '-m', 'task');

    expect(r.status, r.stderr).toBe(0);
    expect(headSubject(main)).toBe('task');
  });
});

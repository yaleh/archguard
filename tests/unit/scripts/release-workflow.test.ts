/**
 * Unit tests for GOAL-001 / AC-001 — the release workflow's `advance-master`
 * job and the master-at-tag criterion it enforces.
 *
 * Two faces:
 *  1. structure — `.github/workflows/release.yml` is parsed with js-yaml and
 *     asserted to be the mechanism the criterion names: a version-tag push
 *     trigger, an `advance-master` job that depends on every other job in the
 *     file, and a run step that fast-forwards (ancestor check, no force flag).
 *  2. behaviour — `scripts/check-master-at-tag.sh` is actually executed against
 *     throwaway git repositories, both on the legal state (exit 0) and on each
 *     drift state (exit 1 with its own CAUSE).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-master-at-tag.sh');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release.yml');

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function runCheck(root: string) {
  return spawnSync('bash', [SCRIPT, root], { encoding: 'utf-8' });
}

interface Job {
  needs?: string | string[];
  steps?: Array<{ run?: string }>;
}

function loadWorkflow(): { on?: Record<string, unknown>; jobs?: Record<string, Job> } {
  return yaml.load(fs.readFileSync(WORKFLOW, 'utf-8')) as {
    on?: Record<string, unknown>;
    jobs?: Record<string, Job>;
  };
}

describe('release.yml structure (AC-001)', () => {
  it('is valid YAML', () => {
    expect(() => yaml.load(fs.readFileSync(WORKFLOW, 'utf-8'))).not.toThrow();
  });

  it('triggers on a version-tag push', () => {
    const doc = loadWorkflow();
    const push = (doc.on as Record<string, Record<string, string[]>>).push;
    expect(push.tags).toContain('v[0-9]+.[0-9]+.[0-9]+');
  });

  it('has an advance-master job whose needs covers every other job in the file', () => {
    const jobs = loadWorkflow().jobs ?? {};
    const names = Object.keys(jobs);
    expect(names).toContain('advance-master');

    const needs = jobs['advance-master'].needs;
    const needsList = Array.isArray(needs) ? needs : needs ? [needs] : [];
    const others = names.filter((n) => n !== 'advance-master');

    // Every other job must be gated on. A job added below and left off this
    // list would let master advance while that job is still red.
    for (const other of others) {
      expect(needsList).toContain(other);
    }
    // And no need may name a job that does not exist — GitHub Actions treats an
    // unknown `needs` entry as an error, but only at run time, on the tag push.
    for (const need of needsList) {
      expect(names).toContain(need);
    }
    expect(others.length).toBeGreaterThan(0);
  });

  it('fast-forwards without any force flag', () => {
    const job = (loadWorkflow().jobs ?? {})['advance-master'];
    const runText = (job.steps ?? [])
      .map((s) => s.run)
      .filter((run): run is string => typeof run === 'string')
      .join('\n');

    // The judgement that makes the push a fast-forward-or-refuse.
    expect(runText).toContain('--is-ancestor');
    // Force is what would let master be moved to a non-descendant — never.
    expect(runText).not.toContain('--force');
    // Short form of the same flag (`git push -f`, `git push --force-with-lease`).
    expect(runText).not.toContain(' -f ');
  });
});

describe('check-master-at-tag.sh', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-at-tag-'));
    git(dir, 'init', '-q');
    // Name the unborn branch explicitly: the criterion is about `master`, not
    // about whatever init.defaultBranch happens to be on the host.
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/master');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'tag.gpgsign', 'false');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function commit(message = 'c'): void {
    fs.writeFileSync(path.join(dir, `f-${Date.now()}-${Math.random()}`), message, 'utf-8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', message);
  }

  it('exits 0 when master sits on a vX.Y.Z tag', () => {
    commit();
    git(dir, 'tag', 'v1.2.3');
    const r = runCheck(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('v1.2.3');
  });

  it('exits 0 when the release tag is annotated', () => {
    // Releases are normally annotated (`git tag -a`); the criterion is about the
    // commit master points at, so an annotated tag must count exactly as a
    // lightweight one does.
    commit();
    git(dir, 'tag', '-a', 'v1.2.3', '-m', 'release 1.2.3');
    const r = runCheck(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('v1.2.3');
  });

  it('exits 1 with CAUSE=master-not-at-a-version-tag on a pre-release suffix', () => {
    // The criterion's shape is exactly ^v[0-9]+\.[0-9]+\.[0-9]+$: `v1.2.3-rc1` is
    // not a released version, so master parked on it is still drift.
    commit();
    git(dir, 'tag', 'v1.2.3-rc1');
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=master-not-at-a-version-tag');
  });

  it('exits 1 with CAUSE=master-not-at-a-version-tag when master has no tag', () => {
    commit();
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=master-not-at-a-version-tag');
  });

  it('exits 1 with CAUSE=master-not-at-a-version-tag when master moved past the release tag', () => {
    commit();
    git(dir, 'tag', 'v1.2.3');
    commit('after the release'); // master drifts ahead of the tagged commit
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=master-not-at-a-version-tag');
  });

  it('exits 1 with CAUSE=master-not-at-a-version-tag when master carries only a non-release tag', () => {
    commit();
    git(dir, 'tag', 'scratch');
    const r = runCheck(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=master-not-at-a-version-tag');
  });

  it('exits 1 with CAUSE=no-master-ref when there is no master branch', () => {
    const r = runCheck(dir); // no commit yet => refs/heads/master is unborn
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=no-master-ref');
  });

  it('judges the real repository it lives in: master must sit on a release tag', () => {
    // The criterion is only a guard if it actually runs against the checkout
    // `npm test` runs in — that is what turns a drifted `master` into a red
    // suite on the loop's own permanent path (AC-001). This is the assertion
    // that keeps the `master-not-at-a-version-tag` regression from recurring
    // silently: with the loop's task-store ticks landing on the main checkout,
    // master was pushed past the release tag one commit at a time and nothing
    // on the standing path noticed.
    const r = runCheck(REPO_ROOT);

    // Exactly one state is exempt: no local master ref at all (e.g. a CI PR
    // checkout, where actions/checkout leaves `refs/heads/master` unborn). That
    // state says nothing about master's value domain, so nothing to judge.
    if (r.stderr.includes('CAUSE=no-master-ref')) return;

    // Every other failure is drift. Never tolerated, in any environment: this
    // repo's master must sit on a vX.Y.Z commit or this suite is red.
    expect(r.stderr).not.toContain('CAUSE=master-not-at-a-version-tag');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ok: master [0-9a-f]+ is at v\d+\.\d+\.\d+$/m);
  });
});

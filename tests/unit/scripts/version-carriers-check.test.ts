/**
 * Regression guard for scripts/check-version-carriers.sh (GOAL-001 / AC-003).
 *
 * The six version carriers live in four files and have no other executable keeper:
 * `npm version`, a hand edit of package.json, or updating only some of the carriers
 * used to leave every check green. `npm test` is part of `prepublishOnly`, so the
 * repo-root case below is what turns carrier consistency into a standing pre-publish
 * guard — drift goes red before anything is published.
 *
 * Scope note: the criterion is the weaker "carriers agree with each other" shape. It
 * cannot see a tree whose carriers all agree but are all stale; lifting it to
 * "every carrier == resolveVersion(VERSION)" is tracked separately.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-version-carriers.sh');

const FIXTURE_VERSION = '1.2.3';
const DRIFTED_VERSION = '9.9.9';

type Json = Record<string, any>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJson(dir: string, rel: string, doc: unknown): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(doc, null, 2), 'utf-8');
}

/** Rewrite one place inside a fixture file, leaving the file otherwise intact. */
function mutate(dir: string, rel: string, edit: (doc: Json) => void): void {
  const doc = readJson(path.join(dir, rel));
  edit(doc);
  writeJson(dir, rel, doc);
}

function writeFixture(dir: string, version = FIXTURE_VERSION): void {
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
  writeJson(dir, 'plugin/.claude-plugin/plugin.json', { name: 'fixture-plugin', version });
}

/**
 * Each of the six carriers, keyed by the label the script prints when it names the
 * carrier that disagrees.
 */
const CARRIERS: Array<{
  label: string;
  file: string;
  setVersion: (dir: string, v: string) => void;
}> = [
  {
    label: 'package.json',
    file: 'package.json',
    setVersion: (dir, v) =>
      mutate(dir, 'package.json', (d) => {
        d.version = v;
      }),
  },
  {
    label: 'package-lock.json',
    file: 'package-lock.json',
    setVersion: (dir, v) =>
      mutate(dir, 'package-lock.json', (d) => {
        d.version = v;
      }),
  },
  {
    label: 'package-lock.json#packages[""]',
    file: 'package-lock.json',
    setVersion: (dir, v) =>
      mutate(dir, 'package-lock.json', (d) => {
        d.packages[''].version = v;
      }),
  },
  {
    label: '.claude-plugin/marketplace.json (source pin)',
    file: '.claude-plugin/marketplace.json',
    setVersion: (dir, v) =>
      mutate(dir, '.claude-plugin/marketplace.json', (d) => {
        d.plugins[0].source.version = v;
      }),
  },
  {
    label: 'plugin/package.json',
    file: 'plugin/package.json',
    setVersion: (dir, v) =>
      mutate(dir, 'plugin/package.json', (d) => {
        d.version = v;
      }),
  },
  {
    label: 'plugin/.claude-plugin/plugin.json',
    file: 'plugin/.claude-plugin/plugin.json',
    setVersion: (dir, v) =>
      mutate(dir, 'plugin/.claude-plugin/plugin.json', (d) => {
        d.version = v;
      }),
  },
];

function runCheck(root: string) {
  return spawnSync('bash', [SCRIPT, root], { encoding: 'utf-8' });
}

describe('check-version-carriers.sh', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-carriers-check-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 against this repository right now (the real six carriers agree)', () => {
    const expected = readJson(path.join(REPO_ROOT, 'package.json')).version;
    const r = runCheck(REPO_ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`all carriers == ${expected}`);
  });

  it('is reached by `npm test`, which `prepublishOnly` runs', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    expect(pkg.scripts.test).toContain('vitest');
    expect(pkg.scripts.prepublishOnly).toContain('npm test');
  });

  it('exits 0 on a fixture whose six carriers agree', () => {
    writeFixture(dir);
    const r = runCheck(dir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`all carriers == ${FIXTURE_VERSION}`);
  });

  describe('drift in any single carrier is caught', () => {
    for (const carrier of CARRIERS) {
      it(`exits 1 and names ${carrier.label}`, () => {
        writeFixture(dir);
        carrier.setVersion(dir, DRIFTED_VERSION);

        const r = runCheck(dir);

        expect(r.status).toBe(1);
        expect(r.stderr).toContain('CAUSE=version-carriers-disagree');
        if (carrier.label === 'package.json') {
          // package.json is the reference: it is the one that moved, so the payload
          // names the five carriers that no longer match it.
          expect(r.stderr).toContain(`期望全部等于 ${DRIFTED_VERSION}`);
        } else {
          expect(r.stderr).toContain(carrier.label);
          expect(r.stderr).toContain(DRIFTED_VERSION);
        }
      });
    }
  });

  describe('unreadable carriers are reported as such, not as drift', () => {
    const files = [...new Set(CARRIERS.map((c) => c.file))];

    for (const file of files) {
      it(`exits 1 with CAUSE=version-carrier-unreadable when ${file} is missing`, () => {
        writeFixture(dir);
        fs.rmSync(path.join(dir, file));

        const r = runCheck(dir);

        expect(r.status).toBe(1);
        expect(r.stderr).toContain('CAUSE=version-carrier-unreadable');
        expect(r.stderr).not.toContain('CAUSE=version-carriers-disagree');
      });
    }

    it('exits 1 with CAUSE=version-carrier-unreadable when a carrier file is not valid JSON', () => {
      writeFixture(dir);
      fs.writeFileSync(path.join(dir, 'plugin/.claude-plugin/plugin.json'), '{ not json', 'utf-8');

      const r = runCheck(dir);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('CAUSE=version-carrier-unreadable');
      expect(r.stderr).toContain('plugin/.claude-plugin/plugin.json');
    });

    it('exits 1 with CAUSE=version-carrier-unreadable when a carrier has no version', () => {
      writeFixture(dir);
      mutate(dir, 'plugin/package.json', (d) => {
        delete d.version;
      });

      const r = runCheck(dir);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('CAUSE=version-carrier-unreadable');
      expect(r.stderr).toContain('plugin/package.json');
    });
  });
});

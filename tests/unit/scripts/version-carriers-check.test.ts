/**
 * Regression guard for the version-carrier single-source derivation (GOAL-001 / AC-003).
 *
 * The six carriers live in four files. Before this task each was an independently maintained
 * string: `npm version` rewrites only the npm side (package.json + package-lock.json x2) and
 * the plugin side lagged, so the goal gate sampled the working tree mid-bump and went red with
 * `CAUSE=version-carriers-disagree`. The long-term fix keeps a single source (`VERSION`) and
 * derives the six from it: `scripts/sync-version-carriers.mjs` writes VERSION + the six inside
 * the `npm version` lifecycle, and `scripts/check-version-carriers.sh` compares the six against
 * that external source — not against each other. The weaker "carriers agree with each other"
 * shape cannot see a tree whose carriers all agree but are all stale; the regression case below
 * pins that the lifted criterion can.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CHECK = path.join(REPO_ROOT, 'scripts/check-version-carriers.sh');
const GENERATOR = path.join(REPO_ROOT, 'scripts/sync-version-carriers.mjs');

const FIXTURE_VERSION = '1.2.3';
const DRIFTED_VERSION = '9.9.9';

type Json = Record<string, any>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJson(dir: string, rel: string, doc: unknown, indent = '  '): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(doc, null, indent)}\n`, 'utf-8');
}

/** Rewrite one place inside a fixture file, leaving the file otherwise intact. */
function mutate(dir: string, rel: string, edit: (doc: Json) => void): void {
  const doc = readJson(path.join(dir, rel));
  edit(doc);
  writeJson(dir, rel, doc);
}

/** A fixture whose six carriers AND VERSION all equal `version` (the healthy tree). */
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
  // The real plugin manifest is tab-indented; mirror that so the generator is exercised on it.
  writeJson(dir, 'plugin/.claude-plugin/plugin.json', { name: 'fixture-plugin', version }, '\t');
  fs.writeFileSync(path.join(dir, 'VERSION'), `${version}\n`, 'utf-8');
}

/** A fixture carrying the partial-bump signature: npm side ahead of the plugin side. */
function writePartialBumpFixture(
  dir: string,
  npmVersion: string,
  pluginVersion: string,
  versionFile: string,
): void {
  writeJson(dir, 'package.json', { name: 'fixture', version: npmVersion });
  writeJson(dir, 'package-lock.json', {
    name: 'fixture',
    version: npmVersion,
    lockfileVersion: 3,
    packages: { '': { name: 'fixture', version: npmVersion } },
  });
  writeJson(dir, '.claude-plugin/marketplace.json', {
    name: 'fixture',
    plugins: [{ name: 'fixture', source: { source: 'npm', package: 'fixture', version: npmVersion } }],
  });
  writeJson(dir, 'plugin/package.json', { name: 'fixture-plugin', version: pluginVersion });
  writeJson(
    dir,
    'plugin/.claude-plugin/plugin.json',
    { name: 'fixture-plugin', version: pluginVersion },
    '\t',
  );
  fs.writeFileSync(path.join(dir, 'VERSION'), `${versionFile}\n`, 'utf-8');
}

/**
 * Each of the six carriers, keyed by the label the checker prints when it names the carrier
 * that disagrees.
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
  return spawnSync('bash', [CHECK, root], { encoding: 'utf-8' });
}

function runGenerator(args: string[]) {
  return spawnSync('node', [GENERATOR, ...args], { encoding: 'utf-8' });
}

/** Every file under `dir` keyed by its path relative to `dir`, for byte-level comparisons. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else out[child] = fs.readFileSync(path.join(dir, child), 'utf-8');
    }
  };
  walk('.');
  return out;
}

describe('check-version-carriers.sh — criterion is the external source VERSION', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-carriers-check-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 against this repository right now, and VERSION equals its version', () => {
    const expected = readJson(path.join(REPO_ROOT, 'package.json')).version;
    const versionFile = fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf-8');

    const r = runCheck(REPO_ROOT);

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`all carriers == ${expected}`);
    // The external source the criterion is anchored to: VERSION is literally that version.
    expect(versionFile.trim()).toBe(expected);
  });

  it('exits 0 on a fixture whose six carriers and VERSION agree', () => {
    writeFixture(dir);

    const r = runCheck(dir);

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`all carriers == ${FIXTURE_VERSION}`);
  });

  it('exits 1 on the regression shape: six carriers agree with each other but not with VERSION', () => {
    // The tree the old "carriers agree with each other" criterion could not see — and the shape
    // AC-003 actually failed on: everything internally consistent, anchored to a stale VERSION.
    writeFixture(dir, FIXTURE_VERSION);
    fs.writeFileSync(path.join(dir, 'VERSION'), `${DRIFTED_VERSION}\n`, 'utf-8');

    const r = runCheck(dir);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=version-carriers-disagree');
    expect(r.stderr).toContain(`期望全部等于 ${DRIFTED_VERSION}`);
    // Every carrier is named because none of them equals the external source.
    for (const carrier of CARRIERS) expect(r.stderr).toContain(carrier.label);
  });

  describe('a carrier that drifts from VERSION is caught and named', () => {
    for (const carrier of CARRIERS) {
      it(`exits 1 and names ${carrier.label}`, () => {
        writeFixture(dir);
        carrier.setVersion(dir, DRIFTED_VERSION);

        const r = runCheck(dir);

        expect(r.status).toBe(1);
        expect(r.stderr).toContain('CAUSE=version-carriers-disagree');
        expect(r.stderr).toContain(carrier.label);
        expect(r.stderr).toContain(DRIFTED_VERSION);
        expect(r.stderr).toContain(`期望全部等于 ${FIXTURE_VERSION}`);
      });
    }
  });

  describe('unreadable sources are reported as unreadable, not as drift', () => {
    it('exits 1 with CAUSE=version-carrier-unreadable when VERSION is missing', () => {
      writeFixture(dir);
      fs.rmSync(path.join(dir, 'VERSION'));

      const r = runCheck(dir);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('CAUSE=version-carrier-unreadable');
      expect(r.stderr).not.toContain('CAUSE=version-carriers-disagree');
    });

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

  it('is wired as npm\'s `version` lifecycle so a bump cannot leave a partial-carrier window', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    expect(pkg.scripts.version).toBeTruthy();
    expect(pkg.scripts.version).toContain('sync-version-carriers');
    expect(pkg.scripts['sync-version']).toContain('sync-version-carriers');
  });
});

describe('sync-version-carriers.mjs --check', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-carriers-sync-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 at the repository root', () => {
    const expected = readJson(path.join(REPO_ROOT, 'package.json')).version;

    const r = runGenerator(['--check', REPO_ROOT]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`all carriers == ${expected}`);
  });

  it('exits 1 on a fixture whose carriers agree with each other but not with VERSION', () => {
    writeFixture(dir, FIXTURE_VERSION);
    fs.writeFileSync(path.join(dir, 'VERSION'), `${DRIFTED_VERSION}\n`, 'utf-8');

    const r = runGenerator(['--check', dir]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=version-carriers-disagree');
    expect(r.stderr).toContain(DRIFTED_VERSION);
  });

  it('exits 1 with CAUSE=version-carrier-unreadable when VERSION is missing', () => {
    writeFixture(dir);
    fs.rmSync(path.join(dir, 'VERSION'));

    const r = runGenerator(['--check', dir]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=version-carrier-unreadable');
    expect(r.stderr).not.toContain('CAUSE=version-carriers-disagree');
  });
});

describe('sync-version-carriers.mjs --from-package (generator)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-carriers-gen-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('converges the partial-bump shape and then passes the check', () => {
    writePartialBumpFixture(dir, '0.1.40', '0.1.39', '0.1.39');

    // The partial bump is caught before any fix (npm side ahead of plugin side + VERSION).
    expect(runCheck(dir).status).toBe(1);

    const gen = runGenerator(['--from-package', dir]);
    expect(gen.status).toBe(0);

    // The generator anchors on package.json's (new) version and writes VERSION + all six.
    expect(fs.readFileSync(path.join(dir, 'VERSION'), 'utf-8').trim()).toBe('0.1.40');
    for (const carrier of CARRIERS) {
      const doc = readJson(path.join(dir, carrier.file));
      const value =
        carrier.label === 'package-lock.json#packages[""]'
          ? doc.packages[''].version
          : carrier.label === '.claude-plugin/marketplace.json (source pin)'
            ? doc.plugins[0].source.version
            : doc.version;
      expect(value).toBe('0.1.40');
    }

    const check = runCheck(dir);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('all carriers == 0.1.40');
  });

  it('is idempotent: a second run leaves every file byte-identical', () => {
    writePartialBumpFixture(dir, '0.1.40', '0.1.39', '0.1.39');

    expect(runGenerator(['--from-package', dir]).status).toBe(0);
    const first = snapshot(dir);

    expect(runGenerator(['--from-package', dir]).status).toBe(0);
    const second = snapshot(dir);

    expect(second).toEqual(first);
  });

  it('preserves each file\'s own indentation (the real plugin manifest is tab-indented)', () => {
    writePartialBumpFixture(dir, '0.1.40', '0.1.39', '0.1.39');

    expect(runGenerator(['--from-package', dir]).status).toBe(0);

    const pluginManifest = fs.readFileSync(
      path.join(dir, 'plugin/.claude-plugin/plugin.json'),
      'utf-8',
    );
    expect(pluginManifest).toContain('\t"version": "0.1.40"');
    expect(pluginManifest).not.toContain('  "version"');
  });
});

#!/usr/bin/env node
/**
 * Version-carrier single-source synchronizer (GOAL-001 / AC-003).
 *
 * The released version is carried in six places across four files, and until now each
 * place was an independently-maintained string with no single source:
 *
 *   package.json                              .version
 *   package-lock.json                         .version
 *   package-lock.json                         .packages[""].version
 *   .claude-plugin/marketplace.json           .plugins[0].source.version   (npm source pin)
 *   plugin/package.json                       .version
 *   plugin/.claude-plugin/plugin.json         .version
 *
 * `npm version <x>` only rewrites package.json + package-lock.json (x2). The plugin side
 * is edited by hand afterwards, which opens a window where the npm side is ahead of the
 * plugin side. GOAL-001 / AC-003 samples the working tree during that window and goes red
 * (`CAUSE=version-carriers-disagree`). The fix is to stop hand-maintaining the six: keep a
 * single source (the repo-root `VERSION` file), derive the six from it, and make the guard
 * compare against that external source rather than "the carriers agree with each other"
 * (the weaker shape that cannot see an all-equal-but-all-stale tree).
 *
 * This script is the one implementation of that logic. `scripts/check-version-carriers.sh`
 * delegates its comparison here (`--check`), so the guard and the generator can never
 * disagree about what "consistent" means.
 *
 * Modes (root defaults to '.', so both run bare in the repo root):
 *   --from-package [root]   read <root>/package.json `.version` and write `VERSION` plus all
 *                           six carriers from it. npm's `version` lifecycle runs this, so a
 *                           bump lands VERSION + all six inside one `npm version` call and the
 *                           partial-bump window cannot hang.
 *   --check [root]          compare the six carriers against <root>/VERSION. Exit 0 with
 *                           `all carriers == <version>` when all agree; otherwise exit 1.
 *   (no mode flag)          same as --from-package.
 *
 * Formatting: each file is rewritten with the indentation and trailing-newline style it
 * already uses, and only when the bytes actually change, so a no-op run leaves a clean tree
 * (plugin/.claude-plugin/plugin.json is tab-indented; the rest are 2-space).
 *
 * Exit codes:
 *   0  success (check: all agree; sync: carriers written)
 *   1  CAUSE=version-carrier-unreadable  — VERSION or a carrier file is missing / unparseable /
 *                                          carries no version string
 *      CAUSE=version-carriers-disagree   — at least one carrier differs from VERSION
 *   2  usage error (unknown flag)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION_FILE = 'VERSION';

/**
 * The six carriers, keyed by the label printed when one disagrees. Order defines the order
 * of the disagreement payload. `get`/`set` walk the file's own shape, so a structurally
 * broken file surfaces as unreadable rather than a silent pass.
 */
const CARRIERS = [
  {
    label: 'package.json',
    file: 'package.json',
    get: (doc) => doc.version,
    set: (doc, v) => {
      doc.version = v;
    },
  },
  {
    label: 'package-lock.json',
    file: 'package-lock.json',
    get: (doc) => doc.version,
    set: (doc, v) => {
      doc.version = v;
    },
  },
  {
    label: 'package-lock.json#packages[""]',
    file: 'package-lock.json',
    get: (doc) => doc.packages[''].version,
    set: (doc, v) => {
      doc.packages[''].version = v;
    },
  },
  {
    label: '.claude-plugin/marketplace.json (source pin)',
    file: '.claude-plugin/marketplace.json',
    get: (doc) => doc.plugins[0].source.version,
    set: (doc, v) => {
      doc.plugins[0].source.version = v;
    },
  },
  {
    label: 'plugin/package.json',
    file: 'plugin/package.json',
    get: (doc) => doc.version,
    set: (doc, v) => {
      doc.version = v;
    },
  },
  {
    label: 'plugin/.claude-plugin/plugin.json',
    file: 'plugin/.claude-plugin/plugin.json',
    get: (doc) => doc.version,
    set: (doc, v) => {
      doc.version = v;
    },
  },
];

function dieUnreadable(detail) {
  process.stderr.write(`CAUSE=version-carrier-unreadable: ${detail}\n`);
  process.exit(1);
}

/**
 * Render the disagreement payload in the shape the previous guard printed (a Python-style
 * dict repr, single-quoted), so a label like `package-lock.json#packages[""]` appears verbatim
 * instead of JSON-escaped — the stderr contract its callers/tests already key on is preserved.
 */
function renderBad(bad) {
  const entries = Object.entries(bad).map(
    ([label, value]) => `'${label}': ${typeof value === 'string' ? `'${value}'` : JSON.stringify(value)}`,
  );
  return `{${entries.join(', ')}}`;
}

function dieDisagree(expected, bad) {
  process.stderr.write(
    `CAUSE=version-carriers-disagree — 期望全部等于 ${expected}，实际不符：${renderBad(bad)}\n`,
  );
  process.exit(1);
}

/** Read + parse one JSON file. Any failure to read or parse is "unreadable", never "disagree". */
function readJson(root, rel) {
  const full = path.join(root, rel);
  let raw;
  try {
    raw = fs.readFileSync(full, 'utf-8');
  } catch {
    dieUnreadable(`${rel} — file not found`);
  }
  try {
    return { raw, doc: JSON.parse(raw) };
  } catch (exc) {
    dieUnreadable(`${rel} — cannot parse (${exc.message})`);
  }
}

/** The indentation unit the file already uses (tabs vs N spaces), so rewriting is byte-stable. */
function detectIndent(raw) {
  const match = raw.match(/^([ \t]+)\S/m);
  return match ? match[1] : '  ';
}

function serializeLike(doc, raw) {
  return JSON.stringify(doc, null, detectIndent(raw)) + (raw.endsWith('\n') ? '\n' : '');
}

function readVersionFile(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, VERSION_FILE), 'utf-8');
  } catch {
    dieUnreadable(`${VERSION_FILE} — file not found`);
  }
  const version = raw.trim();
  if (!version) dieUnreadable(`${VERSION_FILE} — empty`);
  return version;
}

function runCheck(root) {
  const expected = readVersionFile(root);

  const got = {};
  for (const carrier of CARRIERS) {
    const { doc } = readJson(root, carrier.file);
    let value;
    try {
      value = carrier.get(doc);
    } catch {
      dieUnreadable(`${carrier.file} — no version at "${carrier.label}"`);
    }
    // A missing/empty version is a structurally broken carrier, not drift: report it as
    // unreadable (as the accessor raising would) rather than a disagree with an undefined value.
    if (typeof value !== 'string' || value === '') {
      dieUnreadable(`${carrier.file} — no version at "${carrier.label}"`);
    }
    got[carrier.label] = value;
  }

  const bad = {};
  for (const [label, value] of Object.entries(got)) {
    if (value !== expected) bad[label] = value;
  }
  if (Object.keys(bad).length > 0) dieDisagree(expected, bad);

  process.stdout.write(`all carriers == ${expected}\n`);
  process.exit(0);
}

function runSync(root) {
  const { doc: pkg } = readJson(root, 'package.json');
  const expected = pkg.version;
  if (typeof expected !== 'string' || expected === '') {
    dieUnreadable('package.json — no version');
  }

  // Group carriers by file so each file is read once and written once, preserving every
  // byte the generator does not own (key order, indentation, trailing newline).
  const files = new Map();
  for (const carrier of CARRIERS) {
    if (!files.has(carrier.file)) {
      const { raw, doc } = readJson(root, carrier.file);
      files.set(carrier.file, { raw, doc, carriers: [] });
    }
    files.get(carrier.file).carriers.push(carrier);
  }

  for (const [rel, entry] of files) {
    for (const carrier of entry.carriers) {
      try {
        carrier.set(entry.doc, expected);
      } catch {
        dieUnreadable(`${rel} — cannot set version at "${carrier.label}"`);
      }
    }
    const next = serializeLike(entry.doc, entry.raw);
    if (next !== entry.raw) fs.writeFileSync(path.join(root, rel), next, 'utf-8');
  }

  // VERSION is derived too: it and the six carriers all equal package.json's version.
  fs.writeFileSync(path.join(root, VERSION_FILE), `${expected}\n`, 'utf-8');

  process.stdout.write(`synced carriers == ${expected}\n`);
  process.exit(0);
}

function usage() {
  process.stdout.write(
    'usage: node scripts/sync-version-carriers.mjs [--from-package|--check] [repo-root]\n' +
      '  --from-package  write VERSION + the six carriers from package.json (default)\n' +
      '  --check         compare the six carriers against VERSION; exit 1 on any mismatch\n',
  );
}

function main(argv) {
  let mode = 'sync';
  let root = '.';
  for (const arg of argv) {
    if (arg === '--check') mode = 'check';
    else if (arg === '--from-package') mode = 'sync';
    else if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      process.stderr.write(`unknown flag: ${arg}\n`);
      usage();
      process.exit(2);
    } else {
      root = arg;
    }
  }
  if (mode === 'check') runCheck(root);
  else runSync(root);
}

main(process.argv.slice(2));

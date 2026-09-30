#!/usr/bin/env node
// Release-run ledger recorder (GOAL-001 / AC-005).
//
// AC-005 wants a LOCAL carrier — `.quay/release-runs.jsonl` (gitignored, so it never reaches the
// repo) — whose LAST line records that a release actually happened end to end:
//   cli-publish=success AND plugin-publish=success AND install-verify=success.
//
// This script is the WRITE half of that carrier (scripts/check-release-ledger.sh is the READ half).
// The gap it closes: "npm publish exited 0" / "the release object exists" / "the build succeeded"
// were all silently readable as "the release is good", because nothing recorded the three
// conclusions side by side. One append = one row = one release attempt.
//
// Usage:
//   node scripts/record-release-run.mjs --tag vX.Y.Z \
//        --cli-publish <success|failure|skipped> \
//        --plugin-publish <success|failure|skipped> \
//        --install-verify <success|failure|skipped> \
//        [--ledger <path>]            (default: .quay/release-runs.jsonl, parent dir created)
//
// Contract:
//   * APPEND-ONLY — existing rows are never rewritten or reordered.
//   * Exactly one JSON line per invocation, key order: tag, cli-publish, plugin-publish,
//     install-verify, ts (ts = ISO-8601 of the recording moment, never of the publishes).
//   * Invalid args (missing key, bad status, malformed tag, unknown flag) ⇒ NOTHING is written:
//     stderr `CAUSE=invalid-release-run-args` and exit 1. Validation happens before any mkdir, so a
//     rejected invocation cannot leave an empty ledger behind that later reads as `carrier-empty`.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** The closed set a status column may take. `skipped` is a first-class value, not an error:
 *  a publish that was deliberately not attempted must be recordable as such, or the only honest
 *  options left are `success` (a lie) and `failure` (also a lie). */
export const STATUSES = ['success', 'failure', 'skipped'];

/** Tag shape is validated (not just "non-empty") so a typo'd or branch-name tag cannot enter the
 *  ledger as a release identity key. */
export const TAG_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

export const DEFAULT_LEDGER = '.quay/release-runs.jsonl';

const STATUS_FLAGS = [
  ['--cli-publish', 'cli-publish'],
  ['--plugin-publish', 'plugin-publish'],
  ['--install-verify', 'install-verify'],
];

const USAGE =
  'usage: node scripts/record-release-run.mjs --tag vX.Y.Z ' +
  '--cli-publish <success|failure|skipped> --plugin-publish <success|failure|skipped> ' +
  '--install-verify <success|failure|skipped> [--ledger <path>]';

function fail(message) {
  process.stderr.write(`CAUSE=invalid-release-run-args: ${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

/** Parse argv into a plain map; every rejection path routes through fail() so the CAUSE token and
 *  the "nothing was written" guarantee are stated in exactly one place. */
function parseArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    const takesValue =
      arg === '--tag' || arg === '--ledger' || STATUS_FLAGS.some(([flag]) => flag === arg);
    if (!takesValue) {
      fail(arg.startsWith('-') ? `unknown flag: ${arg}` : `unexpected positional argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value === '') fail(`${arg} requires a value`);
    values.set(arg, value);
    i += 1;
  }
  return values;
}

function main(argv) {
  const values = parseArgs(argv);

  const tag = values.get('--tag');
  if (tag === undefined) fail('missing required flag: --tag');
  if (!TAG_PATTERN.test(tag)) fail(`--tag must look like vX.Y.Z, got: ${tag}`);

  const record = { tag };
  for (const [flag, key] of STATUS_FLAGS) {
    const value = values.get(flag);
    if (value === undefined) fail(`missing required flag: ${flag}`);
    if (!STATUSES.includes(value)) {
      fail(`${flag} must be one of ${STATUSES.join('|')}, got: ${value}`);
    }
    record[key] = value;
  }

  const ledger = path.resolve(values.get('--ledger') ?? DEFAULT_LEDGER);
  record.ts = new Date().toISOString();

  // Append only. mkdir happens here — after every validation above — so a rejected invocation
  // cannot materialize the ledger file (the "file未被创建" half of the AC).
  const line = `${JSON.stringify(record)}\n`;
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.appendFileSync(ledger, line, 'utf8');
  process.stdout.write(line);
}

main(process.argv.slice(2));

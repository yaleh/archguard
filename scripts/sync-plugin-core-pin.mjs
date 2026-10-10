#!/usr/bin/env node
/**
 * plugin → core exact-version pin single-source synchronizer (GOAL-001 / AC-004).
 *
 * GOAL-001 / AC-004 asserts the Claude Code plugin package depends on the core runtime by an
 * EXACT version — `plugin/package.json` `.dependencies["@yalehwang/archguard"]` must equal,
 * verbatim, the repo-root `package.json` `.version`. A range (`^`/`~`) would let npm resolve the
 * plugin against a different runtime build than the released one, which the README's channel
 * contract promises never happens.
 *
 * That pin is a SEVENTH version carrier. The six that scripts/sync-version-carriers.mjs owns are
 * all `.version` strings; the pin is a DEPENDENCY RANGE string living in a nested object, so it
 * was in no derivation or validation surface and had to be edited by hand. That is how the
 * 2026-10-10T05:11 window happened: `npm version` lifted the npm side to 0.1.39 while the plugin
 * side (including this pin) stayed at 0.1.38 for ~60-90s, and the goal driver sampled the main
 * checkout exactly there (`CAUSE=plugin-core-dependency-not-exact`).
 *
 * This script is the one implementation of "derive + compare" for the pin, mirroring
 * sync-version-carriers.mjs for the six. `scripts/check-version-carriers.sh` delegates the pin's
 * check here (`--check`), so the guard and the generator cannot disagree about what "exact" means.
 *
 * Modes (root defaults to '.', so both run bare in the repo root):
 *   --from-package [root]   read <root>/package.json `.version` and write it as the pin into
 *                           <root>/plugin/package.json. npm's `version` lifecycle runs this right
 *                           after the six-carrier generator, so the pin moves inside the same
 *                           `npm version` call and the "core ahead, pin behind" window cannot hang.
 *   --check [root]          compare the pin against <root>/package.json `.version`. Exit 0 with
 *                           `plugin core pin ok: <version>`; otherwise exit 1 with a CAUSE code.
 *                           This is the strict AC-004 criterion: it reports a MISSING dependency
 *                           too (`CAUSE=plugin-missing-core-dependency`).
 *   --check-if-declared [root]  the same comparison, but a plugin package that declares no
 *                           `dependencies` object at all is out of scope and exits 0 silently.
 *                           scripts/check-version-carriers.sh uses this mode so the composite guard
 *                           enforces the seventh carrier's exactness without re-litigating the
 *                           pre-existing six-carrier regression contract (a plugin/package.json
 *                           with no `dependencies` is pinned there as healthy). Presence is still
 *                           enforced by strict `--check` above, which is also what AC-004 reads.
 *   (no mode flag)          same as --from-package.
 *
 * Formatting: the file is rewritten with the indentation and trailing-newline style it already
 * uses, and only when the bytes actually change, so a no-op run leaves a clean tree and a second
 * run is byte-identical.
 *
 * Exit codes:
 *   0  success (check: pin exact; sync: pin written)
 *   1  CAUSE=plugin-missing-core-dependency    — plugin/package.json declares no
 *                                                @yalehwang/archguard dependency
 *      CAUSE=plugin-core-dependency-not-exact  — the pin exists but is not the core version
 *                                                verbatim (includes any ^/~ range)
 *      CAUSE=plugin-core-pin-unreadable        — package.json / plugin/package.json is missing
 *                                                or unparseable, or carries no version string
 *   2  usage error (unknown flag)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CORE_DEP = '@yalehwang/archguard';
const CORE_PKG = 'package.json';
const PLUGIN_PKG = path.join('plugin', 'package.json');

function dieUnreadable(detail) {
  process.stderr.write(`CAUSE=plugin-core-pin-unreadable: ${detail}\n`);
  process.exit(1);
}

/** Read + parse one JSON file. Any failure to read or parse is "unreadable", never a mismatch. */
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

/** The reference version: the core package's own `.version`, exactly as AC-004 reads it. */
function coreVersion(root) {
  const { doc } = readJson(root, CORE_PKG);
  const version = doc.version;
  if (typeof version !== 'string' || version === '') dieUnreadable(`${CORE_PKG} — no version`);
  return version;
}

function readPin(root) {
  const { raw, doc } = readJson(root, PLUGIN_PKG);
  const deps = doc.dependencies;
  const declared = deps !== undefined && deps !== null && typeof deps === 'object' && !Array.isArray(deps);
  const dep = declared ? deps[CORE_DEP] : undefined;
  return { raw, doc, declared, dep };
}

function runCheck(root, { ifDeclared = false } = {}) {
  const { declared, dep } = readPin(root);

  // Guard mode: a plugin package with no `dependencies` object at all is outside the composite
  // version-carrier guard's scope (the six-carrier regression contract pins that shape healthy).
  // Its absence of a core dependency is still reported by strict --check (and by AC-004 itself).
  if (ifDeclared && !declared) process.exit(0);

  const core = coreVersion(root);

  if (dep === undefined || dep === null) {
    process.stderr.write(
      `CAUSE=plugin-missing-core-dependency — plugin/package.json 没有声明 ${CORE_DEP} 依赖\n`,
    );
    process.exit(1);
  }
  if (dep !== core) {
    process.stderr.write(
      `CAUSE=plugin-core-dependency-not-exact — ${PLUGIN_PKG} 的 dependencies['${CORE_DEP}'] 是 '${dep}'，core 版本是 '${core}'；带范围会让 plugin 静默解析到另一个运行时版本\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`plugin core pin ok: ${dep}\n`);
  process.exit(0);
}

function runSync(root) {
  const core = coreVersion(root);
  const { raw, doc } = readPin(root);

  if (doc.dependencies === undefined) {
    doc.dependencies = {};
  } else if (typeof doc.dependencies !== 'object' || doc.dependencies === null || Array.isArray(doc.dependencies)) {
    dieUnreadable(`${PLUGIN_PKG} — dependencies is not an object`);
  }
  doc.dependencies[CORE_DEP] = core;

  const next = serializeLike(doc, raw);
  if (next !== raw) fs.writeFileSync(path.join(root, PLUGIN_PKG), next, 'utf-8');

  process.stdout.write(`synced plugin core pin == ${core}\n`);
  process.exit(0);
}

function usage() {
  process.stdout.write(
    'usage: node scripts/sync-plugin-core-pin.mjs [--from-package|--check|--check-if-declared] [repo-root]\n' +
      '  --from-package      write plugin/package.json pin from package.json version (default)\n' +
      '  --check             compare the pin against package.json version; exit 1 on mismatch or absence\n' +
      '  --check-if-declared as --check, but exit 0 when the plugin declares no dependencies at all\n',
  );
}

function main(argv) {
  let mode = 'sync';
  let root = '.';
  for (const arg of argv) {
    if (arg === '--check') mode = 'check';
    else if (arg === '--check-if-declared') mode = 'check-if-declared';
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
  else if (mode === 'check-if-declared') runCheck(root, { ifDeclared: true });
  else runSync(root);
}

main(process.argv.slice(2));

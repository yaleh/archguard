#!/usr/bin/env node
/**
 * Reproducible Dart grammar WASM build from a pinned upstream source commit.
 *
 * The pinned inputs live in `scripts/dart-grammar-source.mjs` (shared with
 * `fetch-grammar-wasms.mjs`) so there is exactly one place to change a commit,
 * archive SHA, CLI version, or image digest.
 *
 * Two modes:
 *   --verify (default): rebuild into a TEMP directory, compute the digest, and
 *       compare it against the expected digest recorded in checksums.json. It
 *       NEVER mutates the checked-in assets — a mismatch fails with
 *       expected/actual, so a drift in inputs cannot silently bless a new blob.
 *   --update: rebuild and, on success, overwrite the checked-in WASM, LICENSE,
 *       checksum, and provenance — committed transactionally as one asset tree
 *       (see grammar-assets-commit.mjs), so a failure never leaves a mix.
 *       Use only when intentionally upgrading a grammar/build input.
 *
 * Usage:
 *   node scripts/build-dart-grammar-wasm.mjs            # verify (non-mutating)
 *   node scripts/build-dart-grammar-wasm.mjs --update   # rebuild + accept new digest
 *
 * Requirements: network to github.com, plus `tar`, `npx`, and a host toolchain
 * (Node; `emcc` only if you want the real compiler recorded in provenance).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DART_GRAMMAR, dartProvenanceSource } from './dart-grammar-source.mjs';
import { commitAssetPlan } from './grammar-assets-commit.mjs';
import { detectHostToolchain } from './host-toolchain.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(repoRoot, 'assets', 'grammars');
const checksumsPath = path.join(assetsDir, 'checksums.json');
const provenancePath = path.join(assetsDir, 'provenance.json');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function assertManifest() {
  const required = [
    'repository',
    'commit',
    'sourceArchiveUrl',
    'sourceArchiveSha256',
    'buildToolVersion',
    'buildScript',
  ];
  for (const key of required) {
    if (!DART_GRAMMAR[key]) throw new Error(`dart grammar manifest missing "${key}"`);
  }
  if (!/^[0-9a-f]{40}$/.test(DART_GRAMMAR.commit)) {
    throw new Error(`dart grammar manifest has a malformed commit: ${DART_GRAMMAR.commit}`);
  }
  if (!/^[0-9a-f]{64}$/.test(DART_GRAMMAR.sourceArchiveSha256)) {
    throw new Error('dart grammar manifest has a malformed sourceArchiveSha256');
  }
}

/**
 * Create a process-unique, throwaway build directory. Unlike the old fixed
 * `.tmp-dart-grammar`, two concurrent verify/update processes get independent
 * paths and only ever clean up the directory they own.
 */
export function createGrammarWorkDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'archguard-dart-grammar-'));
}

/**
 * Download the pinned source archive, verify its SHA, build the WASM with the
 * pinned CLI + image, and return the built WASM + LICENSE buffers. Builds into
 * a throwaway temp directory; never touches the checked-in assets.
 */
async function buildGrammar() {
  assertManifest();

  const workDir = createGrammarWorkDir();

  try {
    // 1. Download + verify the source archive.
    console.log(`[build-dart-grammar] download ${DART_GRAMMAR.sourceArchiveUrl}`);
    const archive = await download(DART_GRAMMAR.sourceArchiveUrl);
    const actualSha = sha256(archive);
    if (actualSha !== DART_GRAMMAR.sourceArchiveSha256) {
      throw new Error(
        `source archive SHA mismatch: expected ${DART_GRAMMAR.sourceArchiveSha256}, got ${actualSha}`
      );
    }
    const archivePath = path.join(workDir, `src.${DART_GRAMMAR.sourceArchiveFormat}`);
    writeFileSync(archivePath, archive);

    // 2. Extract (GitHub tarball extracts into <repo>-<commit>/).
    run('tar', ['-xzf', archivePath, '-C', workDir]);
    const srcDir = path.join(workDir, `tree-sitter-dart-${DART_GRAMMAR.commit}`);
    if (!existsSync(path.join(srcDir, 'grammar.js'))) {
      throw new Error(`expected grammar.js under ${srcDir}`);
    }

    // 3. Verify the LICENSE is MIT (defensive; the archive is already pinned).
    const license = readFileSync(path.join(srcDir, 'LICENSE'), 'utf8');
    if (!/MIT/i.test(license)) throw new Error('LICENSE does not appear to be MIT');

    // 4. Build on the host with the pinned CLI + host toolchain. There is no
    // container step (P0-1 B): the artifact is produced by the emcc/Node/npx
    // actually present, and that toolchain is recorded so the trust claim
    // matches the real build.
    run('npx', ['-y', `${DART_GRAMMAR.buildTool}@${DART_GRAMMAR.buildToolVersion}`, 'generate'], {
      cwd: srcDir,
    });
    run('npx', ['-y', `${DART_GRAMMAR.buildTool}@${DART_GRAMMAR.buildToolVersion}`, 'build', '--wasm'], {
      cwd: srcDir,
    });

    const builtWasm = path.join(srcDir, DART_GRAMMAR.asset);
    if (!existsSync(builtWasm)) throw new Error(`build did not produce ${builtWasm}`);
    return {
      wasm: readFileSync(builtWasm),
      license: readFileSync(path.join(srcDir, 'LICENSE')),
      toolchain: detectHostToolchain(),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function loadExpectedChecksum() {
  if (!existsSync(checksumsPath)) {
    throw new Error(`${checksumsPath} missing — run fetch-grammar-wasms --update first`);
  }
  const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8'));
  const expected = checksums[DART_GRAMMAR.asset];
  if (!expected) throw new Error(`${DART_GRAMMAR.asset}: no expected checksum recorded`);
  return expected;
}

async function verify(deps = {}) {
  // Dependency injection so tests can assert the digest-comparison orchestration
  // without pulling Docker. Defaults to the real builders.
  const build = deps.buildGrammar ?? buildGrammar;
  const loadExpected = deps.loadExpectedChecksum ?? loadExpectedChecksum;

  console.log('[build-dart-grammar] verify: rebuild to temp dir and compare digest');
  const { wasm } = await build();
  const actual = `sha256:${sha256(wasm)}`;
  const expected = loadExpected();
  if (actual !== expected) {
    throw new Error(
      `digest mismatch — expected ${expected}, got ${actual}. The rebuilt WASM does not ` +
        'match the checked-in digest; the pinned inputs drifted.'
    );
  }
  console.log('[build-dart-grammar] OK — rebuilt WASM matches the checked-in digest');
}

/**
 * Validate the staged asset tree for a Dart-only update: the WASM, LICENSE,
 * checksums.json Dart digest, and the provenance Dart entry must all be
 * present and consistent before the tree is committed.
 */
function validateDartStaged(stagingDir, digest) {
  const assetFile = path.join(stagingDir, DART_GRAMMAR.asset);
  if (!existsSync(assetFile)) throw new Error('staged Dart WASM missing');
  if (sha256(readFileSync(assetFile)) !== digest) throw new Error('staged Dart WASM digest mismatch');

  const licenseFile = path.join(stagingDir, 'licenses', DART_GRAMMAR.licenseFile);
  if (!existsSync(licenseFile)) throw new Error('staged Dart LICENSE missing');

  const checksums = JSON.parse(readFileSync(path.join(stagingDir, 'checksums.json'), 'utf8'));
  if (checksums[DART_GRAMMAR.asset] !== `sha256:${digest}`) {
    throw new Error('staged checksums.json Dart digest mismatch');
  }

  const provenance = JSON.parse(readFileSync(path.join(stagingDir, 'provenance.json'), 'utf8'));
  const entry = provenance.sources.find((s) => s.asset === DART_GRAMMAR.asset);
  if (!entry) throw new Error('staged provenance missing Dart entry');
  if (!/MIT/i.test(entry.license ?? '')) throw new Error('staged Dart provenance license not MIT');
}

async function update() {
  console.log('[build-dart-grammar] update: rebuild and accept new digest');
  const { wasm, license, toolchain } = await buildGrammar();
  const digest = sha256(wasm);

  const plan = {
    [DART_GRAMMAR.asset]: wasm,
    [path.join('licenses', DART_GRAMMAR.licenseFile)]: license,
  };

  // New checksums.json = existing checksums + updated Dart digest.
  if (!existsSync(checksumsPath)) {
    throw new Error(`${checksumsPath} missing — run fetch-grammar-wasms --update first`);
  }
  const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8'));
  checksums[DART_GRAMMAR.asset] = `sha256:${digest}`;
  plan['checksums.json'] = JSON.stringify(checksums, null, 2) + '\n';

  // New provenance.json = existing + refreshed Dart entry.
  if (!existsSync(provenancePath)) {
    throw new Error(`${provenancePath} missing — run fetch-grammar-wasms --update first`);
  }
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const entry = provenance.sources.find((s) => s.asset === DART_GRAMMAR.asset);
  if (!entry) throw new Error(`${DART_GRAMMAR.asset} provenance entry not found`);
  Object.assign(entry, dartProvenanceSource(toolchain));
  plan['provenance.json'] = JSON.stringify(provenance, null, 2) + '\n';

  commitAssetPlan(assetsDir, plan, (stagingDir) => validateDartStaged(stagingDir, digest));
  console.log(`[build-dart-grammar] updated ${DART_GRAMMAR.asset} from ${DART_GRAMMAR.commit}`);
}

export {
  buildGrammar,
  verify,
  update,
  loadExpectedChecksum,
  assertManifest,
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mode = process.argv[2] ?? '--verify';
  if (mode === '--verify') {
    try {
      await verify();
    } catch (error) {
      console.error(`[build-dart-grammar] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else if (mode === '--update') {
    await update();
  } else {
    console.error('usage: node scripts/build-dart-grammar-wasm.mjs [--verify|--update]');
    process.exit(2);
  }
}

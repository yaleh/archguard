#!/usr/bin/env node
/**
 * Reproducible acquisition of pinned Tree-sitter WASM assets.
 *
 * Downloads the pinned npm tarballs for the five grammar packages and the
 * web-tree-sitter runtime, verifies each tarball against the npm integrity
 * hash recorded below (mirroring package-lock.json), extracts the prebuilt
 * `.wasm` grammar/runtime plus LICENSE files into assets/grammars/, and
 * verifies (or, with --update, regenerates) the SHA-256 checksums recorded in
 * assets/grammars/checksums.json.
 *
 * The prebuilt .wasm files are shipped inside the official grammar tarballs,
 * compiled by the grammar maintainers with the matching tree-sitter CLI
 * (ABI compatible with web-tree-sitter 0.25.x). Nothing here depends on
 * node_modules state.
 *
 * The git-built Dart grammar is NOT downloaded by `--update`. A plain
 * `--update` only re-records its checksum if the on-disk blob still matches the
 * previously trusted checksum — it never blesses a drifted or tampered blob.
 * Accepting a new Dart digest requires an explicit, auditable rebuild
 * (`--rebuild-git`, which shells out to build-dart-grammar-wasm --update).
 *
 * All file writes go through a transactional directory commit (see
 * grammar-assets-commit.mjs): the whole asset tree is staged, validated, and
 * swapped into place as one unit, so a failed run never leaves a mixed state.
 *
 * Usage:
 *   node scripts/fetch-grammar-wasms.mjs                  # verify assets + checksums
 *   node scripts/fetch-grammar-wasms.mjs --update         # download + regenerate
 *   node scripts/fetch-grammar-wasms.mjs --update --rebuild-git  # rebuild Dart + regenerate
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DART_GRAMMAR, dartProvenanceSource } from './dart-grammar-source.mjs';
import { commitAssetPlan } from './grammar-assets-commit.mjs';
import { detectHostToolchain } from './host-toolchain.mjs';
import { buildGrammar } from './build-dart-grammar-wasm.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(repoRoot, 'assets', 'grammars');
const licensesDir = path.join(assetsDir, 'licenses');
const checksumsPath = path.join(assetsDir, 'checksums.json');
const provenancePath = path.join(assetsDir, 'provenance.json');

const REGISTRY = 'https://registry.npmjs.org';

/** Pinned sources. Integrity values mirror package-lock.json. */
export const SOURCES = [
  {
    asset: 'tree-sitter.wasm',
    package: 'web-tree-sitter',
    version: '0.25.10',
    integrity: 'sha512-Y09sF44/13XvgVKgO2cNDw5rGk6s26MgoZPXLESvMXeefBf7i6/73eFurre0IsTW6E14Y0ArIzhUMmjoc7xyzA==',
    wasmEntry: 'package/tree-sitter.wasm',
    license: 'MIT',
    role: 'runtime',
  },
  {
    asset: 'tree-sitter-go.wasm',
    package: 'tree-sitter-go',
    version: '0.25.0',
    integrity: 'sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==',
    wasmEntry: 'package/tree-sitter-go.wasm',
    license: 'MIT',
    role: 'grammar',
  },
  {
    asset: 'tree-sitter-java.wasm',
    package: 'tree-sitter-java',
    version: '0.23.5',
    integrity: 'sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==',
    wasmEntry: 'package/tree-sitter-java.wasm',
    license: 'MIT',
    role: 'grammar',
  },
  {
    asset: 'tree-sitter-python.wasm',
    package: 'tree-sitter-python',
    version: '0.25.0',
    integrity: 'sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==',
    wasmEntry: 'package/tree-sitter-python.wasm',
    license: 'MIT',
    role: 'grammar',
  },
  {
    asset: 'tree-sitter-cpp.wasm',
    package: 'tree-sitter-cpp',
    version: '0.23.4',
    integrity: 'sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==',
    wasmEntry: 'package/tree-sitter-cpp.wasm',
    license: 'MIT',
    role: 'grammar',
  },
  {
    asset: 'tree-sitter-kotlin.wasm',
    package: '@tree-sitter-grammars/tree-sitter-kotlin',
    version: '1.1.0',
    integrity: 'sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==',
    wasmEntry: 'package/tree-sitter-kotlin.wasm',
    license: 'MIT',
    role: 'grammar',
  },
  {
    // Dart WASM is rebuilt from git (not the npm tarball): the npm
    // tree-sitter-dart@1.0.0 grammar predates enhanced-enum support (Dart
    // 2.17+). The upstream repo (UserNobody14/tree-sitter-dart) is MIT; the npm
    // `license` field ("ISC") is stale.
    //
    // `gitBuilt` entries are NOT downloaded by `--update`; their pinned inputs
    // live in scripts/dart-grammar-source.mjs (single source of truth shared
    // with build-dart-grammar-wasm.mjs). `--update` recomputes their checksum
    // from the actual blob and emits provenance from that manifest.
    asset: DART_GRAMMAR.asset,
    license: DART_GRAMMAR.license,
    role: 'grammar',
    gitBuilt: true,
  },
];

function tarballUrl(source) {
  const baseName = source.package.split('/').pop();
  return `${REGISTRY}/${source.package}/-/${baseName}-${source.version}.tgz`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function verifyIntegrity(buffer, integrity) {
  const [algo, expected] = integrity.split('-', 2);
  const actual = createHash(algo).update(buffer).digest('base64');
  if (actual !== expected) {
    throw new Error(`tarball integrity mismatch (expected ${integrity}, got ${algo}-${actual})`);
  }
}

/** Minimal tar reader: returns Map<entryName, Buffer> for regular files. */
function readTar(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim(), 8);
    const type = String.fromCharCode(header[156]);
    offset += 512;
    if (type === '0' || type === '\0' || type === '') {
      entries.set(name, buffer.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function loadChecksums(checksumsFile = checksumsPath) {
  if (!existsSync(checksumsFile)) return {};
  return JSON.parse(readFileSync(checksumsFile, 'utf8'));
}

/**
 * Read the hostToolchain previously recorded for a git-built asset, so a plain
 * `--update` (which does not rebuild the WASM) keeps the build env from the last
 * real rebuild instead of overwriting it with the current machine's probe.
 */
function loadExistingHostToolchain(dirs, asset) {
  if (!dirs.provenancePath || !existsSync(dirs.provenancePath)) return undefined;
  try {
    const prov = JSON.parse(readFileSync(dirs.provenancePath, 'utf8'));
    return prov.sources?.find((s) => s.asset === asset)?.hostToolchain;
  } catch {
    return undefined;
  }
}

/**
 * Compute the checksum (from the ACTUAL blob, never a stale recorded value) and
 * the provenance entry for a git-built asset. Throws if the WASM or LICENSE is
 * missing. `dirs` is injectable for tests and defaults to the repo layout;
 * `deps.toolchain` pins an explicit host toolchain (test injection only — the
 * real rebuild path records its own toolchain); without it a plain update
 * preserves the previously recorded toolchain.
 */
export function gitBuiltRecord(source, dirs = { assetsDir, licensesDir }, deps = {}) {
  const assetPath = path.join(dirs.assetsDir, source.asset);
  if (!existsSync(assetPath)) {
    throw new Error(
      `${source.asset}: missing — rebuild with: node scripts/build-dart-grammar-wasm.mjs --update`
    );
  }
  const licensePath = path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile);
  if (!existsSync(licensePath)) {
    throw new Error(
      `${DART_GRAMMAR.licenseFile}: missing — rebuild with: node scripts/build-dart-grammar-wasm.mjs --update`
    );
  }
  const toolchain = deps.toolchain ?? loadExistingHostToolchain(dirs, source.asset);
  return {
    checksum: `sha256:${sha256(readFileSync(assetPath))}`,
    provenance: { asset: source.asset, role: source.role, ...dartProvenanceSource(toolchain) },
  };
}

/**
 * Verify a grammar asset directory against its own checksums.json: every
 * declared WASM asset must be present and match its recorded digest, and no
 * undeclared WASM files may exist. Throws on the first batch of failures.
 */
export function verifyTree(dir) {
  const checksums = loadChecksums(path.join(dir, 'checksums.json'));
  const failures = [];

  for (const source of SOURCES) {
    const assetPath = path.join(dir, source.asset);
    if (!existsSync(assetPath)) {
      failures.push(`${source.asset}: missing (run node scripts/fetch-grammar-wasms.mjs --update)`);
      continue;
    }
    const expected = checksums[source.asset];
    const actual = `sha256:${sha256(readFileSync(assetPath))}`;
    if (!expected) {
      failures.push(`${source.asset}: no checksum recorded`);
    } else if (expected !== actual) {
      failures.push(`${source.asset}: checksum mismatch (expected ${expected}, got ${actual})`);
    }
  }

  for (const file of readdirSync(dir)) {
    if (file.endsWith('.wasm') && !SOURCES.some((s) => s.asset === file)) {
      failures.push(`${file}: untracked WASM asset (not in acquisition manifest)`);
    }
  }

  if (failures.length > 0) {
    throw new Error('verification failed:\n  - ' + failures.join('\n  - '));
  }
}

/**
 * Build the complete set of asset files (relative path → content) for an
 * update WITHOUT touching the target directory. The git-built Dart trust check
 * runs first, before any download, so a drifted blob fails fast with zero
 * writes. `dirs` and `download` are injectable for tests.
 */
export async function buildUpdatePlan({ dirs, download: doDownload, allowNewGitBuiltChecksum, dartBuild, sources = SOURCES }) {
  const plan = {};
  const checksums = {};
  const provenanceSources = [];
  const existingChecksums = loadChecksums(dirs.checksumsPath);

  // Trust check for the git-built Dart asset: a plain update must not bless a
  // tampered/stale blob. Only an explicit rebuild may accept a new digest.
  const dartSource = sources.find((s) => s.gitBuilt);
  console.log(
    `[fetch-grammar-wasms] ${dartSource.asset} (git-built, checksum from blob` +
      (allowNewGitBuiltChecksum ? ' — rebuilt' : '') +
      ')'
  );

  // Determine the Dart WASM + LICENSE + provenance: a freshly built set when
  // --rebuild-git (dartBuild), otherwise the checked-in blob on disk.
  let dartWasm, dartLicense, dartChecksum, dartProvenance;
  if (dartBuild) {
    // P1-2: a fresh build from --rebuild-git. The parent script owns the single
    // transactional commit, so the child never writes to the tree directly.
    dartWasm = dartBuild.wasm;
    dartLicense = dartBuild.license;
    dartChecksum = `sha256:${sha256(dartWasm)}`;
    dartProvenance = {
      asset: dartSource.asset,
      role: dartSource.role,
      ...dartProvenanceSource(dartBuild.toolchain ?? detectHostToolchain()),
    };
  } else {
    const dartRecord = gitBuiltRecord(dartSource, dirs);
    if (!allowNewGitBuiltChecksum) {
      const expected = existingChecksums[dartSource.asset];
      if (!expected) {
        throw new Error(
          `${dartSource.asset}: no recorded checksum — rebuild from the pinned source with ` +
            'node scripts/build-dart-grammar-wasm.mjs --update'
        );
      }
      if (expected !== dartRecord.checksum) {
        throw new Error(
          `${dartSource.asset}: blob checksum drifted (expected ${expected}, got ${dartRecord.checksum}). ` +
            'Refusing to bless a tampered or stale asset with a plain --update; rebuild from the ' +
            'pinned source with --rebuild-git or build-dart-grammar-wasm --update.'
        );
      }
    }
    dartWasm = readFileSync(path.join(dirs.assetsDir, dartSource.asset));
    dartLicense = readFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile));
    dartChecksum = dartRecord.checksum;
    dartProvenance = dartRecord.provenance;
  }
  checksums[dartSource.asset] = dartChecksum;
  provenanceSources.push(dartProvenance);
  plan[dartSource.asset] = dartWasm;
  plan[path.join('licenses', DART_GRAMMAR.licenseFile)] = dartLicense;

  // Download + verify the npm-shipped assets.
  for (const source of sources) {
    if (source.gitBuilt) continue;

    const url = tarballUrl(source);
    console.log(`[fetch-grammar-wasms] ${source.package}@${source.version}`);
    const tarball = await doDownload(url);
    verifyIntegrity(tarball, source.integrity);

    const entries = readTar(gunzipSync(tarball));
    const wasm = entries.get(source.wasmEntry);
    if (!wasm) {
      throw new Error(`${source.wasmEntry} not found in ${url}`);
    }
    plan[source.asset] = wasm;
    checksums[source.asset] = `sha256:${sha256(wasm)}`;

    const licenseEntry = entries.get('package/LICENSE') ?? entries.get('package/LICENSE.md');
    if (!licenseEntry) {
      throw new Error(`LICENSE not found in ${url}`);
    }
    const licenseFile = `${source.asset.replace(/\.wasm$/, '')}.LICENSE`;
    plan[path.join('licenses', licenseFile)] = licenseEntry;

    provenanceSources.push({
      asset: source.asset,
      role: source.role,
      package: source.package,
      version: source.version,
      license: source.license,
      licenseFile: `licenses/${licenseFile}`,
      tarball: url,
      tarballIntegrity: source.integrity,
    });
  }

  plan['checksums.json'] = JSON.stringify(checksums, null, 2) + '\n';
  plan['provenance.json'] =
    JSON.stringify(
      {
        generatedBy: 'scripts/fetch-grammar-wasms.mjs',
        abi: 'tree-sitter ABI 14/15 (web-tree-sitter 0.25.x)',
        sources: provenanceSources,
      },
      null,
      2
    ) + '\n';

  return plan;
}

async function update(options = {}) {
  const dirs = options.dirs ?? { assetsDir, licensesDir, checksumsPath, provenancePath };
  const doDownload = options.download ?? download;
  const allowNewGitBuiltChecksum = options.allowNewGitBuiltChecksum ?? false;
  const buildDartGrammar = options.buildDartGrammar ?? buildGrammar;

  // P1-2: when rebuilding the git-built Dart grammar, build it into memory and
  // merge into the SAME plan as the npm assets, so the whole tree commits (or
  // rolls back) as one unit. The child never commits independently.
  const dartBuild =
    allowNewGitBuiltChecksum && buildDartGrammar !== undefined
      ? await buildDartGrammar()
      : undefined;

  const plan = await buildUpdatePlan({
    dirs,
    download: doDownload,
    allowNewGitBuiltChecksum,
    dartBuild,
  });
  commitAssetPlan(dirs.assetsDir, plan, (stagingDir) => verifyTree(stagingDir));
  console.log(`[fetch-grammar-wasms] wrote ${SOURCES.length} assets + checksums + provenance`);
}

function verify() {
  try {
    verifyTree(assetsDir);
  } catch (error) {
    console.error(`[fetch-grammar-wasms] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`[fetch-grammar-wasms] verified ${SOURCES.length} WASM assets against checksums.json`);
}

export { update, verify };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}

async function main() {
  const mode = process.argv[2];
  const rebuildGit = process.argv.includes('--rebuild-git');
  if (mode === '--update') {
    if (rebuildGit) {
      // P1-2: rebuild the git-built Dart grammar into memory and merge it into
      // the SAME plan as the npm assets, committed atomically by update(). No
      // child-script commit, so a failure anywhere leaves the whole tree
      // untouched.
      console.log('[fetch-grammar-wasms] rebuilding git-built Dart grammar first');
    }
    await update({ allowNewGitBuiltChecksum: rebuildGit });
  } else if (mode === undefined && !rebuildGit) {
    verify();
  } else {
    console.error('usage: node scripts/fetch-grammar-wasms.mjs [--update] [--rebuild-git]');
    process.exit(2);
  }
}

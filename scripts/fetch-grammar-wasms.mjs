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
 * Usage:
 *   node scripts/fetch-grammar-wasms.mjs            # verify assets + checksums
 *   node scripts/fetch-grammar-wasms.mjs --update   # download + regenerate
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(repoRoot, 'assets', 'grammars');
const licensesDir = path.join(assetsDir, 'licenses');
const checksumsPath = path.join(assetsDir, 'checksums.json');
const provenancePath = path.join(assetsDir, 'provenance.json');

const REGISTRY = 'https://registry.npmjs.org';

/** Pinned sources. Integrity values mirror package-lock.json. */
const SOURCES = [
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

function loadChecksums() {
  if (!existsSync(checksumsPath)) return {};
  return JSON.parse(readFileSync(checksumsPath, 'utf8'));
}

async function update() {
  mkdirSync(licensesDir, { recursive: true });
  const checksums = {};
  const provenance = [];

  for (const source of SOURCES) {
    const url = tarballUrl(source);
    console.log(`[fetch-grammar-wasms] ${source.package}@${source.version}`);
    const tarball = await download(url);
    verifyIntegrity(tarball, source.integrity);

    const entries = readTar(gunzipSync(tarball));
    const wasm = entries.get(source.wasmEntry);
    if (!wasm) {
      throw new Error(`${source.wasmEntry} not found in ${url}`);
    }

    writeFileSync(path.join(assetsDir, source.asset), wasm);
    checksums[source.asset] = `sha256:${sha256(wasm)}`;

    const licenseEntry = entries.get('package/LICENSE') ?? entries.get('package/LICENSE.md');
    if (!licenseEntry) {
      throw new Error(`LICENSE not found in ${url}`);
    }
    const licenseFile = `${source.asset.replace(/\.wasm$/, '')}.LICENSE`;
    writeFileSync(path.join(licensesDir, licenseFile), licenseEntry);

    provenance.push({
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

  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n');
  writeFileSync(
    provenancePath,
    JSON.stringify(
      {
        generatedBy: 'scripts/fetch-grammar-wasms.mjs',
        abi: 'tree-sitter ABI 14/15 (web-tree-sitter 0.25.x)',
        sources: provenance,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`[fetch-grammar-wasms] wrote ${SOURCES.length} assets + checksums + provenance`);
}

function verify() {
  const checksums = loadChecksums();
  const failures = [];

  for (const source of SOURCES) {
    const assetPath = path.join(assetsDir, source.asset);
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

  for (const file of readdirSync(assetsDir)) {
    if (file.endsWith('.wasm') && !SOURCES.some((s) => s.asset === file)) {
      failures.push(`${file}: untracked WASM asset (not in acquisition manifest)`);
    }
  }

  if (failures.length > 0) {
    console.error('[fetch-grammar-wasms] verification failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`[fetch-grammar-wasms] verified ${SOURCES.length} WASM assets against checksums.json`);
}

const mode = process.argv[2];
if (mode === '--update') {
  await update();
} else if (mode === undefined) {
  verify();
} else {
  console.error(`usage: node scripts/fetch-grammar-wasms.mjs [--update]`);
  process.exit(2);
}

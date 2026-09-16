/**
 * Unit tests for the fetch-grammar-wasms update trust chain and transactional
 * behavior, using injected `dirs` + `download` so no network or real assets are
 * touched.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { update, buildUpdatePlan, SOURCES } from '../../../scripts/fetch-grammar-wasms.mjs';
import { DART_GRAMMAR } from '../../../scripts/dart-grammar-source.mjs';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function makeDirs(): {
  root: string;
  dirs: { assetsDir: string; licensesDir: string; checksumsPath: string; provenancePath: string };
} {
  const root = mkdtempSync(path.join(os.tmpdir(), 'archguard-fetch-'));
  const assetsDir = path.join(root, 'assets');
  const licensesDir = path.join(assetsDir, 'licenses');
  mkdirSync(licensesDir, { recursive: true });
  return {
    root,
    dirs: {
      assetsDir,
      licensesDir,
      checksumsPath: path.join(assetsDir, 'checksums.json'),
      provenancePath: path.join(assetsDir, 'provenance.json'),
    },
  };
}

const neverDownload = async (): Promise<never> => {
  throw new Error('download should not be reached');
};

describe('fetch-grammar-wasms update — git-built trust chain', () => {
  it('refuses to bless a tampered Dart blob with a plain update and writes nothing', async () => {
    const { root, dirs } = makeDirs();
    const trusted = Buffer.from('trusted-dart-wasm');
    const trustedChecksum = `sha256:${sha256(trusted)}`;

    writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), Buffer.from('tampered'));
    writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');
    writeFileSync(
      dirs.checksumsPath,
      JSON.stringify({ [DART_GRAMMAR.asset]: trustedChecksum }, null, 2) + '\n'
    );
    writeFileSync(dirs.provenancePath, JSON.stringify({ sources: [] }, null, 2) + '\n');

    await expect(
      update({ dirs, download: neverDownload, allowNewGitBuiltChecksum: false })
    ).rejects.toThrow(/drifted/);

    // Zero writes: WASM, license, checksums, and provenance all unchanged.
    expect(readFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), 'utf8')).toBe('tampered');
    expect(readFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'utf8')).toBe('MIT');
    expect(readFileSync(dirs.checksumsPath, 'utf8')).toContain(trustedChecksum);
    expect(readFileSync(dirs.provenancePath, 'utf8')).toBe(
      JSON.stringify({ sources: [] }, null, 2) + '\n'
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('fails fast with zero writes when the Dart LICENSE is missing (manifest generation failure)', async () => {
    const { root, dirs } = makeDirs();
    writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), Buffer.from('x'));
    // No license file written.

    await expect(
      update({ dirs, download: neverDownload, allowNewGitBuiltChecksum: false })
    ).rejects.toThrow(/missing/);

    expect(readFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), 'utf8')).toBe('x');
    // Neither checksums nor provenance were created by the failed run.
    expect(existsSync(dirs.checksumsPath)).toBe(false);
    expect(existsSync(dirs.provenancePath)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves the target unchanged when a download fails', async () => {
    const { root, dirs } = makeDirs();
    const trusted = Buffer.from('trusted-dart-wasm');
    writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), trusted);
    writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');
    writeFileSync(
      dirs.checksumsPath,
      JSON.stringify({ [DART_GRAMMAR.asset]: `sha256:${sha256(trusted)}` }, null, 2) + '\n'
    );

    const before = {
      wasm: readFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), 'utf8'),
      checksums: readFileSync(dirs.checksumsPath, 'utf8'),
    };

    await expect(
      update({
        dirs,
        download: async () => {
          throw new Error('network down');
        },
        allowNewGitBuiltChecksum: false,
      })
    ).rejects.toThrow(/network down/);

    expect(readFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), 'utf8')).toBe(before.wasm);
    expect(readFileSync(dirs.checksumsPath, 'utf8')).toBe(before.checksums);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('fetch-grammar-wasms update — --rebuild-git atomic rebuild', () => {
  it('uses the freshly built Dart WASM + toolchain in the merged plan', async () => {
    const { root, dirs } = makeDirs();
    const oldWasm = Buffer.from('old-dart-wasm');
    writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), oldWasm);
    writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT-old');
    writeFileSync(
      dirs.checksumsPath,
      JSON.stringify({ [DART_GRAMMAR.asset]: `sha256:${sha256(oldWasm)}` }, null, 2) + '\n'
    );
    writeFileSync(dirs.provenancePath, JSON.stringify({ sources: [] }, null, 2) + '\n');

    // Only the git-built source is in scope, so no npm download happens.
    const dartOnlySources = SOURCES.filter((s) => s.gitBuilt);
    const plan = await buildUpdatePlan({
      dirs,
      download: neverDownload,
      allowNewGitBuiltChecksum: true,
      dartBuild: {
        wasm: Buffer.from('freshly-built'),
        license: Buffer.from('MIT'),
        toolchain: { node: 'v22.0.0' },
      },
      sources: dartOnlySources,
    });

    expect(plan[DART_GRAMMAR.asset].toString()).toBe('freshly-built');
    const checksums = JSON.parse(plan['checksums.json']);
    expect(checksums[DART_GRAMMAR.asset]).toBe(`sha256:${sha256(Buffer.from('freshly-built'))}`);
    const provenance = JSON.parse(plan['provenance.json']);
    const dartEntry = provenance.sources.find((s) => s.asset === DART_GRAMMAR.asset);
    expect(dartEntry.hostToolchain).toEqual({ node: 'v22.0.0' });
    rmSync(root, { recursive: true, force: true });
  });

  it('does not commit a freshly built Dart WASM when a later npm download fails', async () => {
    const { root, dirs } = makeDirs();
    const oldWasm = Buffer.from('old-dart-wasm');
    writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), oldWasm);
    writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');
    writeFileSync(
      dirs.checksumsPath,
      JSON.stringify({ [DART_GRAMMAR.asset]: `sha256:${sha256(oldWasm)}` }, null, 2) + '\n'
    );
    writeFileSync(dirs.provenancePath, JSON.stringify({ sources: [] }, null, 2) + '\n');

    const buildDartGrammar = async () => ({
      wasm: Buffer.from('freshly-built'),
      license: Buffer.from('MIT'),
      toolchain: { node: 'v22.0.0' },
    });

    await expect(
      update({
        dirs,
        download: async () => {
          throw new Error('network down');
        },
        allowNewGitBuiltChecksum: true,
        buildDartGrammar,
      })
    ).rejects.toThrow(/network down/);

    // The freshly built WASM must NOT have leaked into the tree.
    expect(readFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), 'utf8')).toBe(
      'old-dart-wasm'
    );
    expect(readFileSync(dirs.checksumsPath, 'utf8')).toContain(`sha256:${sha256(oldWasm)}`);
    rmSync(root, { recursive: true, force: true });
  });
});

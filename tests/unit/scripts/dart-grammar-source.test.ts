/**
 * Unit tests for the shared Dart grammar manifest and the non-mutating verify
 * path of build-dart-grammar-wasm.mjs.
 *
 * verify() accepts injected buildGrammar/loadExpectedChecksum so the digest
 * comparison and non-mutation contract are tested without pulling Docker.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

import {
  verify,
  assertManifest,
  createGrammarWorkDir,
} from '../../../scripts/build-dart-grammar-wasm.mjs';
import { gitBuiltRecord } from '../../../scripts/fetch-grammar-wasms.mjs';
import { dartProvenanceSource, DART_GRAMMAR } from '../../../scripts/dart-grammar-source.mjs';

describe('dart-grammar-source manifest', () => {
  it('exposes a complete provenance fragment including licenseNote', () => {
    const p = dartProvenanceSource();
    expect(p.source).toBe('git');
    expect(p.repository).toBe('https://github.com/UserNobody14/tree-sitter-dart');
    expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(p.commitDate).toBeTruthy();
    expect(p.sourceArchiveUrl).toContain(`/archive/${p.commit}.tar.gz`);
    expect(p.sourceArchiveFormat).toBe('tar.gz');
    expect(p.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.license).toBe('MIT');
    expect(p.licenseFile).toBe(`licenses/${DART_GRAMMAR.licenseFile}`);
    // licenseNote must be preserved — this is the field fetch previously dropped.
    expect(p.licenseNote).toContain('enhanced-enum');
    expect(p.buildTool).toBe('tree-sitter-cli');
    expect(p.buildToolVersion).toBe('0.25.10');
    // P0-1 (B): provenance no longer declares a docker build container. It
    // records the real host toolchain instead, so the trust claim matches the
    // actual artifact.
    expect(p.buildImage).toBeUndefined();
    expect(p.buildImageDigest).toBeUndefined();
    expect(p.buildScript).toBe('scripts/build-dart-grammar-wasm.mjs');
  });

  it('assertManifest accepts the pinned manifest', () => {
    expect(() => assertManifest()).not.toThrow();
  });

  it('provenance records the real host toolchain instead of a docker image', () => {
    const p = dartProvenanceSource({
      node: 'v22.0.0',
      emcc: '4.0.4',
      treeSitterCli: '0.25.10',
    });
    expect(p.hostToolchain).toEqual({ node: 'v22.0.0', emcc: '4.0.4', treeSitterCli: '0.25.10' });
    // No docker-build claim remains in the fragment.
    expect(p.buildImage).toBeUndefined();
    expect(p.buildImageDigest).toBeUndefined();
  });
});

describe('build-dart-grammar-wasm verify (non-mutating)', () => {
  it('succeeds when the rebuilt digest matches the expected digest', async () => {
    const wasm = Buffer.from('fake-wasm-bytes');
    const digest = `sha256:${createHash('sha256').update(wasm).digest('hex')}`;

    await expect(
      verify({
        buildGrammar: async () => ({ wasm, license: Buffer.from('MIT') }),
        loadExpectedChecksum: () => digest,
      })
    ).resolves.toBeUndefined();
  });

  it('fails when the rebuilt digest differs from the expected digest', async () => {
    await expect(
      verify({
        buildGrammar: async () => ({ wasm: Buffer.from('a'), license: Buffer.from('MIT') }),
        loadExpectedChecksum: () =>
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      })
    ).rejects.toThrow(/digest mismatch/);
  });
});

describe('build-dart-grammar-wasm work dir (process-unique)', () => {
  it("creates independent temp dirs and never deletes another process's", () => {
    const a = createGrammarWorkDir();
    const b = createGrammarWorkDir();
    expect(a).not.toBe(b);

    // Both are usable simultaneously; removing one must not affect the other.
    fs.writeFileSync(path.join(a, 'owned-by-a'), 'a');
    fs.writeFileSync(path.join(b, 'owned-by-b'), 'b');
    fs.rmSync(a, { recursive: true, force: true });

    expect(fs.existsSync(b)).toBe(true);
    expect(fs.readFileSync(path.join(b, 'owned-by-b'), 'utf8')).toBe('b');
    fs.rmSync(b, { recursive: true, force: true });
  });
});

describe('fetch-grammar-wasms gitBuiltRecord', () => {
  function makeDirs(): { root: string; assetsDir: string; licensesDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-gitbuilt-'));
    const assetsDir = path.join(root, 'assets');
    const licensesDir = path.join(assetsDir, 'licenses');
    fs.mkdirpSync(licensesDir);
    return { root, assetsDir, licensesDir };
  }

  it('computes checksum from the actual blob and preserves licenseNote', () => {
    const dirs = makeDirs();
    const wasm = Buffer.from('fake-wasm-blob');
    fs.writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), wasm);
    fs.writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');

    const record = gitBuiltRecord({ asset: DART_GRAMMAR.asset, role: 'grammar' }, dirs, {
      toolchain: { node: 'v22.0.0', emcc: '4.0.4', treeSitterCli: '0.25.10' },
    });
    expect(record.checksum).toBe(`sha256:${createHash('sha256').update(wasm).digest('hex')}`);
    expect(record.provenance.licenseNote).toContain('enhanced-enum');
    expect(record.provenance.hostToolchain).toEqual({
      node: 'v22.0.0',
      emcc: '4.0.4',
      treeSitterCli: '0.25.10',
    });
  });

  it('throws when the WASM is missing', () => {
    const dirs = makeDirs();
    fs.writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');
    expect(() => gitBuiltRecord({ asset: DART_GRAMMAR.asset, role: 'grammar' }, dirs)).toThrow(
      /missing/
    );
  });

  it('throws when the LICENSE is missing', () => {
    const dirs = makeDirs();
    fs.writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), Buffer.from('x'));
    expect(() => gitBuiltRecord({ asset: DART_GRAMMAR.asset, role: 'grammar' }, dirs)).toThrow(
      /missing/
    );
  });

  it('preserves an existing hostToolchain when not rebuilding (P0-1)', () => {
    const dirs = makeDirs();
    fs.writeFileSync(path.join(dirs.assetsDir, DART_GRAMMAR.asset), Buffer.from('x'));
    fs.writeFileSync(path.join(dirs.licensesDir, DART_GRAMMAR.licenseFile), 'MIT');
    const priorToolchain = { node: 'v20.1.0', treeSitterCli: '0.25.10' };
    const provenancePath = path.join(dirs.assetsDir, 'provenance.json');
    fs.writeFileSync(
      provenancePath,
      JSON.stringify({ sources: [{ asset: DART_GRAMMAR.asset, hostToolchain: priorToolchain }] })
    );

    // No `deps.toolchain` — a plain `--update` must keep the previously recorded
    // build env, not overwrite it with the current machine's probe.
    const record = gitBuiltRecord(
      { asset: DART_GRAMMAR.asset, role: 'grammar' },
      { ...dirs, provenancePath }
    );
    expect(record.provenance.hostToolchain).toEqual(priorToolchain);
  });
});

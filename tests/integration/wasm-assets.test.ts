/**
 * Integration: WASM grammar assets are reproducible, packaged, and loadable
 * from an installed-package layout independent of process.cwd().
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

const repoRoot = path.resolve(__dirname, '../..');
const assetsDir = path.join(repoRoot, 'assets', 'grammars');

const GRAMMAR_ASSETS = [
  'tree-sitter-go.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-kotlin.wasm',
];
const ALL_ASSETS = ['tree-sitter.wasm', ...GRAMMAR_ASSETS];

describe('WASM asset integrity and provenance', () => {
  it('ships runtime + five grammar WASM files matching recorded SHA-256 checksums', () => {
    const checksums = JSON.parse(readFileSync(path.join(assetsDir, 'checksums.json'), 'utf8'));
    for (const asset of ALL_ASSETS) {
      const assetPath = path.join(assetsDir, asset);
      expect(existsSync(assetPath), `${asset} missing`).toBe(true);
      const digest = `sha256:${createHash('sha256').update(readFileSync(assetPath)).digest('hex')}`;
      expect(digest, `${asset} checksum drifted`).toBe(checksums[asset]);
    }
  });

  it('records provenance and license files for every asset', () => {
    const provenance = JSON.parse(readFileSync(path.join(assetsDir, 'provenance.json'), 'utf8'));
    expect(provenance.sources).toHaveLength(ALL_ASSETS.length);
    for (const source of provenance.sources) {
      expect(ALL_ASSETS).toContain(source.asset);
      expect(source.package).toBeTruthy();
      expect(source.version).toBeTruthy();
      expect(source.license).toBe('MIT');
      expect(source.tarball).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(source.tarballIntegrity).toMatch(/^sha512-/);
      const licensePath = path.join(assetsDir, source.licenseFile);
      expect(existsSync(licensePath), `${source.licenseFile} missing`).toBe(true);
    }
  });

  it('declares web-tree-sitter as a required production dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies['web-tree-sitter']).toBeTruthy();
    expect(pkg.devDependencies?.['web-tree-sitter']).toBeUndefined();
    expect(pkg.peerDependencies?.['web-tree-sitter']).toBeUndefined();
    expect(pkg.optionalDependencies?.['web-tree-sitter']).toBeUndefined();
  });

  it('includes the WASM assets in the packed npm artifact', () => {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const packed = JSON.parse(output);
    const files = new Set(packed[0].files.map((f: { path: string }) => f.path));
    for (const asset of ALL_ASSETS) {
      expect(files.has(`assets/grammars/${asset}`), `${asset} not packed`).toBe(true);
    }
    expect(files.has('assets/grammars/checksums.json')).toBe(true);
    expect(files.has('assets/grammars/provenance.json')).toBe(true);
  }, 60_000);
});

describe('packed-install asset loading (cwd-independent)', () => {
  it('parses all five languages from a simulated installed-package layout', async () => {
    // Simulate <pkg>/assets/grammars as produced by npm install of the packed
    // artifact, then load it with a foreign process.cwd().
    const scratch = mkdtempSync(path.join(tmpdir(), 'archguard-wasm-packed-'));
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'archguard-wasm-cwd-'));
    try {
      const installedAssets = path.join(scratch, 'pkg', 'assets', 'grammars');
      cpSync(assetsDir, installedAssets, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(elsewhere);
      try {
        const backend = new WasmParserBackend({ assetsDir: installedAssets });
        const snippets: Record<string, [string, string]> = {
          go: ['package main\n\nfunc main() {}\n', 'source_file'],
          java: ['class A {}\n', 'program'],
          python: ['def f():\n    pass\n', 'module'],
          cpp: ['int main() { return 0; }\n', 'translation_unit'],
          kotlin: ['fun main() {}\n', 'source_file'],
        };
        for (const [language, [code, rootType]] of Object.entries(snippets)) {
          const session = await backend.createSession(language as never);
          try {
            const tree = session.parse(code);
            try {
              expect(tree.rootNode.type, language).toBe(rootType);
            } finally {
              tree.dispose();
            }
          } finally {
            session.dispose();
          }
        }
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 60_000);
});

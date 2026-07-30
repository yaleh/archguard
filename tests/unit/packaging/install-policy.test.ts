/**
 * Unit: dependency-policy invariants (TASK-41).
 *
 * Every normal npm install of ArchGuard must produce a deterministic,
 * portable WASM baseline: `web-tree-sitter` is a required production
 * dependency, while the native `tree-sitter` runtime and native grammar
 * packages are never installed, built, downloaded, or vendored by ArchGuard
 * itself. They may only appear as OPTIONAL peers (metadata for compatible
 * hosts — npm does not install optional peers) or via an explicitly trusted
 * ARCHGUARD_NATIVE_MODULE_ROOT at runtime.
 *
 * These tests inspect package.json and package-lock.json only — never the
 * live (shared) node_modules.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

const KOTLIN_GRAMMAR = '@tree-sitter-grammars/tree-sitter-kotlin';

const NATIVE_PACKAGES = [
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-cpp',
  '@tree-sitter-grammars/tree-sitter-kotlin',
];

interface PackageJson {
  scripts?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: string[];
  bundledDependencies?: string[];
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  overrides?: Record<string, unknown>;
}

interface Lockfile {
  packages?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peer?: boolean;
      optional?: boolean;
      dev?: boolean;
    }
  >;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as PackageJson;
}

function readLockfile(): Lockfile {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as Lockfile;
}

describe('package.json dependency policy', () => {
  it('requires web-tree-sitter as a production dependency (guaranteed WASM baseline)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.['web-tree-sitter']).toBeTruthy();
  });

  it('ships the vendored grammar WASM assets in the published files', () => {
    const pkg = readPackageJson();
    expect(pkg.files).toContain('assets/grammars/');
  });

  it('keeps native tree-sitter packages out of dependencies and optionalDependencies', () => {
    const pkg = readPackageJson();
    for (const name of NATIVE_PACKAGES) {
      expect(pkg.dependencies?.[name], `${name} must not be a dependency`).toBeUndefined();
      expect(
        pkg.optionalDependencies?.[name],
        `${name} must not be an optionalDependency (npm installs those when possible)`
      ).toBeUndefined();
    }
  });

  it('does not bundle or vendor native tree-sitter packages', () => {
    const pkg = readPackageJson();
    const bundled = [...(pkg.bundleDependencies ?? []), ...(pkg.bundledDependencies ?? [])];
    for (const name of NATIVE_PACKAGES) {
      expect(bundled, `${name} must not be bundleDependencies`).not.toContain(name);
    }
  });

  it('declares native tree-sitter packages only as optional peers', () => {
    const pkg = readPackageJson();
    for (const name of NATIVE_PACKAGES) {
      if (name === KOTLIN_GRAMMAR) continue; // see the kotlin-specific test below
      expect(pkg.peerDependencies?.[name], `${name} should be a peer`).toBeTruthy();
      expect(
        pkg.peerDependenciesMeta?.[name]?.optional,
        `${name} peer must be marked optional so npm never installs it`
      ).toBe(true);
    }
  });

  it('does not declare the kotlin grammar as a peer (its stale tree-sitter peer breaks installs)', () => {
    // @tree-sitter-grammars/tree-sitter-kotlin@1.1.0 declares
    // peerOptional tree-sitter@"^0.22.4", which conflicts with our
    // tree-sitter@"^0.25.0" peer. npm 11 resolves that conflict between two
    // optional peers with a hard ERESOLVE failure for the CONSUMER's install
    // (verified by tests/integration/install-policy.test.ts). The grammar is
    // therefore documented for explicit host installation instead of being
    // declared as an optional peer.
    const pkg = readPackageJson();
    expect(pkg.peerDependencies?.[KOTLIN_GRAMMAR]).toBeUndefined();
    expect(pkg.peerDependenciesMeta?.[KOTLIN_GRAMMAR]).toBeUndefined();
  });

  it('has no install lifecycle scripts that could build or fetch native tree-sitter', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts ?? {};
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      expect(scripts[hook], `unexpected "${hook}" lifecycle script`).toBeUndefined();
    }
    // Native staging ran via prepack; packing must be hook-free too.
    expect(scripts.prepack, 'unexpected "prepack" native staging hook').toBeUndefined();
  });

  it('has no script referencing the removed native staging scripts', () => {
    const pkg = readPackageJson();
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      expect(command, `script "${name}" references native staging`).not.toMatch(
        /postinstall-tree-sitter|stage-tree-sitter/
      );
    }
  });

  it('does not pin native tree-sitter through overrides', () => {
    const pkg = readPackageJson();
    expect(pkg.overrides?.['tree-sitter']).toBeUndefined();
  });

  it('does not publish the removed native staging scripts', () => {
    const pkg = readPackageJson();
    for (const file of pkg.files ?? []) {
      expect(file).not.toMatch(/postinstall-tree-sitter|stage-tree-sitter/);
    }
  });
});

describe('removed native staging scripts', () => {
  it('scripts/postinstall-tree-sitter.mjs no longer exists', () => {
    expect(existsSync(path.join(repoRoot, 'scripts', 'postinstall-tree-sitter.mjs'))).toBe(false);
  });

  it('scripts/stage-tree-sitter-prebuild.mjs no longer exists', () => {
    expect(existsSync(path.join(repoRoot, 'scripts', 'stage-tree-sitter-prebuild.mjs'))).toBe(
      false
    );
  });
});

describe('package-lock.json dependency policy', () => {
  it('root package requires no native tree-sitter packages', () => {
    const lock = readLockfile();
    const root = lock.packages?.[''];
    expect(root).toBeDefined();
    for (const name of NATIVE_PACKAGES) {
      expect(root?.dependencies?.[name], `lockfile root must not require ${name}`).toBeUndefined();
      expect(
        root?.optionalDependencies?.[name],
        `lockfile root must not optionally require ${name}`
      ).toBeUndefined();
    }
  });

  it('contains no non-optional package entries for native tree-sitter packages', () => {
    const lock = readLockfile();
    for (const name of NATIVE_PACKAGES) {
      const entry = lock.packages?.[`node_modules/${name}`];
      if (entry === undefined) continue; // fully absent: ideal
      // If npm records an entry at all, it must be an optional peer placeholder —
      // never something a clean production install would materialize.
      expect(
        entry.peer === true && entry.optional === true,
        `lockfile entry for ${name} must be an optional peer (got ${JSON.stringify(entry)})`
      ).toBe(true);
    }
  });

  it('still locks web-tree-sitter as a production dependency', () => {
    const lock = readLockfile();
    const root = lock.packages?.[''];
    expect(root?.dependencies?.['web-tree-sitter']).toBeTruthy();
    const entry = lock.packages?.['node_modules/web-tree-sitter'];
    expect(entry, 'web-tree-sitter must be present in the lock tree').toBeDefined();
    expect(entry?.dev, 'web-tree-sitter must not be dev-only').not.toBe(true);
  });
});

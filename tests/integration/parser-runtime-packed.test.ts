/**
 * Integration: packed-install runtime selection (TASK-39 DoD).
 *
 * Packs ArchGuard into a tarball, extracts it into a temp dir, and simulates
 * two install layouts:
 *
 * 1. WASM-only install: the extracted package's node_modules overlay contains
 *    every runtime dependency EXCEPT the native tree-sitter packages (and the
 *    tarball's bundled tree-sitter copy is removed). The default `auto`
 *    policy must fall back to WASM per language and still parse all language
 *    fixtures — byte-identical ArchJSON to the in-repo WASM backend.
 *
 * 2. Trusted native fixture: same WASM-only package, but with
 *    ARCHGUARD_NATIVE_MODULE_ROOT pointing at an explicitly trusted module
 *    root containing the native packages. `auto` must select native and
 *    produce ArchJSON identical to the in-repo native backend.
 *
 * Native bindings are never mutated: the "missing native" condition comes
 * from the overlay layout, not from touching node_modules contents.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';
import type { ParserBackend, ParserLanguage } from '@/plugins/shared/parser-backend.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { PythonPlugin } from '@/plugins/python/index.js';
import { CppPlugin } from '@/plugins/cpp/index.js';
import { KotlinPlugin } from '@/plugins/kotlin/index.js';

const repoRoot = path.resolve(__dirname, '../..');
const FIXTURES = path.join(repoRoot, 'tests', 'fixtures');
const WASM_PARITY_FIXTURES = path.join(repoRoot, 'tests', 'plugins', 'wasm-parity', 'fixtures');

const CASES: Array<{ language: ParserLanguage; filePath: string }> = [
  { language: 'go', filePath: path.join(FIXTURES, 'go/sample.go') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/simple-class.java') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/simple-class.py') },
  { language: 'cpp', filePath: path.join(WASM_PARITY_FIXTURES, 'sample.cpp') },
  { language: 'kotlin', filePath: path.join(WASM_PARITY_FIXTURES, 'sample.kt') },
];

const NATIVE_PACKAGES = [
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-cpp',
  '@tree-sitter-grammars/tree-sitter-kotlin',
];

const DRIVER = `
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [pkgDir, fixturesRoot, wasmFixtures] = process.argv.slice(2);
const runtime = await import(path.join(pkgDir, 'dist/plugins/shared/parser-runtime.js'));

const cases = [
  { language: 'go', filePath: path.join(fixturesRoot, 'go/sample.go') },
  { language: 'java', filePath: path.join(fixturesRoot, 'java/simple-class.java') },
  { language: 'python', filePath: path.join(fixturesRoot, 'python/simple-class.py') },
  { language: 'cpp', filePath: path.join(wasmFixtures, 'sample.cpp') },
  { language: 'kotlin', filePath: path.join(wasmFixtures, 'sample.kt') },
];
const pluginModules = {
  go: ['dist/plugins/golang/index.js', 'GoPlugin'],
  java: ['dist/plugins/java/index.js', 'JavaPlugin'],
  python: ['dist/plugins/python/index.js', 'PythonPlugin'],
  cpp: ['dist/plugins/cpp/index.js', 'CppPlugin'],
  kotlin: ['dist/plugins/kotlin/index.js', 'KotlinPlugin'],
};

const results = {};
for (const c of cases) {
  const selection = await runtime.selectParserBackendFor(c.language);
  const [modPath, exportName] = pluginModules[c.language];
  const mod = await import(path.join(pkgDir, modPath));
  const plugin = new mod[exportName](selection.backend);
  await plugin.initialize({ workspaceRoot: path.dirname(c.filePath) });
  const code = readFileSync(c.filePath, 'utf8');
  const archjson = plugin.parseCode(code, c.filePath);
  await plugin.dispose?.();
  results[c.language] = {
    runtime: selection.runtime,
    fallbackReason: selection.fallbackReason ?? null,
    archjson: JSON.stringify(archjson).replaceAll(/"timestamp":"[^"]*"/g, '"timestamp":"<normalized>"'),
  };
}
console.log('@@RESULT@@' + JSON.stringify(results));
`;

interface DriverResult {
  runtime: 'native' | 'wasm';
  fallbackReason: string | null;
  archjson: string;
}

let workDir: string;
let pkgDir: string;
let trustedRoot: string;

function normalize(archjson: unknown): string {
  return JSON.stringify(archjson).replaceAll(/"timestamp":"[^"]*"/g, '"timestamp":"<normalized>"');
}

function pluginFor(language: ParserLanguage, backend: ParserBackend) {
  switch (language) {
    case 'go':
      return new GoPlugin(backend);
    case 'java':
      return new JavaPlugin(backend);
    case 'python':
      return new PythonPlugin(backend);
    case 'cpp':
      return new CppPlugin(backend);
    case 'kotlin':
      return new KotlinPlugin(backend);
  }
}

/** Expected ArchJSON computed in-process with the given backend. */
async function expectedArchJson(backend: ParserBackend): Promise<Record<ParserLanguage, string>> {
  const result = {} as Record<ParserLanguage, string>;
  for (const { language, filePath } of CASES) {
    const plugin = pluginFor(language, backend);
    await plugin.initialize({ workspaceRoot: path.dirname(filePath) } as never);
    try {
      const code = readFileSync(filePath, 'utf8');
      result[language] = normalize(plugin.parseCode(code, filePath));
    } finally {
      await plugin.dispose?.();
    }
  }
  return result;
}

/** Symlink every repo dependency except native tree-sitter packages into dir. */
function buildWasmOnlyOverlay(modulesDir: string): void {
  mkdirSync(modulesDir, { recursive: true });
  const repoModules = realpathSync(path.join(repoRoot, 'node_modules'));
  for (const entry of readdirSync(repoModules)) {
    if (entry.startsWith('.')) continue;
    if (entry === 'tree-sitter' || entry.startsWith('tree-sitter-')) continue;
    if (entry === '@tree-sitter-grammars') continue;
    symlinkSync(path.join(repoModules, entry), path.join(modulesDir, entry));
  }
}

function buildTrustedNativeRoot(root: string): void {
  const modulesDir = path.join(root, 'node_modules');
  mkdirSync(modulesDir, { recursive: true });
  const repoModules = realpathSync(path.join(repoRoot, 'node_modules'));
  for (const pkg of NATIVE_PACKAGES) {
    const source = path.join(repoModules, pkg);
    const target = path.join(modulesDir, pkg);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(source, target);
  }
}

function runDriver(nativeModuleRoot?: string): Record<ParserLanguage, DriverResult> {
  const driverPath = path.join(workDir, 'driver.mjs');
  writeFileSync(driverPath, DRIVER);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ARCHGUARD_PARSER_RUNTIME;
  delete env.ARCHGUARD_PARSER_BACKEND;
  delete env.ARCHGUARD_NATIVE_MODULE_ROOT;
  if (nativeModuleRoot) env.ARCHGUARD_NATIVE_MODULE_ROOT = nativeModuleRoot;
  const stdout = execFileSync(
    process.execPath,
    [driverPath, pkgDir, FIXTURES, WASM_PARITY_FIXTURES],
    { env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }
  ).toString('utf8');
  const marker = stdout.lastIndexOf('@@RESULT@@');
  expect(marker, `driver did not emit a result.\nstdout:\n${stdout.slice(-2000)}`).not.toBe(-1);
  return JSON.parse(stdout.slice(marker + '@@RESULT@@'.length).trim());
}

beforeAll(() => {
  // The packed artifact ships dist/: build once if the gate runs vitest alone.
  if (!existsSync(path.join(repoRoot, 'dist', 'cli', 'index.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe', timeout: 280_000 });
  }

  workDir = mkdtempSync(path.join(tmpdir(), 'archguard-packed-'));
  const packOut = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', workDir], {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 120_000,
  }).toString('utf8');
  const tgz = packOut
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .pop();
  expect(tgz, `npm pack did not produce a tarball:\n${packOut}`).toBeTruthy();

  execFileSync('tar', ['-xzf', path.join(workDir, tgz), '-C', workDir], {
    timeout: 120_000,
  });
  pkgDir = path.join(workDir, 'package');

  // WASM-only install: drop the tarball's bundled tree-sitter copy
  // (bundleDependencies), then overlay every other runtime dependency.
  rmSync(path.join(pkgDir, 'node_modules'), { recursive: true, force: true });
  buildWasmOnlyOverlay(path.join(pkgDir, 'node_modules'));

  // Trusted native fixture: explicit external module root with native packages.
  trustedRoot = path.join(workDir, 'trusted-native');
  buildTrustedNativeRoot(trustedRoot);
}, 300_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('packed WASM-only install', () => {
  it('ships the WASM assets and no usable native addons', () => {
    expect(existsSync(path.join(pkgDir, 'assets', 'grammars', 'tree-sitter.wasm'))).toBe(true);
    for (const pkg of NATIVE_PACKAGES) {
      expect(existsSync(path.join(pkgDir, 'node_modules', pkg)), `${pkg} leaked`).toBe(false);
    }
  });

  it('falls back to WASM per language in auto mode and passes all language parses', async () => {
    const expected = await expectedArchJson(wasmParserBackend);
    const results = runDriver();
    for (const { language } of CASES) {
      const result = results[language];
      expect(result, `${language} result missing`).toBeDefined();
      expect(result.runtime, `${language} runtime`).toBe('wasm');
      expect(result.fallbackReason, `${language} should record a fallback reason`).toBeTruthy();
      expect(result.archjson, `${language} ArchJSON must match the WASM baseline`).toBe(
        expected[language]
      );
    }
  }, 240_000);
});

describe('packed install with trusted native module root', () => {
  it('selects native per language in auto mode and passes all language parses', async () => {
    const expected = await expectedArchJson(nativeParserBackend);
    const results = runDriver(trustedRoot);
    for (const { language } of CASES) {
      const result = results[language];
      expect(result, `${language} result missing`).toBeDefined();
      expect(result.runtime, `${language} runtime`).toBe('native');
      expect(result.fallbackReason, `${language} should not fall back`).toBeNull();
      expect(result.archjson, `${language} ArchJSON must match the native baseline`).toBe(
        expected[language]
      );
    }
  }, 240_000);
});

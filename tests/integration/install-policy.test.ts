/**
 * Integration: clean-room install policy (TASK-41 DoD).
 *
 * Packs ArchGuard into a tarball and performs a REAL `npm install` of that
 * tarball into an isolated temp project with its own node_modules — the same
 * artifact and code path a normal `npm install @yalehwang/archguard` (or a
 * Claude npm-source plugin install) exercises. The full lifecycle-script
 * output and the installed dependency tree are recorded as evidence artifacts.
 *
 * Assertions:
 *
 * 1. The clean production dependency tree contains `web-tree-sitter` and NO
 *    native tree-sitter runtime or grammar packages — the optional peer
 *    metadata neither installs the peers nor emits required-peer failures.
 * 2. No install/preinstall/postinstall/prepack lifecycle script attempts to
 *    build or fetch native tree-sitter (log audit).
 * 3. The clean installed package analyzes Go, Java, Python, C++, and Kotlin
 *    through WASM (byte-identical ArchJSON to the in-repo WASM baseline).
 * 4. Native injection: ARCHGUARD_NATIVE_MODULE_ROOT pointing at an explicitly
 *    trusted module root selects native — ArchGuard itself never installed it
 *    (byte-identical ArchJSON to the in-repo native baseline).
 * 5. Analyzed-project isolation: native packages placed only in the analyzed
 *    project's node_modules are ignored even when the entry script runs from
 *    inside that project.
 *
 * The worktree's shared node_modules is never mutated: the clean room gets its
 * own node_modules from the registry; trusted/injected native packages are
 * symlinks into the repo's existing modules.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

/** Matches installed native tree-sitter entries in `npm ls` output (not web-tree-sitter). */
const NATIVE_TREE_LINE = /(?<!web-)tree-sitter@|tree-sitter-(go|java|python|cpp|kotlin)@/;

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
let installDir: string;
let pkgDir: string;
let trustedRoot: string;
let analyzedProject: string;
let installLog: string;
let depTree: string;

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

/** Explicitly trusted external module root containing the native packages. */
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

/**
 * A fake "project being analyzed": it has native tree-sitter packages in its
 * own node_modules, which auto mode must never load.
 */
function buildAnalyzedProject(root: string): void {
  buildTrustedNativeRoot(root); // same layout: <root>/node_modules/<native pkgs>
  mkdirSync(path.join(root, 'src'), { recursive: true });
}

function runDriver(options: {
  nativeModuleRoot?: string;
  cwd?: string;
  driverDir?: string;
}): Record<ParserLanguage, DriverResult> {
  const driverDir = options.driverDir ?? workDir;
  const driverPath = path.join(driverDir, 'driver.mjs');
  writeFileSync(driverPath, DRIVER);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ARCHGUARD_PARSER_RUNTIME;
  delete env.ARCHGUARD_PARSER_BACKEND;
  delete env.ARCHGUARD_NATIVE_MODULE_ROOT;
  if (options.nativeModuleRoot) env.ARCHGUARD_NATIVE_MODULE_ROOT = options.nativeModuleRoot;
  const stdout = execFileSync(
    process.execPath,
    [driverPath, pkgDir, FIXTURES, WASM_PARITY_FIXTURES],
    {
      env,
      cwd: options.cwd ?? installDir,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    }
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

  workDir = mkdtempSync(path.join(tmpdir(), 'archguard-clean-room-'));
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

  // Real clean-room install: isolated project, own node_modules, production
  // dependencies resolved from the registry. --foreground-scripts surfaces any
  // lifecycle-script output so it can be audited.
  installDir = path.join(workDir, 'install');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    path.join(installDir, 'package.json'),
    JSON.stringify({ name: 'archguard-clean-room', private: true, version: '0.0.0' })
  );
  let installStdout = '';
  let installStderr = '';
  try {
    installStdout = execFileSync(
      'npm',
      [
        'install',
        path.join(workDir, tgz),
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--foreground-scripts',
      ],
      { cwd: installDir, stdio: 'pipe', timeout: 480_000, maxBuffer: 64 * 1024 * 1024 }
    ).toString('utf8');
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
    installStdout = err.stdout?.toString('utf8') ?? '';
    installStderr = err.stderr?.toString('utf8') ?? '';
    writeFileSync(
      path.join(workDir, 'install-log.txt'),
      `STDOUT\n======\n${installStdout}\n\nSTDERR\n======\n${installStderr}\n`
    );
    throw new Error(
      `clean-room npm install failed (see install-log.txt):\n${err.message}\n${installStderr.slice(-2000)}`
    );
  }
  installLog = `STDOUT\n======\n${installStdout}\n\nSTDERR\n======\n${installStderr}\n`;
  writeFileSync(path.join(workDir, 'install-log.txt'), installLog);

  // Record the installed dependency tree as evidence.
  depTree = execFileSync('npm', ['ls', '--all', '--omit=dev'], {
    cwd: installDir,
    stdio: 'pipe',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  writeFileSync(path.join(workDir, 'dep-tree.txt'), depTree);

  pkgDir = path.join(installDir, 'node_modules', '@yalehwang', 'archguard');
  expect(existsSync(path.join(pkgDir, 'dist', 'plugins', 'shared', 'parser-runtime.js'))).toBe(
    true
  );

  // Trusted external module root (native packages ArchGuard never installed).
  trustedRoot = path.join(workDir, 'trusted-native');
  buildTrustedNativeRoot(trustedRoot);

  // Fake analyzed project containing native packages in its own node_modules.
  analyzedProject = path.join(workDir, 'analyzed-project');
  buildAnalyzedProject(analyzedProject);
}, 600_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('clean-room npm install: dependency tree', () => {
  it('installs web-tree-sitter (guaranteed WASM baseline)', () => {
    expect(existsSync(path.join(installDir, 'node_modules', 'web-tree-sitter'))).toBe(true);
    expect(depTree).toMatch(/web-tree-sitter@/);
  });

  it('installs no native tree-sitter runtime or grammar packages', () => {
    for (const pkg of NATIVE_PACKAGES) {
      expect(
        existsSync(path.join(installDir, 'node_modules', pkg)),
        `${pkg} must not be installed`
      ).toBe(false);
    }
    const nativeLines = depTree.split('\n').filter((line) => NATIVE_TREE_LINE.test(line));
    // Optional peers may appear in `npm ls` output as unmet-optional metadata;
    // they must never materialize as installed packages.
    const installed = nativeLines.filter((line) => !line.includes('UNMET OPTIONAL DEPENDENCY'));
    expect(installed, `native packages in dep tree:\n${installed.join('\n')}`).toEqual([]);
  });

  it('ships the grammar WASM assets in the installed package', () => {
    expect(existsSync(path.join(pkgDir, 'assets', 'grammars', 'tree-sitter.wasm'))).toBe(true);
    for (const lang of ['go', 'java', 'python', 'cpp', 'kotlin']) {
      expect(existsSync(path.join(pkgDir, 'assets', 'grammars', `tree-sitter-${lang}.wasm`))).toBe(
        true
      );
    }
  });
});

describe('clean-room npm install: lifecycle audit', () => {
  it('records no native tree-sitter build or fetch attempts', () => {
    expect(installLog).not.toMatch(/node-gyp/i);
    expect(installLog).not.toMatch(/prebuild-install/i);
    expect(installLog).not.toMatch(/postinstall-tree-sitter|stage-tree-sitter/i);
    expect(installLog).not.toMatch(/tree_sitter_runtime_binding/i);
  });

  it('emits no required-peer or resolution failures for the optional native peers', () => {
    expect(installLog).not.toMatch(/ERESOLVE/);
    const peerComplaints = installLog
      .split('\n')
      .filter((line) => /peer/i.test(line) && NATIVE_TREE_LINE.test(line));
    expect(peerComplaints).toEqual([]);
  });
});

describe('clean-room install: WASM baseline analysis', () => {
  it('analyzes Go, Java, Python, C++, and Kotlin through WASM in auto mode', async () => {
    const expected = await expectedArchJson(wasmParserBackend);
    const results = runDriver({});
    for (const { language } of CASES) {
      const result = results[language];
      expect(result, `${language} result missing`).toBeDefined();
      expect(result.runtime, `${language} runtime`).toBe('wasm');
      expect(result.fallbackReason, `${language} should record a fallback reason`).toBeTruthy();
      expect(result.archjson, `${language} ArchJSON must match the WASM baseline`).toBe(
        expected[language]
      );
    }
  }, 300_000);
});

describe('clean-room install: native injection via trusted module root', () => {
  it('selects native for every language without ArchGuard having installed it', async () => {
    const expected = await expectedArchJson(nativeParserBackend);
    const results = runDriver({ nativeModuleRoot: trustedRoot });
    for (const { language } of CASES) {
      const result = results[language];
      expect(result, `${language} result missing`).toBeDefined();
      expect(result.runtime, `${language} runtime`).toBe('native');
      expect(result.fallbackReason, `${language} should not fall back`).toBeNull();
      expect(result.archjson, `${language} ArchJSON must match the native baseline`).toBe(
        expected[language]
      );
    }
  }, 300_000);
});

describe('clean-room install: analyzed-project isolation', () => {
  it('ignores native packages placed only in the analyzed project', async () => {
    const expected = await expectedArchJson(wasmParserBackend);
    // Entry script lives INSIDE the analyzed project, and cwd is the analyzed
    // project: even then, native packages in its node_modules must be ignored.
    const results = runDriver({ cwd: analyzedProject, driverDir: analyzedProject });
    for (const { language } of CASES) {
      const result = results[language];
      expect(result, `${language} result missing`).toBeDefined();
      expect(result.runtime, `${language} runtime`).toBe('wasm');
      expect(result.fallbackReason, `${language} should record a fallback reason`).toBeTruthy();
      expect(result.archjson, `${language} ArchJSON must match the WASM baseline`).toBe(
        expected[language]
      );
    }
  }, 300_000);
});

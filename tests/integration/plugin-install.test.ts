/**
 * Integration: npm Claude plugin install — simulated Claude plugin cache (TASK-31).
 *
 * Simulates the Claude Code npm-source plugin install end to end without
 * publishing anything to the npm registry:
 *
 * 1. `npm pack` the core package (@yalehwang/archguard) and the plugin package
 *    (@yalehwang/archguard-claude-plugin) into tarballs — the real artifacts.
 * 2. Install the PLUGIN tarball into an isolated prefix (the simulated plugin
 *    cache) with a REAL `npm install`. The plugin depends on the exact core
 *    version; an npm `overrides` entry in the throwaway prefix root redirects
 *    that one package to the local core tarball, simulating registry
 *    availability. Everything else (commander, MCP SDK, web-tree-sitter,
 *    sharp platform packages, ...) resolves through the normal npm path —
 *    this is the dependency-closure proof the directory-source prototype
 *    failed (ERR_MODULE_NOT_FOUND: commander).
 * 3. Assert the installed closure: web-tree-sitter + bundled grammar WASM
 *    assets present; native tree-sitter runtime/grammars absent; no native
 *    build/fetch lifecycle output.
 * 4. Launch the plugin's MCP launcher from the simulated cache with cwd
 *    OUTSIDE the repo and the install prefix (no repository node_modules
 *    reachable) and perform a REAL MCP handshake + tools/list over stdio.
 * 5. sharp laziness at runtime: physically remove sharp (and its @img/*
 *    platform packages) from the installed closure and repeat the handshake —
 *    query-only startup must not need it.
 * 6. Analyze a Go fixture through the plugin-installed closure with the WASM
 *    runtime forced, proving the installed package analyzes end to end.
 *
 * What is simulated vs real: the ONLY simulation is the npm `overrides`
 * redirect standing in for the published registry package, and the temp
 * prefix standing in for ~/.claude/plugins/cache. The packing, npm install,
 * dependency resolution, MCP launch, and protocol handshake are all real.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(__dirname, '../..');
const pluginSrcDir = path.join(repoRoot, 'plugin');
const FIXTURES = path.join(repoRoot, 'tests', 'fixtures');
const WASM_PARITY_FIXTURES = path.join(repoRoot, 'tests', 'plugins', 'wasm-parity', 'fixtures');

const LANGUAGE_CASES: Array<{ language: string; source: string }> = [
  { language: 'go', source: path.join(FIXTURES, 'go') },
  { language: 'java', source: path.join(FIXTURES, 'java') },
  { language: 'python', source: path.join(FIXTURES, 'python') },
  { language: 'cpp', source: path.join(WASM_PARITY_FIXTURES, 'sample.cpp') },
  { language: 'kotlin', source: path.join(WASM_PARITY_FIXTURES, 'sample.kt') },
];

const NATIVE_PACKAGES = [
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-cpp',
  '@tree-sitter-grammars/tree-sitter-kotlin',
];

let workDir: string;
let installDir: string;
let elsewhereDir: string;
let installLog: string;
let coreTgz: string;
let pluginTgz: string;

function npmPack(cwd: string, dest: string): string {
  const out = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', dest], {
    cwd,
    stdio: 'pipe',
    timeout: 120_000,
  }).toString('utf8');
  const tgz = out
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .pop();
  expect(tgz, `npm pack did not produce a tarball in ${cwd}:\n${out}`).toBeTruthy();
  return path.join(dest, tgz);
}

function pluginPkgDir(): string {
  return path.join(installDir, 'node_modules', '@yalehwang', 'archguard-claude-plugin');
}

function corePkgDir(): string {
  return path.join(installDir, 'node_modules', '@yalehwang', 'archguard');
}

/** Minimal env for the MCP child: no NODE_PATH, no ARCHGUARD_*, no repo paths. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'NODE_PATH') continue;
    if (key.startsWith('ARCHGUARD_')) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** Perform a real MCP handshake + tools/list against the plugin launcher. */
async function mcpHandshake(): Promise<string[]> {
  const launcher = path.join(pluginPkgDir(), 'mcp-launcher.mjs');
  expect(existsSync(launcher), 'installed plugin launcher missing').toBe(true);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher],
    cwd: elsewhereDir,
    env: childEnv(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'task31-plugin-install-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await client.close().catch(() => undefined);
  }
}

beforeAll(() => {
  // The packed artifacts ship dist/: build once if the gate runs vitest alone.
  if (!existsSync(path.join(repoRoot, 'dist', 'cli', 'index.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe', timeout: 280_000 });
  }

  workDir = mkdtempSync(path.join(tmpdir(), 'archguard-plugin-cache-'));
  coreTgz = npmPack(repoRoot, workDir);
  pluginTgz = npmPack(pluginSrcDir, workDir);

  // Simulated Claude plugin cache: Claude Code runs `npm install <plugin>`
  // here for npm-source marketplace entries. The overrides entry redirects
  // the plugin's exact-version @yalehwang/archguard dependency to the local
  // core tarball — the stand-in for the published registry package.
  installDir = path.join(workDir, 'cache');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    path.join(installDir, 'package.json'),
    JSON.stringify({
      name: 'claude-plugin-cache-simulation',
      private: true,
      version: '0.0.0',
      overrides: { '@yalehwang/archguard': `file:${coreTgz}` },
    })
  );

  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(
      'npm',
      ['install', pluginTgz, '--omit=dev', '--no-audit', '--no-fund', '--foreground-scripts'],
      { cwd: installDir, stdio: 'pipe', timeout: 480_000, maxBuffer: 64 * 1024 * 1024 }
    ).toString('utf8');
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
    stdout = err.stdout?.toString('utf8') ?? '';
    stderr = err.stderr?.toString('utf8') ?? '';
    installLog = `STDOUT\n======\n${stdout}\n\nSTDERR\n======\n${stderr}\n`;
    writeFileSync(path.join(workDir, 'install-log.txt'), installLog);
    throw new Error(
      `simulated plugin-cache npm install failed (see install-log.txt):\n${err.message}\n${stderr.slice(-2000)}`
    );
  }
  installLog = `STDOUT\n======\n${stdout}\n\nSTDERR\n======\n${stderr}\n`;
  writeFileSync(path.join(workDir, 'install-log.txt'), installLog);

  // A cwd with no node_modules and no relationship to the repo or prefix.
  elsewhereDir = path.join(workDir, 'elsewhere');
  mkdirSync(elsewhereDir, { recursive: true });
}, 600_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('plugin tarball contents', () => {
  it('installs the plugin manifests, MCP config, launcher, and skills', () => {
    const pkgDir = pluginPkgDir();
    expect(existsSync(path.join(pkgDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(path.join(pkgDir, '.mcp.json'))).toBe(true);
    expect(existsSync(path.join(pkgDir, 'mcp-launcher.mjs'))).toBe(true);
    expect(existsSync(path.join(pkgDir, 'skills', 'feature-developer', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(pkgDir, 'skills', 'project-semantics-discovery', 'SKILL.md'))).toBe(
      true
    );
  });

  it('does not vendor dist/ or node_modules/ inside the plugin package', () => {
    const pkgDir = pluginPkgDir();
    expect(existsSync(path.join(pkgDir, 'dist'))).toBe(false);
    expect(existsSync(path.join(pkgDir, 'node_modules'))).toBe(false);
  });
});

describe('npm-resolved runtime dependency closure', () => {
  it('installs @yalehwang/archguard with the CLI entry and grammar WASM assets', () => {
    const pkgDir = corePkgDir();
    expect(existsSync(path.join(pkgDir, 'dist', 'cli', 'index.js'))).toBe(true);
    expect(existsSync(path.join(pkgDir, 'assets', 'grammars', 'tree-sitter.wasm'))).toBe(true);
    for (const lang of ['go', 'java', 'python', 'cpp', 'kotlin']) {
      expect(existsSync(path.join(pkgDir, 'assets', 'grammars', `tree-sitter-${lang}.wasm`))).toBe(
        true
      );
    }
  });

  it('resolves the ordinary JS dependencies the directory-source prototype lacked', () => {
    for (const dep of ['commander', '@modelcontextprotocol/sdk', 'zod', 'web-tree-sitter']) {
      expect(
        existsSync(path.join(installDir, 'node_modules', ...dep.split('/'))),
        `${dep} must be installed in the plugin cache closure`
      ).toBe(true);
    }
  });

  it('installs no native tree-sitter runtime or grammar packages', () => {
    for (const pkg of NATIVE_PACKAGES) {
      expect(
        existsSync(path.join(installDir, 'node_modules', ...pkg.split('/'))),
        `${pkg} must not be installed`
      ).toBe(false);
    }
  });

  it('records no native build/fetch attempts or resolution failures in the install log', () => {
    expect(installLog).not.toMatch(/node-gyp/i);
    expect(installLog).not.toMatch(/prebuild-install/i);
    expect(installLog).not.toMatch(/tree_sitter_runtime_binding/i);
    expect(installLog).not.toMatch(/ERESOLVE/);
  });
});

describe('MCP startup from the isolated plugin cache', () => {
  it('completes a real MCP handshake and lists the archguard tools', async () => {
    const tools = await mcpHandshake();
    expect(tools).toContain('archguard_summary');
    expect(tools).toContain('archguard_analyze');
    expect(tools.length).toBeGreaterThan(10);
  }, 120_000);

  it('starts query-only with sharp physically absent from the closure', async () => {
    // sharp laziness proven at runtime: remove it (and its platform packages)
    // from the installed closure — query-only MCP startup must still succeed.
    rmSync(path.join(installDir, 'node_modules', 'sharp'), { recursive: true, force: true });
    rmSync(path.join(installDir, 'node_modules', '@img'), { recursive: true, force: true });
    const tools = await mcpHandshake();
    expect(tools).toContain('archguard_summary');
  }, 120_000);
});

describe('analysis through the plugin-installed closure', () => {
  it('packs the production analyze path through the resolver-mediated factory', () => {
    const providerSource = readFileSync(
      path.join(corePkgDir(), 'dist', 'cli', 'processors', 'arch-json-provider.js'),
      'utf8'
    );
    expect(providerSource).toContain('plugin-factory.js');
    expect(providerSource).toContain('createLanguagePlugin');
    expect(providerSource).not.toMatch(
      /new\s+(?:GoPlugin|GoAtlasPlugin|JavaPlugin|PythonPlugin|CppPlugin|KotlinPlugin)\s*\(/
    );
  });

  for (const { language, source } of LANGUAGE_CASES) {
    it(`analyzes ${language} via the CLI with the WASM runtime forced`, () => {
      // File fixtures (cpp/kotlin samples) get a per-language source dir.
      let sourceDir = source;
      if (source.endsWith('.cpp') || source.endsWith('.kt')) {
        sourceDir = path.join(workDir, 'fixtures', language);
        mkdirSync(sourceDir, { recursive: true });
        execFileSync('cp', [source, sourceDir], { timeout: 30_000 });
      }
      const outDir = path.join(workDir, 'analysis-out', language);
      mkdirSync(outDir, { recursive: true });
      execFileSync(
        process.execPath,
        [
          path.join(corePkgDir(), 'dist', 'cli', 'index.js'),
          'analyze',
          '-s',
          sourceDir,
          '--lang',
          language,
          '-f',
          'json',
          '--output-dir',
          outDir,
        ],
        {
          cwd: elsewhereDir,
          env: childEnv({ ARCHGUARD_PARSER_RUNTIME: 'wasm' }),
          stdio: 'pipe',
          timeout: 180_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      // Diagram names are auto-detected per language (architecture.json for
      // Go, java/overview/package.json for Java, ...): accept any produced
      // JSON that parses as ArchJSON for the requested language.
      const produced = execFileSync('find', [outDir, '-name', '*.json', '-type', 'f'], {
        stdio: 'pipe',
        timeout: 30_000,
      })
        .toString('utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
      const archjson = produced
        .map((file) => {
          try {
            return JSON.parse(readFileSync(file, 'utf8')) as {
              version?: string;
              language?: string;
              sourceFiles?: string[];
            };
          } catch {
            return undefined;
          }
        })
        .find((doc) => doc?.version && doc?.language === language);
      expect(
        archjson,
        `${language}: no ArchJSON output for language "${language}" in:\n${produced.join('\n')}`
      ).toBeDefined();
      expect(
        archjson?.sourceFiles?.length,
        `${language}: no source files analyzed`
      ).toBeGreaterThan(0);
    }, 240_000);
  }
});

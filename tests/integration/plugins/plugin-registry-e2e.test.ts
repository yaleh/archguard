/**
 * E2E integration tests for the plugin registry / external plugin loading
 * contracts (TASK-76, A-class boundary-list final batch).
 *
 * The registry is a user-extensible boundary (language plugins are the
 * documented extension surface). These tests pin the three key contracts end
 * to end against the real shipped plugins and real on-disk plugin modules —
 * they are not unit tests with mocks:
 *
 *  1. Built-in plugin enumeration — construct and register every shipped
 *     built-in plugin (typescript/golang/java/python/cpp/kotlin) and assert
 *     the registry enumerates them (listAll / getByName / getByExtension /
 *     directory detection against the real detection fixtures).
 *
 *  2. External plugin path loading — `loadFromPath()` dynamically imports a
 *     plugin module that lives outside src/ (tests/fixtures/mock-plugin) and
 *     the loaded plugin registers and operates (initialize + parseProject)
 *     through the registry.
 *
 *  3. Illegal plugin error — `loadFromPath()` rejects a module that exists on
 *     disk but exports neither a default class nor a named `Plugin` export
 *     (tests/fixtures/invalid-plugin), and rejects nonexistent paths.
 *
 * Contract evidence:
 *  - Built-in set is the factory's supported languages (src/plugins/shared/
 *    plugin-factory.ts: go/java/python/cpp/kotlin) plus the TypeScript plugin
 *    branch in loadPluginForLanguage (src/cli/analyze/run-analysis.ts).
 *  - loadFromPath error contract is the implementation's own documented error
 *    in src/core/plugin-registry.ts: "must export a default class or named
 *    'Plugin' export".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { PluginRegistry } from '@/core/plugin-registry.js';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { PythonPlugin } from '@/plugins/python/index.js';
import { CppPlugin } from '@/plugins/cpp/index.js';
import { KotlinPlugin } from '@/plugins/kotlin/index.js';
import type { ILanguagePlugin } from '@/core/interfaces/language-plugin.js';

const DETECTION_FIXTURES = path.resolve(process.cwd(), 'tests', 'fixtures', 'detection');
const EXTERNAL_MOCK_PLUGIN = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'mock-plugin',
  'index.ts'
);
const INVALID_PLUGIN = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'invalid-plugin',
  'index.ts'
);
const NON_CONSTRUCTOR_PLUGIN = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'non-constructor-plugin',
  'index.ts'
);

/**
 * The shipped built-in plugin set. Every entry is a real plugin class from
 * src/plugins/* — the registry contract is asserted against these, not mocks.
 */
function buildBuiltInPlugins(): ILanguagePlugin[] {
  return [
    new TypeScriptPlugin(),
    new GoPlugin(nativeParserBackend),
    new JavaPlugin(nativeParserBackend),
    new PythonPlugin(nativeParserBackend),
    new CppPlugin(nativeParserBackend),
    new KotlinPlugin(nativeParserBackend),
  ];
}

describe('Plugin registry E2E — built-in plugin enumeration', () => {
  let registry: PluginRegistry;

  beforeAll(() => {
    registry = new PluginRegistry();
    for (const plugin of buildBuiltInPlugins()) {
      registry.register(plugin);
    }
  });

  it('listAll() enumerates every shipped built-in plugin', () => {
    const all = registry.listAll();
    const names = all.map((p) => p.metadata.name).sort();
    expect(names).toEqual(['cpp', 'golang', 'java', 'kotlin', 'python', 'typescript']);
  });

  it('getByName() resolves each built-in plugin by its language name', () => {
    for (const name of ['typescript', 'golang', 'java', 'python', 'cpp', 'kotlin']) {
      const plugin = registry.getByName(name);
      expect(plugin, `getByName('${name}') should resolve a built-in`).not.toBeNull();
      expect(plugin?.metadata.name).toBe(name);
    }
  });

  it('getByExtension() maps each built-in file extension to its plugin', () => {
    const expectations: Array<[string, string]> = [
      ['.ts', 'typescript'],
      ['.tsx', 'typescript'],
      ['.go', 'golang'],
      ['.java', 'java'],
      ['.py', 'python'],
      ['.cpp', 'cpp'],
      ['.kt', 'kotlin'],
    ];
    for (const [extension, expectedName] of expectations) {
      const plugin = registry.getByExtension(extension);
      expect(plugin, `getByExtension('${extension}') should resolve a plugin`).not.toBeNull();
      expect(plugin?.metadata.name).toBe(expectedName);
    }
  });

  it('detectPluginForDirectory() detects built-ins from real marker files', async () => {
    // Reuses the shared detection fixtures (go.mod / package.json / pom.xml /
    // pyproject.toml / unknown-project).
    const cases: Array<[string, string]> = [
      ['go-project', 'golang'],
      ['ts-project', 'typescript'],
      ['java-project', 'java'],
      ['python-project', 'python'],
    ];
    for (const [dir, expectedName] of cases) {
      const detected = await registry.detectPluginForDirectory(path.join(DETECTION_FIXTURES, dir));
      expect(detected, `detect ${dir}`).not.toBeNull();
      expect(detected?.metadata.name).toBe(expectedName);
    }
    const unknown = await registry.detectPluginForDirectory(
      path.join(DETECTION_FIXTURES, 'unknown-project')
    );
    expect(unknown).toBeNull();
  });

  it('resolveForLanguage() resolves shipped built-in packs when no imperative plugin is registered', async () => {
    // java/python ship as built-in knowledge packs (src/plugins/packs); a fresh
    // registry with no imperative plugin must resolve them via pack fallback.
    const fresh = new PluginRegistry();
    for (const lang of ['java', 'python']) {
      const plugin = await fresh.resolveForLanguage(lang);
      expect(plugin, `resolveForLanguage('${lang}') should resolve a built-in pack`).not.toBeNull();
      expect(plugin?.metadata.name).toBe(lang);
    }
    // A language with neither an imperative plugin nor a pack resolves to null.
    expect(await fresh.resolveForLanguage('no-such-lang')).toBeNull();
  });

  it('resolveForLanguage() gives imperative plugins precedence over packs', async () => {
    // JavaPlugin is registered on this describe's registry (imperative branch).
    const plugin = await registry.resolveForLanguage('java');
    expect(plugin).toBeInstanceOf(JavaPlugin);
  });

  it('registering a duplicate built-in without overwrite throws the conflict error', () => {
    const registry2 = new PluginRegistry();
    registry2.register(new TypeScriptPlugin());
    expect(() => registry2.register(new TypeScriptPlugin())).toThrow(/already registered/i);
  });
});

describe('Plugin registry E2E — external plugin path loading', () => {
  let registry: PluginRegistry;
  let externalPlugin: ILanguagePlugin;

  beforeAll(async () => {
    // The mock plugin module lives under tests/fixtures — outside src/ — and is
    // loaded the way a third-party plugin would be: by absolute path.
    externalPlugin = await new PluginRegistry().loadFromPath(EXTERNAL_MOCK_PLUGIN);
    registry = new PluginRegistry();
    registry.register(externalPlugin);
  });

  it('loadFromPath() dynamically imports an external plugin module', () => {
    expect(externalPlugin).toBeDefined();
    expect(externalPlugin.metadata.name).toBe('mock');
    expect(externalPlugin.metadata.version).toBe('1.0.0');
  });

  it('the externally loaded plugin is enumerable through the registry', () => {
    expect(registry.has('mock')).toBe(true);
    expect(registry.getByName('mock')).toBe(externalPlugin);
    expect(registry.getByExtension('.mock')).toBe(externalPlugin);
    expect(registry.listAll()).toContain(externalPlugin);
  });

  it('the externally loaded plugin operates end to end (initialize + parse)', async () => {
    await externalPlugin.initialize({ workspaceRoot: '/tmp/test-e2e' });
    const result = await externalPlugin.parseProject('/tmp/test-e2e', {
      workspaceRoot: '/tmp/test-e2e',
      excludePatterns: [],
    });
    expect(result.version).toBe('1.1');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0].name).toBe('ProjectEntity');
    expect(result.metadata?.pluginName).toBe('mock');
  });
});

describe('Plugin registry E2E — illegal plugin error contract', () => {
  it('loadFromPath() rejects a module that exports no default class / named Plugin', async () => {
    // The invalid fixture EXISTS on disk but is not a plugin module.
    await expect(new PluginRegistry().loadFromPath(INVALID_PLUGIN)).rejects.toThrow(
      /must export a default class or named 'Plugin' export/
    );
  });

  it('loadFromPath() rejects a nonexistent plugin path', async () => {
    const missing = path.resolve(
      process.cwd(),
      'tests',
      'fixtures',
      'nonexistent-plugin',
      'index.ts'
    );
    await expect(new PluginRegistry().loadFromPath(missing)).rejects.toThrow();
  });

  it('loadFromPath() rejects a module whose default export is not a plugin class', async () => {
    // A module that exports a non-constructor default must fail at instantiation,
    // not silently produce a broken plugin.
    await expect(new PluginRegistry().loadFromPath(NON_CONSTRUCTOR_PLUGIN)).rejects.toThrow();
  });
});

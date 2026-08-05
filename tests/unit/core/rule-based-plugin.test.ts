/**
 * TASK-63 Phase B — RuleBasedLanguagePlugin unit tests (ILanguagePlugin
 * duck-type, metadata.language, supportedLevels, canHandle, PluginRegistry
 * instantiation).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { PackRegistry, PluginRegistry, RuleBasedLanguagePlugin } from '@/core/index.js';
import type { LoadedPack } from '@/core/index.js';

async function writePythonPack(dir: string): Promise<void> {
  await fs.ensureDir(path.join(dir, 'rules'));
  await fs.ensureDir(path.join(dir, 'patterns'));
  await fs.writeJson(path.join(dir, 'manifest.json'), {
    name: 'python',
    version: '1.0.0',
    engine: '>=1.0.0',
    language: 'python',
    extensions: ['.py'],
    frameworks: [],
  });
  await fs.writeFile(
    path.join(dir, 'rules', 'modules.yaml'),
    [
      'import_patterns: []',
      'entity_nodes:',
      '  - node_type: class_definition',
      '    entity_type: class',
      '    name_field: name',
      '    body_field: body',
      '    method_node: function_definition',
      'relations:',
      '  import_dependency: true',
      'path_resolution:',
      '  root_relative: true',
      '  extensions: [".py"]',
      '  index_files: []',
    ].join('\n')
  );
  await fs.writeFile(path.join(dir, 'rules', 'dependencies.yaml'), 'package_files: []\n');
  await fs.writeFile(path.join(dir, 'patterns', 'architectural.yaml'), '[]');
}

describe('RuleBasedLanguagePlugin', () => {
  let tmpDir: string;
  let pack: LoadedPack;
  let packRegistry: PackRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-rbp-'));
    await writePythonPack(path.join(tmpDir, 'packs', 'python'));
    packRegistry = new PackRegistry({ builtinPacksRoot: path.join(tmpDir, 'packs') });
    const loaded = await packRegistry.resolve('python');
    if (!loaded) throw new Error('test pack failed to load');
    pack = loaded;
    process.env.ARCHGUARD_PARSER_RUNTIME = 'wasm';
  });

  afterEach(async () => {
    delete process.env.ARCHGUARD_PARSER_RUNTIME;
    await fs.remove(tmpDir);
  });

  it('implements the ILanguagePlugin duck type', () => {
    const plugin = new RuleBasedLanguagePlugin(pack);
    expect(typeof plugin.initialize).toBe('function');
    expect(typeof plugin.parseProject).toBe('function');
    expect(typeof plugin.parseCode).toBe('function');
    expect(typeof plugin.canHandle).toBe('function');
    expect(typeof plugin.dispose).toBe('function');
    expect(plugin.metadata).toBeDefined();
    expect(Array.isArray(plugin.supportedLevels)).toBe(true);
  });

  it('exposes the pack language in metadata', () => {
    const plugin = new RuleBasedLanguagePlugin(pack);
    // PluginMetadata has no `language` field; the language code is carried by
    // metadata.name (like every imperative plugin) plus the plugin `language`
    // getter (per the design proposal).
    expect(plugin.metadata.name).toBe('python');
    expect(plugin.metadata.fileExtensions).toContain('.py');
    expect(plugin.language).toBe('python');
  });

  it('supports package and class diagram levels', () => {
    const plugin = new RuleBasedLanguagePlugin(pack);
    expect(plugin.supportedLevels).toContain('package');
    expect(plugin.supportedLevels).toContain('class');
  });

  it('canHandle matches the pack extensions', () => {
    const plugin = new RuleBasedLanguagePlugin(pack);
    expect(plugin.canHandle('/abs/path/main.py')).toBe(true);
    expect(plugin.canHandle('/abs/path/main.PY')).toBe(true);
    expect(plugin.canHandle('/abs/path/main.java')).toBe(false);
  });

  it('is instantiable via PluginRegistry.resolveForLanguage', async () => {
    const pluginRegistry = new PluginRegistry();
    const plugin = await pluginRegistry.resolveForLanguage('python', packRegistry);
    expect(plugin).toBeInstanceOf(RuleBasedLanguagePlugin);
  });

  it('returns null from resolveForLanguage when no pack exists', async () => {
    const pluginRegistry = new PluginRegistry();
    const plugin = await pluginRegistry.resolveForLanguage('rust', packRegistry);
    expect(plugin).toBeNull();
  });

  it('prefers an imperative plugin over a pack-resolved one', async () => {
    const pluginRegistry = new PluginRegistry();
    const imperative = new RuleBasedLanguagePlugin(pack);
    pluginRegistry.register(imperative);
    const resolved = await pluginRegistry.resolveForLanguage('python', packRegistry);
    expect(resolved).toBe(imperative);
  });

  it('parseProject produces entities for a fixture project', async () => {
    const project = path.join(tmpDir, 'proj');
    await fs.ensureDir(path.join(project, 'app'));
    await fs.writeFile(path.join(project, 'app', 'main.py'), 'class Service:\n    pass\n');

    const plugin = new RuleBasedLanguagePlugin(pack);
    await plugin.initialize({ workspaceRoot: project });
    const result = await plugin.parseProject(project, { excludePatterns: [] });

    expect(result.language).toBe('python');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0].name).toBe('Service');
    await plugin.dispose();
  });
});

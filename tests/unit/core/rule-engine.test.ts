/**
 * TASK-63 Phase B — RuleEngine unit tests (extractEntities / extractRelations /
 * detectFramework / empty-AST).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { PackRegistry, type LoadedPack } from '@/core/pack-registry/index.js';
import { RuleEngine } from '@/core/rule-engine/index.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

async function writePythonPack(dir: string): Promise<void> {
  await fs.ensureDir(path.join(dir, 'rules', 'frameworks'));
  await fs.ensureDir(path.join(dir, 'patterns'));
  await fs.writeJson(path.join(dir, 'manifest.json'), {
    name: 'python',
    version: '1.0.0',
    engine: '>=1.0.0',
    language: 'python',
    extensions: ['.py'],
    frameworks: ['fastapi'],
  });
  await fs.writeFile(
    path.join(dir, 'rules', 'modules.yaml'),
    [
      'import_patterns:',
      '  - type: python_from',
      "    pattern: '^from ([\\w.]+) import'",
      '    module_group: 1',
      '  - type: python_import',
      "    pattern: '^import ([\\w.]+)$'",
      '    module_group: 1',
      'entity_nodes:',
      '  - node_type: class_definition',
      '    entity_type: class',
      '    name_field: name',
      '    body_field: body',
      '    method_node: function_definition',
      '    base_class_field: superclasses',
      '  - node_type: function_definition',
      '    entity_type: function',
      '    name_field: name',
      '    body_field: body',
      'relations:',
      '  inheritance: true',
      '  implementation: false',
      '  field_dependency: false',
      '  parameter_dependency: false',
      '  import_dependency: true',
      'path_resolution:',
      '  root_relative: true',
      '  extensions: [".py"]',
      '  index_files: []',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(dir, 'rules', 'dependencies.yaml'),
    'package_files:\n  - pyproject.toml\n'
  );
  await fs.writeFile(
    path.join(dir, 'rules', 'frameworks', 'fastapi.yaml'),
    [
      'name: FastAPI',
      'detect:',
      '  - file_match: "pyproject.toml"',
      '    content_contains: "fastapi"',
      'modules: {}',
      'entry_points: []',
    ].join('\n')
  );
  await fs.writeFile(path.join(dir, 'patterns', 'architectural.yaml'), '[]');
}

describe('RuleEngine', () => {
  let tmpDir: string;
  let pack: LoadedPack;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-engine-'));
    await writePythonPack(path.join(tmpDir, 'packs', 'python'));
    const loaded = await new PackRegistry({
      builtinPacksRoot: path.join(tmpDir, 'packs'),
    }).resolve('python');
    if (!loaded) throw new Error('test pack failed to load');
    pack = loaded;
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('extracts class and module-function entities from Python source', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session, { workspaceRoot: tmpDir });
      const code = [
        'import os',
        '',
        'class User:',
        '    def __init__(self, name):',
        '        self.name = name',
        '    def greet(self):',
        '        return f"hi {self.name}"',
        '',
        'def helper():',
        '    return 1',
      ].join('\n');
      const file = path.join(tmpDir, 'app', 'user.py');
      const entities = engine.extractEntities(code, file);

      const names = entities.map((e) => e.name);
      expect(names).toContain('User');
      expect(names).toContain('helper');
      expect(names).toHaveLength(2);

      const user = entities.find((e) => e.name === 'User');
      expect(user).toBeDefined();
      expect(user?.members.some((m) => m.name === 'greet')).toBe(true);
      expect(user?.members.some((m) => m.name === '__init__')).toBe(true);
      expect(user?.id).toBe('app.user.User');
    } finally {
      session.dispose();
    }
  });

  it('extracts import dependency relations', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session, { workspaceRoot: tmpDir });
      const code = 'from foo import Bar\nclass A: pass\n';
      const file = path.join(tmpDir, 'app', 'main.py');
      const moduleIndex = new Set(['foo']);
      const relations = engine.extractRelations(code, file, moduleIndex);

      expect(relations.some((r) => r.type === 'dependency' && r.target === 'foo')).toBe(true);
      expect(relations.some((r) => r.source === 'app.main')).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it('drops stdlib imports that are not known project modules', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session, { workspaceRoot: tmpDir });
      const code = 'import os\nimport sys\nclass A: pass\n';
      const file = path.join(tmpDir, 'app', 'main.py');
      const moduleIndex = new Set(['app.main']);
      const relations = engine.extractRelations(code, file, moduleIndex);
      const deps = relations.filter((r) => r.type === 'dependency');
      expect(deps).toHaveLength(0);
    } finally {
      session.dispose();
    }
  });

  it('detects an active framework from project markers', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session);
      const project = path.join(tmpDir, 'proj');
      await fs.ensureDir(project);
      await fs.writeFile(
        path.join(project, 'pyproject.toml'),
        '[project]\ndependencies = ["fastapi"]\n'
      );
      const framework = await engine.detectFramework(project);
      expect(framework).toBe('FastAPI');
    } finally {
      session.dispose();
    }
  });

  it('returns null when no framework markers match', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session);
      const project = path.join(tmpDir, 'proj2');
      await fs.ensureDir(project);
      const framework = await engine.detectFramework(project);
      expect(framework).toBeNull();
    } finally {
      session.dispose();
    }
  });

  it('returns an empty entity list for an empty AST', async () => {
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session);
      const entities = engine.extractEntities('', path.join(tmpDir, 'empty.py'));
      expect(entities).toEqual([]);
    } finally {
      session.dispose();
    }
  });
});

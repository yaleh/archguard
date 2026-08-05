/**
 * TASK-63 Phase D — Python knowledge pack unit tests.
 */
import { describe, it, expect } from 'vitest';
import { PackRegistry, KnowledgePackSchema, RuleEngine } from '@/core/index.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

async function loadPythonPack(): Promise<import('@/core/index.js').LoadedPack> {
  const pack = await new PackRegistry().resolve('python');
  if (!pack) throw new Error('built-in python pack not found');
  return pack;
}

describe('python knowledge pack', () => {
  it('resolve("python") returns a valid LoadedPack', async () => {
    const pack = await loadPythonPack();
    expect(pack.rootPath.endsWith('plugins/packs/python')).toBe(true);
  });

  it('manifest declares the python language and .py extension', async () => {
    const pack = await loadPythonPack();
    expect(pack.manifest.language).toBe('python');
    expect(pack.manifest.extensions).toEqual(['.py']);
    expect(pack.manifest.frameworks).toEqual(expect.arrayContaining(['django', 'fastapi']));
  });

  it('passes the KnowledgePackSchema', async () => {
    const pack = await loadPythonPack();
    const parsed = KnowledgePackSchema.parse({
      manifest: pack.manifest,
      modules: pack.modules,
      dependencies: pack.dependencies,
      frameworks: pack.frameworks,
      patterns: pack.patterns,
    });
    expect(parsed.manifest.language).toBe('python');
    expect(parsed.frameworks.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Django', 'FastAPI'])
    );
  });

  it('extracts classes and module-level functions from Python source', async () => {
    const pack = await loadPythonPack();
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session, { workspaceRoot: '/proj' });
      const code = [
        'class User:',
        '    def __init__(self, name):',
        '        self.name = name',
        '',
        'def helper():',
        '    return 1',
      ].join('\n');
      const file = '/proj/app/user.py';
      const entities = engine.extractEntities(code, file);

      const byName = new Map(entities.map((e) => [e.name, e]));
      expect(byName.get('User')?.type).toBe('class');
      expect(byName.get('helper')?.type).toBe('function');
      expect(byName.get('User')?.members.some((m) => m.name === '__init__')).toBe(true);
      expect(byName.get('User')?.id).toBe('app.user.User');
    } finally {
      session.dispose();
    }
  });

  it('extracts `import foo` and `from foo import Bar` relations', async () => {
    const pack = await loadPythonPack();
    const session = await wasmParserBackend.createSession('python');
    try {
      const engine = new RuleEngine(pack, session, { workspaceRoot: '/proj' });
      const code = ['import os', 'import mypkg.utils', 'from mypkg.models import User'].join('\n');
      const file = '/proj/app/main.py';
      const moduleIndex = new Set(['mypkg.utils', 'mypkg.models', 'app.main']);
      const relations = engine.extractRelations(code, file, moduleIndex);

      const targets = relations.filter((r) => r.type === 'dependency').map((r) => r.target);
      expect(targets).toContain('mypkg.utils');
      expect(targets).toContain('mypkg.models');
      expect(targets).not.toContain('os'); // stdlib import dropped
    } finally {
      session.dispose();
    }
  });
});

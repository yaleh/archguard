/**
 * TASK-63 Phase C — Java knowledge pack unit tests.
 */
import { describe, it, expect } from 'vitest';
import { PackRegistry, KnowledgePackSchema, RuleEngine } from '@/core/index.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

async function loadJavaPack(): Promise<import('@/core/index.js').LoadedPack> {
  const pack = await new PackRegistry().resolve('java');
  if (!pack) throw new Error('built-in java pack not found');
  return pack;
}

describe('java knowledge pack', () => {
  it('resolve("java") returns a valid LoadedPack', async () => {
    const pack = await loadJavaPack();
    expect(pack.rootPath.endsWith('plugins/packs/java')).toBe(true);
  });

  it('manifest declares the java language and .java extension', async () => {
    const pack = await loadJavaPack();
    expect(pack.manifest.language).toBe('java');
    expect(pack.manifest.extensions).toEqual(['.java']);
    expect(pack.manifest.name).toBe('java');
    expect(pack.manifest.frameworks).toContain('spring');
  });

  it('passes the KnowledgePackSchema', async () => {
    const pack = await loadJavaPack();
    const parsed = KnowledgePackSchema.parse({
      manifest: pack.manifest,
      modules: pack.modules,
      dependencies: pack.dependencies,
      frameworks: pack.frameworks,
      patterns: pack.patterns,
    });
    expect(parsed.manifest.language).toBe('java');
    expect(parsed.modules.entityNodes.length).toBeGreaterThanOrEqual(3);
  });

  it('extracts classes, interfaces and enums from Java source', async () => {
    const pack = await loadJavaPack();
    const session = await wasmParserBackend.createSession('java');
    try {
      const engine = new RuleEngine(pack, session);
      const code = [
        'package com.example;',
        'public class Service {',
        '    private final int count = 0;',
        '    public void run() {}',
        '}',
        'public interface Handler { void handle(); }',
        'public enum Status { ACTIVE, INACTIVE }',
      ].join('\n');
      const entities = engine.extractEntities(code, '/abs/Service.java');

      const byName = new Map(entities.map((e) => [e.name, e]));
      expect(byName.get('Service')?.type).toBe('class');
      expect(byName.get('Handler')?.type).toBe('interface');
      expect(byName.get('Status')?.type).toBe('enum');

      const service = byName.get('Service');
      expect(service?.members.some((m) => m.name === 'run' && m.type === 'method')).toBe(true);
      expect(service?.members.some((m) => m.name === 'count' && m.type === 'field')).toBe(true);
      expect(service?.id).toBe('com.example.Service');
    } finally {
      session.dispose();
    }
  });

  it('extracts import relations from Java source', async () => {
    const pack = await loadJavaPack();
    const session = await wasmParserBackend.createSession('java');
    try {
      const engine = new RuleEngine(pack, session);
      const code = [
        'package com.example;',
        'import com.example.repo.OrderRepository;',
        'import static com.example.util.Constants.MAX;',
        'public class Service {}',
      ].join('\n');
      const relations = engine.extractImportRelations(code, '/abs/Service.java');

      const targets = relations.filter((r) => r.type === 'dependency').map((r) => r.target);
      expect(targets).toContain('com.example.repo.OrderRepository');
      // Static imports capture the full dotted member path (the pack pattern
      // does not strip the trailing member name).
      expect(targets).toContain('com.example.util.Constants.MAX');
    } finally {
      session.dispose();
    }
  });
});

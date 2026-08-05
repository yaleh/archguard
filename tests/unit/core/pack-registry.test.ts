/**
 * TASK-63 Phase A — PackRegistry + Zod schema unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { ZodError } from 'zod';
import {
  PackRegistry,
  PackNotFoundError,
  KnowledgePackSchema,
} from '@/core/pack-registry/index.js';

const VALID_MANIFEST = {
  name: 'java',
  version: '1.0.0',
  engine: '>=1.0.0',
  language: 'java',
  extensions: ['.java'],
  frameworks: ['spring'],
};

async function writeValidPack(dir: string): Promise<void> {
  await fs.ensureDir(path.join(dir, 'rules'));
  await fs.ensureDir(path.join(dir, 'patterns'));
  await fs.writeJson(path.join(dir, 'manifest.json'), VALID_MANIFEST);
  await fs.writeFile(
    path.join(dir, 'rules', 'modules.yaml'),
    [
      'import_patterns:',
      '  - type: java_import',
      '    pattern: "^import (?:static )?([a-zA-Z0-9_.]+);"',
      '    module_group: 1',
      'entity_nodes: []',
      'path_resolution:',
      '  root_relative: true',
      '  extensions: [".java"]',
      '  index_files: []',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(dir, 'rules', 'dependencies.yaml'),
    ['package_files:', '  - pom.xml', '  - build.gradle'].join('\n')
  );
  await fs.writeFile(
    path.join(dir, 'patterns', 'architectural.yaml'),
    ['- name: data_class', '  pattern: ".*"', '  description: any'].join('\n')
  );
}

describe('PackRegistry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-packs-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('load()', () => {
    it('loads a valid pack directory into a typed LoadedPack', async () => {
      const packDir = path.join(tmpDir, 'java');
      await writeValidPack(packDir);

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      const loaded = await registry.load(packDir);

      expect(loaded).toBeDefined();
      expect(loaded.manifest.language).toBe('java');
      expect(loaded.manifest.extensions).toEqual(['.java']);
      expect(loaded.rootPath).toBe(path.resolve(packDir));
      expect(loaded.modules.importPatterns).toHaveLength(1);
      expect(loaded.modules.importPatterns[0].moduleGroup).toBe(1);
      expect(loaded.dependencies.packageFiles).toEqual(['pom.xml', 'build.gradle']);
      expect(loaded.frameworks).toEqual([]);
      expect(loaded.patterns).toHaveLength(1);
    });

    it('throws PackNotFoundError when manifest.json is missing', async () => {
      const packDir = path.join(tmpDir, 'empty');
      await fs.ensureDir(packDir);

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      await expect(registry.load(packDir)).rejects.toBeInstanceOf(PackNotFoundError);
    });

    it('throws a ZodError mentioning "language" when the manifest lacks a language field', async () => {
      const packDir = path.join(tmpDir, 'bad');
      await writeValidPack(packDir);
      // Remove the language field from the manifest
      const manifest = { ...VALID_MANIFEST };
      delete (manifest as { language?: string }).language;
      await fs.writeJson(path.join(packDir, 'manifest.json'), manifest);

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      await expect(registry.load(packDir)).rejects.toBeInstanceOf(ZodError);
      await expect(registry.load(packDir)).rejects.toThrow(/language/);
    });

    it('throws a ZodError for an invalid extension field type', async () => {
      const packDir = path.join(tmpDir, 'bad-ext');
      await writeValidPack(packDir);
      await fs.writeJson(path.join(packDir, 'manifest.json'), {
        ...VALID_MANIFEST,
        extensions: 'not-an-array',
      });

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      await expect(registry.load(packDir)).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('resolve()', () => {
    it('returns the built-in java pack when a java directory exists', async () => {
      const javaDir = path.join(tmpDir, 'java');
      await writeValidPack(javaDir);

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      const loaded = await registry.resolve('java');
      expect(loaded).toBeDefined();
      expect(loaded?.manifest.language).toBe('java');
    });

    it('returns undefined for a nonexistent language', async () => {
      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      const loaded = await registry.resolve('nonexistent');
      expect(loaded).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('lists pack languages', async () => {
      await writeValidPack(path.join(tmpDir, 'java'));
      await writeValidPack(path.join(tmpDir, 'python'));

      const registry = new PackRegistry({ builtinPacksRoot: tmpDir });
      const langs = await registry.list();
      expect(langs).toContain('java');
      expect(langs).toContain('python');
    });
  });
});

describe('KnowledgePackSchema', () => {
  it('parses a fully valid pack', () => {
    const result = KnowledgePackSchema.parse({
      manifest: VALID_MANIFEST,
      modules: {
        importPatterns: [],
        entityNodes: [],
        pathResolution: { rootRelative: true, extensions: [], indexFiles: [] },
      },
      dependencies: { packageFiles: ['pom.xml'] },
      frameworks: [],
      patterns: [],
    });

    expect(result.manifest.language).toBe('java');
    expect(result.frameworks).toEqual([]);
  });

  it('rejects a manifest missing the language field', () => {
    const manifest = { ...VALID_MANIFEST };
    delete (manifest as { language?: string }).language;
    expect(() => KnowledgePackSchema.parse({ manifest })).toThrow(ZodError);
    expect(() => KnowledgePackSchema.parse({ manifest })).toThrow(/language/);
  });

  it('rejects a framework rule missing its name', () => {
    expect(() =>
      KnowledgePackSchema.parse({
        manifest: VALID_MANIFEST,
        frameworks: [{ detect: [], modules: {}, entryPoints: [] }],
      })
    ).toThrow(ZodError);
  });

  it('applies defaults for optional layers', () => {
    const result = KnowledgePackSchema.parse({ manifest: VALID_MANIFEST });
    expect(result.modules.importPatterns).toEqual([]);
    expect(result.dependencies.packageFiles).toEqual([]);
    expect(result.frameworks).toEqual([]);
    expect(result.patterns).toEqual([]);
  });
});

/**
 * Cross-Language Consistency Tests
 *
 * Tests that different language plugins produce consistent ArchJSON output
 * when parsing semantically equivalent code structures.
 *
 * Based on Proposal 03 §6.3-6.4 for multi-language support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { PluginRegistry } from '@/core/plugin-registry.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';
import type { ArchJSON } from '@/types/index.js';

/**
 * Test fixture specification
 */
interface FixtureSpec {
  name: string;
  description: string;
  languages: string[];
  expectedMetrics: {
    entityCount: number;
    methodCount: number;
    fieldCount: number;
    relationCount: number;
  };
}

/**
 * Fixture test result for a single language
 */
interface FixtureResult {
  language: string;
  archJson: ArchJSON;
  metrics: {
    entityCount: number;
    methodCount: number;
    fieldCount: number;
    relationCount: number;
  };
}

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/cross-language');

describe('Cross-Language Consistency', () => {
  let registry: PluginRegistry;
  let typescriptPlugin: TypeScriptPlugin;
  let goPlugin: GoPlugin;

  beforeEach(async () => {
    // Initialize plugins
    typescriptPlugin = new TypeScriptPlugin();
    goPlugin = new GoPlugin();

    await typescriptPlugin.initialize({ workspaceRoot: '/tmp' });
    await goPlugin.initialize({ workspaceRoot: '/tmp' });

    // Register plugins
    registry = new PluginRegistry();
    registry.register(typescriptPlugin);
    registry.register(goPlugin);
  });

  afterEach(async () => {
    // Cleanup plugins
    await typescriptPlugin.dispose();
    await goPlugin.dispose();
  });

  /**
   * Load fixture specification
   */
  async function loadFixtureSpec(fixtureDir: string): Promise<FixtureSpec> {
    const specPath = path.join(fixtureDir, 'spec.json');
    const specContent = await fs.readFile(specPath, 'utf-8');
    return JSON.parse(specContent) as FixtureSpec;
  }

  /**
   * Parse fixture with all specified languages
   */
  async function parseFixtureWithLanguages(
    fixtureDir: string,
    languages: string[]
  ): Promise<FixtureResult[]> {
    const results: FixtureResult[] = [];

    for (const language of languages) {
      const plugin = getPluginForLanguage(language);
      if (!plugin) {
        throw new Error(`No plugin registered for language: ${language}`);
      }

      const sourceFile = getSourceFile(fixtureDir, language);
      const sourceContent = await fs.readFile(sourceFile, 'utf-8');

      const archJson = plugin.parseCode(sourceContent, sourceFile);

      results.push({
        language,
        archJson,
        metrics: extractMetrics(archJson),
      });
    }

    return results;
  }

  /**
   * Get plugin for a language
   */
  function getPluginForLanguage(language: string): ILanguagePlugin | null {
    const extensionMap: Record<string, string> = {
      typescript: '.ts',
      go: '.go',
      java: '.java',
      python: '.py',
    };

    const extension = extensionMap[language];
    if (!extension) {
      return null;
    }

    return registry.getByExtension(extension);
  }

  /**
   * Get source file path for a language
   */
  function getSourceFile(fixtureDir: string, language: string): string {
    const fileMap: Record<string, string> = {
      typescript: 'typescript.ts',
      go: 'go.go',
      java: 'java.java',
      python: 'python.py',
    };

    const fileName = fileMap[language];
    if (!fileName) {
      throw new Error(`No source file mapping for language: ${language}`);
    }

    return path.join(fixtureDir, fileName);
  }

  /**
   * Extract metrics from ArchJSON
   */
  function extractMetrics(archJson: ArchJSON): {
    entityCount: number;
    methodCount: number;
    fieldCount: number;
    relationCount: number;
  } {
    let methodCount = 0;
    let fieldCount = 0;

    for (const entity of archJson.entities) {
      for (const member of entity.members ?? []) {
        if (member.type === 'method') {
          methodCount++;
        } else if (member.type === 'field' || member.type === 'property') {
          fieldCount++;
        }
      }
    }

    return {
      entityCount: archJson.entities.length,
      methodCount,
      fieldCount,
      relationCount: archJson.relations?.length ?? 0,
    };
  }

  describe('01 - Simple Class', () => {
    it('should extract consistent entity count across languages', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '01-simple-class');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      // All languages should extract same number of entities
      for (const result of results) {
        expect(
          result.metrics.entityCount,
          `${result.language} should have ${spec.expectedMetrics.entityCount} entities`
        ).toBe(spec.expectedMetrics.entityCount);
      }
    });

    it('should extract consistent method count across languages', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '01-simple-class');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      for (const result of results) {
        expect(
          result.metrics.methodCount,
          `${result.language} should have ${spec.expectedMetrics.methodCount} methods`
        ).toBe(spec.expectedMetrics.methodCount);
      }
    });

    it('should extract consistent field count across languages', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '01-simple-class');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      for (const result of results) {
        expect(
          result.metrics.fieldCount,
          `${result.language} should have ${spec.expectedMetrics.fieldCount} fields`
        ).toBe(spec.expectedMetrics.fieldCount);
      }
    });
  });

  describe('02 - Interface Implementation', () => {
    it('should extract consistent entity count for interface patterns', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '02-interface-implementation');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      for (const result of results) {
        expect(
          result.metrics.entityCount,
          `${result.language} should have ${spec.expectedMetrics.entityCount} entities`
        ).toBe(spec.expectedMetrics.entityCount);
      }
    });

    it('should detect interface entity type', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '02-interface-implementation');
      const results = await parseFixtureWithLanguages(fixtureDir, ['typescript', 'go']);

      for (const result of results) {
        const interfaceEntity = result.archJson.entities.find(
          (e) => e.name.toLowerCase().includes('repository') && e.type === 'interface'
        );

        expect(
          interfaceEntity,
          `${result.language} should detect IRepository interface`
        ).toBeDefined();
      }
    });

    it('should detect implementation class/struct', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '02-interface-implementation');
      const results = await parseFixtureWithLanguages(fixtureDir, ['typescript', 'go']);

      for (const result of results) {
        const implEntity = result.archJson.entities.find(
          (e) =>
            e.name.toLowerCase().includes('inmemory') && (e.type === 'class' || e.type === 'struct')
        );

        expect(
          implEntity,
          `${result.language} should detect InMemoryRepository implementation`
        ).toBeDefined();
      }
    });
  });

  describe('03 - Composition', () => {
    it('should extract consistent entity count for composition patterns', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '03-composition');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      for (const result of results) {
        expect(
          result.metrics.entityCount,
          `${result.language} should have ${spec.expectedMetrics.entityCount} entities`
        ).toBe(spec.expectedMetrics.entityCount);
      }
    });

    it('should detect Address and Person entities', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '03-composition');
      const results = await parseFixtureWithLanguages(fixtureDir, ['typescript', 'go']);

      for (const result of results) {
        const addressEntity = result.archJson.entities.find((e) => e.name === 'Address');
        const personEntity = result.archJson.entities.find((e) => e.name === 'Person');

        expect(addressEntity, `${result.language} should detect Address entity`).toBeDefined();
        expect(personEntity, `${result.language} should detect Person entity`).toBeDefined();
      }
    });
  });

  describe('04 - Inheritance', () => {
    it('should extract consistent entity count for inheritance patterns', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '04-inheritance');
      const spec = await loadFixtureSpec(fixtureDir);
      const results = await parseFixtureWithLanguages(fixtureDir, spec.languages);

      for (const result of results) {
        expect(
          result.metrics.entityCount,
          `${result.language} should have ${spec.expectedMetrics.entityCount} entities`
        ).toBe(spec.expectedMetrics.entityCount);
      }
    });

    it('should detect Animal and Dog entities', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '04-inheritance');
      const results = await parseFixtureWithLanguages(fixtureDir, ['typescript', 'go']);

      for (const result of results) {
        // Note: Go uses BaseAnimal, TypeScript uses Animal
        const animalEntity = result.archJson.entities.find(
          (e) => e.name.includes('Animal') || e.name.includes('BaseAnimal')
        );
        const dogEntity = result.archJson.entities.find((e) => e.name === 'Dog');

        expect(animalEntity, `${result.language} should detect Animal entity`).toBeDefined();
        expect(dogEntity, `${result.language} should detect Dog entity`).toBeDefined();
      }
    });

    it('should have consistent method counts (accounting for language differences)', async () => {
      const fixtureDir = path.join(FIXTURES_DIR, '04-inheritance');
      const results = await parseFixtureWithLanguages(fixtureDir, ['typescript', 'go']);

      // TypeScript: Animal has makeSound, Dog has makeSound + fetch = 3 methods
      // Go: BaseAnimal has MakeSound, Dog has MakeSound + Fetch = 3 methods
      const tsResult = results.find((r) => r.language === 'typescript');
      const goResult = results.find((r) => r.language === 'go');

      // Method counts should be similar (may vary due to constructor counting)
      expect(tsResult?.metrics.methodCount).toBeGreaterThanOrEqual(3);
      expect(goResult?.metrics.methodCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Fixture Discovery', () => {
    it('should discover all fixture directories', async () => {
      const fixtureDirs = await fs.readdir(FIXTURES_DIR);

      const expectedFixtures = [
        '01-simple-class',
        '02-interface-implementation',
        '03-composition',
        '04-inheritance',
      ];

      for (const expected of expectedFixtures) {
        expect(fixtureDirs, `Should have fixture: ${expected}`).toContain(expected);
      }
    });

    it('should have valid spec.json in each fixture', async () => {
      const fixtureDirs = [
        '01-simple-class',
        '02-interface-implementation',
        '03-composition',
        '04-inheritance',
      ];

      for (const dir of fixtureDirs) {
        const specPath = path.join(FIXTURES_DIR, dir, 'spec.json');
        const exists = await fs.pathExists(specPath);
        expect(exists, `${dir} should have spec.json`).toBe(true);

        const spec = await loadFixtureSpec(path.join(FIXTURES_DIR, dir));
        expect(spec.name, `${dir} spec should have name`).toBeDefined();
        expect(spec.languages, `${dir} spec should have languages array`).toBeInstanceOf(Array);
        expect(spec.expectedMetrics, `${dir} spec should have expectedMetrics`).toBeDefined();
      }
    });

    it('should have source files for all specified languages', async () => {
      const fixtureDirs = [
        '01-simple-class',
        '02-interface-implementation',
        '03-composition',
        '04-inheritance',
      ];

      for (const dir of fixtureDirs) {
        const fixturePath = path.join(FIXTURES_DIR, dir);
        const spec = await loadFixtureSpec(fixturePath);

        for (const language of spec.languages) {
          const sourceFile = getSourceFile(fixturePath, language);
          const exists = await fs.pathExists(sourceFile);
          expect(exists, `${dir} should have ${language} source file`).toBe(true);
        }
      }
    });
  });

  describe('Plugin Registry Integration', () => {
    it('should have TypeScript plugin registered', () => {
      expect(registry.has('typescript')).toBe(true);
    });

    it('should have Go plugin registered', () => {
      expect(registry.has('golang')).toBe(true);
    });

    it('should get TypeScript plugin by extension', () => {
      const plugin = registry.getByExtension('.ts');
      expect(plugin).toBeDefined();
      expect(plugin?.metadata.name).toBe('typescript');
    });

    it('should get Go plugin by extension', () => {
      const plugin = registry.getByExtension('.go');
      expect(plugin).toBeDefined();
      expect(plugin?.metadata.name).toBe('golang');
    });
  });
});

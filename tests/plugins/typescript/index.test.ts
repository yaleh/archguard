/**
 * TypeScript Plugin Tests
 * Phase 1.1: T1.1.1 - TypeScript Plugin Skeleton Tests
 *           T1.1.2 - Wrapping Existing Parsers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import type { PluginInitConfig } from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/typescript-plugin');

describe('TypeScriptPlugin - T1.1.1 Skeleton', () => {
  let plugin: TypeScriptPlugin;
  let tempDir: string;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    tempDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  describe('Metadata', () => {
    it('should have correct plugin name', () => {
      expect(plugin.metadata.name).toBe('typescript');
    });

    it('should have correct version', () => {
      expect(plugin.metadata.version).toBe('1.0.0');
    });

    it('should have correct display name', () => {
      expect(plugin.metadata.displayName).toBe('TypeScript/JavaScript');
    });

    it('should support TypeScript and JavaScript file extensions', () => {
      expect(plugin.metadata.fileExtensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
    });

    it('should have correct author', () => {
      expect(plugin.metadata.author).toBe('ArchGuard Team');
    });

    it('should have correct minimum core version', () => {
      expect(plugin.metadata.minCoreVersion).toBe('2.0.0');
    });

    it('should have correct capabilities', () => {
      expect(plugin.metadata.capabilities).toEqual({
        singleFileParsing: true,
        incrementalParsing: true,
        dependencyExtraction: true,
        typeInference: true,
      });
    });
  });

  describe('Lifecycle', () => {
    it('should initialize successfully', async () => {
      const config: PluginInitConfig = {
        workspaceRoot: tempDir,
        cacheDir: path.join(tempDir, '.cache'),
        verbose: false,
      };

      await expect(plugin.initialize(config)).resolves.not.toThrow();
    });

    it('should initialize without cache directory', async () => {
      const config: PluginInitConfig = {
        workspaceRoot: tempDir,
        verbose: false,
      };

      await expect(plugin.initialize(config)).resolves.not.toThrow();
    });

    it('should dispose successfully', async () => {
      const config: PluginInitConfig = {
        workspaceRoot: tempDir,
      };

      await plugin.initialize(config);
      await expect(plugin.dispose()).resolves.not.toThrow();
    });

    it('should dispose without prior initialization', async () => {
      const freshPlugin = new TypeScriptPlugin();
      await expect(freshPlugin.dispose()).resolves.not.toThrow();
    });
  });

  describe('canHandle', () => {
    it('should handle .ts files', () => {
      expect(plugin.canHandle('/path/to/file.ts')).toBe(true);
    });

    it('should handle .tsx files', () => {
      expect(plugin.canHandle('/path/to/component.tsx')).toBe(true);
    });

    it('should handle .js files', () => {
      expect(plugin.canHandle('/path/to/script.js')).toBe(true);
    });

    it('should handle .jsx files', () => {
      expect(plugin.canHandle('/path/to/component.jsx')).toBe(true);
    });

    it('should reject unsupported file extensions', () => {
      expect(plugin.canHandle('/path/to/file.py')).toBe(false);
      expect(plugin.canHandle('/path/to/file.go')).toBe(false);
      expect(plugin.canHandle('/path/to/file.java')).toBe(false);
      expect(plugin.canHandle('/path/to/file.rs')).toBe(false);
    });

    it('should handle directories with package.json', async () => {
      const packageJsonPath = path.join(tempDir, 'package.json');
      await fs.writeJson(packageJsonPath, { name: 'test-project' });

      expect(plugin.canHandle(tempDir)).toBe(true);
    });

    it('should handle directories with tsconfig.json', async () => {
      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeJson(tsconfigPath, { compilerOptions: {} });

      expect(plugin.canHandle(tempDir)).toBe(true);
    });

    it('should reject directories without TypeScript/JavaScript markers', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      await fs.ensureDir(emptyDir);

      expect(plugin.canHandle(emptyDir)).toBe(false);
    });
  });
});

describe('TypeScriptPlugin - T1.1.2 Parser Wrapping', () => {
  let plugin: TypeScriptPlugin;
  let tempDir: string;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    tempDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    const config: PluginInitConfig = {
      workspaceRoot: tempDir,
      verbose: false,
    };
    await plugin.initialize(config);
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  describe('parseCode', () => {
    it('should parse TypeScript class', () => {
      const code = `
        export class TestClass {
          private value: string;

          constructor(value: string) {
            this.value = value;
          }

          getValue(): string {
            return this.value;
          }
        }
      `;

      const result = plugin.parseCode(code, 'test.ts');

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0');
      expect(result.language).toBe('typescript');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('TestClass');
      expect(result.entities[0].type).toBe('class');
    });

    it('should set language to typescript', () => {
      const code = `export class Simple {}`;
      const result = plugin.parseCode(code);

      expect(result.language).toBe('typescript');
    });

    it('should extract entities and members', () => {
      const code = `
        export class UserService {
          async getUser(id: string): Promise<User> {
            return {} as User;
          }
        }
      `;

      const result = plugin.parseCode(code);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].members).toHaveLength(1);
      expect(result.entities[0].members[0].name).toBe('getUser');
      expect(result.entities[0].members[0].type).toBe('method');
    });

    it('should use default file path if not provided', () => {
      const code = `export class Test {}`;
      const result = plugin.parseCode(code);

      expect(result.sourceFiles).toContain('source.ts');
    });

    it('should use custom file path when provided', () => {
      const code = `export class Test {}`;
      const result = plugin.parseCode(code, 'custom.ts');

      expect(result.sourceFiles).toContain('custom.ts');
    });
  });

  describe('parseProject', () => {
    it('should parse fixture project', async () => {
      const config: ParseConfig = {
        workspaceRoot: FIXTURES_DIR,
        excludePatterns: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
      };

      const result = await plugin.parseProject(FIXTURES_DIR, config);

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0');
      expect(result.language).toBe('typescript');
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.sourceFiles.length).toBeGreaterThan(0);
    });

    it('should respect file patterns', async () => {
      // Create a temp project with .ts and .js files
      const srcDir = path.join(tempDir, 'src');
      await fs.ensureDir(srcDir);
      await fs.writeFile(path.join(srcDir, 'class.ts'), 'export class Test {}');
      await fs.writeFile(path.join(srcDir, 'script.js'), 'function test() {}');

      const config: ParseConfig = {
        workspaceRoot: tempDir,
        excludePatterns: [],
        filePattern: '**/*.ts', // Only TypeScript files
      };

      const result = await plugin.parseProject(tempDir, config);

      // Should only include .ts files
      const tsFiles = result.sourceFiles.filter((f) => f.endsWith('.ts'));
      const jsFiles = result.sourceFiles.filter((f) => f.endsWith('.js'));

      expect(tsFiles.length).toBeGreaterThan(0);
      expect(jsFiles.length).toBe(0);
    });

    it('should exclude test files by default', async () => {
      const srcDir = path.join(tempDir, 'src');
      await fs.ensureDir(srcDir);
      await fs.writeFile(path.join(srcDir, 'class.ts'), 'export class Test {}');
      await fs.writeFile(path.join(srcDir, 'class.test.ts'), 'describe("test", () => {})');

      const config: ParseConfig = {
        workspaceRoot: tempDir,
        excludePatterns: ['**/*.test.ts'],
      };

      const result = await plugin.parseProject(tempDir, config);

      const testFiles = result.sourceFiles.filter((f) => f.includes('.test.'));
      expect(testFiles.length).toBe(0);
    });
  });

  describe('parseFiles', () => {
    it('should parse multiple files', async () => {
      const file1 = path.join(FIXTURES_DIR, 'simple-class.ts');
      const filePaths = [file1];

      const result = await plugin.parseFiles(filePaths);

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0');
      expect(result.language).toBe('typescript');
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should use ParallelParser for concurrent processing', async () => {
      // Create multiple files
      const srcDir = path.join(tempDir, 'src');
      await fs.ensureDir(srcDir);

      const files = [];
      for (let i = 0; i < 3; i++) {
        const filePath = path.join(srcDir, `class${i}.ts`);
        await fs.writeFile(filePath, `export class Test${i} {}`);
        files.push(filePath);
      }

      const result = await plugin.parseFiles(files);

      expect(result.entities.length).toBe(3);
      expect(result.sourceFiles.length).toBe(3);
    });

    it('should handle empty file list', async () => {
      const result = await plugin.parseFiles([]);

      expect(result.entities).toHaveLength(0);
      expect(result.sourceFiles).toHaveLength(0);
    });
  });
});

describe('TypeScriptPlugin - T1.1.3 Dependency Extraction', () => {
  let plugin: TypeScriptPlugin;
  let tempDir: string;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    tempDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    const config: PluginInitConfig = {
      workspaceRoot: tempDir,
      verbose: false,
    };
    await plugin.initialize(config);
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  describe('extractDependencies', () => {
    it('should extract npm dependencies from package.json', async () => {
      // Copy fixture package.json to temp directory
      const fixturePackageJson = path.join(FIXTURES_DIR, 'package.json');
      const tempPackageJson = path.join(tempDir, 'package.json');
      await fs.copy(fixturePackageJson, tempPackageJson);

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      expect(dependencies.length).toBeGreaterThan(0);

      // Check that dependencies are extracted
      const express = dependencies.find((d) => d.name === 'express');
      expect(express).toBeDefined();
      expect(express?.type).toBe('npm');
      expect(express?.scope).toBe('runtime');
      expect(express?.isDirect).toBe(true);
      expect(express?.source).toBe('package.json');
    });

    it('should extract devDependencies with development scope', async () => {
      const fixturePackageJson = path.join(FIXTURES_DIR, 'package.json');
      const tempPackageJson = path.join(tempDir, 'package.json');
      await fs.copy(fixturePackageJson, tempPackageJson);

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      const vitest = dependencies.find((d) => d.name === 'vitest');
      expect(vitest).toBeDefined();
      expect(vitest?.scope).toBe('development');
      expect(vitest?.isDirect).toBe(true);
    });

    it('should extract peerDependencies with peer scope', async () => {
      const fixturePackageJson = path.join(FIXTURES_DIR, 'package.json');
      const tempPackageJson = path.join(tempDir, 'package.json');
      await fs.copy(fixturePackageJson, tempPackageJson);

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      const react = dependencies.find((d) => d.name === 'react');
      expect(react).toBeDefined();
      expect(react?.scope).toBe('peer');
      expect(react?.isDirect).toBe(true);
    });

    it('should handle missing package.json', async () => {
      // No package.json in tempDir
      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      expect(dependencies).toEqual([]);
    });

    it('should handle empty package.json', async () => {
      const emptyPackageJson = path.join(tempDir, 'package.json');
      await fs.writeJson(emptyPackageJson, { name: 'empty-project' });

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      expect(dependencies).toEqual([]);
    });

    it('should set all dependencies as direct', async () => {
      const fixturePackageJson = path.join(FIXTURES_DIR, 'package.json');
      const tempPackageJson = path.join(tempDir, 'package.json');
      await fs.copy(fixturePackageJson, tempPackageJson);

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      dependencies.forEach((dep) => {
        expect(dep.isDirect).toBe(true);
      });
    });

    it('should include version information', async () => {
      const fixturePackageJson = path.join(FIXTURES_DIR, 'package.json');
      const tempPackageJson = path.join(tempDir, 'package.json');
      await fs.copy(fixturePackageJson, tempPackageJson);

      const dependencies = await plugin.dependencyExtractor.extractDependencies(tempDir);

      const lodash = dependencies.find((d) => d.name === 'lodash');
      expect(lodash).toBeDefined();
      expect(lodash?.version).toBe('^4.17.21');
    });
  });
});

describe('TypeScriptPlugin - T1.1.4 Validation', () => {
  let plugin: TypeScriptPlugin;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: __dirname });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('validate', () => {
    it('should validate valid ArchJSON', () => {
      const validArchJson: any = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'TestClass',
            name: 'TestClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: {
              file: 'test.ts',
              startLine: 1,
              endLine: 5,
            },
          },
        ],
        relations: [],
      };

      const result = plugin.validator.validate(validArchJson);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect missing version', () => {
      const invalidJson: any = {
        language: 'typescript',
        entities: [],
        relations: [],
      };

      const result = plugin.validator.validate(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_VERSION',
          severity: 'error',
        })
      );
    });

    it('should detect missing language', () => {
      const invalidJson: any = {
        version: '1.0',
        entities: [],
        relations: [],
      };

      const result = plugin.validator.validate(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_LANGUAGE',
          severity: 'error',
        })
      );
    });

    it('should detect missing entity id', () => {
      const invalidJson: any = {
        version: '1.0',
        language: 'typescript',
        entities: [
          {
            name: 'TestClass',
            type: 'class',
          },
        ],
        relations: [],
      };

      const result = plugin.validator.validate(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTITY_ID',
          path: 'entities[0].id',
        })
      );
    });

    it('should detect missing entity name', () => {
      const invalidJson: any = {
        version: '1.0',
        language: 'typescript',
        entities: [
          {
            id: 'test',
            type: 'class',
          },
        ],
        relations: [],
      };

      const result = plugin.validator.validate(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTITY_NAME',
          path: 'entities[0].name',
        })
      );
    });

    it('should warn about dangling relation source', () => {
      const jsonWithDanglingRelation: any = {
        version: '1.0',
        language: 'typescript',
        entities: [
          {
            id: 'ClassA',
            name: 'ClassA',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
          },
        ],
        relations: [
          {
            id: 'rel-1',
            type: 'dependency',
            source: 'NonExistent',
            target: 'ClassA',
          },
        ],
      };

      const result = plugin.validator.validate(jsonWithDanglingRelation);

      expect(result.valid).toBe(true); // Warnings don't invalidate
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'DANGLING_RELATION_SOURCE',
          severity: 'warning',
        })
      );
    });

    it('should warn about dangling relation target', () => {
      const jsonWithDanglingRelation: any = {
        version: '1.0',
        language: 'typescript',
        entities: [
          {
            id: 'ClassA',
            name: 'ClassA',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
          },
        ],
        relations: [
          {
            id: 'rel-1',
            type: 'dependency',
            source: 'ClassA',
            target: 'NonExistent',
          },
        ],
      };

      const result = plugin.validator.validate(jsonWithDanglingRelation);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'DANGLING_RELATION_TARGET',
          severity: 'warning',
        })
      );
    });

    it('should include suggestions in warnings', () => {
      const jsonWithDanglingRelation: any = {
        version: '1.0',
        language: 'typescript',
        entities: [],
        relations: [
          {
            id: 'rel-1',
            type: 'dependency',
            source: 'A',
            target: 'B',
          },
        ],
      };

      const result = plugin.validator.validate(jsonWithDanglingRelation);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].suggestion).toBeDefined();
    });
  });
});

describe('TypeScriptPlugin - T1.1.5 Integration Tests', () => {
  let plugin: TypeScriptPlugin;
  let tempDir: string;

  beforeEach(async () => {
    plugin = new TypeScriptPlugin();
    tempDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    await plugin.initialize({
      workspaceRoot: tempDir,
      verbose: false,
    });
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  it('should complete full workflow: parse, extract, validate', async () => {
    // Create a small TypeScript project
    const srcDir = path.join(tempDir, 'src');
    await fs.ensureDir(srcDir);

    const classFile = path.join(srcDir, 'service.ts');
    await fs.writeFile(
      classFile,
      `
export class UserService {
  getUser(id: string): User {
    return { id };
  }
}
      `
    );

    const packageJson = path.join(tempDir, 'package.json');
    await fs.writeJson(packageJson, {
      name: 'test-app',
      dependencies: {
        express: '^4.0.0',
      },
    });

    // 1. Parse the code
    const config: ParseConfig = {
      workspaceRoot: tempDir,
      excludePatterns: [],
    };
    const archJson = await plugin.parseProject(tempDir, config);

    expect(archJson.language).toBe('typescript');
    expect(archJson.entities.length).toBeGreaterThan(0);

    // 2. Extract dependencies
    const deps = await plugin.dependencyExtractor.extractDependencies(tempDir);
    expect(deps).toContainEqual(
      expect.objectContaining({
        name: 'express',
        type: 'npm',
      })
    );

    // 3. Validate the result
    const validation = plugin.validator.validate(archJson);
    expect(validation.valid).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    // Test with non-existent directory
    const nonExistent = path.join(tempDir, 'does-not-exist');

    const config: ParseConfig = {
      workspaceRoot: nonExistent,
      excludePatterns: [],
    };

    // Should not throw, but return empty result (graceful degradation)
    const result = await plugin.parseProject(nonExistent, config);
    expect(result.entities).toHaveLength(0);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('should preserve existing TypeScript parser behavior', async () => {
    // This test ensures backward compatibility
    const code = `
      export class LegacyClass {
        oldMethod(): void {}
      }
    `;

    const result = plugin.parseCode(code);

    // Should produce same output as old TypeScriptParser
    expect(result.version).toBe('1.0');
    expect(result.language).toBe('typescript');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('LegacyClass');
  });

  it('should integrate with PluginRegistry', async () => {
    const { PluginRegistry } = await import('@/core/plugin-registry.js');
    const registry = new PluginRegistry();

    registry.register(plugin);

    const retrieved = registry.getByName('typescript');
    expect(retrieved).toBe(plugin);

    const byExtension = registry.getByExtension('.ts');
    expect(byExtension).toBe(plugin);
  });
});

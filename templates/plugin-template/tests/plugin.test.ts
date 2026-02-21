/**
 * Plugin Test Template
 *
 * This template provides test examples for your language plugin.
 * Customize the tests based on your language's features.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { MyLanguagePlugin } from '../src/index.js';

describe('MyLanguagePlugin', () => {
  let plugin: MyLanguagePlugin;
  const fixturesDir = path.join(__dirname, 'fixtures');

  beforeEach(async () => {
    plugin = new MyLanguagePlugin();
    await plugin.initialize({
      workspaceRoot: fixturesDir,
      verbose: false,
    });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  // ==================== Metadata Tests ====================

  describe('metadata', () => {
    it('should have correct plugin name', () => {
      expect(plugin.metadata.name).toBe('my-language');
    });

    it('should have valid version', () => {
      expect(plugin.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have file extensions defined', () => {
      expect(plugin.metadata.fileExtensions.length).toBeGreaterThan(0);
    });

    it('should have capabilities defined', () => {
      expect(plugin.metadata.capabilities).toBeDefined();
      expect(typeof plugin.metadata.capabilities.singleFileParsing).toBe('boolean');
      expect(typeof plugin.metadata.capabilities.dependencyExtraction).toBe('boolean');
    });
  });

  // ==================== canHandle Tests ====================

  describe('canHandle', () => {
    it('should handle files with supported extensions', () => {
      expect(plugin.canHandle('test.my')).toBe(true);
      expect(plugin.canHandle('test.ml')).toBe(true);
    });

    it('should not handle files with unsupported extensions', () => {
      expect(plugin.canHandle('test.txt')).toBe(false);
      expect(plugin.canHandle('test.js')).toBe(false);
    });

    it('should handle directories with project markers', () => {
      // Create temp directory with marker
      const tempDir = path.join(fixturesDir, 'temp-project');
      fs.ensureDirSync(tempDir);
      fs.writeFileSync(path.join(tempDir, 'myproject.toml'), '');

      expect(plugin.canHandle(tempDir)).toBe(true);

      // Cleanup
      fs.removeSync(tempDir);
    });

    it('should not handle directories without project markers', () => {
      const tempDir = path.join(fixturesDir, 'temp-no-marker');
      fs.ensureDirSync(tempDir);

      expect(plugin.canHandle(tempDir)).toBe(false);

      // Cleanup
      fs.removeSync(tempDir);
    });
  });

  // ==================== parseCode Tests ====================

  describe('parseCode', () => {
    it('should parse empty code', () => {
      const result = plugin.parseCode('');

      expect(result.entities).toEqual([]);
      expect(result.relations).toEqual([]);
    });

    it('should parse a simple class', () => {
      const code = `
        class MyClass {
          field: string
          method(): void {}
        }
      `;

      const result = plugin.parseCode(code);

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities[0].name).toBe('MyClass');
      expect(result.entities[0].type).toBe('class');
    });

    it('should include source location information', () => {
      const code = `class TestClass {}`;

      const result = plugin.parseCode(code);

      expect(result.entities[0].sourceLocation).toBeDefined();
      expect(result.entities[0].sourceLocation.startLine).toBeGreaterThan(0);
    });

    it('should extract inheritance relations', () => {
      const code = `
        class Parent {}
        class Child extends Parent {}
      `;

      const result = plugin.parseCode(code);

      const inheritanceRelations = result.relations.filter(
        r => r.type === 'inheritance'
      );
      expect(inheritanceRelations.length).toBeGreaterThan(0);
    });

    it('should extract implementation relations', () => {
      const code = `
        interface MyInterface {}
        class MyClass implements MyInterface {}
      `;

      const result = plugin.parseCode(code);

      const implRelations = result.relations.filter(
        r => r.type === 'implementation'
      );
      expect(implRelations.length).toBeGreaterThan(0);
    });
  });

  // ==================== parseProject Tests ====================

  describe('parseProject', () => {
    it('should parse project directory', async () => {
      const result = await plugin.parseProject(fixturesDir, {
        workspaceRoot: fixturesDir,
        excludePatterns: [],
      });

      expect(result.language).toBe('my-language');
      expect(result.version).toBe('1.0');
      expect(result.timestamp).toBeDefined();
      expect(Array.isArray(result.sourceFiles)).toBe(true);
      expect(Array.isArray(result.entities)).toBe(true);
      expect(Array.isArray(result.relations)).toBe(true);
    });

    it('should respect exclude patterns', async () => {
      const result = await plugin.parseProject(fixturesDir, {
        workspaceRoot: fixturesDir,
        excludePatterns: ['**/exclude/**'],
      });

      const hasExcludedFiles = result.sourceFiles.some(
        f => f.includes('exclude')
      );
      expect(hasExcludedFiles).toBe(false);
    });

    it('should handle missing files gracefully', async () => {
      // Non-existent directory should not throw
      const result = await plugin.parseProject('/non/existent/path', {
        workspaceRoot: '/non/existent/path',
        excludePatterns: [],
      });

      expect(result.entities).toEqual([]);
    });
  });

  // ==================== parseFiles Tests ====================

  describe('parseFiles', () => {
    it('should parse multiple files', async () => {
      const testFile = path.join(fixturesDir, 'basic', 'class.my');

      // Ensure test file exists
      await fs.ensureFile(testFile);
      await fs.writeFile(testFile, 'class TestClass {}');

      const result = await plugin.parseFiles([testFile]);

      expect(result.sourceFiles).toContain(testFile);
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should handle empty file list', async () => {
      const result = await plugin.parseFiles([]);

      expect(result.entities).toEqual([]);
      expect(result.relations).toEqual([]);
    });
  });

  // ==================== Error Handling Tests ====================

  describe('error handling', () => {
    it('should throw when not initialized', async () => {
      const uninitializedPlugin = new MyLanguagePlugin();

      expect(() => uninitializedPlugin.parseCode('class Test {}')).toThrow(
        /not initialized/i
      );
    });

    it('should handle syntax errors gracefully', () => {
      const invalidCode = 'class { invalid syntax }';

      // Should not throw, may return empty or partial results
      const result = plugin.parseCode(invalidCode);

      expect(result).toBeDefined();
      expect(Array.isArray(result.entities)).toBe(true);
    });
  });
});

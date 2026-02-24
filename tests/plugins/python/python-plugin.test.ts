/**
 * Tests for PythonPlugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { PythonPlugin } from '@/plugins/python/index.js';
import type { PluginInitConfig } from '@/core/interfaces/language-plugin.js';

describe('PythonPlugin', () => {
  let plugin: PythonPlugin;
  let tempDir: string;

  beforeEach(async () => {
    plugin = new PythonPlugin();
    tempDir = path.join(process.cwd(), 'test-temp-python-plugin');
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await plugin.dispose();
    await fs.remove(tempDir);
  });

  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      expect(plugin.metadata.name).toBe('python');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.displayName).toBe('Python');
      expect(plugin.metadata.fileExtensions).toContain('.py');
      expect(plugin.metadata.author).toBe('ArchGuard Team');
      expect(plugin.metadata.minCoreVersion).toBe('2.0.0');
    });

    it('should declare correct capabilities', () => {
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.incrementalParsing).toBe(true);
      expect(plugin.metadata.capabilities.dependencyExtraction).toBe(true);
      expect(plugin.metadata.capabilities.typeInference).toBe(false);
    });
  });

  describe('canHandle', () => {
    it('should handle .py files', () => {
      expect(plugin.canHandle('/path/to/file.py')).toBe(true);
      expect(plugin.canHandle('/path/to/script.py')).toBe(true);
    });

    it('should not handle non-Python files', () => {
      expect(plugin.canHandle('/path/to/file.ts')).toBe(false);
      expect(plugin.canHandle('/path/to/file.js')).toBe(false);
      expect(plugin.canHandle('/path/to/file.go')).toBe(false);
    });

    it('should handle directories with Python markers', async () => {
      // Create temp directory with pyproject.toml
      const pyprojectDir = path.join(tempDir, 'pyproject-project');
      await fs.ensureDir(pyprojectDir);
      await fs.writeFile(path.join(pyprojectDir, 'pyproject.toml'), '[tool.poetry]\nname = "test"');

      expect(plugin.canHandle(pyprojectDir)).toBe(true);

      // Create temp directory with requirements.txt
      const reqDir = path.join(tempDir, 'requirements-project');
      await fs.ensureDir(reqDir);
      await fs.writeFile(path.join(reqDir, 'requirements.txt'), 'flask==2.0.0');

      expect(plugin.canHandle(reqDir)).toBe(true);

      // Create temp directory with setup.py
      const setupDir = path.join(tempDir, 'setup-project');
      await fs.ensureDir(setupDir);
      await fs.writeFile(path.join(setupDir, 'setup.py'), 'from setuptools import setup');

      expect(plugin.canHandle(setupDir)).toBe(true);
    });

    it('should not handle directories without Python markers', async () => {
      const plainDir = path.join(tempDir, 'plain-project');
      await fs.ensureDir(plainDir);

      expect(plugin.canHandle(plainDir)).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const config: PluginInitConfig = {
        workspaceRoot: tempDir,
      };

      await expect(plugin.initialize(config)).resolves.not.toThrow();
    });

    it('should be idempotent', async () => {
      const config: PluginInitConfig = {
        workspaceRoot: tempDir,
      };

      await plugin.initialize(config);
      await expect(plugin.initialize(config)).resolves.not.toThrow();
    });
  });

  describe('parseCode', () => {
    beforeEach(async () => {
      await plugin.initialize({ workspaceRoot: tempDir });
    });

    it('should parse simple Python class', () => {
      const code = `
class User:
    def __init__(self, name: str):
        self.name = name

    def get_name(self) -> str:
        return self.name
      `.trim();

      const result = plugin.parseCode(code, 'user.py');

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].type).toBe('class');
      expect(result.entities[0].members).toHaveLength(2);
    });

    it('should parse module-level functions', () => {
      const code = `
def calculate_sum(a: int, b: int) -> int:
    return a + b

def greet(name: str) -> str:
    return f"Hello, {name}"
      `.trim();

      const result = plugin.parseCode(code, 'utils.py');

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe('calculate_sum');
      expect(result.entities[0].type).toBe('function');
      expect(result.entities[1].name).toBe('greet');
      expect(result.entities[1].type).toBe('function');
    });

    it('should parse inheritance', () => {
      const code = `
class Animal:
    pass

class Dog(Animal):
    pass
      `.trim();

      const result = plugin.parseCode(code, 'animals.py');

      expect(result.entities).toHaveLength(2);
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].type).toBe('inheritance');
      expect(result.relations[0].source).toContain('Dog');
      expect(result.relations[0].target).toContain('Animal');
    });

    it('should handle empty code', () => {
      const result = plugin.parseCode('', 'empty.py');

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(0);
    });

    it('should handle syntax errors gracefully', () => {
      const code = `
class User:
    def __init__(self
      `.trim();

      // Should not throw, but may return partial results
      expect(() => plugin.parseCode(code, 'broken.py')).not.toThrow();
    });
  });

  describe('parseFiles', () => {
    let testFile1: string;
    let testFile2: string;

    beforeEach(async () => {
      await plugin.initialize({ workspaceRoot: tempDir });

      testFile1 = path.join(tempDir, 'module1.py');
      testFile2 = path.join(tempDir, 'module2.py');

      await fs.writeFile(
        testFile1,
        `
class Class1:
    pass
      `.trim()
      );

      await fs.writeFile(
        testFile2,
        `
class Class2:
    pass
      `.trim()
      );
    });

    it('should parse multiple files', async () => {
      const result = await plugin.parseFiles([testFile1, testFile2]);

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe('Class1');
      expect(result.entities[1].name).toBe('Class2');
      expect(result.sourceFiles).toContain(testFile1);
      expect(result.sourceFiles).toContain(testFile2);
    });

    it('should handle single file', async () => {
      const result = await plugin.parseFiles([testFile1]);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Class1');
    });
  });

  describe('dependencyExtractor', () => {
    it('should provide dependency extractor', () => {
      expect(plugin.dependencyExtractor).toBeDefined();
    });

    it('should extract dependencies from requirements.txt', async () => {
      await fs.writeFile(path.join(tempDir, 'requirements.txt'), 'flask==2.0.0\nrequests>=2.25.0');

      const deps = await plugin.dependencyExtractor.extractDependencies(tempDir);

      expect(deps.length).toBeGreaterThanOrEqual(2);
      expect(deps.find((d) => d.name === 'flask')).toBeDefined();
      expect(deps.find((d) => d.name === 'requests')).toBeDefined();
    });

    it('should extract dependencies from pyproject.toml', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[tool.poetry.dependencies]
flask = "^2.0.0"

[tool.poetry.dev-dependencies]
pytest = "^6.2.0"
        `.trim()
      );

      const deps = await plugin.dependencyExtractor.extractDependencies(tempDir);

      expect(deps.length).toBeGreaterThanOrEqual(2);
      expect(deps.find((d) => d.name === 'flask')?.scope).toBe('runtime');
      expect(deps.find((d) => d.name === 'pytest')?.scope).toBe('development');
    });
  });

  describe('dispose', () => {
    it('should dispose resources', async () => {
      await plugin.initialize({ workspaceRoot: tempDir });
      await expect(plugin.dispose()).resolves.not.toThrow();
    });
  });
});

// Import afterEach for cleanup
import { afterEach } from 'vitest';

/**
 * Integration tests for Python Plugin
 *
 * Tests end-to-end functionality with real Python files
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { PythonPlugin } from '@/plugins/python/index.js';
import type { PluginInitConfig } from '@/core/interfaces/language-plugin.js';

describe('PythonPlugin Integration Tests', () => {
  let plugin: PythonPlugin;
  let fixturesDir: string;

  beforeAll(async () => {
    plugin = new PythonPlugin();
    fixturesDir = path.join(process.cwd(), 'tests', 'fixtures', 'python');

    const config: PluginInitConfig = {
      workspaceRoot: fixturesDir,
    };

    await plugin.initialize(config);
  });

  afterAll(async () => {
    await plugin.dispose();
  });

  describe('Real Python fixtures', () => {
    it('should parse simple-class.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'simple-class.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      expect(result.language).toBe('python');
      expect(result.entities.length).toBeGreaterThan(0);

      const userClass = result.entities.find(e => e.name === 'User');
      expect(userClass).toBeDefined();
      expect(userClass?.type).toBe('class');
      expect(userClass?.members.length).toBeGreaterThan(0);

      // Check methods
      const initMethod = userClass?.members.find(m => m.name === '__init__');
      expect(initMethod).toBeDefined();

      const getNameMethod = userClass?.members.find(m => m.name === 'get_name');
      expect(getNameMethod).toBeDefined();
      expect(getNameMethod?.returnType).toBe('str');
    });

    it('should parse inheritance.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'inheritance.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      expect(result.entities.length).toBeGreaterThanOrEqual(3);

      const userClass = result.entities.find(e => e.name === 'User');
      const auditableClass = result.entities.find(e => e.name === 'Auditable');
      const adminUserClass = result.entities.find(e => e.name === 'AdminUser');

      expect(userClass).toBeDefined();
      expect(auditableClass).toBeDefined();
      expect(adminUserClass).toBeDefined();

      // Check inheritance relations
      const inheritanceRelations = result.relations.filter(r => r.type === 'inheritance');
      expect(inheritanceRelations.length).toBeGreaterThanOrEqual(2);

      // AdminUser should inherit from both User and Auditable
      const adminInherits = inheritanceRelations.filter(
        r => r.source.includes('AdminUser')
      );
      expect(adminInherits.length).toBe(2);
    });

    it('should parse decorators.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'decorators.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      const serviceClass = result.entities.find(e => e.name === 'Service');
      expect(serviceClass).toBeDefined();

      // Check for property decorator
      const nameMethod = serviceClass?.members.find(m => m.name === 'name');
      expect(nameMethod).toBeDefined();
      expect(nameMethod?.decorators).toBeDefined();
      expect(nameMethod?.decorators?.some(d => d.name === 'property')).toBe(true);

      // Check for classmethod decorator
      const createMethod = serviceClass?.members.find(m => m.name === 'create');
      expect(createMethod).toBeDefined();
      expect(createMethod?.decorators?.some(d => d.name === 'classmethod')).toBe(true);

      // Check for staticmethod decorator
      const validateMethod = serviceClass?.members.find(m => m.name === 'validate');
      expect(validateMethod).toBeDefined();
      expect(validateMethod?.decorators?.some(d => d.name === 'staticmethod')).toBe(true);
    });

    it('should parse type-hints.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'type-hints.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      const processorClass = result.entities.find(e => e.name === 'DataProcessor');
      expect(processorClass).toBeDefined();

      const processMethod = processorClass?.members.find(m => m.name === 'process_items');
      expect(processMethod).toBeDefined();
      expect(processMethod?.parameters).toBeDefined();
      expect(processMethod?.parameters?.length).toBeGreaterThan(0);

      // Check parameter types
      const itemsParam = processMethod?.parameters?.find(p => p.name === 'items');
      expect(itemsParam?.type).toContain('List');

      // Check return type
      expect(processMethod?.returnType).toBeDefined();
    });

    it('should parse async-functions.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'async-functions.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      // Should have both module-level function and class
      expect(result.entities.length).toBeGreaterThanOrEqual(2);

      // Check module-level async function
      const fetchDataFunc = result.entities.find(e => e.name === 'fetch_data');
      expect(fetchDataFunc).toBeDefined();
      expect(fetchDataFunc?.type).toBe('function');

      const asyncServiceClass = result.entities.find(e => e.name === 'AsyncService');
      expect(asyncServiceClass).toBeDefined();

      const processMethod = asyncServiceClass?.members.find(m => m.name === 'process');
      expect(processMethod).toBeDefined();
      expect(processMethod?.isAsync).toBe(true);

      const fetchMultipleMethod = asyncServiceClass?.members.find(
        m => m.name === 'fetch_multiple'
      );
      expect(fetchMultipleMethod).toBeDefined();
      expect(fetchMultipleMethod?.isAsync).toBe(true);
    });

    it('should parse module-functions.py fixture', async () => {
      const filePath = path.join(fixturesDir, 'module-functions.py');
      const code = await fs.readFile(filePath, 'utf-8');

      const result = plugin.parseCode(code, filePath);

      // Module-level functions should be entities with type 'function'
      expect(result.entities.some(e => e.type === 'function')).toBe(true);

      const calculate = result.entities.find(e => e.name === 'calculate');
      expect(calculate).toBeDefined();
      expect(calculate?.type).toBe('function');

      const processString = result.entities.find(e => e.name === 'process_string');
      expect(processString).toBeDefined();
      expect(processString?.type).toBe('function');
    });
  });

  describe('Multi-file parsing', () => {
    it('should parse multiple Python files together', async () => {
      const files = [
        path.join(fixturesDir, 'simple-class.py'),
        path.join(fixturesDir, 'inheritance.py'),
      ];

      const result = await plugin.parseFiles(files);

      expect(result.language).toBe('python');
      expect(result.sourceFiles.length).toBe(2);

      // Should have entities from both files
      expect(result.entities.length).toBeGreaterThan(3);

      // Should include User from both files (they're different modules)
      const userEntities = result.entities.filter(e => e.name === 'User');
      expect(userEntities.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Dependency extraction', () => {
    it('should extract dependencies from pyproject.toml if present', async () => {
      const tempDir = path.join(process.cwd(), 'test-temp-deps');
      await fs.ensureDir(tempDir);

      try {
        await fs.writeFile(
          path.join(tempDir, 'pyproject.toml'),
          `
[tool.poetry]
name = "test-project"

[tool.poetry.dependencies]
python = "^3.8"
flask = "^2.0.0"

[tool.poetry.dev-dependencies]
pytest = "^6.2.0"
          `.trim()
        );

        const deps = await plugin.dependencyExtractor.extractDependencies(tempDir);

        expect(deps.length).toBeGreaterThanOrEqual(2);
        expect(deps.find(d => d.name === 'flask')).toBeDefined();
        expect(deps.find(d => d.name === 'pytest')).toBeDefined();
      } finally {
        await fs.remove(tempDir);
      }
    });
  });

  describe('Error handling', () => {
    it('should handle malformed Python code gracefully', async () => {
      const malformedCode = `
class User:
    def __init__(self
      `;

      const result = plugin.parseCode(malformedCode, 'malformed.py');

      // Should return a valid ArchJSON structure even with errors
      expect(result.language).toBe('python');
      expect(result.entities).toBeDefined();
      expect(result.relations).toBeDefined();
    });

    it('should handle empty files', async () => {
      const result = plugin.parseCode('', 'empty.py');

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });

    it('should handle files with only comments', async () => {
      const code = `
# This is a comment
# Another comment
      `.trim();

      const result = plugin.parseCode(code, 'comments.py');

      expect(result.language).toBe('python');
      expect(result.entities).toHaveLength(0);
    });
  });
});

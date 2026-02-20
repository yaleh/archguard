/**
 * Integration tests for PluginRegistry with real plugin loading
 * Written using TDD - tests first, implementation verified second
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '@/core/plugin-registry.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('PluginRegistry Integration Tests', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('loadFromPath()', () => {
    it('should discover and load mock plugin from file path', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);

      expect(plugin).toBeDefined();
      expect(plugin.metadata).toBeDefined();
      expect(plugin.metadata.name).toBe('mock');
      expect(plugin.metadata.version).toBe('1.0.0');
    });

    it('should register loaded mock plugin', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);
      registry.register(plugin);

      const retrieved = registry.getByName('mock');
      expect(retrieved).toBe(plugin);
    });

    it('should get mock plugin by file extension (.mock)', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);
      registry.register(plugin);

      const retrieved = registry.getByExtension('.mock');
      expect(retrieved).toBe(plugin);
      expect(retrieved?.metadata.name).toBe('mock');
    });

    it('should handle plugin initialization and disposal', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);

      // Initialize
      await plugin.initialize({
        workspaceRoot: '/tmp/test',
        verbose: false,
      });

      // Plugin should be functional
      expect(plugin.canHandle('test.mock')).toBe(true);
      expect(plugin.canHandle('test.ts')).toBe(false);

      // Dispose
      await plugin.dispose();
    });

    it('should support single-file parsing capability', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);

      // Check capability
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);

      // Use capability
      if (plugin.parseCode) {
        const result = plugin.parseCode('mock code', 'test.mock');
        expect(result).toBeDefined();
        expect(result.entities).toHaveLength(1);
        expect(result.entities[0].name).toBe('MockEntity');
      }
    });

    it('should support incremental parsing capability', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);

      // Check capability
      expect(plugin.metadata.capabilities.incrementalParsing).toBe(true);

      // Use capability
      if (plugin.parseFiles) {
        const result = await plugin.parseFiles(['file1.mock', 'file2.mock']);
        expect(result).toBeDefined();
        expect(result.entities).toHaveLength(2);
        expect(result.sourceFiles).toEqual(['file1.mock', 'file2.mock']);
      }
    });

    it('should parse entire project', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin = await registry.loadFromPath(pluginPath);
      await plugin.initialize({ workspaceRoot: '/tmp/test' });

      const result = await plugin.parseProject('/tmp/test', {
        workspaceRoot: '/tmp/test',
        excludePatterns: [],
      });

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('ProjectEntity');
      expect(result.metadata?.pluginName).toBe('mock');
    });

    it('should prevent version conflicts when registering', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');

      const plugin1 = await registry.loadFromPath(pluginPath);
      const plugin2 = await registry.loadFromPath(pluginPath);

      registry.register(plugin1);

      // Should throw on duplicate registration
      expect(() => registry.register(plugin2)).toThrow(/already registered/i);

      // Should succeed with overwrite
      expect(() => registry.register(plugin2, { overwrite: true })).not.toThrow();
    });

    it('should throw error for invalid plugin path', async () => {
      const invalidPath = join(__dirname, '../fixtures/nonexistent-plugin/index.ts');

      await expect(registry.loadFromPath(invalidPath)).rejects.toThrow();
    });
  });

  describe('Plugin canHandle() detection', () => {
    it('should detect .mock files', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');
      const plugin = await registry.loadFromPath(pluginPath);

      expect(plugin.canHandle('src/test.mock')).toBe(true);
      expect(plugin.canHandle('/absolute/path/file.mock')).toBe(true);
    });

    it('should detect mock.json files', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');
      const plugin = await registry.loadFromPath(pluginPath);

      expect(plugin.canHandle('mock.json')).toBe(true);
      expect(plugin.canHandle('/path/to/mock.json')).toBe(true);
    });

    it('should not detect other file types', async () => {
      const pluginPath = join(__dirname, '../fixtures/mock-plugin/index.ts');
      const plugin = await registry.loadFromPath(pluginPath);

      expect(plugin.canHandle('test.ts')).toBe(false);
      expect(plugin.canHandle('test.js')).toBe(false);
      expect(plugin.canHandle('package.json')).toBe(false);
    });
  });
});

/**
 * Unit tests for PluginRegistry
 * Written using TDD - tests first, implementation second
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '@/core/plugin-registry.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';
import type { ArchJSON } from '@/types/index.js';

// Mock plugin for testing
class MockPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'mock-v1',
    version: '1.0.0',
    displayName: 'Mock Plugin v1',
    fileExtensions: ['.mock'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: false,
      incrementalParsing: false,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  async initialize(): Promise<void> {
    // Mock initialization
  }

  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.mock');
  }

  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }

  async dispose(): Promise<void> {
    // Mock cleanup
  }
}

// Mock plugin v2 for version testing
class MockPluginV2 implements ILanguagePlugin {
  readonly metadata = {
    name: 'mock-v1', // Same name, different version
    version: '2.0.0',
    displayName: 'Mock Plugin v2',
    fileExtensions: ['.mock'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.mock');
  }
  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }
  async dispose(): Promise<void> {}
}

// Different plugin for extension collision testing
class AnotherMockPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'another-mock',
    version: '1.0.0',
    displayName: 'Another Mock',
    fileExtensions: ['.mock', '.test'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: false,
      incrementalParsing: false,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.mock') || targetPath.endsWith('.test');
  }
  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }
  async dispose(): Promise<void> {}
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('register()', () => {
    it('should register a plugin successfully', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      const retrieved = registry.getByName('mock-v1');
      expect(retrieved).toBe(plugin);
    });

    it('should prevent duplicate plugin registration without overwrite flag', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();

      registry.register(plugin1);

      expect(() => registry.register(plugin2)).toThrow();
      expect(() => registry.register(plugin2)).toThrow(/already registered/i);
    });

    it('should allow overwriting with overwrite: true', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();

      registry.register(plugin1);
      registry.register(plugin2, { overwrite: true });

      const retrieved = registry.getByName('mock-v1');
      expect(retrieved).toBe(plugin2);
    });

    it('should register multiple versions of the same plugin', () => {
      const pluginV1 = new MockPlugin();
      const pluginV2 = new MockPluginV2();

      registry.register(pluginV1);
      registry.register(pluginV2);

      const v1 = registry.getByName('mock-v1', '1.0.0');
      const v2 = registry.getByName('mock-v1', '2.0.0');

      expect(v1).toBe(pluginV1);
      expect(v2).toBe(pluginV2);
    });
  });

  describe('getByExtension()', () => {
    it('should get plugin by file extension', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      const retrieved = registry.getByExtension('.mock');
      expect(retrieved).toBe(plugin);
    });

    it('should return null for unsupported file extension', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      const retrieved = registry.getByExtension('.unsupported');
      expect(retrieved).toBeNull();
    });

    it('should handle multiple plugins for same extension (priority)', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new AnotherMockPlugin();

      registry.register(plugin1);
      registry.register(plugin2);

      // Should return the first registered plugin
      const retrieved = registry.getByExtension('.mock');
      expect(retrieved).toBe(plugin1);
    });

    it('should prioritize higher versions when specified', () => {
      const pluginV1 = new MockPlugin();
      const pluginV2 = new MockPluginV2();

      registry.register(pluginV1);
      registry.register(pluginV2);

      // Without version, should return latest
      const retrieved = registry.getByExtension('.mock');
      expect(retrieved).toBe(pluginV2);
    });
  });

  describe('detectPluginForDirectory()', () => {
    it('should detect plugin for directory with mock.json file', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      // Note: This test will need filesystem mocking or fixture
      // For now, we test the interface exists
      expect(registry.detectPluginForDirectory).toBeDefined();
    });
  });

  describe('getByName()', () => {
    it('should get plugin by name', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      const retrieved = registry.getByName('mock-v1');
      expect(retrieved).toBe(plugin);
    });

    it('should get plugin by version', () => {
      const pluginV1 = new MockPlugin();
      const pluginV2 = new MockPluginV2();

      registry.register(pluginV1);
      registry.register(pluginV2);

      const v1 = registry.getByName('mock-v1', '1.0.0');
      const v2 = registry.getByName('mock-v1', '2.0.0');

      expect(v1).toBe(pluginV1);
      expect(v2).toBe(pluginV2);
    });

    it('should return latest version when multiple exist and no version specified', () => {
      const pluginV1 = new MockPlugin();
      const pluginV2 = new MockPluginV2();

      registry.register(pluginV1);
      registry.register(pluginV2);

      const retrieved = registry.getByName('mock-v1');
      expect(retrieved).toBe(pluginV2);
    });

    it('should return null for unknown plugin name', () => {
      const retrieved = registry.getByName('unknown');
      expect(retrieved).toBeNull();
    });
  });

  describe('listVersions()', () => {
    it('should list all versions of a plugin', () => {
      const pluginV1 = new MockPlugin();
      const pluginV2 = new MockPluginV2();

      registry.register(pluginV1);
      registry.register(pluginV2);

      const versions = registry.listVersions('mock-v1');
      expect(versions).toEqual(['1.0.0', '2.0.0']);
    });

    it('should return empty array for unknown plugin', () => {
      const versions = registry.listVersions('unknown');
      expect(versions).toEqual([]);
    });
  });

  describe('listAll()', () => {
    it('should list all registered plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new AnotherMockPlugin();

      registry.register(plugin1);
      registry.register(plugin2);

      const all = registry.listAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(plugin1);
      expect(all).toContain(plugin2);
    });

    it('should return empty array when no plugins registered', () => {
      const all = registry.listAll();
      expect(all).toEqual([]);
    });
  });

  describe('has()', () => {
    it('should return true for registered plugin', () => {
      const plugin = new MockPlugin();
      registry.register(plugin);

      expect(registry.has('mock-v1')).toBe(true);
    });

    it('should return false for unregistered plugin', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });
});

/**
 * Unit tests for PluginRegistry
 * Written using TDD - tests first, implementation second
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { PluginRegistry } from '@/core/plugin-registry.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';
import type { ArchJSON } from '@/types/index.js';

// Fixture directory for detection tests
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/detection');

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

// Mock Go plugin for detection testing
class MockGoPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'golang',
    version: '1.0.0',
    displayName: 'Go (Golang)',
    fileExtensions: ['.go'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: false,
      typeInference: true,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.go');
  }
  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }
  async dispose(): Promise<void> {}
}

// Mock TypeScript plugin for detection testing
class MockTypeScriptPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(targetPath);
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

// Mock Java plugin for detection testing
class MockJavaPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'java',
    version: '1.0.0',
    displayName: 'Java',
    fileExtensions: ['.java'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.java');
  }
  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };
  }
  async dispose(): Promise<void> {}
}

// Mock Python plugin for detection testing
class MockPythonPlugin implements ILanguagePlugin {
  readonly metadata = {
    name: 'python',
    version: '1.0.0',
    displayName: 'Python',
    fileExtensions: ['.py'],
    author: 'Test',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false,
    },
  };

  async initialize(): Promise<void> {}
  canHandle(targetPath: string): boolean {
    return targetPath.endsWith('.py');
  }
  async parseProject(): Promise<ArchJSON> {
    return {
      version: '1.0',
      language: 'python',
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
    it('should have detectPluginForDirectory method defined', () => {
      expect(typeof registry.detectPluginForDirectory).toBe('function');
    });

    it('should detect Go plugin for directory with go.mod', async () => {
      const goPlugin = new MockGoPlugin();
      registry.register(goPlugin);

      const goProjectDir = path.join(FIXTURES_DIR, 'go-project');
      const detected = await registry.detectPluginForDirectory(goProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('golang');
    });

    it('should detect TypeScript plugin for directory with package.json', async () => {
      const tsPlugin = new MockTypeScriptPlugin();
      registry.register(tsPlugin);

      const tsProjectDir = path.join(FIXTURES_DIR, 'ts-project');
      const detected = await registry.detectPluginForDirectory(tsProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('typescript');
    });

    it('should detect TypeScript plugin for directory with tsconfig.json', async () => {
      const tsPlugin = new MockTypeScriptPlugin();
      registry.register(tsPlugin);

      // ts-project has both package.json and tsconfig.json
      const tsProjectDir = path.join(FIXTURES_DIR, 'ts-project');
      const detected = await registry.detectPluginForDirectory(tsProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('typescript');
    });

    it('should detect Java plugin for directory with pom.xml', async () => {
      const javaPlugin = new MockJavaPlugin();
      registry.register(javaPlugin);

      const javaProjectDir = path.join(FIXTURES_DIR, 'java-project');
      const detected = await registry.detectPluginForDirectory(javaProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('java');
    });

    it('should detect Java plugin for directory with build.gradle', async () => {
      const javaPlugin = new MockJavaPlugin();
      registry.register(javaPlugin);

      // java-project has both pom.xml and build.gradle
      const javaProjectDir = path.join(FIXTURES_DIR, 'java-project');
      const detected = await registry.detectPluginForDirectory(javaProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('java');
    });

    it('should detect Python plugin for directory with pyproject.toml', async () => {
      const pythonPlugin = new MockPythonPlugin();
      registry.register(pythonPlugin);

      const pythonProjectDir = path.join(FIXTURES_DIR, 'python-project');
      const detected = await registry.detectPluginForDirectory(pythonProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('python');
    });

    it('should detect Python plugin for directory with requirements.txt', async () => {
      const pythonPlugin = new MockPythonPlugin();
      registry.register(pythonPlugin);

      // python-project has both pyproject.toml and requirements.txt
      const pythonProjectDir = path.join(FIXTURES_DIR, 'python-project');
      const detected = await registry.detectPluginForDirectory(pythonProjectDir);

      expect(detected).not.toBeNull();
      expect(detected?.metadata.name).toBe('python');
    });

    it('should return null for unknown project type', async () => {
      const detected = await registry.detectPluginForDirectory(
        path.join(FIXTURES_DIR, 'unknown-project')
      );

      expect(detected).toBeNull();
    });

    it('should return null for non-existent directory', async () => {
      const detected = await registry.detectPluginForDirectory(
        path.join(FIXTURES_DIR, 'non-existent-dir')
      );

      expect(detected).toBeNull();
    });

    it('should return null when no matching plugin is registered', async () => {
      // Only register TypeScript plugin
      const tsPlugin = new MockTypeScriptPlugin();
      registry.register(tsPlugin);

      // Try to detect Go project (no Go plugin registered)
      const detected = await registry.detectPluginForDirectory(
        path.join(FIXTURES_DIR, 'go-project')
      );

      expect(detected).toBeNull();
    });

    it('should prioritize detection rules in order (go.mod before package.json)', async () => {
      const goPlugin = new MockGoPlugin();
      const tsPlugin = new MockTypeScriptPlugin();
      registry.register(goPlugin);
      registry.register(tsPlugin);

      // Go project should be detected as Go, not TypeScript
      const detected = await registry.detectPluginForDirectory(
        path.join(FIXTURES_DIR, 'go-project')
      );

      expect(detected?.metadata.name).toBe('golang');
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

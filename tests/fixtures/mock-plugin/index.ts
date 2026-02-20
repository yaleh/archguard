/**
 * Mock Plugin for testing plugin system
 *
 * This is a minimal implementation of ILanguagePlugin for testing purposes.
 */

import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  ParseConfig,
} from '@/core/interfaces/index.js';
import type { ArchJSON } from '@/types/index.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * Mock Language Plugin
 *
 * A simple plugin that demonstrates the plugin system.
 * Handles .mock files and directories with mock.json files.
 */
export default class MockPlugin implements ILanguagePlugin {
  /**
   * Plugin metadata
   */
  readonly metadata: PluginMetadata = {
    name: 'mock',
    version: '1.0.0',
    displayName: 'Mock Plugin',
    fileExtensions: ['.mock'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: false,
      typeInference: false,
    },
  };

  private initialized = false;
  private workspaceRoot = '';

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    this.workspaceRoot = config.workspaceRoot;
    this.initialized = true;

    if (config.verbose) {
      console.log(`[MockPlugin] Initialized for workspace: ${config.workspaceRoot}`);
    }
  }

  /**
   * Check if this plugin can handle the given path
   */
  canHandle(targetPath: string): boolean {
    // Handle .mock files
    if (targetPath.endsWith('.mock')) {
      return true;
    }

    // Handle directories with mock.json
    // Note: This is a simplified check, real implementation would check filesystem
    return targetPath.endsWith('mock.json');
  }

  /**
   * Parse a single code string
   */
  parseCode(code: string, filePath?: string): ArchJSON {
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: filePath ? [filePath] : [],
      entities: [
        {
          id: 'mock-entity',
          name: 'MockEntity',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: {
            file: filePath || 'unknown',
            startLine: 1,
            endLine: 1,
          },
        },
      ],
      relations: [],
    };
  }

  /**
   * Parse specific files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    const entities = filePaths.map((filePath, index) => ({
      id: `mock-entity-${index}`,
      name: `MockEntity${index}`,
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: {
        file: filePath,
        startLine: 1,
        endLine: 1,
      },
    }));

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities,
      relations: [],
    };
  }

  /**
   * Parse entire project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    if (!this.initialized) {
      throw new Error('Plugin must be initialized before parsing');
    }

    // In a real plugin, this would:
    // 1. Scan for .mock files
    // 2. Parse each file
    // 3. Extract entities and relations
    // 4. Aggregate into ArchJSON

    // For mock purposes, return minimal ArchJSON
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [
        {
          id: 'project-entity',
          name: 'ProjectEntity',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'mockMethod',
              type: 'method',
              visibility: 'public',
              returnType: 'void',
              parameters: [],
            },
          ],
          sourceLocation: {
            file: join(workspaceRoot, 'mock.mock'),
            startLine: 1,
            endLine: 10,
          },
        },
      ],
      relations: [],
      metadata: {
        pluginName: this.metadata.name,
        pluginVersion: this.metadata.version,
      },
    };
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.initialized = false;
    this.workspaceRoot = '';
  }
}

// Named export for alternative import style
export { MockPlugin as Plugin };

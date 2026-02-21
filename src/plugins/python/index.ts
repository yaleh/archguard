/**
 * Python Language Plugin for ArchGuard
 *
 * Provides Python language support through tree-sitter parsing
 */

import path from 'path';
import fs from 'fs-extra';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  PluginCapabilities,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { DependencyExtractor } from './dependency-extractor.js';

/**
 * Python language plugin implementation
 */
export class PythonPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'python',
    version: '1.0.0',
    displayName: 'Python',
    fileExtensions: ['.py'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false, // Python doesn't require type inference as it has type hints
    } as PluginCapabilities,
  };

  private treeSitterBridge!: TreeSitterBridge;
  private archJsonMapper!: ArchJsonMapper;
  private initialized = false;

  readonly dependencyExtractor = new DependencyExtractor();

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.treeSitterBridge = new TreeSitterBridge();
    this.archJsonMapper = new ArchJsonMapper();
    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a file with .py extension
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.py') {
      return true;
    }

    // Check if it's a directory with Python project markers
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        // Check for common Python project markers
        const markers = [
          'pyproject.toml',
          'requirements.txt',
          'setup.py',
          'setup.cfg',
          'Pipfile',
        ];

        for (const marker of markers) {
          if (fs.existsSync(path.join(targetPath, marker))) {
            return true;
          }
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  /**
   * Parse entire project directory
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // Find all Python files in the project
    const pattern = config.filePattern ?? '**/*.py';
    const files = await this.findPythonFiles(workspaceRoot, pattern, config.excludePatterns);

    // Parse all files
    return this.parseFiles(files);
  }

  /**
   * Parse single code string
   */
  parseCode(code: string, filePath: string = 'source.py'): ArchJSON {
    this.ensureInitialized();

    try {
      // Parse with tree-sitter
      const rawModule = this.treeSitterBridge.parseCode(code, filePath);

      // Map to ArchJSON
      const { entities, relations } = this.archJsonMapper.mapModule(rawModule);

      return {
        version: '1.0',
        language: 'python',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities,
        relations,
      };
    } catch (error) {
      // Return empty ArchJSON on error
      console.warn(`Error parsing Python code: ${error}`);
      return {
        version: '1.0',
        language: 'python',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities: [],
        relations: [],
      };
    }
  }

  /**
   * Parse multiple files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    const modules = [];

    for (const filePath of filePaths) {
      try {
        const code = await fs.readFile(filePath, 'utf-8');
        const rawModule = this.treeSitterBridge.parseCode(code, filePath);
        modules.push(rawModule);
      } catch (error) {
        console.warn(`Error parsing file ${filePath}: ${error}`);
      }
    }

    // Map all modules to ArchJSON
    return this.archJsonMapper.mapModules(modules);
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Ensure plugin is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PythonPlugin not initialized. Call initialize() first.');
    }
  }

  /**
   * Find Python files matching pattern
   */
  private async findPythonFiles(
    root: string,
    pattern: string,
    exclude?: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    // Simple implementation: recursively find .py files
    // In production, we'd use a proper glob library
    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip excluded patterns
          if (exclude && exclude.some(exc => fullPath.includes(exc))) {
            continue;
          }

          // Skip common non-source directories
          if (entry.isDirectory()) {
            if (
              entry.name.startsWith('.') ||
              entry.name === '__pycache__' ||
              entry.name === 'node_modules' ||
              entry.name === 'venv' ||
              entry.name === 'env'
            ) {
              continue;
            }
            await scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.py')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };

    await scanDir(root);
    return files;
  }
}

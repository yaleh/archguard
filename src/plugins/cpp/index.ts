/**
 * C++ Language Plugin
 *
 * Implements ILanguagePlugin for C and C++ source code analysis.
 * Uses tree-sitter-cpp for AST parsing and HeaderMerger to unify
 * .h/.cpp declaration-implementation pairs before ArchJSON mapping.
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import { HeaderMerger } from './builders/header-merger.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { DependencyExtractor } from './dependency-extractor.js';

export class CppPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'cpp',
    version: '1.0.0',
    displayName: 'C/C++',
    fileExtensions: ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: false,
    },
  };

  readonly supportedLevels = ['package', 'class'] as const;

  /** Non-optional dependency extractor — follows GoPlugin pattern */
  readonly dependencyExtractor: IDependencyExtractor;

  private bridge!: TreeSitterBridge;
  private merger!: HeaderMerger;
  private mapper!: ArchJsonMapper;
  private initialized = false;

  constructor() {
    this.dependencyExtractor = new DependencyExtractor();
  }

  /**
   * Initialize plugin resources.
   * Guard against double-init: second call is a silent no-op.
   */
  async initialize(_config: PluginInitConfig): Promise<void> {
    if (this.initialized) return;
    this.bridge = new TreeSitterBridge();
    this.merger = new HeaderMerger();
    this.mapper = new ArchJsonMapper();
    this.initialized = true;
  }

  /**
   * Detect whether the plugin can handle a given path.
   *
   * Returns true for:
   * - Any file whose extension is a recognised C/C++ extension
   * - Any directory containing CMakeLists.txt or Makefile
   */
  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    if (['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h', '.h++'].includes(ext)) {
      return true;
    }
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        return (
          fs.existsSync(path.join(targetPath, 'CMakeLists.txt')) ||
          fs.existsSync(path.join(targetPath, 'Makefile'))
        );
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Parse an entire C++ project rooted at workspaceRoot.
   *
   * Steps:
   * 1. Glob for all C/C++ source files, honouring exclude patterns.
   * 2. Read and parse each file via TreeSitterBridge.
   * 3. Merge header/implementation pairs via HeaderMerger.
   * 4. Collect free enums and functions from raw files.
   * 5. Map merged entities and relations to ArchJSON via ArchJsonMapper.
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    const defaultIgnore = [
      '**/build/**',
      '**/cmake-build-*/**',
      '**/node_modules/**',
      '**/vendor/**',
    ];
    const ignorePatterns = [...defaultIgnore, ...(config.excludePatterns ?? [])];

    const files = await glob('**/*.{cpp,cxx,cc,hpp,hxx,h}', {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ignorePatterns,
    });

    const rawFiles = await Promise.all(
      files.map(async (file) => {
        const code = await fs.readFile(file, 'utf-8');
        return this.bridge.parseCode(code, file);
      })
    );

    const merged = this.merger.merge(rawFiles);
    const allEnums = rawFiles.flatMap((f) => f.enums);
    const allFunctions = rawFiles.flatMap((f) => f.functions);

    const entities = this.mapper.mapEntities(merged, allEnums, allFunctions, workspaceRoot);
    const relations = this.mapper.mapRelations(merged, entities);

    return {
      version: '1.0',
      language: 'cpp',
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
    };
  }

  /**
   * Parse a single C++ code string.
   * Useful for testing and IDE integrations.
   */
  parseCode(code: string, filePath = 'source.cpp'): ArchJSON {
    this.ensureInitialized();

    const rawFile = this.bridge.parseCode(code, filePath);
    const merged = this.merger.merge([rawFile]);
    const entities = this.mapper.mapEntities(
      merged,
      rawFile.enums,
      rawFile.functions,
      path.dirname(filePath)
    );
    const relations = this.mapper.mapRelations(merged, entities);

    return {
      version: '1.0',
      language: 'cpp',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations,
    };
  }

  /**
   * Release plugin resources.
   * Sets initialized = false so subsequent calls throw a clear error.
   */
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CppPlugin not initialized. Call initialize() first.');
    }
  }
}

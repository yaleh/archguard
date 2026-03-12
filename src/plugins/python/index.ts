/**
 * Python Language Plugin for ArchGuard
 *
 * Provides Python language support through tree-sitter parsing
 */

import path from 'path';
import fs from 'fs-extra';
import micromatch from 'micromatch';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  PluginCapabilities,
  RawTestFile,
  RawTestCase,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestPatternConfig } from '@/types/extensions.js';
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
      testStructureExtraction: true,
    } as PluginCapabilities,
  };

  readonly supportedLevels = ['package', 'class', 'method'] as const;

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
        const markers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];

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

    // Parse all files and include workspaceRoot in the output ArchJSON
    return this.parseFiles(files, workspaceRoot);
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
  async parseFiles(filePaths: string[], workspaceRoot?: string): Promise<ArchJSON> {
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

    // Map all modules to ArchJSON, propagating workspaceRoot for stable IDs and path resolution
    return this.archJsonMapper.mapModules(modules, workspaceRoot);
  }

  /**
   * Determine whether a given file path is a Python test file.
   *
   * Default pytest conventions:
   *   - Filename matches test_*.py or *_test.py
   *   - File resides in a directory named "tests" or "test"
   *   - conftest.py and __init__.py are excluded
   *
   * When patternConfig.testFileGlobs is provided those globs take precedence.
   */
  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    if (patternConfig?.testFileGlobs && patternConfig.testFileGlobs.length > 0) {
      return micromatch.isMatch(filePath, patternConfig.testFileGlobs);
    }
    const base = path.basename(filePath);
    if (base === 'conftest.py' || base === '__init__.py') return false;
    if (/^test_.+\.py$/.test(base) || /^.+_test\.py$/.test(base)) return true;
    // directory convention: any .py file inside tests/ or test/ directory
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.some((p) => p === 'tests' || p === 'test');
  }

  /**
   * Extract raw test structure from a Python test file (static analysis only).
   *
   * Scans the source line-by-line for pytest / unittest test functions and
   * classes, counts assertion statements, and detects skip decorators.
   */
  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath, patternConfig)) return null;

    try {
      const lines = code.split('\n');

      // --- Framework detection ---
      const frameworks: string[] = [];
      if (/^import pytest\b|^from pytest\b/m.test(code)) frameworks.push('pytest');
      if (/^import unittest\b|^from unittest\b/m.test(code)) frameworks.push('unittest');
      if (frameworks.length === 0) frameworks.push('unknown');

      // --- testTypeHint from file path ---
      let testTypeHint: RawTestFile['testTypeHint'] = 'unit';
      if (/\/e2e\/|\/cypress\//.test(filePath)) testTypeHint = 'e2e';
      else if (/\/integration\//.test(filePath)) testTypeHint = 'integration';
      else if (/\/perf\/|\/performance\/|\/benchmark\//.test(filePath))
        testTypeHint = 'performance';

      // --- Configurable patterns ---
      const assertionPatterns = patternConfig?.assertionPatterns ?? [
        'assert ',        // Python assert statement: assert x == y
        'assert(',        // assert(condition) call style
        '.assert',        // self.assertX (unittest), torch.testing.assert_close, np.testing.assert_allclose
      ];
      const skipPatterns = patternConfig?.skipPatterns ?? [
        '@pytest.mark.skip',
        '@pytest.mark.skipif',
        '@unittest.skip',
        '@skip(',
      ];

      // --- Test case extraction (line-scan) ---
      const testCases: RawTestCase[] = [];
      let pendingSkip = false;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();

        // Detect skip decorator on this line
        if (skipPatterns.some((sp) => trimmed.startsWith(sp.startsWith('@') ? sp : sp))) {
          pendingSkip = true;
          continue;
        }

        // def test_* → a test case
        const testFnMatch = trimmed.match(/^def\s+(test_\w+)\s*\(/);
        if (testFnMatch) {
          const name = testFnMatch[1];
          const isSkipped = pendingSkip;
          // Count assertions in the next 30 lines (body heuristic)
          const bodyEnd = Math.min(i + 30, lines.length);
          const assertionCount = lines
            .slice(i + 1, bodyEnd)
            .filter((l) => assertionPatterns.some((ap) => l.includes(ap))).length;
          testCases.push({ name, isSkipped, assertionCount });
          pendingSkip = false;
          continue;
        }

        // Reset pending skip on any non-decorator, non-blank, non-comment line
        if (trimmed !== '' && !trimmed.startsWith('@') && !trimmed.startsWith('#')) {
          pendingSkip = false;
        }
      }

      if (testCases.length === 0) return null;

      return {
        filePath,
        frameworks,
        testTypeHint,
        testCases,
        importedSourceFiles: this.extractAbsoluteImports(code),
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract absolute Python imports from source code and convert to relative file paths.
   *
   * Handles:
   *   from pkg.sub.module import X  →  pkg/sub/module.py
   *   import pkg.sub.module         →  pkg/sub/module.py  (multi-component only)
   *
   * Relative imports (from . import, from .. import, from .foo import) are skipped
   * because they cannot be resolved without the full package graph.
   * Single-component bare imports (import os, import sys) are also skipped to
   * avoid spurious matches against stdlib/package-root names.
   */
  private extractAbsoluteImports(code: string): string[] {
    const seen = new Set<string>();
    const results: string[] = [];

    // Match both top-level and inline import statements
    // from pkg.sub.module import X[, Y]
    const fromRe = /^\s*from\s+([\w.]+)\s+import\b/gm;
    // import pkg.sub.module [as alias]
    const importRe = /^\s*import\s+([\w.]+)(?:\s+as\s+\w+)?\s*$/gm;

    let m: RegExpExecArray | null;

    while ((m = fromRe.exec(code)) !== null) {
      const modulePath = m[1];
      // Skip relative imports (start with a dot captured as first char of the group)
      // Note: the regex only captures word chars and dots, so a leading dot in
      // the original "from .foo import" would not be captured — guard anyway.
      if (modulePath.startsWith('.')) continue;
      const filePath = modulePath.replace(/\./g, '/') + '.py';
      if (!seen.has(filePath)) {
        seen.add(filePath);
        results.push(filePath);
      }
    }

    while ((m = importRe.exec(code)) !== null) {
      const modulePath = m[1];
      // Skip single-component imports (stdlib, package root): no dot present
      if (!modulePath.includes('.')) continue;
      const filePath = modulePath.replace(/\./g, '/') + '.py';
      if (!seen.has(filePath)) {
        seen.add(filePath);
        results.push(filePath);
      }
    }

    return results;
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
          if (exclude && exclude.some((exc) => fullPath.includes(exc))) {
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

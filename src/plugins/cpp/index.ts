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
  RawTestFile,
  RawTestCase,
} from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions.js';
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
      testStructureExtraction: true,
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
    const relations = this.mapper.mapRelations(merged, entities, workspaceRoot);

    return {
      version: '1.0',
      language: 'cpp',
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
      workspaceRoot,
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

  isTestFile(filePath: string, _patternConfig?: TestPatternConfig): boolean {
    const base = path.basename(filePath);
    const ext = path.extname(base).toLowerCase();
    if (!['.cpp', '.cxx', '.cc'].includes(ext)) return false;
    // Named test-*.cpp / test_*.cpp / *_test.cpp / *Test.cpp
    if (/^test[-_]/i.test(base) || /[-_]test\./i.test(base) || /Test\./.test(base)) return true;
    // Inside a tests/ or test/ directory
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.some((p) => p === 'tests' || p === 'test');
  }

  extractTestStructure(
    filePath: string,
    code: string,
    _patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath)) return null;

    // Framework detection
    const frameworks: string[] = [];
    if (/#include\s*[<"]gtest\/gtest/.test(code)) frameworks.push('gtest');
    if (/#include\s*[<"]catch2\//.test(code) || /CATCH_CONFIG_MAIN/.test(code)) frameworks.push('catch2');
    if (/#include\s*[<"]doctest\.h/.test(code)) frameworks.push('doctest');
    if (frameworks.length === 0) frameworks.push('assert'); // custom main-based

    // Assertion counting patterns
    const assertionPatterns = [
      /\bassert\s*\(/g,
      /\bassert_\w+\s*\(/g,
      /\bt\.assert_\w+\s*\(/g,
      /\bGGML_ASSERT\s*\(/g,
      /\bLLAMA_ASSERT\s*\(/g,
      /\bEXPECT_\w+\s*\(/g,
      /\bASSERT_\w+\s*\(/g,
      /\bREQUIRE\s*\(/g,
      /\bCHECK\s*\(/g,
    ];
    let totalAssertions = 0;
    for (const pat of assertionPatterns) {
      const m = code.match(pat);
      if (m) totalAssertions += m.length;
    }

    const testCases: RawTestCase[] = [];

    if (frameworks.includes('gtest')) {
      // TEST(suite, name) / TEST_F(fixture, name) / TEST_P(fixture, name)
      const re = /\bTEST(?:_F|_P)?\s*\(\s*\w+\s*,\s*(\w+)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        testCases.push({ name: m[1], assertionCount: 0, isSkipped: false });
      }
    } else if (frameworks.includes('catch2') || frameworks.includes('doctest')) {
      // TEST_CASE("name") / SCENARIO("name")
      const re = /\b(?:TEST_CASE|SCENARIO)\s*\(\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        testCases.push({ name: m[1], assertionCount: 0, isSkipped: false });
      }
    } else {
      // Custom main-based: extract static/void/bool test_*() and verify_*() functions
      const re = /^(?:static\s+)?(?:void|bool|int)\s+((?:test|verify|check)_?\w*)\s*\(/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        if (m[1] === 'main') continue;
        testCases.push({ name: m[1], assertionCount: 0, isSkipped: false });
      }
      // If no named functions found but has main(), treat the whole file as one test
      if (testCases.length === 0 && /\bint\s+main\s*\(/.test(code)) {
        testCases.push({ name: path.basename(filePath, path.extname(filePath)), assertionCount: totalAssertions, isSkipped: false });
      }
    }

    if (testCases.length === 0) return null;

    // Distribute assertions across cases using remainder distribution to preserve the total.
    // Math.round() would lose assertions when totalAssertions < testCases.length (e.g. 4/9→0).
    if (totalAssertions > 0 && testCases.length > 0) {
      const base = Math.floor(totalAssertions / testCases.length);
      const remainder = totalAssertions % testCases.length;
      for (let i = 0; i < testCases.length; i++) {
        if (testCases[i].assertionCount === 0) {
          testCases[i].assertionCount = base + (i < remainder ? 1 : 0);
        }
      }
    }

    // Imports: #include "local/*.h" patterns for coverage linking
    const importedSourceFiles: string[] = [];
    const includeRe = /^#include\s+"([^"]+)"/gm;
    let im: RegExpExecArray | null;
    while ((im = includeRe.exec(code)) !== null) {
      importedSourceFiles.push(im[1]);
    }

    const isBenchmark = /benchmark|bench|perf/i.test(path.basename(filePath));
    const testTypeHint: RawTestFile['testTypeHint'] = isBenchmark ? 'performance' : 'unit';

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles,
      totalAssertions,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CppPlugin not initialized. Call initialize() first.');
    }
  }
}

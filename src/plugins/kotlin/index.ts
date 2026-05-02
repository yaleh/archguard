/**
 * Kotlin Language Plugin
 *
 * Implements ILanguagePlugin for Kotlin source code analysis.
 * Uses tree-sitter-kotlin for AST parsing and produces ArchJSON
 * with entity and relation information.
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import micromatch from 'micromatch';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  RawTestFile,
  RawTestCase,
} from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { KotlinDependencyExtractor } from './dependency-extractor.js';

export class KotlinPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'kotlin',
    version: '1.0.0',
    displayName: 'Kotlin',
    fileExtensions: ['.kt', '.kts'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false,
      testStructureExtraction: true,
    },
  };

  readonly supportedLevels = ['package', 'class'] as const;

  /** Non-optional dependency extractor — follows CppPlugin/GoPlugin pattern */
  readonly dependencyExtractor: IDependencyExtractor;

  private bridge!: TreeSitterBridge;
  private mapper!: ArchJsonMapper;
  private initialized = false;
  private moduleRoot = '';

  constructor() {
    this.dependencyExtractor = new KotlinDependencyExtractor();
  }

  /**
   * Initialize plugin resources.
   * Guard against double-init: second call is a silent no-op.
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) return;
    this.bridge = new TreeSitterBridge();
    this.bridge.initialize();
    this.mapper = new ArchJsonMapper();
    this.moduleRoot = await this.detectModuleRoot(config.workspaceRoot);
    this.initialized = true;
  }

  /**
   * Detect whether the plugin can handle a given path.
   *
   * Returns true for any file whose extension is .kt or .kts.
   */
  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    return ['.kt', '.kts'].includes(ext);
  }

  /**
   * Parse an entire Kotlin project rooted at workspaceRoot.
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    const defaultIgnore = [
      '**/build/**',
      '**/.gradle/**',
      '**/node_modules/**',
    ];
    const ignorePatterns = [...defaultIgnore, ...(config.excludePatterns ?? [])];

    const files = await glob('**/*.kt', {
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

    return this.mapper.map(rawFiles, this.moduleRoot, workspaceRoot);
  }

  /**
   * Parse a single Kotlin code string.
   * Useful for testing and IDE integrations.
   */
  parseCode(code: string, filePath = 'source.kt'): ArchJSON {
    this.ensureInitialized();

    const rawFile = this.bridge.parseCode(code, filePath);
    return this.mapper.map([rawFile], this.moduleRoot, path.dirname(filePath));
  }

  /**
   * Parse specific Kotlin files.
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    const rawFiles = await Promise.all(
      filePaths.map(async (file) => {
        const code = await fs.readFile(file, 'utf-8');
        return this.bridge.parseCode(code, file);
      })
    );

    const workspaceRoot = filePaths.length > 0 ? path.dirname(filePaths[0]) : '.';
    return this.mapper.map(rawFiles, this.moduleRoot, workspaceRoot);
  }

  /**
   * Release plugin resources.
   * Sets initialized = false so subsequent calls throw a clear error.
   */
  async dispose(): Promise<void> {
    this.initialized = false;
    this.bridge = undefined as any;
    this.mapper = undefined as any;
  }

  /**
   * Determine whether a given file path is a Kotlin test file.
   *
   * Kotlin test conventions:
   *  - File name ends with Test.kt or starts with Test and ends with .kt
   *  - Located under src/test/, src/androidTest/, or src/sharedTest/
   *  - Custom globs from patternConfig take precedence
   */
  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    // Custom globs take precedence when provided
    if (patternConfig?.testFileGlobs?.length) {
      return micromatch.isMatch(filePath, patternConfig.testFileGlobs);
    }

    const basename = path.basename(filePath);

    // File name patterns: FooTest.kt or TestFoo.kt
    if (/Test\.kts?$/.test(basename) || /^Test[A-Z].*\.kts?$/.test(basename)) {
      return true;
    }

    // Directory patterns
    const normalized = filePath.replace(/\\/g, '/');
    return (
      normalized.includes('/test/') ||
      normalized.includes('/androidTest/') ||
      normalized.includes('/sharedTest/')
    );
  }

  /**
   * Extract raw test structure from a single Kotlin test file (pure static analysis).
   * Returns null if no test cases are found.
   */
  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath, patternConfig)) return null;

    const lines = code.split('\n');
    const testCases: RawTestCase[] = [];
    let totalAssertions = 0;

    // Assertion patterns for Kotlin/JUnit/Kotest
    const defaultAssertionPatterns = [
      /\b(assertEquals|assertNotEquals|assertTrue|assertFalse|assertNull|assertNotNull)\s*\(/g,
      /\b(assertThat|assertThrows|assertDoesNotThrow|assertTimeout)\s*\(/g,
      /\b(verify|verifyNoMoreInteractions|verifyZeroInteractions)\s*\(/g,
      /\b(expect|shouldBe|shouldNotBe|shouldBeNull|shouldNotBeNull)\s*\(/g,
      /\b(shouldContain|shouldHaveSize|shouldBeEmpty|shouldBeInstanceOf)\s*\(/g,
    ];

    // Count file-level assertions
    for (const pattern of defaultAssertionPatterns) {
      const matches = code.match(pattern);
      if (matches) totalAssertions += matches.length;
    }

    // Apply custom assertion patterns from patternConfig
    if (patternConfig?.customAssertionRegexes?.length) {
      for (const regexStr of patternConfig.customAssertionRegexes) {
        try {
          const regex = new RegExp(regexStr, 'g');
          const matches = code.match(regex);
          if (matches) totalAssertions += matches.length;
        } catch {
          // ignore invalid regex patterns
        }
      }
    }

    // Scan for test case annotations
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Match @Test, @ParameterizedTest, @RepeatedTest annotations
      if (/^@(Test|ParameterizedTest|RepeatedTest)\b/.test(trimmed)) {
        // Look forward for the function declaration
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const m = lines[j].match(/fun\s+(\w+)\s*[\(<]/);
          if (m) {
            testCases.push({
              name: m[1],
              assertionCount: 0,
              isSkipped: false,
            });
            break;
          }
        }
      }

      // Match @Ignore or @Disabled (skipped tests) — still count as test cases
      if (/^@(Ignore|Disabled)\b/.test(trimmed)) {
        // Look forward for a @Test + fun pair
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const annotLine = lines[j].trim();
          if (/^@(Test|ParameterizedTest|RepeatedTest)\b/.test(annotLine)) {
            for (let k = j + 1; k < Math.min(j + 4, lines.length); k++) {
              const m = lines[k].match(/fun\s+(\w+)\s*[\(<]/);
              if (m) {
                testCases.push({
                  name: m[1],
                  assertionCount: 0,
                  isSkipped: true,
                });
                break;
              }
            }
            break;
          }
        }
      }
    }

    if (testCases.length === 0) return null;

    // Distribute assertions across cases using remainder distribution
    if (totalAssertions > 0) {
      const base = Math.floor(totalAssertions / testCases.length);
      const remainder = totalAssertions % testCases.length;
      for (let i = 0; i < testCases.length; i++) {
        testCases[i].assertionCount = base + (i < remainder ? 1 : 0);
      }
    }

    // Detect imported source files (project-internal imports only)
    const importedSourceFiles: string[] = [];
    const importRe = /^import\s+([\w.]+)/gm;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(code)) !== null) {
      // Only include project-internal imports (not stdlib or well-known third-party)
      const importPath = im[1];
      if (
        !importPath.startsWith('kotlin.') &&
        !importPath.startsWith('java.') &&
        !importPath.startsWith('javax.') &&
        !importPath.startsWith('android.') &&
        !importPath.startsWith('org.junit') &&
        !importPath.startsWith('org.mockito') &&
        !importPath.startsWith('io.mockk') &&
        !importPath.startsWith('io.kotest')
      ) {
        importedSourceFiles.push(importPath);
      }
    }

    // Determine test type hint based on path
    const normalized = filePath.replace(/\\/g, '/');
    let testTypeHint: RawTestFile['testTypeHint'] = 'unit';
    if (normalized.includes('/androidTest/') || normalized.includes('/integrationTest/')) {
      testTypeHint = 'integration';
    } else if (normalized.includes('/e2eTest/') || normalized.includes('/endToEndTest/')) {
      testTypeHint = 'e2e';
    }

    return {
      filePath,
      frameworks: ['junit'],
      testTypeHint,
      testCases,
      importedSourceFiles,
      totalAssertions,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KotlinPlugin not initialized. Call initialize() first.');
    }
  }

  /**
   * Detect the module root name from project configuration files.
   * Tries settings.gradle.kts rootProject.name first, then scans .kt files for package declarations.
   */
  private async detectModuleRoot(workspaceRoot: string): Promise<string> {
    // Try settings.gradle.kts for rootProject.name
    const settingsPath = path.join(workspaceRoot, 'settings.gradle.kts');
    if (await fs.pathExists(settingsPath)) {
      try {
        const content = await fs.readFile(settingsPath, 'utf-8');
        const m = content.match(/rootProject\.name\s*=\s*"([^"]+)"/);
        if (m) return m[1];
      } catch {
        // ignore read errors
      }
    }

    // Fallback: scan first few .kt files for package declarations
    try {
      const ktFiles = await glob('**/*.kt', { cwd: workspaceRoot, absolute: true, ignore: ['**/build/**'] });
      for (const f of ktFiles.slice(0, 5)) {
        const content = await fs.readFile(f, 'utf-8');
        const m = content.match(/^package\s+([\w.]+)/m);
        if (m) {
          // Use the top-level package prefix (e.g. com.example from com.example.app.data)
          const parts = m[1].split('.');
          return parts.slice(0, 2).join('.');
        }
      }
    } catch {
      // ignore errors — return empty string
    }

    return '';
  }
}

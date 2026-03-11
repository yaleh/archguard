/**
 * Java Language Plugin
 * Phase 3.A: Tree-sitter-based Java parser
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
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestPatternConfig } from '@/types/extensions.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { DependencyExtractor } from './dependency-extractor.js';
import type { JavaRawPackage } from './types.js';

/**
 * Java plugin for ArchGuard
 *
 * Uses tree-sitter-java for parsing Java source code and extracting
 * architecture information including classes, interfaces, enums, and
 * their relationships.
 */
export class JavaPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'java',
    version: '1.0.0',
    displayName: 'Java',
    fileExtensions: ['.java'],
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

  readonly supportedLevels = ['package', 'class', 'method'] as const;

  private treeSitter!: TreeSitterBridge;
  private mapper!: ArchJsonMapper;
  private depExtractor!: DependencyExtractor;
  private initialized = false;

  /**
   * Dependency extractor instance
   */
  get dependencyExtractor(): IDependencyExtractor | undefined {
    this.ensureInitialized();
    return this.depExtractor;
  }

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.treeSitter = new TreeSitterBridge();
    this.mapper = new ArchJsonMapper();
    this.depExtractor = new DependencyExtractor();

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a .java file
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.java') {
      return true;
    }

    // Check if it's a directory with pom.xml or build.gradle
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        if (
          fs.existsSync(path.join(targetPath, 'pom.xml')) ||
          fs.existsSync(path.join(targetPath, 'build.gradle'))
        ) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  /**
   * Parse entire Java project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // Find all .java files
    const pattern = config.filePattern ?? '**/*.java';
    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/target/**', '**/build/**', '**/node_modules/**', ...config.excludePatterns],
    });

    // Parse all files
    const packages = new Map<string, JavaRawPackage>();

    for (const file of files) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const pkg = this.treeSitter.parseCode(code, file);

        // Merge into packages map
        if (packages.has(pkg.name)) {
          const existing = packages.get(pkg.name);
          existing.classes.push(...pkg.classes);
          existing.interfaces.push(...pkg.interfaces);
          existing.enums.push(...pkg.enums);
        } else {
          packages.set(pkg.name, pkg);
        }
      } catch (error) {
        console.warn(`Failed to parse ${file}:`, error);
        // Continue with other files
      }
    }

    const packageList = Array.from(packages.values());

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList);

    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
      workspaceRoot,
    };
  }

  /**
   * Parse single Java file
   */
  parseCode(code: string, filePath: string = 'source.java'): ArchJSON {
    this.ensureInitialized();

    try {
      const pkg = this.treeSitter.parseCode(code, filePath);

      // Map to ArchJSON
      const entities = this.mapper.mapEntities([pkg]);
      const relations = this.mapper.mapRelations([pkg]);

      return {
        version: '1.0',
        language: 'java',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities,
        relations,
      };
    } catch (error) {
      console.warn(`Failed to parse code:`, error);
      // Return empty result on error
      return {
        version: '1.0',
        language: 'java',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities: [],
        relations: [],
      };
    }
  }

  /**
   * Parse multiple Java files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    const packages = new Map<string, JavaRawPackage>();

    for (const file of filePaths) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const pkg = this.treeSitter.parseCode(code, file);

        // Merge into packages map
        if (packages.has(pkg.name)) {
          const existing = packages.get(pkg.name);
          existing.classes.push(...pkg.classes);
          existing.interfaces.push(...pkg.interfaces);
          existing.enums.push(...pkg.enums);
        } else {
          packages.set(pkg.name, pkg);
        }
      } catch (error) {
        console.warn(`Failed to parse ${file}:`, error);
        // Continue with other files
      }
    }

    const packageList = Array.from(packages.values());

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList);

    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities,
      relations,
    };
  }

  isTestFile(filePath: string): boolean {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const base = parts[parts.length - 1];
    if (path.extname(base).toLowerCase() !== '.java') return false;
    // directory convention
    if (parts.some((p) => p === 'test' || p === 'tests')) return true;
    // naming conventions
    const name = base.slice(0, -5); // strip .java
    if (/^Test[A-Z]/.test(name)) return true;
    if (/(?:Test|Tests|TestCase|IT|Spec|Bench|Benchmark)$/.test(name)) return true;
    return false;
  }

  extractTestStructure(filePath: string, code: string, _patternConfig?: TestPatternConfig): RawTestFile | null {
    // Detect frameworks
    const hasJUnit5 = /import\s+org\.junit\.jupiter\.api\b/.test(code);
    const hasJUnit4 = !hasJUnit5 && /import\s+org\.junit\b/.test(code);
    const hasTestNG = /import\s+org\.testng\.annotations\b/.test(code);
    const hasJMH = /import\s+org\.openjdk\.jmh\.annotations\b/.test(code);
    const hasAssertJ = /import\s+org\.assertj\.core\.api\b/.test(code);

    const frameworks: string[] = [];
    if (hasJUnit5) frameworks.push('junit5');
    else if (hasJUnit4) frameworks.push('junit4');
    if (hasTestNG) frameworks.push('testng');
    if (hasJMH) frameworks.push('jmh');
    if (hasAssertJ) frameworks.push('assertj');

    if (frameworks.length === 0) return null;

    // Extract test/benchmark methods line-by-line
    const lines = code.split('\n');
    const testCases: RawTestCase[] = [];
    let pendingAnnotation = false; // @Test or @Benchmark seen
    let pendingSkip = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^@(?:Test|Benchmark)\b/.test(trimmed)) {
        pendingAnnotation = true;
      } else if (/^@(?:Ignore|Disabled)\b/.test(trimmed)) {
        pendingSkip = true;
      } else if (pendingAnnotation) {
        if (trimmed.startsWith('@')) {
          // Another annotation — keep pending
        } else if (/\b(\w+)\s*\(/.test(trimmed)) {
          // Method declaration
          const nameMatch = /(?:(?:public|private|protected|static|final|void|\w+)\s+)+(\w+)\s*\(/.exec(trimmed);
          if (nameMatch) {
            testCases.push({ name: nameMatch[1], isSkipped: pendingSkip, assertionCount: 0 });
          }
          pendingAnnotation = false;
          pendingSkip = false;
        } else if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          pendingAnnotation = false;
          pendingSkip = false;
        }
      }
    }

    if (testCases.length === 0) return null;

    // Count total assertions and distribute evenly
    const assertionTotal = this.countJavaAssertions(code);
    const perCase = testCases.length > 0 ? Math.round(assertionTotal / testCases.length) : 0;
    for (const tc of testCases) tc.assertionCount = perCase;

    const isBenchmark = hasJMH || /benchmark|bench/i.test(path.basename(filePath, '.java'));
    const testTypeHint: RawTestFile['testTypeHint'] = isBenchmark ? 'performance' : 'unit';

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles: [],
    };
  }

  private countJavaAssertions(code: string): number {
    const patterns = [
      /\bAssert\.\s*assert\w+\s*\(/g,
      /\bAssertions\.\s*assert\w+\s*\(/g,
      /\bassertEquals\s*\(/g,
      /\bassertTrue\s*\(/g,
      /\bassertFalse\s*\(/g,
      /\bassertNotNull\s*\(/g,
      /\bassertNull\s*\(/g,
      /\bassertThat\s*\(/g,
      /\bassertThrows\s*\(/g,
      /\bassertSame\s*\(/g,
      /\bassertNotSame\s*\(/g,
    ];
    let count = 0;
    for (const pat of patterns) count += (code.match(pat) ?? []).length;
    return count;
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
      throw new Error('JavaPlugin not initialized. Call initialize() first.');
    }
  }
}

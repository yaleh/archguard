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
import { ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import type { ParserBackend } from '../shared/parser-backend.js';
import type { ParserSession } from '../shared/syntax-tree.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { DependencyExtractor } from './dependency-extractor.js';
import { MavenCrossModuleParser } from './maven-crossmodule-parser.js';
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
  private parserSession?: ParserSession;

  constructor(private readonly parserBackend: ParserBackend) {
    if (!parserBackend) {
      throw new TypeError('A resolver-selected parser backend is required');
    }
  }

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
  async initialize(_config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.parserSession = await this.parserBackend.createSession('java');
    this.treeSitter = new TreeSitterBridge(this.parserSession);
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
    } catch {
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
    const rawRelations = this.mapper.mapRelations(packageList);
    const relations = this.mapper.reconcileInheritanceTargets(entities, rawRelations);

    // Add call graph relations (Phase 94)
    const entityNameSet = new Set(entities.map((e) => e.name));
    const callRelations = this.mapper.mapCallRelations(packageList, entityNameSet);
    relations.push(...callRelations);

    // Add Maven cross-module dependency relations
    try {
      const crossModuleDeps = await new MavenCrossModuleParser().parse(workspaceRoot);
      if (crossModuleDeps.length > 0) {
        // Build sub-module → representative Java package prefix map
        const modulePackageMap = new Map<string, string>();
        for (const entity of entities) {
          if (!entity.sourceLocation?.file) continue;
          const relFile = path.relative(workspaceRoot, entity.sourceLocation.file);
          const moduleName = relFile.split('/')[0];
          if (!modulePackageMap.has(moduleName) && entity.id.includes('.')) {
            const pkgPrefix = entity.id.split('.').slice(0, -1).join('.');
            modulePackageMap.set(moduleName, pkgPrefix);
          }
        }

        const crossSeen = new Set<string>();
        for (const dep of crossModuleDeps) {
          const srcPkg = modulePackageMap.get(dep.from);
          const tgtPkg = modulePackageMap.get(dep.to);
          if (!srcPkg || !tgtPkg) continue;
          const key = `dependency:${srcPkg}:${tgtPkg}`;
          if (crossSeen.has(key)) continue;
          crossSeen.add(key);
          relations.push({
            id: key,
            type: 'dependency',
            source: srcPkg,
            target: tgtPkg,
            inferenceSource: 'explicit',
          });
        }
      }
    } catch (error) {
      console.warn('Failed to parse Maven cross-module dependencies:', error);
    }

    return {
      version: ARCHJSON_SCHEMA_VERSION,
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
      const rawRelations = this.mapper.mapRelations([pkg]);
      const relations = this.mapper.reconcileInheritanceTargets(entities, rawRelations);

      return {
        version: ARCHJSON_SCHEMA_VERSION,
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
        version: ARCHJSON_SCHEMA_VERSION,
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
    const rawRelations = this.mapper.mapRelations(packageList);
    const relations = this.mapper.reconcileInheritanceTargets(entities, rawRelations);

    return {
      version: ARCHJSON_SCHEMA_VERSION,
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

  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
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
          const nameMatch =
            /(?:(?:public|private|protected|static|final|void|\w+)\s+)+(\w+)\s*\(/.exec(trimmed);
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

    // Count total assertions across the whole file (JUnit/AssertJ + Mockito + custom patterns).
    const assertionTotal = this.countJavaAssertions(code, patternConfig);

    // Distribute assertions across cases using remainder distribution to preserve the total.
    // Math.round() would lose assertions when totalAssertions < testCases.length (e.g. 13/53→0),
    // misclassifying assertion-bearing files as zero-assertion 'debug' tests.
    if (assertionTotal > 0) {
      const base = Math.floor(assertionTotal / testCases.length);
      const remainder = assertionTotal % testCases.length;
      for (let i = 0; i < testCases.length; i++) {
        testCases[i].assertionCount = base + (i < remainder ? 1 : 0);
      }
    }

    const isBenchmark = hasJMH || /benchmark|bench/i.test(path.basename(filePath, '.java'));
    const testTypeHint: RawTestFile['testTypeHint'] = isBenchmark ? 'performance' : 'unit';

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles: this.extractJavaImports(code),
      totalAssertions: assertionTotal,
      samePackageTargets: this.inferSamePackageTargets(filePath, code),
    };
  }

  /**
   * Same-package inference: a Java test class FooTest in package com.x (whose file
   * lives under src/test/java/com/x/) typically tests com.x.Foo without importing it.
   * Derive the implied FQN candidates from the class's own package + name so
   * test coverage mapping can link tests that never import the class under test.
   * Returns fully-qualified candidate entity ids (empty when not inferable).
   */
  private inferSamePackageTargets(filePath: string, code: string): string[] {
    // Extract the test class's package declaration.
    const pkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(code);
    if (!pkgMatch) return [];
    const pkg = pkgMatch[1];

    // Test class name from the filename (FooTest.java → FooTest).
    const base = path.basename(filePath, '.java');
    const candidates: string[] = [];

    // FooTest → Foo, FooTests → Foo
    if (/(?:Tests?)$/.test(base)) {
      candidates.push(`${pkg}.${base.replace(/Tests?$/, '')}`);
    }
    // TestFoo → Foo (when the prefix is "Test" followed by an uppercase letter)
    if (/^Test(?=[A-Z])/.test(base)) {
      candidates.push(`${pkg}.${base.slice(4)}`);
    }

    // Same-package direct references: aggregate/Pojo tests (BeanXxxTest, FooPojoTest,
    // UIStateBeanTest) construct or call same-package classes without importing them.
    // Collect the simple names that are clearly referenced (new Foo, Foo.member) so the
    // analyzer can link them to same-package entities. Only names not imported are
    // candidates — imported classes are resolved via import matching instead.
    const importedNames = new Set<string>();
    for (const imp of code.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm)) {
      const segs = imp[1].split('.');
      const last = segs[segs.length - 1];
      if (/^[A-Z]/.test(last)) importedNames.add(last);
    }
    for (const ref of code.matchAll(/\bnew\s+([A-Z]\w+)\s*\(/g)) {
      const sn = ref[1];
      if (sn !== base && !importedNames.has(sn)) candidates.push(`${pkg}.${sn}`);
    }
    for (const ref of code.matchAll(/\b([A-Z]\w+)\.(?:[a-z]\w+)\s*\(/g)) {
      const sn = ref[1];
      if (sn !== base && !importedNames.has(sn)) candidates.push(`${pkg}.${sn}`);
    }
    // .class literals (Foo.class) — reflection-based contract/coverage tests that
    // reference same-package classes without constructing or calling them.
    for (const ref of code.matchAll(/\b([A-Z]\w+)\.class\b/g)) {
      const sn = ref[1];
      if (sn !== base && !importedNames.has(sn)) candidates.push(`${pkg}.${sn}`);
    }
    // Class.forName("com.x.Y") — contract tests that verify a fully-qualified class
    // exists via reflection. The FQN is exact (no package inference), so link it
    // directly when the analyzer finds a matching entity.
    for (const ref of code.matchAll(/Class\.forName\(\s*"([\w.]+\.\w+)"\s*\)/g)) {
      // Keep only fully-qualified names that end in a class segment (uppercase start).
      if (/^[a-z][\w.]*\.[A-Z]\w*$/.test(ref[1])) candidates.push(ref[1]);
    }

    // The test class itself is NOT a target — filter it out if derived (defensive).
    return [...new Set(candidates)].filter((c) => c !== `${pkg}.${base}`);
  }

  /**
   * Extract project-local imports from Java source and convert to relative file paths.
   * e.g. "com.example.Foo" → "com/example/Foo.java"
   * Well-known external/stdlib packages are filtered out so only project-internal imports remain.
   * The caller (resolveImportedEntityIds) matches these paths against entity sourceLocation files
   * using a suffix match for Maven multi-module projects.
   */
  private extractJavaImports(code: string): string[] {
    // Known external package prefixes — anything matching these is skipped.
    const EXTERNAL_PREFIXES = [
      'java.',
      'javax.',
      'jakarta.',
      'sun.',
      'com.sun.',
      'org.junit.',
      'org.testng.',
      'org.assertj.',
      'org.openjdk.jmh.',
      'org.mockito.',
      'org.slf4j.',
      'ch.qos.',
      'com.fasterxml.',
      'com.google.',
      'io.grpc.',
      'io.netty.',
      'io.vertx.',
      'org.apache.',
      'org.springframework.',
    ];

    const imported: string[] = [];
    // Matches both: import com.foo.Bar;  and  import static com.foo.Bar.*;
    const importRegex = /^\s*import\s+(?:static\s+)?([a-zA-Z][\w.]*[\w*])\s*;/gm;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(code)) !== null) {
      let fqn = m[1];
      // Strip trailing wildcard (import com.example.pkg.*)
      if (fqn.endsWith('.*')) fqn = fqn.slice(0, -2);

      // Skip external packages
      if (EXTERNAL_PREFIXES.some((pfx) => fqn.startsWith(pfx))) continue;

      // Heuristic: if last segment starts with uppercase it's a class → append .java
      // if last segment is lowercase but second-to-last starts with uppercase, it's a
      // static method/field import (e.g. import static com.example.MyClass.myMethod) → class file
      // otherwise treat as package directory (no extension) for dir-level matching
      const parts = fqn.split('.');
      const last = parts[parts.length - 1];
      let filePath: string;
      if (/^[A-Z]/.test(last)) {
        filePath = parts.join('/') + '.java';
      } else if (parts.length >= 2 && /^[A-Z]/.test(parts[parts.length - 2])) {
        // static method/field import — strip method name, use class file
        filePath = parts.slice(0, -1).join('/') + '.java';
      } else {
        filePath = parts.join('/');
      }

      if (!imported.includes(filePath)) imported.push(filePath);
    }
    return imported;
  }

  private countJavaAssertions(code: string, patternConfig?: TestPatternConfig): number {
    // JUnit / AssertJ assertion calls
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
    // Mockito verification / stubbing API — these are assertion-bearing calls that
    // JUnit-only patterns would otherwise miss, misclassifying tests as zero-assertion.
    const mockitoPatterns = [
      /\bverify\s*\(/g,
      /\bverifyNoMoreInteractions\s*\(/g,
      /\bverifyZeroInteractions\s*\(/g,
      /\bwhen\s*\(/g,
      /\bdoReturn\s*\(/g,
      /\bdoThrow\s*\(/g,
      /\bdoNothing\s*\(/g,
      /\bdoAnswer\s*\(/g,
    ];
    let count = 0;
    for (const pat of [...patterns, ...mockitoPatterns]) {
      count += (code.match(pat) ?? []).length;
    }
    // Apply custom assertion patterns from patternConfig
    if (patternConfig?.customAssertionRegexes?.length) {
      for (const regexStr of patternConfig.customAssertionRegexes) {
        try {
          const regex = new RegExp(regexStr, 'g');
          const matches = code.match(regex);
          if (matches) count += matches.length;
        } catch {
          // ignore invalid regex patterns
        }
      }
    }
    return count;
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    this.parserSession?.dispose();
    this.parserSession = undefined;
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

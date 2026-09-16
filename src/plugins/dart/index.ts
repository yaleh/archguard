/**
 * Dart Language Plugin
 *
 * Implements ILanguagePlugin for Dart source code analysis.
 * Uses the tree-sitter-dart grammar (WASM baseline) for AST parsing and
 * produces ArchJSON with entity and relation information.
 *
 * Dart is WASM-only: the legacy `tree-sitter-dart` native binding is ABI 13
 * and incompatible with the tree-sitter 0.25 runtime, so `auto` policy always
 * resolves the portable WASM backend. This mirrors the optional-native design
 * of the other Tree-sitter plugins (Go/Java/Python/C++/Kotlin), where native
 * is an optional accelerator and WASM is the deterministic baseline.
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
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import type { ParserBackend } from '../shared/parser-backend.js';
import type { ParserSession } from '../shared/syntax-tree.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { buildPackageMap, resolveImportUri } from './pubspec-resolver.js';
import { DART_DEFAULT_IGNORE, DART_VENDORED_IGNORE } from './ignore-patterns.js';

export class DartPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'dart',
    version: '1.0.0',
    displayName: 'Dart',
    fileExtensions: ['.dart'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: false,
      typeInference: false,
      testStructureExtraction: true,
    },
  };

  readonly supportedLevels = ['package', 'class'] as const;

  private bridge?: TreeSitterBridge;
  private mapper?: ArchJsonMapper;
  private initialized = false;
  private parserSession?: ParserSession;
  /** package name → absolute pubspec directory, built once at initialize. */
  private packageMap = new Map<string, string>();

  constructor(private readonly parserBackend: ParserBackend) {
    if (!parserBackend) {
      throw new TypeError('A resolver-selected parser backend is required');
    }
  }

  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) return;
    this.parserSession = await this.parserBackend.createSession('dart');
    this.bridge = new TreeSitterBridge(this.parserSession);
    this.mapper = new ArchJsonMapper();
    // Resolve package: imports to file paths (melos monorepo aware).
    if (config.workspaceRoot) {
      this.packageMap = await buildPackageMap(config.workspaceRoot);
    }
    this.initialized = true;
  }

  canHandle(targetPath: string): boolean {
    return path.extname(targetPath).toLowerCase() === '.dart';
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    const ignorePatterns = [
      ...DART_DEFAULT_IGNORE,
      ...DART_VENDORED_IGNORE,
      ...(config.excludePatterns ?? []),
    ];

    const files = await glob('**/*.dart', {
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

    return this.mapper.map(rawFiles, '', workspaceRoot, this.packageMap);
  }

  parseCode(code: string, filePath = 'source.dart'): ArchJSON {
    this.ensureInitialized();
    const rawFile = this.bridge.parseCode(code, filePath);
    return this.mapper.map([rawFile], '', path.dirname(filePath));
  }

  async parseFiles(filePaths: string[], workspaceRoot?: string): Promise<ArchJSON> {
    this.ensureInitialized();

    const rawFiles = await Promise.all(
      filePaths.map(async (file) => {
        const code = await fs.readFile(file, 'utf-8');
        return this.bridge.parseCode(code, file);
      })
    );

    // An explicit workspaceRoot (from the CLI/MCP provider) is authoritative; it
    // must NOT be derived from the first file (that would be `<project>/lib`
    // instead of `<project>`, breaking pubspec/package resolution and entity IDs).
    const root = workspaceRoot ?? (filePaths.length > 0 ? path.dirname(filePaths[0]) : '.');
    return this.mapper.map(rawFiles, '', root, this.packageMap);
  }

  async dispose(): Promise<void> {
    this.parserSession?.dispose();
    this.parserSession = undefined;
    this.initialized = false;
    this.bridge = undefined;
    this.mapper = undefined;
  }

  /**
   * Determine whether a file is a Dart test file.
   *
   * The Dart/Flutter convention (`dart test` / `flutter test`) only auto-runs
   * `*_test.dart` files. A bare `/test/` directory match would misclassify
   * helpers and fixtures that live beside tests (e.g. `*_base.dart`,
   * `*_helper.dart`) as test files. Custom globs take precedence.
   */
  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    if (patternConfig?.testFileGlobs?.length) {
      return micromatch.isMatch(filePath, patternConfig.testFileGlobs);
    }
    const normalized = filePath.replace(/\\/g, '/');
    return /_test\.dart$/.test(normalized);
  }

  /**
   * Extract raw test structure from a Dart test file (pure static analysis).
   *
   * Recognizes `test` / `testWidgets` cases (package:test / flutter_test),
   * counts `expect(` assertions, and flags `skip:`-marked cases. Returns null
   * when no test cases are found.
   */
  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath, patternConfig)) return null;

    const testCases: RawTestCase[] = [];
    let totalAssertions = 0;

    // Case name = first string literal argument to test(...) / testWidgets(...).
    const caseRe = /\b(?:testWidgets|test)\s*\(\s*(['"`])([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = caseRe.exec(code)) !== null) {
      // Find the closing paren of this test(...) call and inspect its argument
      // list for a `skip:` named parameter.
      const openParen = code.indexOf('(', match.index);
      const closeParen = this.matchParen(code, openParen);
      const callText =
        closeParen > 0 ? code.slice(match.index, closeParen) : code.slice(match.index);
      testCases.push({
        name: match[2],
        assertionCount: 0,
        isSkipped: /\bskip\s*:/.test(callText),
      });
    }

    // Assertion count: `expect(` calls.
    const expectRe = /\bexpect(?:Later)?\s*\(/g;
    totalAssertions = code.match(expectRe)?.length ?? 0;

    if (patternConfig?.customAssertionRegexes?.length) {
      for (const regexStr of patternConfig.customAssertionRegexes) {
        try {
          totalAssertions += code.match(new RegExp(regexStr, 'g'))?.length ?? 0;
        } catch {
          // ignore invalid custom regex
        }
      }
    }

    if (testCases.length === 0) return null;

    // Distribute assertions across cases using remainder distribution.
    // NOTE: this is an APPROXIMATION — `totalAssertions` is a file-wide count
    // of `expect(`/`expectLater(` calls, not a per-case attribution. A static
    // scan cannot reliably bind each `expect(` to its enclosing `test(...)`
    // without an AST callback-range walk, so per-case `assertionCount` is the
    // file total split evenly. Do not use it for per-case "zero-assertion"
    // detection; that would require counting inside each test's callback range.
    if (totalAssertions > 0) {
      const base = Math.floor(totalAssertions / testCases.length);
      const remainder = totalAssertions % testCases.length;
      for (let i = 0; i < testCases.length; i++) {
        testCases[i].assertionCount = base + (i < remainder ? 1 : 0);
      }
    }

    const normalized = filePath.replace(/\\/g, '/');
    let testTypeHint: RawTestFile['testTypeHint'] = 'unit';
    if (/\/integration_test\//.test(normalized) || /\/integration(?:Test|\/)/.test(normalized)) {
      testTypeHint = 'integration';
    } else if (/\/e2e_test\//.test(normalized) || /\/e2e(?:Test|\/)/.test(normalized)) {
      testTypeHint = 'e2e';
    }

    const frameworks: string[] = [];
    if (/\btestWidgets\s*\(/.test(code) || /flutter_test/.test(code)) {
      frameworks.push('flutter_test');
    }
    if (/\b(?:test|group)\s*\(/.test(code)) {
      frameworks.push('test');
    }

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles: this.extractImportedSourceFiles(code, filePath),
      totalAssertions,
    };
  }

  private extractImportedSourceFiles(code: string, filePath: string): string[] {
    const imported: string[] = [];
    // Match `import <uri>` followed by any valid trailing clauses before `;`:
    //   import 'x';                import 'x' as api;
    //   import 'x' deferred as d;  import 'x' show a, b;
    //   import 'x' hide c;         import 'x' if (dart.library.io) 'io';
    // The URI capture is the first quoted string; the trailing clauses are
    // matched loosely and discarded — we only need the module path.
    const importRe = /^import\s+(['"])([^'"]+)\1[\s\S]*?;/gm;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(code)) !== null) {
      const resolved = resolveImportUri(this.packageMap, m[2], filePath);
      if (resolved) imported.push(resolved);
    }
    return imported;
  }

  /** Index of the paren matching the opening paren at `openIndex` (naive string scan). */
  private matchParen(code: string, openIndex: number): number {
    if (openIndex < 0 || code[openIndex] !== '(') return -1;
    let depth = 0;
    for (let i = openIndex; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('DartPlugin not initialized. Call initialize() first.');
    }
  }
}

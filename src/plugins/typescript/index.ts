/**
 * TypeScript/JavaScript Language Plugin
 * Phase 1.1: TypeScript Plugin Migration
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
} from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import type { IDependencyExtractor, Dependency } from '@/core/interfaces/dependency.js';
import type {
  IValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '@/core/interfaces/validation.js';
import { Project } from 'ts-morph';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { findTsConfigPath, loadPathAliases } from '@/utils/tsconfig-finder.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import { TypeScriptAnalyzer } from './typescript-analyzer.js';

// ---------------------------------------------------------------------------
// Module-level helpers for extractTestStructure
// ---------------------------------------------------------------------------

/**
 * Scan forward from startIdx to find the closing '}' of the test callback body.
 * Returns the line index (exclusive) of the first line after the body ends.
 * Tracks brace depth: opening '{' increments, closing '}' decrements.
 * Scanning starts counting depth only after the first '{' is seen
 * (the callback function open brace), so inline object literals on the
 * test() invocation line itself are handled gracefully.
 */
export function scanTestBody(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}' && started) {
        depth--;
        if (depth === 0) {
          return i + 1; // exclusive end index
        }
      }
    }
  }
  return lines.length; // unterminated body — scan to end of file
}

/** Module-level tsconfig path cache keyed on directory (avoids repeated FS traversal). */
const _tsconfigPathCache = new Map<string, string | undefined>();

function compileCustomAssertionRegexes(patterns?: string[]): RegExp[] {
  return (patterns ?? []).flatMap((pattern) => {
    try {
      return [new RegExp(pattern)];
    } catch (error) {
      console.warn(
        `[typescript:test-analysis] Invalid custom assertion regex "${pattern}": ${String(error)}`
      );
      return [];
    }
  });
}

function cachedFindTsConfigPath(dir: string): string | undefined {
  if (_tsconfigPathCache.has(dir)) return _tsconfigPathCache.get(dir);
  const result = findTsConfigPath(dir);
  _tsconfigPathCache.set(dir, result);
  return result;
}

/**
 * TypeScript/JavaScript plugin for ArchGuard
 *
 * Wraps existing TypeScriptParser and ParallelParser to conform to
 * the ILanguagePlugin interface, enabling multi-language support.
 */
export class TypeScriptPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: true,
      testStructureExtraction: true,
    } as PluginCapabilities,
  };

  readonly supportedLevels = ['package', 'class', 'method'] as const;

  private parser!: TypeScriptParser;
  private parallelParser!: ParallelParser;
  private initialized = false;
  private workspaceRoot?: string;

  readonly dependencyExtractor: IDependencyExtractor = {
    extractDependencies: this.extractDeps.bind(this),
  };

  readonly validator: IValidator = {
    validate: this.validateArchJson.bind(this),
  };

  /**
   * Initialize the plugin
   */
  async initialize(_config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize parsers
    this.parser = new TypeScriptParser();
    this.parallelParser = new ParallelParser({
      continueOnError: true,
    });

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a file with supported extension
    const ext = path.extname(targetPath).toLowerCase();
    if (this.metadata.fileExtensions.includes(ext)) {
      return true;
    }

    // Check if it's a directory with TypeScript/JavaScript markers
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        // Check for package.json
        if (fs.existsSync(path.join(targetPath, 'package.json'))) {
          return true;
        }
        // Check for tsconfig.json
        if (fs.existsSync(path.join(targetPath, 'tsconfig.json'))) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Create a shared ts-morph Project instance for the workspace.
   * Source files are added once here; both TypeScriptParser and
   * TypeScriptAnalyzer reuse this Project to avoid a second parse pass.
   */
  private initTsProject(
    workspaceRoot: string,
    pattern: string,
    excludePatterns?: string[]
  ): Project {
    // Inject only baseUrl + paths from the nearest tsconfig.json so that path
    // aliases (e.g. @/*) are resolved by the TypeChecker. Other compiler options
    // (e.g. moduleResolution) are intentionally NOT inherited to preserve ts-morph's
    // default .js → .ts resolution used by RelationExtractor.
    const tsConfigFilePath = findTsConfigPath(workspaceRoot);
    const pathAliases = tsConfigFilePath ? loadPathAliases(tsConfigFilePath) : undefined;
    const project = pathAliases
      ? new Project({ compilerOptions: { target: 99 /* ESNext */, ...pathAliases } })
      : new Project({ compilerOptions: { target: 99 /* ESNext */ } });
    const builtinExcludes = [
      `!${workspaceRoot}/**/*.test.ts`,
      `!${workspaceRoot}/**/*.spec.ts`,
      `!${workspaceRoot}/**/*.test.tsx`,
      `!${workspaceRoot}/**/*.spec.tsx`,
      `!${workspaceRoot}/**/*.test.jsx`,
      `!${workspaceRoot}/**/*.spec.jsx`,
      `!${workspaceRoot}/**/node_modules/**`,
    ];
    const callerExcludes = (excludePatterns ?? []).map((p) =>
      p.startsWith('!') || path.isAbsolute(p) ? p : `!${workspaceRoot}/${p}`
    );
    project.addSourceFilesAtPaths([
      `${workspaceRoot}/${pattern}`,
      ...builtinExcludes,
      ...callerExcludes,
    ]);
    return project;
  }

  /**
   * Parse entire project
   * Delegates to TypeScriptParser.parseProject and TypeScriptAnalyzer.analyze
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // Store workspaceRoot so it can be passed to parsers for file-scoped entity IDs
    this.workspaceRoot = workspaceRoot;

    // Recreate parsers with workspaceRoot for correct relative path handling
    this.parser = new TypeScriptParser(workspaceRoot);
    this.parallelParser = new ParallelParser({
      workspaceRoot,
      continueOnError: true,
    });

    const pattern = config.filePattern ?? '**/*.{ts,tsx}';

    // Create a single shared ts-morph Project to avoid parsing twice
    const tsProject = this.initTsProject(workspaceRoot, pattern, config.excludePatterns);

    // Parse ArchJSON using the shared Project
    const archJson = this.parser.parseProject(workspaceRoot, pattern, tsProject);

    // Run TypeScript-specific analysis (module graph, etc.) with same source files
    const analyzer = new TypeScriptAnalyzer();
    const tsAnalysis = analyzer.analyze(
      workspaceRoot,
      tsProject.getSourceFiles(),
      archJson.entities
    );

    // Attach tsAnalysis to extensions
    return {
      ...archJson,
      workspaceRoot,
      extensions: {
        ...archJson.extensions,
        tsAnalysis,
      },
    };
  }

  /**
   * Parse single code string
   * Delegates to TypeScriptParser.parseCode
   */
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    this.ensureInitialized();
    return this.parser.parseCode(code, filePath);
  }

  /**
   * Parse multiple files
   * Delegates to ParallelParser.parseFiles
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();
    return this.parallelParser.parseFiles(filePaths);
  }

  /**
   * Extract npm dependencies from package.json
   */
  private async extractDeps(workspaceRoot: string): Promise<Dependency[]> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return [];
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const dependencies: Dependency[] = [];

    // Runtime dependencies
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'runtime',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    // Development dependencies
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'development',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    // Peer dependencies
    if (packageJson.peerDependencies) {
      for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'peer',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    return dependencies;
  }

  /**
   * Validate ArchJSON structure
   */
  private validateArchJson(archJson: ArchJSON): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    // Validate version
    if (!archJson.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'ArchJSON version is required',
        path: 'version',
        severity: 'error',
      });
    }

    // Validate language
    if (!archJson.language) {
      errors.push({
        code: 'MISSING_LANGUAGE',
        message: 'ArchJSON language is required',
        path: 'language',
        severity: 'error',
      });
    }

    // Validate entities
    if (archJson.entities) {
      archJson.entities.forEach((entity, index) => {
        if (!entity.id) {
          errors.push({
            code: 'MISSING_ENTITY_ID',
            message: `Entity at index ${index} is missing id`,
            path: `entities[${index}].id`,
            severity: 'error',
          });
        }

        if (!entity.name) {
          errors.push({
            code: 'MISSING_ENTITY_NAME',
            message: `Entity at index ${index} is missing name`,
            path: `entities[${index}].name`,
            severity: 'error',
          });
        }
      });
    }

    // Validate relation references
    if (archJson.relations && archJson.entities) {
      const entityIds = new Set(archJson.entities.map((e) => e.id));

      archJson.relations.forEach((relation, index) => {
        if (!entityIds.has(relation.source)) {
          warnings.push({
            code: 'DANGLING_RELATION_SOURCE',
            message: `Relation references non-existent source entity: ${relation.source}`,
            path: `relations[${index}].source`,
            severity: 'warning',
            suggestion: 'Ensure the source entity is included in the parsed scope',
          });
        }

        if (!entityIds.has(relation.target)) {
          warnings.push({
            code: 'DANGLING_RELATION_TARGET',
            message: `Relation references non-existent target entity: ${relation.target}`,
            path: `relations[${index}].target`,
            severity: 'warning',
            suggestion: 'Ensure the target entity is included in the parsed scope',
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Determine whether a given file path is a test file.
   */
  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    return (
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) ||
      (patternConfig?.testFileGlobs?.length
        ? micromatch.isMatch(filePath, patternConfig.testFileGlobs)
        : false)
    );
  }

  /**
   * Extract raw test structure from a single TypeScript/JavaScript test file.
   */
  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    try {
      // Detect frameworks
      const frameworks: string[] = [];
      const frameworkPatterns: Array<[string, RegExp]> = [
        ['vitest', /from ['"]vitest['"]/],
        ['jest', /from ['"]@jest\/|require\(['"]jest['"]\)|jest\.fn\(/],
        ['mocha', /from ['"]mocha['"]|require\(['"]mocha['"]\)/],
        ['jasmine', /jasmine\.(describe|it|expect)\(/],
        ['playwright', /from ['"]@playwright\/test['"]/],
        ['cypress', /from ['"]cypress['"]/],
        ['@testing-library', /from ['"]@testing-library\//],
      ];
      for (const [name, pattern] of frameworkPatterns) {
        if (pattern.test(code)) {
          frameworks.push(name);
        }
      }
      if (frameworks.length === 0) {
        frameworks.push('unknown');
      }

      // Determine testTypeHint from file path
      let testTypeHint: RawTestFile['testTypeHint'] = 'unit';
      if (/\/e2e\/|\/cypress\/|\/playwright\//.test(filePath)) {
        testTypeHint = 'e2e';
      } else if (/\/integration\/|\.integration\.test\./.test(filePath)) {
        testTypeHint = 'integration';
      } else if (/\/perf\/|\/performance\/|\/benchmark\//.test(filePath)) {
        testTypeHint = 'performance';
      }

      // Assertion patterns
      const assertionPatterns = patternConfig?.assertionPatterns ?? [
        'expect(',
        'assert(',
        'assert.',
      ];
      const customAssertionRegexes = compileCustomAssertionRegexes(
        patternConfig?.customAssertionRegexes
      );

      // Skip patterns
      const skipPatterns = patternConfig?.skipPatterns ?? [
        'it.skip(',
        'test.skip(',
        'xit(',
        'xtest(',
        'it.todo(',
        'test.todo(',
        'describe.skip(',
      ];

      // Count test cases: lines matching it( or test(
      const lines = code.split('\n');
      const testCasePattern = /\bit\s*\(|\btest\s*\(/;

      const testCases = lines
        .map((line, _idx) => {
          if (!testCasePattern.test(line)) return null;

          const isSkipped = skipPatterns.some((p) => line.includes(p));
          // Use brace-depth scan to find the full test body instead of a fixed 20-line window
          const bodyEnd = scanTestBody(lines, _idx);
          const assertionCount = lines
            .slice(_idx, bodyEnd)
            .filter(
              (line) =>
                assertionPatterns.some((pattern) => line.includes(pattern)) ||
                customAssertionRegexes.some((regex) => regex.test(line))
            ).length;

          // Extract name from first string argument
          const nameMatch = line.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
          const name = nameMatch ? nameMatch[1] : `test at line ${_idx + 1}`;

          return { name, isSkipped, assertionCount };
        })
        .filter((tc): tc is NonNullable<typeof tc> => tc !== null);

      // Extract imported source files: relative imports not ending in .test/.spec
      const importedSourceFiles: string[] = [];
      const importPattern = /import\s+.*?from\s+['"](\.[^'"]+)['"]/g;
      const dir = path.dirname(filePath);
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(code)) !== null) {
        const importPath = match[1];
        // Skip test/spec files
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(importPath)) continue;
        // Resolve to absolute path
        const resolved = path.resolve(dir, importPath);
        // Try adding extensions if no extension present; normalise .js → .ts
        const withExt = /\.(ts|tsx|js|jsx)$/.test(resolved)
          ? resolved.replace(/\.js$/, '.ts')
          : `${resolved}.ts`;
        importedSourceFiles.push(withExt);
      }

      // Extract @/-alias imports (e.g. `from '@/parser/foo.js'`)
      // Resolve using the nearest tsconfig.json paths config.
      const aliasPattern = /import\s+.*?from\s+['"](@\/[^'"]+)['"]/g;
      let aliasMatch: RegExpExecArray | null;
      while ((aliasMatch = aliasPattern.exec(code)) !== null) {
        const aliasPath = aliasMatch[1]; // e.g. '@/parser/typescript-parser.js'
        // Strip the leading '@/'
        const stripped = aliasPath.replace(/^@\//, ''); // e.g. 'parser/typescript-parser.js'

        // Resolve via tsconfig.paths: '@/*' maps to 'src/*' (most common convention).
        const tsConfigPath = cachedFindTsConfigPath(path.dirname(filePath));
        const aliases = tsConfigPath ? loadPathAliases(tsConfigPath) : undefined;

        let resolvedBase: string | null = null;

        if (aliases?.paths) {
          // Look for '@/*' → ['src/*'] or equivalent
          const atStarTarget = aliases.paths['@/*'];
          if (atStarTarget && atStarTarget.length > 0) {
            // e.g. 'src/*' → strip trailing '/*' → 'src'
            const targetDir = atStarTarget[0].replace(/\/\*$/, '');
            resolvedBase = path.join(aliases.baseUrl, targetDir);
          }
        }

        if (!resolvedBase) {
          // Fallback: assume '@/*' → '<workspaceRoot>/src/*' by convention
          // workspaceRoot is unavailable here; use file's ancestor heuristic
          resolvedBase = path.join(path.dirname(filePath), '..', '..', 'src');
        }

        // Build resolved path from base + stripped alias
        const resolved = path.join(resolvedBase, stripped);
        // Normalise extension: .js imports → .ts sources; bare path → add .ts
        const withTs = /\.(ts|tsx|js|jsx)$/.test(resolved)
          ? resolved.replace(/\.js$/, '.ts')
          : `${resolved}.ts`;
        importedSourceFiles.push(withTs);
      }

      // Extract dynamic import() calls: await import('@/...') or import('../...')
      const dynamicImportPattern = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let dynMatch: RegExpExecArray | null;
      while ((dynMatch = dynamicImportPattern.exec(code)) !== null) {
        const specifier = dynMatch[1];
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(specifier)) continue;

        if (specifier.startsWith('@/')) {
          // @/ alias — reuse same alias resolution logic
          const stripped = specifier.replace(/^@\//, '');
          const tsConfigPath = cachedFindTsConfigPath(path.dirname(filePath));
          const aliases = tsConfigPath ? loadPathAliases(tsConfigPath) : undefined;
          let resolvedBase: string | null = null;
          if (aliases?.paths) {
            const atStarTarget = aliases.paths['@/*'];
            if (atStarTarget && atStarTarget.length > 0) {
              const targetDir = atStarTarget[0].replace(/\/\*$/, '');
              resolvedBase = path.join(aliases.baseUrl, targetDir);
            }
          }
          if (!resolvedBase) {
            resolvedBase = path.join(path.dirname(filePath), '..', '..', 'src');
          }
          const resolved = path.join(resolvedBase, stripped);
          const withTs = /\.(ts|tsx|js|jsx)$/.test(resolved)
            ? resolved.replace(/\.js$/, '.ts')
            : `${resolved}.ts`;
          importedSourceFiles.push(withTs);
        } else if (specifier.startsWith('.')) {
          // Relative path
          const resolved = path.resolve(dir, specifier);
          const withExt = /\.(ts|tsx|js|jsx)$/.test(resolved)
            ? resolved.replace(/\.js$/, '.ts')
            : `${resolved}.ts`;
          importedSourceFiles.push(withExt);
        }
      }

      return {
        filePath,
        frameworks,
        testTypeHint,
        testCases,
        importedSourceFiles,
      };
    } catch {
      return null;
    }
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
      throw new Error('TypeScriptPlugin not initialized. Call initialize() first.');
    }
  }
}

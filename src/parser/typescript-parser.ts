/**
 * TypeScriptParser - Main parser orchestrating all extractors
 * Story 6: Complete Arch-JSON Generation
 */

import path from 'path';
import { Project } from 'ts-morph';
import { findTsConfigPath, loadPathAliases } from '@/utils/tsconfig-finder.js';
import { ClassExtractor } from './class-extractor';
import { InterfaceExtractor } from './interface-extractor';
import { EnumExtractor } from './enum-extractor';
import { RelationExtractor } from './relation-extractor';
import { FunctionExtractor } from './function-extractor';
import type { ArchJSON, Entity, Relation } from '@/types';

/**
 * Main TypeScript parser that orchestrates all extractors
 * to generate complete ArchJSON output
 */
export class TypeScriptParser {
  private project: Project;
  private classExtractor: ClassExtractor;
  private interfaceExtractor: InterfaceExtractor;
  private enumExtractor: EnumExtractor;
  private relationExtractor: RelationExtractor;
  private functionExtractor: FunctionExtractor;
  private workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
    this.classExtractor = new ClassExtractor();
    this.interfaceExtractor = new InterfaceExtractor();
    this.enumExtractor = new EnumExtractor();
    this.relationExtractor = new RelationExtractor();
    this.functionExtractor = new FunctionExtractor();
  }

  /**
   * Convert an absolute file path to a workspace-relative path.
   * If no workspaceRoot is set, returns the path as-is.
   */
  private toRelPath(absPath: string): string {
    if (this.workspaceRoot) {
      return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
    }
    return absPath;
  }

  /**
   * Parse TypeScript code and generate ArchJSON
   *
   * NOTE: This is the in-memory per-file entry point used by ParallelParser.parseFiles().
   * It uses an in-memory ts-morph Project without TypeChecker, so cross-file type
   * resolution and external relation filtering are NOT applied here. Those transforms
   * are applied only in parseProject() which has filesystem access and a full TypeChecker.
   *
   * @param code - TypeScript source code
   * @param filePath - Source file path (default: 'source.ts')
   * @returns Complete ArchJSON structure
   */
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const entities: Entity[] = [];
    const sourceFiles: string[] = [filePath];

    const relPath = this.toRelPath(filePath);

    // Extract classes
    for (const classDecl of sourceFile.getClasses()) {
      const entity = this.classExtractor['extractClass'](classDecl, relPath);
      entities.push(entity);
    }

    // Extract interfaces
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      const entity = this.interfaceExtractor.extractInterface(interfaceDecl, relPath);
      entities.push(entity);
    }

    // Extract enums
    for (const enumDecl of sourceFile.getEnums()) {
      const entity = this.enumExtractor.extractEnum(enumDecl, relPath);
      entities.push(entity);
    }

    // Extract standalone functions
    entities.push(...this.functionExtractor.extract(sourceFile, relPath));

    // Extract relations
    const relations = this.relationExtractor.extractFromSourceFile(sourceFile);

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations,
    };
  }

  /**
   * Parse multiple TypeScript files from a project directory
   *
   * NOTE: This is the filesystem entry point. It uses a real ts-morph Project with
   * TypeChecker, enabling cross-file relation target resolution (resolveRelationTargets)
   * and external/primitive relation filtering (filterExternalRelations). These transforms
   * are NOT available in parseCode() / ParallelParser.parseFiles() which use in-memory
   * per-file projects without TypeChecker.
   *
   * @param rootDir - Root directory path
   * @param pattern - Glob pattern for files (default: '**\/*.ts')
   * @returns Complete ArchJSON structure
   */
  parseProject(rootDir: string, pattern: string = '**/*.ts', externalProject?: Project): ArchJSON {
    // Set workspaceRoot so toRelPath() can relativize paths
    this.workspaceRoot = rootDir;

    // Use externally-provided Project if supplied; otherwise create a new one.
    // This allows TypeScriptPlugin to share a single ts-morph Project instance
    // between parsing and analysis (avoiding a duplicate parse pass).
    let fsProject: Project;
    if (externalProject) {
      fsProject = externalProject;
    } else {
      // Create a new project for filesystem parsing (not in-memory).
      // Inject only baseUrl + paths from the nearest tsconfig.json so that path
      // aliases (e.g. @/*) are resolved by the TypeChecker. Other compiler options
      // (e.g. moduleResolution) are intentionally NOT inherited to preserve ts-morph's
      // default .js → .ts resolution used by RelationExtractor.
      const tsConfigFilePath = findTsConfigPath(rootDir);
      const pathAliases = tsConfigFilePath ? loadPathAliases(tsConfigFilePath) : undefined;
      fsProject = pathAliases
        ? new Project({ compilerOptions: { target: 99, ...pathAliases } })
        : new Project({ compilerOptions: { target: 99 } });

      // Add source files (exclude test files and node_modules)
      fsProject.addSourceFilesAtPaths([
        `${rootDir}/${pattern}`,
        `!${rootDir}/**/*.test.ts`,
        `!${rootDir}/**/*.spec.ts`,
        `!${rootDir}/**/node_modules/**`,
      ]);
    }

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const sourceFiles: string[] = [];

    // Process all source files
    for (const sourceFile of fsProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      sourceFiles.push(filePath);

      const relPath = this.toRelPath(filePath);

      // Extract classes
      for (const classDecl of sourceFile.getClasses()) {
        const entity = this.classExtractor['extractClass'](classDecl, relPath);
        entities.push(entity);
      }

      // Extract interfaces
      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const entity = this.interfaceExtractor.extractInterface(interfaceDecl, relPath);
        entities.push(entity);
      }

      // Extract enums
      for (const enumDecl of sourceFile.getEnums()) {
        const entity = this.enumExtractor.extractEnum(enumDecl, relPath);
        entities.push(entity);
      }

      // Extract standalone functions
      entities.push(...this.functionExtractor.extract(sourceFile, relPath));

      // Build import resolution map for this source file:
      // maps imported name → scoped entity ID (e.g. "ArchJSON" → "src/types/index.ts.ArchJSON")
      const importedNameToScopedId = new Map<string, string>();
      for (const importDecl of sourceFile.getImportDeclarations()) {
        const importedSourceFile = importDecl.getModuleSpecifierSourceFile();
        if (!importedSourceFile) continue;
        const importedRelPath = this.toRelPath(importedSourceFile.getFilePath());
        for (const named of importDecl.getNamedImports()) {
          const importedName = named.getName();
          importedNameToScopedId.set(importedName, `${importedRelPath}.${importedName}`);
        }
      }

      // Extract relations for this file and resolve both source and target to scoped IDs
      const fileRelations = this.relationExtractor.extractFromSourceFile(sourceFile);
      const resolvedRelations = fileRelations.map((rel) => {
        // Fix source: RelationExtractor returns bare class name; scope it to the current file
        const scopedSource = `${relPath}.${rel.source}`;

        // Fix target: if imported, map to scoped ID; otherwise keep bare for diagnostics
        let resolvedTarget = rel.target;
        if (importedNameToScopedId.has(rel.target)) {
          resolvedTarget = importedNameToScopedId.get(rel.target)!;
        }

        return {
          ...rel,
          id: `${scopedSource}_${rel.type}_${resolvedTarget}`,
          source: scopedSource,
          target: resolvedTarget,
        };
      });

      relations.push(...resolvedRelations);
    }

    // Build merged result
    const merged: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations,
    };

    // Filter out external/primitive type relations that could not be resolved to project entities.
    // Note: cross-file relation resolution and external filtering apply here only.
    // The parseCode() path (ParallelParser) uses in-memory per-file projects without
    // TypeChecker and cannot resolve cross-file types.
    const filtered = this.filterExternalRelations(merged);

    // Deduplicate relations
    const uniqueRelations = this.deduplicateRelations(filtered.relations);

    return {
      ...filtered,
      relations: uniqueRelations,
    };
  }

  /**
   * Filter out relations whose targets are external types (primitives, built-ins, or
   * types that could not be resolved to any known project entity ID).
   * Keeps unknown non-primitive targets for diagnostics.
   * Only applicable in parseProject() where the full entity set is available.
   *
   * @param merged - ArchJSON with all entities and relations
   * @returns ArchJSON with external primitive relations removed
   */
  private filterExternalRelations(merged: ArchJSON): ArchJSON {
    const entityIds = new Set(merged.entities.map((e) => e.id));
    const EXTERNAL_PATTERNS = [
      /^(string|number|boolean|void|null|undefined|any|unknown|never|object|symbol|bigint)$/,
      /^(NodeJS\.|Buffer$|Error$|Promise$|Map$|Set$|Array$|Record$|WeakMap|WeakSet)/,
      /^\{/,
      /^\[/,
      /^\d+$/,
    ];

    const filteredRelations = merged.relations.filter((rel) => {
      // Keep relations whose target is a known project entity
      if (entityIds.has(rel.target)) return true;
      // Remove relations whose target matches an external/primitive pattern
      if (EXTERNAL_PATTERNS.some((p) => p.test(rel.target))) return false;
      // Keep unknown non-primitive targets for diagnostics
      return true;
    });

    return { ...merged, relations: filteredRelations };
  }

  /**
   * Remove duplicate relations
   * @param relations - Array of relations
   * @returns Deduplicated array of relations
   */
  private deduplicateRelations(relations: Relation[]): Relation[] {
    const seen = new Set<string>();
    const unique: Relation[] = [];

    for (const relation of relations) {
      const key = `${relation.type}:${relation.source}:${relation.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(relation);
      }
    }

    return unique;
  }

  /**
   * Serialize ArchJSON to JSON string
   * @param archJson - ArchJSON object
   * @param pretty - Whether to format JSON (default: false)
   * @returns JSON string
   */
  toJSON(archJson: ArchJSON, pretty: boolean = false): string {
    return JSON.stringify(archJson, null, pretty ? 2 : undefined);
  }
}

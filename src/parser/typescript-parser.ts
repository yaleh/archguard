/**
 * TypeScriptParser - Main parser orchestrating all extractors
 * Story 6: Complete Arch-JSON Generation
 */

import { Project } from 'ts-morph';
import { ClassExtractor } from './class-extractor';
import { InterfaceExtractor } from './interface-extractor';
import { EnumExtractor } from './enum-extractor';
import { RelationExtractor } from './relation-extractor';
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

  constructor() {
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
  }

  /**
   * Parse TypeScript code and generate ArchJSON
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

    // Extract classes
    for (const classDecl of sourceFile.getClasses()) {
      const entity = this.classExtractor['extractClass'](classDecl, filePath);
      entities.push(entity);
    }

    // Extract interfaces
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      const entity = this.interfaceExtractor.extractInterface(interfaceDecl, filePath);
      entities.push(entity);
    }

    // Extract enums
    for (const enumDecl of sourceFile.getEnums()) {
      const entity = this.enumExtractor.extractEnum(enumDecl, filePath);
      entities.push(entity);
    }

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
   * @param rootDir - Root directory path
   * @param pattern - Glob pattern for files (default: '** /*.ts')
   * @returns Complete ArchJSON structure
   */
  parseProject(rootDir: string, pattern: string = '**/*.ts'): ArchJSON {
    // Create a new project for filesystem parsing (not in-memory)
    const fsProject = new Project({
      compilerOptions: {
        target: 99, // ESNext
      },
    });

    // Add source files (exclude test files and node_modules)
    fsProject.addSourceFilesAtPaths([
      `${rootDir}/${pattern}`,
      `!${rootDir}/**/*.test.ts`,
      `!${rootDir}/**/*.spec.ts`,
      `!${rootDir}/**/node_modules/**`,
    ]);

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const sourceFiles: string[] = [];

    // Process all source files
    for (const sourceFile of fsProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      sourceFiles.push(filePath);

      // Extract classes
      for (const classDecl of sourceFile.getClasses()) {
        const entity = this.classExtractor['extractClass'](classDecl, filePath);
        entities.push(entity);
      }

      // Extract interfaces
      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const entity = this.interfaceExtractor.extractInterface(interfaceDecl, filePath);
        entities.push(entity);
      }

      // Extract enums
      for (const enumDecl of sourceFile.getEnums()) {
        const entity = this.enumExtractor.extractEnum(enumDecl, filePath);
        entities.push(entity);
      }

      // Extract relations
      const fileRelations = this.relationExtractor.extractFromSourceFile(sourceFile);
      relations.push(...fileRelations);
    }

    // Deduplicate relations
    const uniqueRelations = this.deduplicateRelations(relations);

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations: uniqueRelations,
    };
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

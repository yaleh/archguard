/**
 * EnumExtractor - Extracts enum information from TypeScript source code
 * Story 3: Interface & Enum Support
 */

import { Project, type EnumDeclaration } from 'ts-morph';
import type { Entity, Member } from '@/types';
import { ParseError } from './errors.js';

/**
 * Extracts enum entities from TypeScript code using ts-morph
 */
export class EnumExtractor {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
  }

  /**
   * Extract enum entity from TypeScript code
   * @param code - TypeScript source code string
   * @param filePath - Source file path (default: 'test.ts')
   * @returns Entity representing the enum
   * @throws Error if no enum found in the code
   */
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const enumDecl = sourceFile.getEnums()[0];

    if (!enumDecl) {
      throw new ParseError('No enum found in code', filePath);
    }

    return this.extractEnum(enumDecl, filePath);
  }

  /**
   * Extract entity information from an EnumDeclaration node
   * @param enumDecl - ts-morph EnumDeclaration node
   * @param filePath - Source file path
   * @returns Entity object
   */
  extractEnum(enumDecl: EnumDeclaration, filePath: string): Entity {
    const name = enumDecl.getName();

    return {
      id: `${filePath}.${name}`,
      name,
      type: 'enum',
      visibility: 'public',
      members: this.extractMembers(enumDecl),
      decorators: [],
      isConst: enumDecl.isConstEnum(),
      sourceLocation: {
        file: filePath,
        startLine: enumDecl.getStartLineNumber(),
        endLine: enumDecl.getEndLineNumber(),
      },
    };
  }

  /**
   * Extract all enum members
   * @param enumDecl - EnumDeclaration node
   * @returns Array of Member objects
   */
  private extractMembers(enumDecl: EnumDeclaration): Member[] {
    const members: Member[] = [];

    for (const member of enumDecl.getMembers()) {
      const initializer = member.getInitializer();

      members.push({
        name: member.getName(),
        type: 'property',
        visibility: 'public',
        defaultValue: initializer?.getText(),
      });
    }

    return members;
  }
}

/**
 * FunctionExtractor - Extracts exported standalone function entities from TypeScript source files
 * Phase B-P3: Standalone Function Entity Extraction
 */

import {
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph';
import type { Entity, Member } from '@/types/index.js';

/**
 * Extracts exported standalone function entities from a TypeScript SourceFile.
 * Handles:
 *  - Named exported function declarations: export function foo(...)
 *  - Exported arrow-function consts: export const bar = (...) => ...
 *  - Exported function-expression consts: export const baz = function(...) { ... }
 */
export class FunctionExtractor {
  /**
   * Extract all exported standalone function entities from a SourceFile.
   * @param sourceFile - ts-morph SourceFile
   * @param relativeFilePath - workspace-relative file path used for entity IDs and sourceLocation
   * @returns Array of Entity objects with type 'function'
   */
  extract(sourceFile: SourceFile, relativeFilePath: string): Entity[] {
    const entities: Entity[] = [];

    // 1. Named exported function declarations: export function foo(...)
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      const name = fn.getName();
      if (!name) continue;
      entities.push({
        id: `${relativeFilePath}.${name}`,
        name,
        type: 'function',
        visibility: 'public',
        members: this.extractParamsAsMembers(fn),
        sourceLocation: {
          file: relativeFilePath,
          startLine: fn.getStartLineNumber(),
          endLine: fn.getEndLineNumber(),
        },
      });
    }

    // 2. Arrow / function-expression const exports:
    //    export const bar = (...) => ...
    //    export const baz = function(...) { ... }
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          const name = decl.getName();
          entities.push({
            id: `${relativeFilePath}.${name}`,
            name,
            type: 'function',
            visibility: 'public',
            members: this.extractParamsAsMembers(init),
            sourceLocation: {
              file: relativeFilePath,
              startLine: decl.getStartLineNumber(),
              endLine: decl.getEndLineNumber(),
            },
          });
        }
      }
    }

    return entities;
  }

  /**
   * Extract parameters from a function/arrow/expression node as Member objects.
   * Parameters are represented as members with type 'field' so they satisfy the
   * Member interface (which requires a MemberType).
   */
  private extractParamsAsMembers(
    fn: FunctionDeclaration | ArrowFunction | FunctionExpression
  ): Member[] {
    return fn.getParameters().map((p) => ({
      name: p.getName(),
      type: 'field' as const,
      visibility: 'public' as const,
      fieldType: p.getType().getText(),
    }));
  }
}

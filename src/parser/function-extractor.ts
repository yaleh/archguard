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
 * Higher-order component wrappers whose first argument is the actual component
 * function. `export const X = memo(() => ...)` is a function declaration in
 * everything but syntax: the entity belongs to the wrapped function.
 */
const HOC_WRAPPER_NAMES = new Set(['memo', 'forwardRef']);

/**
 * Extracts exported standalone function entities from a TypeScript SourceFile.
 * Handles:
 *  - Named exported function declarations: export function foo(...)
 *  - Exported arrow-function consts: export const bar = (...) => ...
 *  - Exported function-expression consts: export const baz = function(...) { ... }
 *  - HOC-wrapped arrow/function-expression consts:
 *      export const Qux = memo((...) => ...)
 *      export const Quux = forwardRef<HTMLDivElement, P>(function Quux() { ... })
 *      export const Corge = React.memo(() => ...)
 *      (nested wrappers such as memo(forwardRef(...)) are unwrapped recursively)
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
    //    plus HOC-wrapped variants (memo / forwardRef / React.memo / React.forwardRef)
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        const fn = this.unwrapFunctionInitializer(init);
        if (!fn) continue;
        const name = decl.getName();
        entities.push({
          id: `${relativeFilePath}.${name}`,
          name,
          type: 'function',
          visibility: 'public',
          members: this.extractParamsAsMembers(fn),
          sourceLocation: {
            file: relativeFilePath,
            startLine: decl.getStartLineNumber(),
            endLine: decl.getEndLineNumber(),
          },
        });
      }
    }

    return entities;
  }

  /**
   * Resolve a variable initializer to the function it declares, looking through
   * HOC wrapper calls.
   *
   * Returns the initializer itself when it is an arrow / function expression, or
   * the first argument of `memo(...)` / `forwardRef(...)` (also `React.`-qualified),
   * unwrapping nested wrappers. Returns undefined for anything else.
   */
  private unwrapFunctionInitializer(init: Node): ArrowFunction | FunctionExpression | undefined {
    let current: Node = init;
    // Parentheses may survive as explicit nodes in some ts-morph versions.
    while (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      return current;
    }

    const seen = new Set<Node>();
    while (Node.isCallExpression(current) && !seen.has(current)) {
      seen.add(current);
      if (!this.isHocWrapperCall(current)) return undefined;
      const [firstArg] = current.getArguments();
      if (!firstArg) return undefined;
      current = firstArg;
      while (Node.isParenthesizedExpression(current)) {
        current = current.getExpression();
      }
      if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
        return current;
      }
    }

    return undefined;
  }

  /**
   * True when the callee is `memo(...)`, `forwardRef(...)`, `React.memo(...)`
   * or `React.forwardRef(...)`.
   */
  private isHocWrapperCall(call: Node): boolean {
    if (!Node.isCallExpression(call)) return false;
    const callee = call.getExpression();
    if (Node.isIdentifier(callee)) {
      return HOC_WRAPPER_NAMES.has(callee.getText());
    }
    if (Node.isPropertyAccessExpression(callee)) {
      return (
        callee.getExpression().getText() === 'React' && HOC_WRAPPER_NAMES.has(callee.getName())
      );
    }
    return false;
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

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
 *  - Declarations that are exported by reference rather than by modifier:
 *      const Grault = memo(...); export default Grault;
 *      const Garply = (...) => ...; export default memo(Garply);
 *      function Waldo(...) {}; export default React.memo(Waldo);
 *      const Fred = memo(...); export { Fred };
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
    const referencedExports = this.collectReferencedExportNames(sourceFile);

    // 1. Named exported function declarations: export function foo(...)
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      if (!fn.isExported() && !referencedExports.has(name)) continue;
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
    //    and declarations referenced by `export default` / `export { ... }`.
    for (const stmt of sourceFile.getVariableStatements()) {
      const statementIsExported = stmt.isExported();
      for (const decl of stmt.getDeclarations()) {
        const name = decl.getName();
        if (!statementIsExported && !referencedExports.has(name)) continue;
        const init = decl.getInitializer();
        if (!init) continue;
        const fn = this.unwrapFunctionInitializer(init);
        if (!fn) continue;
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
   * Collect names of top-level declarations that are exported by reference:
   *  - `export default <Identifier>`
   *  - `export default memo/forwardRef/React.memo/React.forwardRef(<Identifier>)`
   *  - `export { A, B as C }` (local exports only; re-exports from another module
   *    reference declarations that live elsewhere and are ignored)
   */
  private collectReferencedExportNames(sourceFile: SourceFile): Set<string> {
    const names = new Set<string>();

    for (const assignment of sourceFile.getExportAssignments()) {
      if (assignment.isExportEquals()) continue;
      const expression = assignment.getExpression();
      for (const name of this.collectHocTargetIdentifiers(expression)) {
        names.add(name);
      }
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      if (declaration.getModuleSpecifier()) continue;
      for (const specifier of declaration.getNamedExports()) {
        names.add(specifier.getName());
      }
    }

    return names;
  }

  /**
   * Resolve an expression used in an export position to the identifiers whose
   * declarations it exports. Unwraps HOC wrapper calls the same way
   * `unwrapFunctionInitializer` does, so `export default memo(Foo)` exports `Foo`.
   */
  private collectHocTargetIdentifiers(expression: Node): string[] {
    let current: Node = expression;
    while (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
    }
    if (Node.isIdentifier(current)) {
      return [current.getText()];
    }

    const names: string[] = [];
    const seen = new Set<Node>();
    while (Node.isCallExpression(current) && !seen.has(current)) {
      seen.add(current);
      if (!this.isHocWrapperCall(current)) break;
      const [firstArg] = current.getArguments();
      if (!firstArg) break;
      current = firstArg;
      while (Node.isParenthesizedExpression(current)) {
        current = current.getExpression();
      }
      if (Node.isIdentifier(current)) {
        names.push(current.getText());
        break;
      }
    }

    return names;
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

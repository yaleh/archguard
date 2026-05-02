/**
 * FunctionBuilder — extracts top-level Kotlin functions from a parsed AST.
 *
 * Responsibility: only direct `function_declaration` children of the
 * `source_file` root node.  Class/interface method extraction is handled
 * by ClassBuilder.
 *
 * AST shape (verified in AST_NODES.md):
 *
 *   [function_declaration]
 *     [modifiers]?
 *       [annotation]*          ← @Composable, @Preview, …
 *         [@]
 *         [user_type]
 *           [type_identifier]  ← annotation name
 *       [visibility_modifier]? ← private / protected / internal / public
 *     [fun]
 *     [simple_identifier]      ← function name
 *     [function_value_parameters]
 *       [(]
 *       [function_value_parameter]*
 *         [parameter]
 *           [simple_identifier] ← param name
 *           [:]
 *           <type node>         ← user_type / nullable_type / …
 *       [)]
 *     [:]?
 *     <type node>?              ← return type (user_type / nullable_type)
 *     [function_body]?
 */

import type { RawKotlinFunction, KotlinVisibility } from '../types.js';

export class FunctionBuilder {
  /**
   * Extract all top-level `function_declaration` nodes that are direct
   * children of `rootNode` (source_file).  Class-level methods are skipped
   * because they reside inside a `class_body` subtree.
   */
  extractTopLevelFunctions(
    rootNode: any,
    packageName: string,
    filePath: string
  ): RawKotlinFunction[] {
    const results: RawKotlinFunction[] = [];

    for (const child of rootNode.namedChildren as any[]) {
      if (child.type !== 'function_declaration') continue;

      const name = this.extractName(child);
      if (!name) continue;

      const annotations = this.extractAnnotations(child);
      const visibility = this.extractVisibility(child);
      const paramTypes = this.extractParamTypes(child);
      const returnType = this.extractReturnType(child);
      const isComposable = annotations.includes('Composable');

      results.push({
        name,
        visibility,
        packageName,
        isComposable,
        returnType,
        paramTypes,
        decorators: annotations,
        filePath,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Extract function name from `identifier` direct child of the declaration. */
  private extractName(node: any): string | undefined {
    for (const child of node.namedChildren as any[]) {
      if (child.type === 'identifier' || child.type === 'simple_identifier') {
        return child.text as string;
      }
    }
    return undefined;
  }

  /**
   * Collect annotation names from `modifiers` → `annotation` nodes.
   *
   * Two annotation shapes (from AST_NODES.md):
   *   - Simple:  annotation → [@] [user_type [type_identifier "Composable"]]
   *   - With args: annotation → [@] [constructor_invocation [user_type …]]
   *
   * We normalise both by drilling into the first `user_type` we find and
   * returning its first `type_identifier` (or `simple_identifier`) text.
   */
  private extractAnnotations(fnNode: any): string[] {
    const names: string[] = [];

    const modifiers = this.findDirectChild(fnNode, 'modifiers');
    if (!modifiers) return names;

    for (const child of modifiers.namedChildren as any[]) {
      if (child.type !== 'annotation') continue;

      const name = this.resolveAnnotationName(child);
      if (name) names.push(name);
    }

    return names;
  }

  /**
   * Resolve annotation name from an `annotation` node.
   * Drills through optional `constructor_invocation` → `user_type`.
   */
  private resolveAnnotationName(annotationNode: any): string | undefined {
    for (const child of annotationNode.namedChildren as any[]) {
      if (child.type === 'user_type') {
        return this.extractUserTypeName(child);
      }
      if (child.type === 'constructor_invocation') {
        const ut = this.findDirectChild(child, 'user_type');
        if (ut) return this.extractUserTypeName(ut);
      }
    }
    return undefined;
  }

  /**
   * Get the plain identifier text from a `user_type` node.
   * Handles both `type_identifier` and `simple_identifier` children
   * (tree-sitter-kotlin uses `type_identifier` for type positions).
   */
  private extractUserTypeName(userTypeNode: any): string | undefined {
    // Actual AST: user_type > identifier (not type_identifier or simple_identifier)
    for (const child of userTypeNode.namedChildren as any[]) {
      if (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'simple_identifier') {
        return child.text as string;
      }
    }
    // Fallback: use the full text of the user_type node
    const raw: string = userTypeNode.text ?? '';
    const firstIdent = raw.split(/[<\s.?]/)[0];
    return firstIdent || undefined;
  }

  /**
   * Extract visibility from `modifiers` → `visibility_modifier` text.
   * Defaults to 'public' if no modifier is present.
   */
  private extractVisibility(fnNode: any): KotlinVisibility {
    const modifiers = this.findDirectChild(fnNode, 'modifiers');
    if (!modifiers) return 'public';

    for (const child of modifiers.namedChildren as any[]) {
      if (child.type === 'visibility_modifier') {
        const text = (child.text as string).trim().toLowerCase();
        if (text === 'private' || text === 'protected' || text === 'internal') {
          return text as KotlinVisibility;
        }
        return 'public';
      }
    }

    return 'public';
  }

  /**
   * Extract ordered list of parameter types from `function_value_parameters`.
   *
   * AST path per parameter:
   *   function_value_parameters → function_value_parameter → parameter
   *     → [simple_identifier (name)] [:] [<type node>]
   *
   * For the type we take the last named child of `parameter` that is a
   * type-bearing node (user_type, nullable_type, function_type, …).
   */
  private extractParamTypes(fnNode: any): string[] {
    const types: string[] = [];

    const paramsNode = this.findDirectChild(fnNode, 'function_value_parameters');
    if (!paramsNode) return types;

    // Actual AST: function_value_parameters → parameter (direct, no function_value_parameter wrapper)
    for (const param of paramsNode.namedChildren as any[]) {
      if (param.type !== 'parameter') continue;
      const typeName = this.extractParamTypeName(param);
      if (typeName) types.push(typeName);
    }

    return types;
  }

  /**
   * Given a `parameter` node, find its type child and return the base type name.
   *
   * In a `parameter` node the children are roughly:
   *   [simple_identifier (name)] [:] [type_node]
   *
   * We iterate namedChildren and pick the first that looks like a type node
   * (anything that is NOT the param name `simple_identifier`).
   */
  private extractParamTypeName(paramNode: any): string | undefined {
    // namedChildren: [simple_identifier "name", <type_node>]
    const named: any[] = paramNode.namedChildren;
    if (named.length < 2) return undefined;

    // The type is the second named child (after the identifier)
    const typeNode = named[1];
    return this.typeNodeToString(typeNode);
  }

  /**
   * Extract return type from `function_declaration`.
   *
   * The return type node immediately follows the `:` token after the
   * closing `)` of the parameter list.  In tree-sitter-kotlin it is a
   * direct named child of `function_declaration` with type `user_type`,
   * `nullable_type`, or `function_type`.
   *
   * We find it by scanning named children after `function_value_parameters`.
   */
  private extractReturnType(fnNode: any): string | undefined {
    const named: any[] = fnNode.namedChildren;
    let seenParams = false;

    for (const child of named) {
      if (child.type === 'function_value_parameters') {
        seenParams = true;
        continue;
      }

      if (!seenParams) continue;

      // Skip modifiers, name, body, and non-type nodes
      if (
        child.type === 'function_body' ||
        child.type === 'modifiers' ||
        child.type === 'simple_identifier' ||
        child.type === 'type_parameters'
      ) {
        continue;
      }

      // The first type-ish node after params is the return type
      if (
        child.type === 'user_type' ||
        child.type === 'nullable_type' ||
        child.type === 'function_type' ||
        child.type === 'parenthesized_type'
      ) {
        return this.typeNodeToString(child);
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Type node utilities
  // ---------------------------------------------------------------------------

  /**
   * Convert a type AST node to its plain string representation.
   * For user_type: returns the first `type_identifier` or `simple_identifier`.
   * For nullable_type: recurses into inner user_type and appends `?`.
   * Fallback: return the raw `.text` of the node (trimmed).
   */
  private typeNodeToString(typeNode: any): string | undefined {
    if (!typeNode) return undefined;

    switch (typeNode.type as string) {
      case 'user_type': {
        return this.extractUserTypeName(typeNode);
      }
      case 'nullable_type': {
        // nullable_type child is usually a user_type
        const inner = this.findDirectChild(typeNode, 'user_type');
        if (inner) {
          const name = this.extractUserTypeName(inner);
          return name ? `${name}?` : undefined;
        }
        // fallback
        const raw: string = typeNode.text ?? '';
        return raw.trim() || undefined;
      }
      case 'function_type': {
        // Return the raw text for lambda types
        const raw: string = typeNode.text ?? '';
        return raw.trim() || undefined;
      }
      default: {
        const raw: string = typeNode.text ?? '';
        return raw.trim() || undefined;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Generic AST helpers
  // ---------------------------------------------------------------------------

  /**
   * Return the first direct named child of `node` whose `.type` matches `type`.
   */
  private findDirectChild(node: any, type: string): any | undefined {
    for (const child of node.namedChildren as any[]) {
      if (child.type === type) return child;
    }
    return undefined;
  }
}

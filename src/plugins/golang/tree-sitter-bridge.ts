/**
 * Tree-sitter bridge for Go language parsing
 *
 * Thin facade that delegates to focused builder modules.
 * Mirrors the C++/Kotlin builder pattern.
 */

import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import type { GoRawPackage, GoImport, TreeSitterParseOptions } from './types.js';
import { NodeUtils } from './builders/node-utils.js';
import { StructBuilder } from './builders/struct-builder.js';
import { FunctionBuilder } from './builders/function-builder.js';

// Re-export for backward compatibility with callers that import from this module
export type { TreeSitterParseOptions };

export class TreeSitterBridge {
  private parser: Parser;
  private structBuilder: StructBuilder;
  private functionBuilder: FunctionBuilder;

  constructor() {
    this.parser = new Parser();
    // @ts-expect-error -- tree-sitter-go language definition type incompatibility
    this.parser.setLanguage(Go);
    this.structBuilder = new StructBuilder();
    this.functionBuilder = new FunctionBuilder();
  }

  /**
   * Parse a single Go source file with optional function body extraction
   *
   * UNIFIED API: Single method, single parser.parse() call.
   * Body extraction controlled by options.
   */
  parseCode(code: string, filePath: string, options?: TreeSitterParseOptions): GoRawPackage {
    const tree = this.parser.parse(code); // Only parsed ONCE
    const rootNode = tree.rootNode;

    // Extract package name
    const packageName = this.extractPackageName(rootNode, code);

    // Extract imports
    const imports = this.extractImports(rootNode, code, filePath);

    // Extract type declarations (structs + interfaces share AST walk via StructBuilder)
    const { structs, interfaces } = this.structBuilder.extract(
      filePath,
      rootNode,
      code,
      packageName
    );

    // Extract methods and attach to structs; collect orphaned methods
    const { orphanedMethods } = this.functionBuilder.extractMethods(
      filePath,
      rootNode,
      code,
      structs,
      options
    );

    // Extract functions (with optional bodies)
    const functions = this.functionBuilder.extractFunctions(
      filePath,
      rootNode,
      code,
      packageName,
      options
    );

    return {
      id: packageName,
      name: packageName,
      fullName: '', // Filled by caller (needs moduleRoot context)
      dirPath: '',
      imports,
      structs,
      interfaces,
      functions,
      sourceFiles: [filePath],
      ...(orphanedMethods.length > 0 ? { orphanedMethods } : {}),
    };
  }

  private extractPackageName(rootNode: Parser.SyntaxNode, code: string): string {
    const packageClause = rootNode.namedChildren.find((c) => c.type === 'package_clause');
    if (!packageClause) return 'main';

    const nameNode = packageClause.namedChild(0);
    if (!nameNode) return 'main';

    return NodeUtils.nodeText(nameNode, code);
  }

  private extractImports(rootNode: Parser.SyntaxNode, code: string, filePath: string): GoImport[] {
    const imports: GoImport[] = [];
    const importDecls = rootNode.descendantsOfType('import_declaration');

    for (const importDecl of importDecls) {
      const importSpecs = importDecl.descendantsOfType('import_spec');

      for (const importSpec of importSpecs) {
        const pathNode = importSpec.childForFieldName('path');
        if (!pathNode) continue;

        let path = NodeUtils.nodeText(pathNode, code);
        path = path.replace(/^["']|["']$/g, '');

        const nameNode = importSpec.childForFieldName('name');
        const alias = nameNode ? NodeUtils.nodeText(nameNode, code) : undefined;

        imports.push({
          path,
          alias,
          location: NodeUtils.nodeToLocation(importSpec, filePath),
        });
      }
    }

    return imports;
  }
}

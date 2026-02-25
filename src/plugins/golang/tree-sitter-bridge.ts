/**
 * Tree-sitter bridge for Go language parsing
 *
 * Uses tree-sitter-go to parse Go source code into raw AST data
 */

import Parser from 'tree-sitter';
// @ts-ignore - tree-sitter-go doesn't have proper type definitions
import Go from 'tree-sitter-go';
import type {
  GoRawPackage,
  GoRawStruct,
  GoRawInterface,
  GoFunction,
  GoFunctionBody,
  GoCallExpr,
  GoSpawnStmt,
  GoChannelOp,
  GoMethod,
  GoField,
  GoImport,
  GoSourceLocation,
} from './types.js';

/**
 * Parse options for TreeSitterBridge
 *
 * DESIGN: Single entry point, options control behavior.
 * Avoids double-parsing (no separate parseCode vs parseCodeWithBodies).
 */
export interface TreeSitterParseOptions {
  /** Whether to extract function body behavior data (default false) */
  extractBodies?: boolean;
  /** Whether to use selective extraction (only functions with target AST nodes) */
  selectiveExtraction?: boolean;
}

export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    // @ts-ignore - tree-sitter-go language definition compatibility
    this.parser.setLanguage(Go);
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

    // Extract type declarations
    const structs: GoRawStruct[] = [];
    const interfaces: GoRawInterface[] = [];

    const typeDecls = rootNode.descendantsOfType('type_declaration');
    for (const typeDecl of typeDecls) {
      // type_spec is a named child, not a field
      const typeSpec = typeDecl.namedChildren.find((child) => child.type === 'type_spec');
      if (!typeSpec) continue;

      const nameNode = typeSpec.childForFieldName('name');
      if (!nameNode) continue;

      const typeName = code.substring(nameNode.startIndex, nameNode.endIndex);
      const typeNode = typeSpec.childForFieldName('type');

      if (typeNode?.type === 'struct_type') {
        structs.push(this.extractStruct(typeName, typeNode, packageName, code, filePath));
      } else if (typeNode?.type === 'interface_type') {
        interfaces.push(this.extractInterface(typeName, typeNode, packageName, code, filePath));
      }
    }

    // Extract methods for structs
    const methodDecls = rootNode.descendantsOfType('method_declaration');
    for (const methodDecl of methodDecls) {
      const method = this.extractMethod(methodDecl, code, filePath, options);
      if (method && method.receiverType) {
        // Find the struct this method belongs to
        const struct = structs.find((s) => s.name === method.receiverType);
        if (struct) {
          struct.methods.push(method);
        }
      }
    }

    // Extract functions (with optional bodies)
    const functions = options?.extractBodies
      ? this.extractFunctionsWithBodies(rootNode, code, filePath, packageName, options)
      : this.extractFunctions(rootNode, code, filePath, packageName);

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
    };
  }

  /**
   * Extract standalone functions (without bodies)
   */
  private extractFunctions(
    rootNode: Parser.SyntaxNode,
    code: string,
    filePath: string,
    packageName: string
  ): GoFunction[] {
    const functions: GoFunction[] = [];
    const funcDecls = rootNode.descendantsOfType('function_declaration');

    for (const funcDecl of funcDecls) {
      functions.push(this.extractFunctionSignature(funcDecl, code, filePath, packageName));
    }

    return functions;
  }

  /**
   * Extract functions with optional body data
   */
  private extractFunctionsWithBodies(
    rootNode: Parser.SyntaxNode,
    code: string,
    filePath: string,
    packageName: string,
    options: TreeSitterParseOptions
  ): GoFunction[] {
    const funcDecls = rootNode.descendantsOfType('function_declaration');
    const functions: GoFunction[] = [];

    for (const funcDecl of funcDecls) {
      const func = this.extractFunctionSignature(funcDecl, code, filePath, packageName);

      // Decide whether to extract body
      const blockNode = funcDecl.childForFieldName('body');
      if (blockNode) {
        if (options.selectiveExtraction) {
          // AST-based pre-scanning (NOT string matching)
          if (this.shouldExtractBody(blockNode)) {
            func.body = this.extractFunctionBody(blockNode, code, filePath);
          }
        } else {
          // Full extraction
          func.body = this.extractFunctionBody(blockNode, code, filePath);
        }
      }

      functions.push(func);
    }

    return functions;
  }

  /**
   * Extract a function's signature (name, params, return types)
   */
  private extractFunctionSignature(
    funcDecl: Parser.SyntaxNode,
    code: string,
    filePath: string,
    packageName: string
  ): GoFunction {
    const nameNode = funcDecl.childForFieldName('name');
    const funcName = nameNode ? code.substring(nameNode.startIndex, nameNode.endIndex) : '';

    const parameters = this.extractParameters(funcDecl, code, filePath);
    const returnTypes = this.extractReturnTypes(funcDecl, code);

    return {
      name: funcName,
      packageName,
      parameters,
      returnTypes,
      exported: this.isExported(funcName),
      location: this.nodeToLocation(funcDecl, filePath),
    };
  }

  /**
   * Selective extraction: AST node type pre-scanning
   *
   * Uses descendantsOfType() instead of string matching.
   * This avoids false positives from comments, variable names, etc.
   *
   * Triggers on:
   * - Goroutine/channel patterns (go_statement, send_statement, receive_expression)
   * - HTTP handler registration calls (HandleFunc, Handle, GET, POST, ...)
   */
  private shouldExtractBody(blockNode: Parser.SyntaxNode): boolean {
    const targetNodeTypes = [
      'go_statement', // go func() / go namedFunc()
      'send_statement', // ch <- value
      'receive_expression', // <-ch
    ];

    if (targetNodeTypes.some((nodeType) => blockNode.descendantsOfType(nodeType).length > 0)) {
      return true;
    }

    // HTTP handler registration patterns (net/http and gin/echo/chi-style routers)
    const httpHandlerNames = new Set([
      'HandleFunc',
      'Handle', // net/http ServeMux
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH', // gin / echo / chi
    ]);

    for (const callExpr of blockNode.descendantsOfType('call_expression')) {
      const funcNode = callExpr.childForFieldName('function');
      if (!funcNode) continue;

      let fnName = '';
      if (funcNode.type === 'identifier') {
        fnName = funcNode.text;
      } else if (funcNode.type === 'selector_expression') {
        const field = funcNode.childForFieldName('field');
        if (field) fnName = field.text;
      }

      if (httpHandlerNames.has(fnName)) return true;
    }

    return false;
  }

  /**
   * Extract function body behavior data
   */
  private extractFunctionBody(
    blockNode: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoFunctionBody {
    return {
      calls: this.extractCallExprs(blockNode, code, filePath),
      goSpawns: this.extractGoSpawns(blockNode, code, filePath),
      channelOps: this.extractChannelOps(blockNode, code, filePath),
    };
  }

  /**
   * Extract goroutine spawn statements
   */
  private extractGoSpawns(block: Parser.SyntaxNode, code: string, filePath: string): GoSpawnStmt[] {
    const spawns: GoSpawnStmt[] = [];
    const goStmts = block.descendantsOfType('go_statement');

    for (const goStmt of goStmts) {
      const children = goStmt.namedChildren;
      if (children.length === 0) continue;

      const expr = children[0]; // The spawned expression

      if (expr.type === 'call_expression') {
        const call = this.extractCallExpr(expr, code, filePath);
        spawns.push({ call, location: this.nodeToLocation(goStmt, filePath) });
      } else if (expr.type === 'func_literal') {
        // go func() { ... }()
        spawns.push({
          call: { functionName: '<anonymous>', location: this.nodeToLocation(expr, filePath) },
          location: this.nodeToLocation(goStmt, filePath),
        });
      }
    }

    return spawns;
  }

  /**
   * Extract call expressions from a block
   */
  private extractCallExprs(block: Parser.SyntaxNode, code: string, filePath: string): GoCallExpr[] {
    const calls: GoCallExpr[] = [];
    const callExprs = block.descendantsOfType('call_expression');

    for (const callExpr of callExprs) {
      calls.push(this.extractCallExpr(callExpr, code, filePath));
    }

    return calls;
  }

  private extractCallExpr(callExpr: Parser.SyntaxNode, code: string, filePath: string): GoCallExpr {
    const funcNode = callExpr.childForFieldName('function');
    let functionName = '';
    let packageName: string | undefined;
    let receiverType: string | undefined;

    if (funcNode) {
      if (funcNode.type === 'identifier') {
        functionName = code.substring(funcNode.startIndex, funcNode.endIndex);
      } else if (funcNode.type === 'selector_expression') {
        const operand = funcNode.childForFieldName('operand');
        const field = funcNode.childForFieldName('field');
        if (operand && field) {
          packageName = code.substring(operand.startIndex, operand.endIndex);
          functionName = code.substring(field.startIndex, field.endIndex);
        }
      }
    }

    // Extract argument list
    const argsNode = callExpr.childForFieldName('arguments');
    const args: string[] = [];
    if (argsNode) {
      for (const child of argsNode.namedChildren) {
        const text = code.substring(child.startIndex, child.endIndex);
        if (child.type === 'interpreted_string_literal' || child.type === 'raw_string_literal') {
          // Strip surrounding quotes/backticks
          args.push(text.slice(1, -1));
        } else {
          // selector_expression, identifier, etc. — keep raw text
          args.push(text);
        }
      }
    }

    return {
      functionName,
      packageName,
      receiverType,
      args,
      location: this.nodeToLocation(callExpr, filePath),
    };
  }

  /**
   * Extract channel operations
   */
  private extractChannelOps(
    block: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoChannelOp[] {
    const ops: GoChannelOp[] = [];

    // send_statement: ch <- value
    for (const sendStmt of block.descendantsOfType('send_statement')) {
      const channel = sendStmt.childForFieldName('channel');
      ops.push({
        channelName: channel ? code.substring(channel.startIndex, channel.endIndex) : '',
        operation: 'send',
        location: this.nodeToLocation(sendStmt, filePath),
      });
    }

    // receive_expression: <-ch
    for (const recvExpr of block.descendantsOfType('receive_expression')) {
      const operand = recvExpr.namedChildren[0];
      ops.push({
        channelName: operand ? code.substring(operand.startIndex, operand.endIndex) : '',
        operation: 'receive',
        location: this.nodeToLocation(recvExpr, filePath),
      });
    }

    // make(chan T, size) — detect via call_expression
    for (const callExpr of block.descendantsOfType('call_expression')) {
      const funcNode = callExpr.childForFieldName('function');
      if (funcNode && code.substring(funcNode.startIndex, funcNode.endIndex) === 'make') {
        const args = callExpr.childForFieldName('arguments');
        if (args) {
          const firstArg = args.namedChildren[0];
          if (firstArg && firstArg.type === 'channel_type') {
            ops.push({
              channelName: this.extractMakeChanVarName(callExpr, code),
              operation: 'make',
              location: this.nodeToLocation(callExpr, filePath),
            });
          }
        }
      }
    }

    return ops;
  }

  /**
   * Extract the variable name assigned from a make(chan) call expression.
   * Walks up the AST to find the enclosing short_var_declaration or
   * assignment_statement, then returns the LHS identifier at the matching index.
   *
   * Handles:
   *   jobs := make(chan Job, 100)          → "jobs"
   *   x, done := make(chan T), make(chan T) → "x" / "done" (by RHS position)
   *   jobs = make(chan Job)                → "jobs"
   *   s.jobs = make(chan Job)              → "jobs" (selector field name)
   */
  private extractMakeChanVarName(callExpr: Parser.SyntaxNode, code: string): string {
    let node: Parser.SyntaxNode | null = callExpr.parent;

    while (node) {
      if (node.type === 'short_var_declaration' || node.type === 'assignment_statement') {
        const lhsList = node.namedChildren[0]; // expression_list (LHS)
        const rhsList = node.namedChildren[1]; // expression_list (RHS)

        if (lhsList && rhsList) {
          // Find position of callExpr among RHS siblings
          const rhsIdx = rhsList.namedChildren.findIndex(
            (ch) => ch.startIndex <= callExpr.startIndex && ch.endIndex >= callExpr.endIndex
          );
          const lhsVar = lhsList.namedChildren[rhsIdx >= 0 ? rhsIdx : 0];
          if (lhsVar) {
            if (lhsVar.type === 'identifier') {
              return code.substring(lhsVar.startIndex, lhsVar.endIndex);
            }
            // selector_expression: e.g. s.jobs → extract field name
            if (lhsVar.type === 'selector_expression') {
              const field = lhsVar.namedChildren[lhsVar.namedChildCount - 1];
              if (field) return code.substring(field.startIndex, field.endIndex);
            }
          }
        }
        break;
      }

      // Don't walk past statement/block boundaries
      if (['block', 'function_declaration', 'method_declaration', 'func_literal'].includes(node.type)) {
        break;
      }
      node = node.parent;
    }
    return '';
  }

  /**
   * Extract package name from AST
   */
  private extractPackageName(rootNode: Parser.SyntaxNode, code: string): string {
    const packageClause = rootNode.childForFieldName('package');
    if (!packageClause) {
      return 'main';
    }

    const nameNode = packageClause.childForFieldName('name');
    if (!nameNode) {
      return 'main';
    }

    return code.substring(nameNode.startIndex, nameNode.endIndex);
  }

  /**
   * Extract imports from AST
   */
  private extractImports(rootNode: Parser.SyntaxNode, code: string, filePath: string): GoImport[] {
    const imports: GoImport[] = [];
    const importDecls = rootNode.descendantsOfType('import_declaration');

    for (const importDecl of importDecls) {
      const importSpecs = importDecl.descendantsOfType('import_spec');

      for (const importSpec of importSpecs) {
        const pathNode = importSpec.childForFieldName('path');
        if (!pathNode) continue;

        // Remove quotes from path
        let path = code.substring(pathNode.startIndex, pathNode.endIndex);
        path = path.replace(/^["']|["']$/g, '');

        const nameNode = importSpec.childForFieldName('name');
        const alias = nameNode ? code.substring(nameNode.startIndex, nameNode.endIndex) : undefined;

        imports.push({
          path,
          alias,
          location: this.nodeToLocation(importSpec, filePath),
        });
      }
    }

    return imports;
  }

  /**
   * Extract struct definition
   */
  private extractStruct(
    name: string,
    structNode: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): GoRawStruct {
    const fields: GoField[] = [];
    const embeddedTypes: string[] = [];

    // Find field_declaration_list (it's a named child, not a field)
    const fieldDeclList = structNode.namedChildren.find(
      (child) => child.type === 'field_declaration_list'
    );
    if (!fieldDeclList) {
      return {
        name,
        packageName,
        fields: [],
        methods: [],
        embeddedTypes: [],
        exported: this.isExported(name),
        location: this.nodeToLocation(structNode, filePath),
      };
    }

    // Get all field_declaration children
    const fieldDecls = fieldDeclList.children.filter((child) => child.type === 'field_declaration');

    for (const fieldDecl of fieldDecls) {
      // Get all named children (should be field name identifiers and type)
      const namedChildren = fieldDecl.namedChildren;

      if (namedChildren.length === 0) continue;

      // Last named child is usually the type
      const typeNode = namedChildren[namedChildren.length - 1];
      const typeText = code.substring(typeNode.startIndex, typeNode.endIndex);

      // Check if there are name identifiers before the type
      const nameNodes = namedChildren
        .slice(0, -1)
        .filter((child) => child.type === 'field_identifier' || child.type === 'identifier');

      if (nameNodes.length === 0) {
        // Embedded field (no names, just type)
        embeddedTypes.push(typeText);
      } else {
        // Regular field(s)
        for (const nameNode of nameNodes) {
          const fieldName = code.substring(nameNode.startIndex, nameNode.endIndex);

          // Extract tag if present
          const tagNode = fieldDecl.children.find((child) => child.type === 'raw_string_literal');
          const tag = tagNode
            ? code.substring(tagNode.startIndex, tagNode.endIndex).replace(/`/g, '')
            : undefined;

          fields.push({
            name: fieldName,
            type: typeText,
            tag,
            exported: this.isExported(fieldName),
            location: this.nodeToLocation(fieldDecl, filePath),
          });
        }
      }
    }

    return {
      name,
      packageName,
      fields,
      methods: [],
      embeddedTypes,
      exported: this.isExported(name),
      location: this.nodeToLocation(structNode, filePath),
    };
  }

  /**
   * Extract interface definition
   */
  private extractInterface(
    name: string,
    interfaceNode: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): GoRawInterface {
    const methods: GoMethod[] = [];
    const embeddedInterfaces: string[] = [];

    // Get all method_elem children (interface methods)
    const methodElems = interfaceNode.namedChildren.filter((child) => child.type === 'method_elem');

    for (const methodElem of methodElems) {
      const nameNode = methodElem.childForFieldName('name');
      if (!nameNode) {
        // Might be embedded interface - check if it's a type
        const firstChild = methodElem.namedChild(0);
        if (firstChild && firstChild.type === 'type_identifier') {
          embeddedInterfaces.push(code.substring(firstChild.startIndex, firstChild.endIndex));
        }
        continue;
      }

      const methodName = code.substring(nameNode.startIndex, nameNode.endIndex);
      const parameters = this.extractParametersFromElem(methodElem, code, filePath);
      const returnTypes = this.extractReturnTypesFromElem(methodElem, code);

      methods.push({
        name: methodName,
        parameters,
        returnTypes,
        exported: this.isExported(methodName),
        location: this.nodeToLocation(methodElem, filePath),
      });
    }

    return {
      name,
      packageName,
      methods,
      embeddedInterfaces,
      exported: this.isExported(name),
      location: this.nodeToLocation(interfaceNode, filePath),
    };
  }

  /**
   * Extract parameters from method_elem (interface method)
   */
  private extractParametersFromElem(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoField[] {
    const parameters: GoField[] = [];

    // Find parameter_list
    const paramList = node.namedChildren.find((child) => child.type === 'parameter_list');
    if (!paramList) return parameters;

    // Get parameter_declaration children
    const paramDecls = paramList.namedChildren.filter(
      (child) => child.type === 'parameter_declaration'
    );

    for (const paramDecl of paramDecls) {
      const nameList = paramDecl.namedChildren.filter((child) => child.type === 'identifier');
      const typeNode = paramDecl.namedChildren.find((child) => child.type !== 'identifier');

      if (!typeNode) continue;

      const typeText = code.substring(typeNode.startIndex, typeNode.endIndex);

      if (nameList.length === 0) {
        // Unnamed parameter
        parameters.push({
          name: '',
          type: typeText,
          exported: false,
          location: this.nodeToLocation(paramDecl, filePath),
        });
      } else {
        for (const nameNode of nameList) {
          const paramName = code.substring(nameNode.startIndex, nameNode.endIndex);
          parameters.push({
            name: paramName,
            type: typeText,
            exported: false,
            location: this.nodeToLocation(paramDecl, filePath),
          });
        }
      }
    }

    return parameters;
  }

  /**
   * Extract return types from method_elem (interface method)
   */
  private extractReturnTypesFromElem(node: Parser.SyntaxNode, code: string): string[] {
    const returnTypes: string[] = [];

    // Look for type nodes after the parameter_list
    const children = node.namedChildren;
    let foundParamList = false;

    for (const child of children) {
      if (child.type === 'parameter_list' && !foundParamList) {
        foundParamList = true;
        continue;
      }

      if (foundParamList) {
        // This should be a return type
        if (child.type === 'parameter_list') {
          // Multiple return values
          const types = child.namedChildren.filter((c) => c.type === 'parameter_declaration');
          for (const typeDecl of types) {
            const typeNode = typeDecl.namedChildren.find((c) => c.type !== 'identifier');
            if (typeNode) {
              returnTypes.push(code.substring(typeNode.startIndex, typeNode.endIndex));
            }
          }
        } else {
          // Single return type
          returnTypes.push(code.substring(child.startIndex, child.endIndex));
        }
      }
    }

    return returnTypes;
  }

  /**
   * Extract method declaration
   */
  private extractMethod(
    methodDecl: Parser.SyntaxNode,
    code: string,
    filePath: string,
    options?: TreeSitterParseOptions
  ): GoMethod | null {
    const nameNode = methodDecl.childForFieldName('name');
    if (!nameNode) return null;

    const methodName = code.substring(nameNode.startIndex, nameNode.endIndex);

    // Extract receiver
    const receiverNode = methodDecl.childForFieldName('receiver');
    let receiverType: string | undefined;

    if (receiverNode) {
      const paramList = receiverNode.descendantsOfType('parameter_declaration');
      if (paramList.length > 0) {
        const typeNode = paramList[0].childForFieldName('type');
        if (typeNode) {
          receiverType = code.substring(typeNode.startIndex, typeNode.endIndex).replace(/^\*/, ''); // Remove pointer indicator
        }
      }
    }

    const parameters = this.extractParameters(methodDecl, code, filePath);
    const returnTypes = this.extractReturnTypes(methodDecl, code);

    let body: GoFunctionBody | undefined;
    if (options?.extractBodies) {
      const blockNode = methodDecl.childForFieldName('body');
      if (blockNode) {
        if (options.selectiveExtraction) {
          if (this.shouldExtractBody(blockNode)) {
            body = this.extractFunctionBody(blockNode, code, filePath);
          }
        } else {
          body = this.extractFunctionBody(blockNode, code, filePath);
        }
      }
    }

    return {
      name: methodName,
      receiverType,
      parameters,
      returnTypes,
      exported: this.isExported(methodName),
      location: this.nodeToLocation(methodDecl, filePath),
      body,
    };
  }

  /**
   * Extract parameters from method/function
   */
  private extractParameters(node: Parser.SyntaxNode, code: string, filePath: string): GoField[] {
    const parameters: GoField[] = [];
    const paramsNode = node.childForFieldName('parameters');

    if (!paramsNode) return parameters;

    const paramDecls = paramsNode.descendantsOfType('parameter_declaration');

    for (const paramDecl of paramDecls) {
      const nameList = paramDecl.childForFieldName('name');
      const typeNode = paramDecl.childForFieldName('type');

      if (!typeNode) continue;

      const typeText = code.substring(typeNode.startIndex, typeNode.endIndex);

      if (!nameList) {
        // Unnamed parameter
        parameters.push({
          name: '',
          type: typeText,
          exported: false,
          location: this.nodeToLocation(paramDecl, filePath),
        });
      } else {
        const nameNodes = nameList.namedChildren;
        for (const nameNode of nameNodes) {
          const paramName = code.substring(nameNode.startIndex, nameNode.endIndex);
          parameters.push({
            name: paramName,
            type: typeText,
            exported: false,
            location: this.nodeToLocation(paramDecl, filePath),
          });
        }
      }
    }

    return parameters;
  }

  /**
   * Extract return types from method/function
   */
  private extractReturnTypes(node: Parser.SyntaxNode, code: string): string[] {
    const resultNode = node.childForFieldName('result');
    if (!resultNode) return [];

    // Single return type
    if (resultNode.type !== 'parameter_list') {
      return [code.substring(resultNode.startIndex, resultNode.endIndex)];
    }

    // Multiple return types
    const returnTypes: string[] = [];
    const paramDecls = resultNode.descendantsOfType('parameter_declaration');

    for (const paramDecl of paramDecls) {
      const typeNode = paramDecl.childForFieldName('type');
      if (typeNode) {
        returnTypes.push(code.substring(typeNode.startIndex, typeNode.endIndex));
      }
    }

    return returnTypes;
  }

  /**
   * Check if identifier is exported (starts with uppercase)
   */
  private isExported(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase();
  }

  /**
   * Convert tree-sitter node to source location
   */
  private nodeToLocation(node: Parser.SyntaxNode, filePath: string): GoSourceLocation {
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
    };
  }
}

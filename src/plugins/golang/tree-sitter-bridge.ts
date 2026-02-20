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
  GoMethod,
  GoField,
  GoImport,
  GoSourceLocation,
} from './types.js';

export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    // @ts-ignore - tree-sitter-go language definition compatibility
    this.parser.setLanguage(Go);
  }

  /**
   * Parse a single Go source file
   */
  parseCode(code: string, filePath: string): GoRawPackage {
    const tree = this.parser.parse(code);
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
      const typeSpec = typeDecl.namedChildren.find(child => child.type === 'type_spec');
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
      const method = this.extractMethod(methodDecl, code, filePath);
      if (method && method.receiverType) {
        // Find the struct this method belongs to
        const struct = structs.find(s => s.name === method.receiverType);
        if (struct) {
          struct.methods.push(method);
        }
      }
    }

    return {
      id: packageName,
      name: packageName,
      dirPath: '',
      imports,
      structs,
      interfaces,
      functions: [], // TODO: Extract standalone functions
    };
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
        const alias = nameNode
          ? code.substring(nameNode.startIndex, nameNode.endIndex)
          : undefined;

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
    const fieldDecls = fieldDeclList.children.filter(
      (child) => child.type === 'field_declaration'
    );

    for (const fieldDecl of fieldDecls) {
      // Get all named children (should be field name identifiers and type)
      const namedChildren = fieldDecl.namedChildren;

      if (namedChildren.length === 0) continue;

      // Last named child is usually the type
      const typeNode = namedChildren[namedChildren.length - 1];
      const typeText = code.substring(typeNode.startIndex, typeNode.endIndex);

      // Check if there are name identifiers before the type
      const nameNodes = namedChildren.slice(0, -1).filter(
        (child) => child.type === 'field_identifier' || child.type === 'identifier'
      );

      if (nameNodes.length === 0) {
        // Embedded field (no names, just type)
        embeddedTypes.push(typeText);
      } else {
        // Regular field(s)
        for (const nameNode of nameNodes) {
          const fieldName = code.substring(nameNode.startIndex, nameNode.endIndex);

          // Extract tag if present
          const tagNode = fieldDecl.children.find(child => child.type === 'raw_string_literal');
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
    const methodElems = interfaceNode.namedChildren.filter(
      (child) => child.type === 'method_elem'
    );

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
    const paramList = node.namedChildren.find(child => child.type === 'parameter_list');
    if (!paramList) return parameters;

    // Get parameter_declaration children
    const paramDecls = paramList.namedChildren.filter(
      child => child.type === 'parameter_declaration'
    );

    for (const paramDecl of paramDecls) {
      const nameList = paramDecl.namedChildren.filter(
        child => child.type === 'identifier'
      );
      const typeNode = paramDecl.namedChildren.find(
        child => child.type !== 'identifier'
      );

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
          const types = child.namedChildren.filter(
            c => c.type === 'parameter_declaration'
          );
          for (const typeDecl of types) {
            const typeNode = typeDecl.namedChildren.find(
              c => c.type !== 'identifier'
            );
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
    filePath: string
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
          receiverType = code
            .substring(typeNode.startIndex, typeNode.endIndex)
            .replace(/^\*/, ''); // Remove pointer indicator
        }
      }
    }

    const parameters = this.extractParameters(methodDecl, code, filePath);
    const returnTypes = this.extractReturnTypes(methodDecl, code);

    return {
      name: methodName,
      receiverType,
      parameters,
      returnTypes,
      exported: this.isExported(methodName),
      location: this.nodeToLocation(methodDecl, filePath),
    };
  }

  /**
   * Extract parameters from method/function
   */
  private extractParameters(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoField[] {
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

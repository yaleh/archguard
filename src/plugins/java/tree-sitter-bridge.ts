/**
 * Tree-sitter bridge for Java language parsing
 *
 * Uses tree-sitter-java to parse Java source code into raw AST data
 */

import Parser from 'tree-sitter';
// @ts-ignore - tree-sitter-java doesn't have proper type definitions
import Java from 'tree-sitter-java';
import type {
  JavaRawPackage,
  JavaRawClass,
  JavaRawInterface,
  JavaRawEnum,
  JavaRawMethod,
  JavaRawField,
  JavaRawConstructor,
  JavaRawParameter,
  JavaRawAnnotation,
} from './types.js';

export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    // @ts-ignore - tree-sitter-java language definition compatibility
    this.parser.setLanguage(Java);
  }

  /**
   * Parse a single Java source file
   */
  parseCode(code: string, filePath: string): JavaRawPackage {
    const tree = this.parser.parse(code);
    const rootNode = tree.rootNode;

    // Extract package name
    const packageName = this.extractPackageName(rootNode, code);

    // Extract declarations
    const classes: JavaRawClass[] = [];
    const interfaces: JavaRawInterface[] = [];
    const enums: JavaRawEnum[] = [];

    // Process all top-level declarations
    for (const child of rootNode.namedChildren) {
      if (child.type === 'class_declaration') {
        const cls = this.extractClass(child, packageName, code, filePath);
        if (cls) classes.push(cls);
      } else if (child.type === 'interface_declaration') {
        const iface = this.extractInterface(child, packageName, code, filePath);
        if (iface) interfaces.push(iface);
      } else if (child.type === 'enum_declaration') {
        const enumDecl = this.extractEnum(child, packageName, code, filePath);
        if (enumDecl) enums.push(enumDecl);
      }
    }

    return {
      name: packageName,
      classes,
      interfaces,
      enums,
    };
  }

  /**
   * Extract package name from AST
   */
  private extractPackageName(rootNode: Parser.SyntaxNode, code: string): string {
    const packageDecl = rootNode.children.find(n => n.type === 'package_declaration');
    if (!packageDecl) {
      return '';
    }

    // Find the scoped_identifier or identifier node
    const scopedId = packageDecl.descendantsOfType('scoped_identifier')[0];
    if (scopedId) {
      return code.substring(scopedId.startIndex, scopedId.endIndex);
    }

    const identifier = packageDecl.descendantsOfType('identifier')[0];
    if (identifier) {
      return code.substring(identifier.startIndex, identifier.endIndex);
    }

    return '';
  }

  /**
   * Extract class declaration
   */
  private extractClass(
    node: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): JavaRawClass | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = code.substring(nameNode.startIndex, nameNode.endIndex);

    // Extract modifiers and annotations
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const isAbstract = modifiers.includes('abstract');

    // Extract superclass
    const superclassNode = node.childForFieldName('superclass');
    let superClass: string | undefined = undefined;
    if (superclassNode) {
      // The superclass field contains 'extends' keyword + type
      const typeId = superclassNode.descendantsOfType('type_identifier')[0] ||
                     superclassNode.descendantsOfType('identifier')[0];
      if (typeId) {
        superClass = code.substring(typeId.startIndex, typeId.endIndex);
      }
    }

    // Extract interfaces
    const interfacesNode = node.childForFieldName('interfaces');
    const interfaces: string[] = [];
    if (interfacesNode) {
      // Get type_list node which contains the interface types
      const typeList = interfacesNode.childForFieldName('type_list') || interfacesNode;
      const typeIds = typeList.descendantsOfType('type_identifier');
      for (const typeId of typeIds) {
        interfaces.push(code.substring(typeId.startIndex, typeId.endIndex));
      }
    }

    // Extract class body
    const bodyNode = node.childForFieldName('body');
    const fields: JavaRawField[] = [];
    const methods: JavaRawMethod[] = [];
    const constructors: JavaRawConstructor[] = [];

    if (bodyNode) {
      for (const child of bodyNode.namedChildren) {
        if (child.type === 'field_declaration') {
          const extracted = this.extractFields(child, code);
          fields.push(...extracted);
        } else if (child.type === 'method_declaration') {
          const method = this.extractMethod(child, code);
          if (method) methods.push(method);
        } else if (child.type === 'constructor_declaration') {
          const constructor = this.extractConstructor(child, code);
          if (constructor) constructors.push(constructor);
        }
      }
    }

    return {
      name,
      packageName,
      modifiers,
      superClass,
      interfaces,
      fields,
      methods,
      constructors,
      annotations,
      isAbstract,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Extract interface declaration
   */
  private extractInterface(
    node: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): JavaRawInterface | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = code.substring(nameNode.startIndex, nameNode.endIndex);

    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);

    // Extract extended interfaces
    const extendsNode = node.children.find(n => n.type === 'extends_interfaces');
    const extendsList: string[] = [];
    if (extendsNode) {
      const typeIds = extendsNode.descendantsOfType('type_identifier');
      for (const typeId of typeIds) {
        extendsList.push(code.substring(typeId.startIndex, typeId.endIndex));
      }
    }

    // Extract methods
    const methods: JavaRawMethod[] = [];
    const bodyNode = node.childForFieldName('body');

    if (bodyNode) {
      for (const child of bodyNode.namedChildren) {
        if (child.type === 'method_declaration') {
          const method = this.extractMethod(child, code);
          if (method) methods.push(method);
        }
      }
    }

    return {
      name,
      packageName,
      modifiers,
      extends: extendsList,
      methods,
      annotations,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Extract enum declaration
   */
  private extractEnum(
    node: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): JavaRawEnum | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = code.substring(nameNode.startIndex, nameNode.endIndex);
    const modifiers = this.extractModifiers(node, code);

    // Extract enum constants
    const values: string[] = [];
    const bodyNode = node.childForFieldName('body');

    if (bodyNode) {
      const enumConstants = bodyNode.descendantsOfType('enum_constant');
      for (const constant of enumConstants) {
        const constantName = constant.childForFieldName('name');
        if (constantName) {
          values.push(code.substring(constantName.startIndex, constantName.endIndex));
        }
      }
    }

    return {
      name,
      packageName,
      modifiers,
      values,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Extract field declarations
   */
  private extractFields(node: Parser.SyntaxNode, code: string): JavaRawField[] {
    const fields: JavaRawField[] = [];
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);

    // Get field type
    const typeNode = node.childForFieldName('type');
    const type = typeNode ? this.extractTypeName(typeNode, code) : 'unknown';

    // Get declarators (can have multiple fields in one declaration)
    const declarators = node.descendantsOfType('variable_declarator');
    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = code.substring(nameNode.startIndex, nameNode.endIndex);

      // Get default value if present
      const valueNode = declarator.childForFieldName('value');
      const defaultValue = valueNode
        ? code.substring(valueNode.startIndex, valueNode.endIndex)
        : undefined;

      fields.push({
        name,
        type,
        modifiers,
        annotations,
        defaultValue,
      });
    }

    return fields;
  }

  /**
   * Extract method declaration
   */
  private extractMethod(node: Parser.SyntaxNode, code: string): JavaRawMethod | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = code.substring(nameNode.startIndex, nameNode.endIndex);

    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const isAbstract = modifiers.includes('abstract');

    // Get return type
    const typeNode = node.childForFieldName('type');
    const returnType = typeNode ? this.extractTypeName(typeNode, code) : 'void';

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode
      ? this.extractParameters(parametersNode, code)
      : [];

    return {
      name,
      returnType,
      parameters,
      modifiers,
      annotations,
      isAbstract,
    };
  }

  /**
   * Extract constructor declaration
   */
  private extractConstructor(node: Parser.SyntaxNode, code: string): JavaRawConstructor | null {
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode
      ? this.extractParameters(parametersNode, code)
      : [];

    return {
      parameters,
      modifiers,
      annotations,
    };
  }

  /**
   * Extract method/constructor parameters
   */
  private extractParameters(node: Parser.SyntaxNode, code: string): JavaRawParameter[] {
    const parameters: JavaRawParameter[] = [];
    const formalParams = node.descendantsOfType('formal_parameter');

    for (const param of formalParams) {
      const typeNode = param.childForFieldName('type');
      const nameNode = param.childForFieldName('name');

      if (!typeNode || !nameNode) continue;

      const type = this.extractTypeName(typeNode, code);
      const name = code.substring(nameNode.startIndex, nameNode.endIndex);
      const annotations = this.extractAnnotations(param, code);

      parameters.push({
        name,
        type,
        annotations,
      });
    }

    return parameters;
  }

  /**
   * Extract modifiers from a node
   */
  private extractModifiers(node: Parser.SyntaxNode, code: string): string[] {
    const modifiers: string[] = [];
    const modifierNodes = node.children.filter(n => n.type === 'modifiers');

    for (const modNode of modifierNodes) {
      // Extract all children (both named and unnamed) that are modifiers
      for (const child of modNode.children) {
        // Skip non-modifier children
        const validModifiers = [
          'public', 'private', 'protected',
          'static', 'final', 'abstract',
          'synchronized', 'volatile', 'transient',
          'native', 'strictfp'
        ];
        if (validModifiers.includes(child.type)) {
          modifiers.push(child.type);
        }
      }
    }

    return modifiers;
  }

  /**
   * Extract annotations from a node
   */
  private extractAnnotations(node: Parser.SyntaxNode, code: string): JavaRawAnnotation[] {
    const annotations: JavaRawAnnotation[] = [];

    // Look for annotations in modifiers
    const modifierNodes = node.children.filter(n => n.type === 'modifiers');
    for (const modNode of modifierNodes) {
      for (const child of modNode.children) {
        if (child.type === 'marker_annotation' || child.type === 'annotation') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) {
            const name = code.substring(nameNode.startIndex, nameNode.endIndex);
            // Remove @ prefix if present
            const cleanName = name.startsWith('@') ? name.substring(1) : name;
            annotations.push({
              name: cleanName,
              arguments: undefined,
            });
          }
        }
      }
    }

    return annotations;
  }

  /**
   * Extract type name from type node
   */
  private extractTypeName(node: Parser.SyntaxNode, code: string): string {
    // Handle different type node structures
    if (node.type === 'type_identifier' || node.type === 'identifier') {
      return code.substring(node.startIndex, node.endIndex);
    }

    if (node.type === 'scoped_type_identifier') {
      return code.substring(node.startIndex, node.endIndex);
    }

    if (node.type === 'generic_type') {
      // For generics like List<String>, return the full type
      return code.substring(node.startIndex, node.endIndex);
    }

    if (node.type === 'array_type') {
      // For arrays like String[], return the full type
      return code.substring(node.startIndex, node.endIndex);
    }

    // For primitive types and other types
    return code.substring(node.startIndex, node.endIndex);
  }

  /**
   * Extract list of type names (for interfaces, extends)
   */
  private extractTypeList(node: Parser.SyntaxNode, code: string): string[] {
    const types: string[] = [];
    const typeNodes = node.descendantsOfType([
      'type_identifier',
      'scoped_type_identifier',
      'generic_type',
    ]);

    for (const typeNode of typeNodes) {
      types.push(code.substring(typeNode.startIndex, typeNode.endIndex));
    }

    return types;
  }
}

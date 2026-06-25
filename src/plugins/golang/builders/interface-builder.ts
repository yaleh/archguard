/**
 * InterfaceBuilder — interface extraction for Go parsing
 */

import type Parser from 'tree-sitter';
import type { GoRawInterface, GoMethod, GoField } from '../types.js';
import { NodeUtils } from './node-utils.js';

export class InterfaceBuilder {
  /**
   * Extract all interfaces from a Go source file root node.
   */
  extract(
    filePath: string,
    rootNode: Parser.SyntaxNode,
    code: string,
    packageName: string
  ): GoRawInterface[] {
    const interfaces: GoRawInterface[] = [];

    const typeDecls = rootNode.descendantsOfType('type_declaration');
    for (const typeDecl of typeDecls) {
      const typeSpec = typeDecl.namedChildren.find((child) => child.type === 'type_spec');
      if (!typeSpec) continue;

      const nameNode = typeSpec.childForFieldName('name');
      if (!nameNode) continue;

      const typeName = NodeUtils.nodeText(nameNode, code);
      const typeNode = typeSpec.childForFieldName('type');

      if (typeNode?.type === 'interface_type') {
        interfaces.push(this.extractInterface(typeName, typeNode, packageName, code, filePath));
      }
    }

    return interfaces;
  }

  private extractInterface(
    name: string,
    interfaceNode: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): GoRawInterface {
    const methods: GoMethod[] = [];
    const embeddedInterfaces: string[] = [];

    // Handle both method_elem (interface methods) and type_elem (embedded interfaces)
    for (const child of interfaceNode.namedChildren) {
      if (child.type === 'type_elem') {
        const firstChild = child.namedChild(0);
        if (firstChild && firstChild.type === 'type_identifier') {
          embeddedInterfaces.push(NodeUtils.nodeText(firstChild, code));
        }
        continue;
      }
      if (child.type !== 'method_elem') continue;
    }

    const methodElems = interfaceNode.namedChildren.filter((child) => child.type === 'method_elem');

    for (const methodElem of methodElems) {
      const nameNode = methodElem.childForFieldName('name');
      if (!nameNode) {
        // Fallback: older tree-sitter-go versions use method_elem for embedded types
        const firstChild = methodElem.namedChild(0);
        if (firstChild && firstChild.type === 'type_identifier') {
          embeddedInterfaces.push(NodeUtils.nodeText(firstChild, code));
        }
        continue;
      }

      const methodName = NodeUtils.nodeText(nameNode, code);
      const parameters = this.extractParametersFromElem(methodElem, code, filePath);
      const returnTypes = this.extractReturnTypesFromElem(methodElem, code);

      methods.push({
        name: methodName,
        parameters,
        returnTypes,
        exported: NodeUtils.isExported(methodName),
        location: NodeUtils.nodeToLocation(methodElem, filePath),
      });
    }

    return {
      name,
      packageName,
      methods,
      embeddedInterfaces,
      exported: NodeUtils.isExported(name),
      location: NodeUtils.nodeToLocation(interfaceNode, filePath),
    };
  }

  extractParametersFromElem(node: Parser.SyntaxNode, code: string, filePath: string): GoField[] {
    const parameters: GoField[] = [];

    const paramList = node.namedChildren.find((child) => child.type === 'parameter_list');
    if (!paramList) return parameters;

    const paramDecls = paramList.namedChildren.filter(
      (child) => child.type === 'parameter_declaration'
    );

    for (const paramDecl of paramDecls) {
      const nameList = paramDecl.namedChildren.filter((child) => child.type === 'identifier');
      const typeNode = paramDecl.namedChildren.find((child) => child.type !== 'identifier');

      if (!typeNode) continue;

      const typeText = NodeUtils.nodeText(typeNode, code);

      if (nameList.length === 0) {
        parameters.push({
          name: '',
          type: typeText,
          exported: false,
          location: NodeUtils.nodeToLocation(paramDecl, filePath),
        });
      } else {
        for (const nameNode of nameList) {
          const paramName = NodeUtils.nodeText(nameNode, code);
          parameters.push({
            name: paramName,
            type: typeText,
            exported: false,
            location: NodeUtils.nodeToLocation(paramDecl, filePath),
          });
        }
      }
    }

    return parameters;
  }

  extractReturnTypesFromElem(node: Parser.SyntaxNode, code: string): string[] {
    const returnTypes: string[] = [];

    const children = node.namedChildren;
    let foundParamList = false;

    for (const child of children) {
      if (child.type === 'parameter_list' && !foundParamList) {
        foundParamList = true;
        continue;
      }

      if (foundParamList) {
        if (child.type === 'parameter_list') {
          const types = child.namedChildren.filter((c) => c.type === 'parameter_declaration');
          for (const typeDecl of types) {
            const typeNode = typeDecl.namedChildren.find((c) => c.type !== 'identifier');
            if (typeNode) {
              returnTypes.push(NodeUtils.nodeText(typeNode, code));
            }
          }
        } else {
          returnTypes.push(NodeUtils.nodeText(child, code));
        }
      }
    }

    return returnTypes;
  }
}

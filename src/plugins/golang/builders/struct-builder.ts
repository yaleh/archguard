/**
 * StructBuilder — struct type declaration extraction for Go parsing
 *
 * Handles struct_type from type_declaration nodes.
 * Delegates interface extraction to InterfaceBuilder in the same AST walk.
 */

import type Parser from 'tree-sitter';
import type { GoRawStruct, GoRawInterface, GoField } from '../types.js';
import { NodeUtils } from './node-utils.js';
import { InterfaceBuilder } from './interface-builder.js';

export interface StructBuilderResult {
  structs: GoRawStruct[];
  interfaces: GoRawInterface[];
}

export class StructBuilder {
  private interfaceBuilder = new InterfaceBuilder();

  /**
   * Extract all structs and interfaces from a Go source file root node.
   * Interfaces are extracted via InterfaceBuilder in the same AST walk.
   */
  extract(
    filePath: string,
    rootNode: Parser.SyntaxNode,
    code: string,
    packageName: string
  ): StructBuilderResult {
    const structs: GoRawStruct[] = [];
    const interfaces: GoRawInterface[] = [];

    const typeDecls = rootNode.descendantsOfType('type_declaration');
    for (const typeDecl of typeDecls) {
      const typeSpec = typeDecl.namedChildren.find((child) => child.type === 'type_spec');
      if (!typeSpec) continue;

      const nameNode = typeSpec.childForFieldName('name');
      if (!nameNode) continue;

      const typeName = NodeUtils.nodeText(nameNode, code);
      const typeNode = typeSpec.childForFieldName('type');

      if (typeNode?.type === 'struct_type') {
        structs.push(this.extractStruct(typeName, typeNode, packageName, code, filePath));
      } else if (typeNode?.type === 'interface_type') {
        // Delegate to InterfaceBuilder — pass the type_declaration node
        interfaces.push(...this.interfaceBuilder.extract(filePath, typeDecl, code, packageName));
      }
    }

    return { structs, interfaces };
  }

  private extractStruct(
    name: string,
    structNode: Parser.SyntaxNode,
    packageName: string,
    code: string,
    filePath: string
  ): GoRawStruct {
    const fields: GoField[] = [];
    const embeddedTypes: string[] = [];

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
        exported: NodeUtils.isExported(name),
        location: NodeUtils.nodeToLocation(structNode, filePath),
      };
    }

    const fieldDecls = fieldDeclList.children.filter((child) => child.type === 'field_declaration');

    for (const fieldDecl of fieldDecls) {
      const namedChildren = fieldDecl.namedChildren;

      if (namedChildren.length === 0) continue;

      const typeNode = namedChildren[namedChildren.length - 1];
      const typeText = NodeUtils.nodeText(typeNode, code);

      const nameNodes = namedChildren
        .slice(0, -1)
        .filter((child) => child.type === 'field_identifier' || child.type === 'identifier');

      if (nameNodes.length === 0) {
        // Embedded field (no names, just type)
        embeddedTypes.push(typeText);
      } else {
        for (const nameNode of nameNodes) {
          const fieldName = NodeUtils.nodeText(nameNode, code);

          const tagNode = fieldDecl.children.find((child) => child.type === 'raw_string_literal');
          const tag = tagNode ? NodeUtils.nodeText(tagNode, code).replace(/`/g, '') : undefined;

          fields.push({
            name: fieldName,
            type: typeText,
            tag,
            exported: NodeUtils.isExported(fieldName),
            location: NodeUtils.nodeToLocation(fieldDecl, filePath),
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
      exported: NodeUtils.isExported(name),
      location: NodeUtils.nodeToLocation(structNode, filePath),
    };
  }
}

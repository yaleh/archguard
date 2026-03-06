import type Parser from 'tree-sitter';
import type { RawField, RawMethod } from '../types.js';

type Visibility = 'public' | 'private' | 'protected';

export class ClassBuilder {
  extractMembers(
    bodyNode: Parser.SyntaxNode,
    sourceFile: string,
    defaultVisibility: Visibility = 'private'
  ): { fields: RawField[]; methods: RawMethod[] } {
    const fields: RawField[] = [];
    const methods: RawMethod[] = [];
    let currentVisibility: Visibility = defaultVisibility;

    for (const child of bodyNode.namedChildren) {
      if (child.type === 'access_specifier') {
        const text = child.text.replace(':', '').trim().toLowerCase();
        if (text === 'public' || text === 'private' || text === 'protected') {
          currentVisibility = text as Visibility;
        }
        continue;
      }

      if (child.type === 'function_definition' || child.type === 'declaration') {
        const method = this.tryExtractMethod(child, sourceFile, currentVisibility);
        if (method) {
          methods.push(method);
          continue;
        }
      }

      if (child.type === 'field_declaration') {
        const field = this.tryExtractField(child, currentVisibility);
        if (field) fields.push(field);
      }
    }

    return { fields, methods };
  }

  private tryExtractMethod(
    node: Parser.SyntaxNode,
    sourceFile: string,
    visibility: Visibility
  ): RawMethod | null {
    // Look for function declarator
    const declarator = this.findDescendant(node, 'function_declarator');
    if (!declarator) return null;

    const nameNode = declarator.childForFieldName('declarator');
    if (!nameNode) return null;

    const name = nameNode.text.replace(/^~/, '~'); // preserve destructor ~
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text ?? 'void';

    const params = this.extractParams(declarator);
    const isVirtual = node.text.includes('virtual');
    const isStatic = node.text.includes('static');
    const isPure = node.text.includes('= 0');
    const isConst = declarator.text.includes(') const');

    return {
      name,
      returnType,
      parameters: params,
      visibility,
      isVirtual,
      isStatic,
      isPure,
      isConst,
      sourceFile,
      startLine: node.startPosition.row + 1,
    };
  }

  private tryExtractField(node: Parser.SyntaxNode, visibility: Visibility): RawField | null {
    const typeNode = node.childForFieldName('type');
    const declarator = node.childForFieldName('declarator');
    if (!typeNode || !declarator) return null;

    const nameNode =
      this.findDescendant(declarator, 'field_identifier') ??
      this.findDescendant(declarator, 'identifier');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      fieldType: typeNode.text,
      visibility,
      isStatic: node.text.includes('static'),
    };
  }

  private extractParams(declaratorNode: Parser.SyntaxNode): Array<{ name: string; type: string }> {
    const paramsNode = declaratorNode.childForFieldName('parameters');
    if (!paramsNode) return [];

    return paramsNode.namedChildren
      .filter((n) => n.type === 'parameter_declaration')
      .map((n) => {
        const typeNode = n.childForFieldName('type');
        const declNode = n.childForFieldName('declarator');
        const nameNode = declNode
          ? (this.findDescendant(declNode, 'identifier') ?? declNode)
          : null;
        return {
          name: nameNode?.text ?? '',
          type: typeNode?.text ?? '',
        };
      });
  }

  private findDescendant(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
    if (node.type === type) return node;
    for (const child of node.namedChildren) {
      const found = this.findDescendant(child, type);
      if (found) return found;
    }
    return null;
  }
}

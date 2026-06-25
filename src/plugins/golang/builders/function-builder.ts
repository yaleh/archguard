/**
 * FunctionBuilder — function/method extraction for Go parsing
 */

import type Parser from 'tree-sitter';
import type { GoFunction, GoMethod, GoField, GoFunctionBody, GoRawStruct } from '../types.js';
import { NodeUtils } from './node-utils.js';
import { GoroutineBuilder } from './goroutine-builder.js';
import type { TreeSitterParseOptions } from '../types.js';

export interface MethodExtractionResult {
  orphanedMethods: GoMethod[];
}

export class FunctionBuilder {
  private goroutineBuilder: GoroutineBuilder;

  constructor() {
    this.goroutineBuilder = new GoroutineBuilder();
  }

  /**
   * Extract standalone functions from a Go source file root node.
   */
  extractFunctions(
    filePath: string,
    rootNode: Parser.SyntaxNode,
    code: string,
    packageName: string,
    options?: TreeSitterParseOptions
  ): GoFunction[] {
    const funcDecls = rootNode.descendantsOfType('function_declaration');
    const functions: GoFunction[] = [];

    for (const funcDecl of funcDecls) {
      const func = this.extractFunctionSignature(funcDecl, code, filePath, packageName);

      if (options?.extractBodies) {
        const blockNode = funcDecl.childForFieldName('body');
        if (blockNode) {
          if (options.selectiveExtraction) {
            const forced = options.forceExtractFunctions?.includes(func.name) ?? false;
            if (forced || this.shouldExtractBody(blockNode, code)) {
              func.body = this.extractFunctionBody(blockNode, code, filePath);
            }
          } else {
            func.body = this.extractFunctionBody(blockNode, code, filePath);
          }
        }
      }

      functions.push(func);
    }

    return functions;
  }

  /**
   * Extract methods and attach them to struct definitions.
   * Returns orphaned methods whose receiver struct is in another file.
   */
  extractMethods(
    filePath: string,
    rootNode: Parser.SyntaxNode,
    code: string,
    structs: GoRawStruct[],
    options?: TreeSitterParseOptions
  ): MethodExtractionResult {
    const methodDecls = rootNode.descendantsOfType('method_declaration');
    const orphanedMethods: GoMethod[] = [];

    for (const methodDecl of methodDecls) {
      const method = this.extractMethod(methodDecl, code, filePath, options);
      if (method && method.receiverType) {
        const struct = structs.find((s) => s.name === method.receiverType);
        if (struct) {
          struct.methods.push(method);
        } else {
          orphanedMethods.push(method);
        }
      }
    }

    return { orphanedMethods };
  }

  private extractFunctionSignature(
    funcDecl: Parser.SyntaxNode,
    code: string,
    filePath: string,
    packageName: string
  ): GoFunction {
    const nameNode = funcDecl.childForFieldName('name');
    const funcName = nameNode ? NodeUtils.nodeText(nameNode, code) : '';

    const parameters = this.extractParameters(funcDecl, code, filePath);
    const returnTypes = this.extractReturnTypes(funcDecl, code);

    return {
      name: funcName,
      packageName,
      parameters,
      returnTypes,
      exported: NodeUtils.isExported(funcName),
      location: NodeUtils.nodeToLocation(funcDecl, filePath),
    };
  }

  private extractMethod(
    methodDecl: Parser.SyntaxNode,
    code: string,
    filePath: string,
    options?: TreeSitterParseOptions
  ): GoMethod | null {
    const nameNode = methodDecl.childForFieldName('name');
    if (!nameNode) return null;

    const methodName = NodeUtils.nodeText(nameNode, code);

    const receiverNode = methodDecl.childForFieldName('receiver');
    let receiverType: string | undefined;

    if (receiverNode) {
      const paramList = receiverNode.descendantsOfType('parameter_declaration');
      if (paramList.length > 0) {
        const typeNode = paramList[0].childForFieldName('type');
        if (typeNode) {
          receiverType = NodeUtils.nodeText(typeNode, code).replace(/^\*/, '');
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
          const forced = options.forceExtractFunctions?.includes(methodName) ?? false;
          if (forced || this.shouldExtractBody(blockNode, code)) {
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
      exported: NodeUtils.isExported(methodName),
      location: NodeUtils.nodeToLocation(methodDecl, filePath),
      body,
    };
  }

  private extractParameters(node: Parser.SyntaxNode, code: string, filePath: string): GoField[] {
    const parameters: GoField[] = [];
    const paramsNode = node.childForFieldName('parameters');

    if (!paramsNode) return parameters;

    const paramDecls = paramsNode.descendantsOfType('parameter_declaration');

    for (const paramDecl of paramDecls) {
      const nameList = paramDecl.childForFieldName('name');
      const typeNode = paramDecl.childForFieldName('type');

      if (!typeNode) continue;

      const typeText = NodeUtils.nodeText(typeNode, code);

      if (!nameList) {
        parameters.push({
          name: '',
          type: typeText,
          exported: false,
          location: NodeUtils.nodeToLocation(paramDecl, filePath),
        });
      } else {
        const nameNodes = nameList.namedChildren;
        for (const nameNode of nameNodes) {
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

  private extractReturnTypes(node: Parser.SyntaxNode, code: string): string[] {
    const resultNode = node.childForFieldName('result');
    if (!resultNode) return [];

    if (resultNode.type !== 'parameter_list') {
      return [NodeUtils.nodeText(resultNode, code)];
    }

    const returnTypes: string[] = [];
    const paramDecls = resultNode.descendantsOfType('parameter_declaration');

    for (const paramDecl of paramDecls) {
      const typeNode = paramDecl.childForFieldName('type');
      if (typeNode) {
        returnTypes.push(NodeUtils.nodeText(typeNode, code));
      }
    }

    return returnTypes;
  }

  /**
   * Selective extraction: AST node type pre-scanning
   */
  shouldExtractBody(blockNode: Parser.SyntaxNode, code: string): boolean {
    const targetNodeTypes = ['go_statement', 'send_statement', 'receive_expression'];

    if (targetNodeTypes.some((nodeType) => blockNode.descendantsOfType(nodeType).length > 0)) {
      return true;
    }

    const httpHandlerNames = new Set([
      'HandleFunc',
      'Handle',
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'AddTool',
      'RegisterTool',
      'AddCommand',
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

    const parentDecl = blockNode.parent;
    if (parentDecl) {
      const paramsNode = parentDecl.childForFieldName('parameters');
      if (paramsNode) {
        const paramsText = code.substring(paramsNode.startIndex, paramsNode.endIndex);
        if (paramsText.includes('ResponseWriter') && paramsText.includes('Request')) {
          return true;
        }
      }
    }

    return false;
  }

  private extractFunctionBody(
    blockNode: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoFunctionBody {
    return this.goroutineBuilder.extract(filePath, blockNode, code);
  }
}

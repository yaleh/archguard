/**
 * GoroutineBuilder — goroutine spawn/channel detection for Go parsing
 */

import type Parser from 'tree-sitter';
import type { GoFunctionBody, GoCallExpr, GoSpawnStmt, GoChannelOp } from '../types.js';
import { NodeUtils } from './node-utils.js';

export class GoroutineBuilder {
  /**
   * Extract goroutine and channel information from a function body block node.
   */
  extract(filePath: string, block: Parser.SyntaxNode, code: string): GoFunctionBody {
    return {
      calls: this.extractCallExprs(block, code, filePath),
      goSpawns: this.extractGoSpawns(block, code, filePath),
      channelOps: this.extractChannelOps(block, code, filePath),
    };
  }

  private extractGoSpawns(block: Parser.SyntaxNode, code: string, filePath: string): GoSpawnStmt[] {
    const spawns: GoSpawnStmt[] = [];
    const goStmts = block.descendantsOfType('go_statement');

    for (const goStmt of goStmts) {
      const children = goStmt.namedChildren;
      if (children.length === 0) continue;

      const expr = children[0];

      if (expr.type === 'call_expression') {
        const call = this.extractCallExpr(expr, code, filePath);
        spawns.push({ call, location: NodeUtils.nodeToLocation(goStmt, filePath) });
      } else if (expr.type === 'func_literal') {
        spawns.push({
          call: {
            functionName: '<anonymous>',
            location: NodeUtils.nodeToLocation(expr, filePath),
          },
          location: NodeUtils.nodeToLocation(goStmt, filePath),
        });
      }
    }

    return spawns;
  }

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
    const receiverType: string | undefined = undefined;

    if (funcNode) {
      if (funcNode.type === 'identifier') {
        functionName = NodeUtils.nodeText(funcNode, code);
      } else if (funcNode.type === 'selector_expression') {
        const operand = funcNode.childForFieldName('operand');
        const field = funcNode.childForFieldName('field');
        if (operand && field) {
          packageName = NodeUtils.nodeText(operand, code);
          functionName = NodeUtils.nodeText(field, code);
        }
      }
    }

    const argsNode = callExpr.childForFieldName('arguments');
    const args: string[] = [];
    if (argsNode) {
      for (const child of argsNode.namedChildren) {
        const text = NodeUtils.nodeText(child, code);
        if (child.type === 'interpreted_string_literal' || child.type === 'raw_string_literal') {
          args.push(text.slice(1, -1));
        } else {
          args.push(text);
        }
      }
    }

    return {
      functionName,
      packageName,
      receiverType,
      args,
      location: NodeUtils.nodeToLocation(callExpr, filePath),
    };
  }

  private extractChannelOps(
    block: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoChannelOp[] {
    const ops: GoChannelOp[] = [];

    for (const sendStmt of block.descendantsOfType('send_statement')) {
      const channel = sendStmt.childForFieldName('channel');
      ops.push({
        channelName: channel ? NodeUtils.nodeText(channel, code) : '',
        operation: 'send',
        location: NodeUtils.nodeToLocation(sendStmt, filePath),
      });
    }

    for (const recvExpr of block.descendantsOfType('receive_expression')) {
      const operand = recvExpr.namedChildren[0];
      ops.push({
        channelName: operand ? NodeUtils.nodeText(operand, code) : '',
        operation: 'receive',
        location: NodeUtils.nodeToLocation(recvExpr, filePath),
      });
    }

    for (const callExpr of block.descendantsOfType('call_expression')) {
      const funcNode = callExpr.childForFieldName('function');
      if (funcNode && NodeUtils.nodeText(funcNode, code) === 'make') {
        const args = callExpr.childForFieldName('arguments');
        if (args) {
          const firstArg = args.namedChildren[0];
          if (firstArg && firstArg.type === 'channel_type') {
            ops.push({
              channelName: this.extractMakeChanVarName(callExpr, code),
              operation: 'make',
              location: NodeUtils.nodeToLocation(callExpr, filePath),
            });
          }
        }
      }
    }

    return ops;
  }

  private extractMakeChanVarName(callExpr: Parser.SyntaxNode, code: string): string {
    let node: Parser.SyntaxNode | null = callExpr.parent;

    while (node) {
      if (node.type === 'short_var_declaration' || node.type === 'assignment_statement') {
        const lhsList = node.namedChildren[0];
        const rhsList = node.namedChildren[1];

        if (lhsList && rhsList) {
          const rhsIdx = rhsList.namedChildren.findIndex(
            (ch) => ch.startIndex <= callExpr.startIndex && ch.endIndex >= callExpr.endIndex
          );
          const lhsVar = lhsList.namedChildren[rhsIdx >= 0 ? rhsIdx : 0];
          if (lhsVar) {
            if (lhsVar.type === 'identifier') {
              return NodeUtils.nodeText(lhsVar, code);
            }
            if (lhsVar.type === 'selector_expression') {
              const field = lhsVar.namedChildren[lhsVar.namedChildCount - 1];
              if (field) return NodeUtils.nodeText(field, code);
            }
          }
        }
        break;
      }

      if (
        ['block', 'function_declaration', 'method_declaration', 'func_literal'].includes(node.type)
      ) {
        break;
      }
      node = node.parent;
    }
    return '';
  }
}

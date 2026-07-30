/**
 * NodeUtils — shared tree-sitter node traversal helpers for Go parsing
 */

import type { SyntaxNodeLike } from '../../shared/syntax-tree.js';
import type { GoSourceLocation } from '../types.js';

export class NodeUtils {
  /**
   * Check if identifier is exported (starts with uppercase)
   */
  static isExported(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase();
  }

  /**
   * Extract text from a node using the source code string
   */
  static nodeText(node: SyntaxNodeLike, code: string): string {
    return code.substring(node.startIndex, node.endIndex);
  }

  /**
   * Convert tree-sitter node to source location
   */
  static nodeToLocation(node: SyntaxNodeLike, filePath: string): GoSourceLocation {
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
    };
  }
}

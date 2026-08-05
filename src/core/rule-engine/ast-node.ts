/**
 * Small, dependency-free AST node helpers used by the rule engine (TASK-63).
 *
 * They wrap the minimal tree-sitter node surface (SyntaxNodeLike) so the
 * engine reads fields and descendants without repeating substring slicing.
 */

import type { SyntaxNodeLike } from '@/plugins/shared/syntax-tree.js';

/** Named children of a node whose type matches `type`. */
export function childrenOfType(node: SyntaxNodeLike, type: string): SyntaxNodeLike[] {
  return node.namedChildren.filter((child) => child.type === type);
}

/** Text of a node's field, or undefined when the field is absent. */
export function fieldText(node: SyntaxNodeLike, field: string, code: string): string | undefined {
  const child = node.childForFieldName(field);
  return child ? code.substring(child.startIndex, child.endIndex) : undefined;
}

/** First descendant of one of the given types, in document order. */
export function firstDescendantOfType(
  node: SyntaxNodeLike,
  types: string | string[]
): SyntaxNodeLike | undefined {
  const found = node.descendantsOfType(types);
  return found[0];
}

/** Text of a node (convenience). */
export function nodeText(node: SyntaxNodeLike, code: string): string {
  return code.substring(node.startIndex, node.endIndex);
}

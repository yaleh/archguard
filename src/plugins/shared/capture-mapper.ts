/**
 * CaptureMapper — base class that bridges tree-sitter query captures to
 * language-specific raw types.
 *
 * A concrete subclass supplies `mapCapture(group, filePath)`, which converts
 * one query match's capture group (keyed by capture name) into a raw entity or
 * `null` to skip it. `runQuery(root, filePath)` iterates every match of the
 * compiled query over `root`, builds each match's capture group, calls
 * `mapCapture`, and skips `null` results.
 */
import type { ParserQueryLike, SyntaxNodeLike } from './syntax-tree.js';

/** All captures of one query match, keyed by capture name. */
export interface CaptureGroup {
  [captureName: string]: SyntaxNodeLike | undefined;
}

/**
 * Collect the enclosing namespace-qualified name of a matched node by walking
 * its ancestor chain (outermost first). Empty when the node is at global scope.
 */
export function collectNamespace(node: SyntaxNodeLike): string {
  const parts: string[] = [];
  let cur: SyntaxNodeLike | null = node.parent;
  while (cur) {
    if (cur.type === 'namespace_definition') {
      const name = cur.childForFieldName('name')?.text ?? '';
      if (name) parts.unshift(name);
    }
    cur = cur.parent;
  }
  return parts.join('::');
}

export abstract class CaptureMapper<TRaw> {
  constructor(protected readonly query: ParserQueryLike) {}

  /**
   * Iterate all query matches over `root`, map each match's capture group to a
   * raw entity via `mapCapture`, skipping `null` returns.
   */
  runQuery(root: SyntaxNodeLike, filePath: string): TRaw[] {
    const results: TRaw[] = [];
    for (const match of this.query.matches(root)) {
      const group: CaptureGroup = {};
      for (const capture of match.captures) {
        group[capture.name] = capture.node;
      }
      const raw = this.mapCapture(group, filePath);
      if (raw !== null) results.push(raw);
    }
    return results;
  }

  /** Convert one match's capture group into a raw entity, or `null` to skip. */
  protected abstract mapCapture(group: CaptureGroup, filePath: string): TRaw | null;
}

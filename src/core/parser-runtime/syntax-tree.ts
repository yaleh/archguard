export type ParserRuntimeKind = 'native' | 'wasm';

export interface SyntaxPointLike {
  readonly row: number;
  readonly column: number;
}

/** Minimal tree-sitter node surface consumed by ArchGuard's language extractors. */
export interface SyntaxNodeLike {
  /** Stable numeric id of the node within its tree (identity across accesses). */
  readonly id: number;
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: SyntaxPointLike;
  readonly endPosition: SyntaxPointLike;
  readonly isNamed: boolean;
  readonly parent: SyntaxNodeLike | null;
  readonly children: SyntaxNodeLike[];
  readonly namedChildren: SyntaxNodeLike[];
  readonly namedChildCount: number;
  namedChild(index: number): SyntaxNodeLike | null;
  childForFieldName(name: string): SyntaxNodeLike | null;
  descendantsOfType(type: string | string[]): SyntaxNodeLike[];
}

export interface SyntaxTreeLike {
  readonly rootNode: SyntaxNodeLike;
  dispose(): void;
}

/** One capture inside a tree-sitter query match. */
export interface QueryCaptureLike {
  readonly name: string;
  readonly node: SyntaxNodeLike;
}

/** One tree-sitter query match: a pattern index plus its captures. */
export interface QueryMatchLike {
  readonly pattern: number;
  readonly captures: QueryCaptureLike[];
}

/**
 * Minimal tree-sitter query surface. Both the native binding
 * (`new Parser.Query(...)` → `.matches(node)`) and web-tree-sitter
 * (`Language.query(src)` → `Query.matches(node)`) expose this shape.
 */
export interface ParserQueryLike {
  matches(node: SyntaxNodeLike): Iterable<QueryMatchLike> | readonly QueryMatchLike[];
}

export interface ParserSession {
  readonly language: string;
  readonly runtime: ParserRuntimeKind;
  parse(code: string): SyntaxTreeLike;
  /**
   * Compile a tree-sitter S-expression (`.scm`) query against this session's
   * grammar. The returned query is tied to the session's grammar and can only
   * be run against nodes parsed by that same grammar.
   */
  query(source: string): ParserQueryLike;
  dispose(): void;
}

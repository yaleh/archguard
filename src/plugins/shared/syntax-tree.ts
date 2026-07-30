export type ParserRuntimeKind = 'native';

export interface SyntaxPointLike {
  readonly row: number;
  readonly column: number;
}

/** Minimal tree-sitter node surface consumed by ArchGuard's language extractors. */
export interface SyntaxNodeLike {
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

export interface ParserSession {
  readonly language: string;
  readonly runtime: ParserRuntimeKind;
  parse(code: string): SyntaxTreeLike;
  dispose(): void;
}

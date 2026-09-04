/**
 * Unit tests for TreeSitterBridge parse diagnostics (P1/P2-1).
 *
 * The old parseCode silently converted an extractor exception into an empty
 * RawDartFile, so a failed extraction looked like "successfully parsed, zero
 * content". These tests lock the fixed contract: an extractor exception and a
 * tree-sitter syntax error are BOTH surfaced as per-file diagnostics, never a
 * bare empty stub.
 */
import { describe, it, expect } from 'vitest';
import { TreeSitterBridge } from '@/plugins/dart/tree-sitter-bridge.js';
import type { ParserSession, SyntaxNodeLike } from '@/plugins/shared/syntax-tree.js';

function sessionWithRoot(rootNode: unknown): ParserSession {
  return {
    language: 'dart',
    runtime: 'wasm',
    parse: () => ({ rootNode, dispose: () => {} }),
    query: () => {
      throw new Error('unused');
    },
    dispose: () => {},
  } as unknown as ParserSession;
}

describe('TreeSitterBridge parse diagnostics', () => {
  it('records an extract_error diagnostic instead of silently returning an empty file', () => {
    const rootNode = {
      get namedChildren(): SyntaxNodeLike[] {
        throw new Error('extractor boom');
      },
    };
    const bridge = new TreeSitterBridge(sessionWithRoot(rootNode));
    const file = bridge.parseCode('class A {}', 'a.dart');

    expect(file.classes).toEqual([]);
    expect(file.diagnostics).toHaveLength(1);
    expect(file.diagnostics?.[0].kind).toBe('extract_error');
    expect(file.diagnostics?.[0].message).toContain('boom');
  });

  it('records a syntax_error diagnostic when the tree has ERROR nodes', () => {
    const rootNode = {
      hasError: true,
      namedChildren: [],
    };
    const bridge = new TreeSitterBridge(sessionWithRoot(rootNode));
    const file = bridge.parseCode('class A {', 'broken.dart');

    expect(file.classes).toEqual([]);
    expect(file.diagnostics).toHaveLength(1);
    expect(file.diagnostics?.[0].kind).toBe('syntax_error');
  });

  it('emits no diagnostics for a clean parse', () => {
    const rootNode = {
      hasError: false,
      namedChildren: [],
    };
    const bridge = new TreeSitterBridge(sessionWithRoot(rootNode));
    const file = bridge.parseCode('class A {}', 'ok.dart');

    expect(file.diagnostics).toBeUndefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { TreeSitterBridge } from '@/plugins/cpp/tree-sitter-bridge.js';
import type { ParserSession, SyntaxNodeLike } from '@/plugins/shared/syntax-tree.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../../fixtures/cpp/benchmark-fixture.cpp', import.meta.url)
);

function measureMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Minimal imperative traversal baseline: parse + recursive entity-node walk. */
function directTraversalBaseline(session: ParserSession, code: string): number {
  const tree = session.parse(code);
  let count = 0;
  const visit = (node: SyntaxNodeLike): void => {
    if (
      node.type === 'class_specifier' ||
      node.type === 'struct_specifier' ||
      node.type === 'function_definition' ||
      node.type === 'field_declaration'
    ) {
      count++;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  tree.dispose();
  return count;
}

describe('C++ query-based bridge performance', () => {
  let session: ParserSession;
  let bridge: TreeSitterBridge;
  let code: string;

  beforeAll(async () => {
    session = await nativeParserBackend.createSession('cpp');
    bridge = new TreeSitterBridge(session);
    code = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  });

  afterAll(() => {
    session.dispose();
  });

  it('extracts 50 classes / 200 methods / 100 fields from the fixture', () => {
    const result = bridge.parseCode(code, 'benchmark-fixture.cpp');
    expect(result.classes).toHaveLength(50);
    const methods = result.classes.reduce((sum, cls) => sum + cls.methods.length, 0);
    const fields = result.classes.reduce((sum, cls) => sum + cls.fields.length, 0);
    expect(methods).toBe(200);
    expect(fields).toBe(100);
  }, 10000);

  it('query-based extraction ≤ 2x direct traversal (or ≤500ms absolute)', () => {
    // Warm up the JIT and native bindings before measuring.
    bridge.parseCode(code, 'warmup.cpp');
    directTraversalBaseline(session, code);

    const queryMs =
      measureMs(() => {
        for (let i = 0; i < 3; i++) bridge.parseCode(code, 'bench.cpp');
      }) / 3;
    const baselineMs =
      measureMs(() => {
        for (let i = 0; i < 3; i++) directTraversalBaseline(session, code);
      }) / 3;

    // Bound: query time must be within 2x the direct-traversal baseline, or
    // under 500ms absolute — whichever is less strict.
    const thresholdMs = Math.max(2 * baselineMs, 500);
    expect(queryMs).toBeLessThanOrEqual(thresholdMs);
  }, 15000);
});

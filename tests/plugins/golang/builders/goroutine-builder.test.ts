/**
 * Tests for GoroutineBuilder — goroutine spawn/channel detection
 */

import { describe, it, expect } from 'vitest';
import { GoroutineBuilder } from '../../../../src/plugins/golang/builders/goroutine-builder.js';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

function parse(code: string): Parser.SyntaxNode {
  const parser = new Parser();
  // @ts-ignore
  parser.setLanguage(Go);
  return parser.parse(code).rootNode;
}

function getBlockNode(code: string): Parser.SyntaxNode {
  const root = parse(code);
  const funcDecl = root.descendantsOfType('function_declaration')[0];
  return funcDecl.childForFieldName('body')!;
}

describe('GoroutineBuilder', () => {
  const builder = new GoroutineBuilder();

  describe('extract()', () => {
    it('returns empty array when no goroutines', () => {
      const code = `package main

func start() {
  x := 1 + 1
  _ = x
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      expect(result.goSpawns).toHaveLength(0);
      expect(result.channelOps).toHaveLength(0);
    });

    it('detects go statement spawn', () => {
      const code = `package main

func start() {
  go worker()
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      expect(result.goSpawns).toHaveLength(1);
      expect(result.goSpawns[0].call.functionName).toBe('worker');
    });

    it('extracts channel make() variable name from short_var_declaration', () => {
      const code = `package main

func start() {
  jobs := make(chan int, 100)
  _ = jobs
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const makeOp = result.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('jobs');
    });

    it('extracts channel make() variable name from assignment_statement', () => {
      const code = `package main

func start() {
  var jobs chan int
  jobs = make(chan int, 100)
  _ = jobs
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const makeOp = result.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('jobs');
    });

    it('extracts correct variable in multi-assign short_var_declaration', () => {
      const code = `package main

func start() {
  results, done := make(chan string), make(chan bool)
  _ = results
  _ = done
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const makeOps = result.channelOps.filter((op) => op.operation === 'make');
      expect(makeOps).toHaveLength(2);
      expect(makeOps[0].channelName).toBe('results');
      expect(makeOps[1].channelName).toBe('done');
    });

    it('returns empty string when make(chan) is not assigned to a variable', () => {
      const code = `package main

func start() chan int {
  return make(chan int)
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const makeOp = result.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('');
    });

    it('extracts call expression arguments (string literal)', () => {
      const code = `package main

func setup() {
  mux.HandleFunc("/api/users", handleUsers)
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const handleFuncCall = result.calls.find((c) => c.functionName === 'HandleFunc');
      expect(handleFuncCall).toBeDefined();
      expect(handleFuncCall?.args).toEqual(['/api/users', 'handleUsers']);
    });

    it('extracts call expression with METHOD prefix', () => {
      const code = `package main

func setup() {
  mux.HandleFunc("POST /products", handler.Create)
}
`;
      const block = getBlockNode(code);
      const result = builder.extract('test.go', block, code);
      const handleFuncCall = result.calls.find((c) => c.functionName === 'HandleFunc');
      expect(handleFuncCall).toBeDefined();
      expect(handleFuncCall?.args).toEqual(['POST /products', 'handler.Create']);
    });
  });
});

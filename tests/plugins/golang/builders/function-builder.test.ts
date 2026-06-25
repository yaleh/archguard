/**
 * Tests for FunctionBuilder — function/method extraction
 */

import { describe, it, expect } from 'vitest';
import { FunctionBuilder } from '../../../../src/plugins/golang/builders/function-builder.js';
import Parser from 'tree-sitter';
// @ts-expect-error -- tree-sitter-go has no TypeScript types
import Go from 'tree-sitter-go';

function parse(code: string): Parser.SyntaxNode {
  const parser = new Parser();
  // @ts-expect-error -- setLanguage accepts any Language object
  parser.setLanguage(Go);
  return parser.parse(code).rootNode;
}

describe('FunctionBuilder', () => {
  const builder = new FunctionBuilder();

  describe('extractFunctions()', () => {
    it('returns empty arrays when no functions', () => {
      const code = 'package main\n';
      const root = parse(code);
      const result = builder.extractFunctions('test.go', root, code, 'main');
      expect(result).toHaveLength(0);
    });

    it('extracts a top-level function', () => {
      const code = `package main

func Hello() {
  fmt.Println("hello")
}
`;
      const root = parse(code);
      const result = builder.extractFunctions('test.go', root, code, 'main');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Hello');
      expect(result[0].packageName).toBe('main');
      expect(result[0].exported).toBe(true);
    });

    it('extracts function return types', () => {
      const code = `package main

func Add(a int, b int) int {
  return a + b
}
`;
      const root = parse(code);
      const result = builder.extractFunctions('test.go', root, code, 'main');
      expect(result[0].returnTypes).toContain('int');
    });
  });

  describe('extractMethods()', () => {
    it('extracts a method (with receiver)', () => {
      const code = `package main

type User struct {
  Name string
}

func (u User) GetName() string {
  return u.Name
}
`;
      const root = parse(code);
      const structs = [
        {
          name: 'User',
          packageName: 'main',
          fields: [],
          methods: [] as any[],
          embeddedTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 3, endLine: 5 },
        },
      ];
      builder.extractMethods('test.go', root, code, structs as any);
      expect(structs[0].methods).toHaveLength(1);
      expect(structs[0].methods[0].name).toBe('GetName');
      expect(structs[0].methods[0].receiverType).toBe('User');
    });

    it('returns orphaned methods when receiver struct is in another file', () => {
      const code = `package main

func (s *Server) handleHealth() {
  // handle
}
`;
      const root = parse(code);
      const structs: any[] = [];
      const result = builder.extractMethods('test.go', root, code, structs);
      expect(result.orphanedMethods).toHaveLength(1);
      expect(result.orphanedMethods[0].name).toBe('handleHealth');
      expect(result.orphanedMethods[0].receiverType).toBe('Server');
    });
  });
});

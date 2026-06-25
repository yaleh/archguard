/**
 * Tests for InterfaceBuilder — interface extraction
 */

import { describe, it, expect } from 'vitest';
import { InterfaceBuilder } from '../../../../src/plugins/golang/builders/interface-builder.js';
import Parser from 'tree-sitter';
// @ts-expect-error -- tree-sitter-go has no TypeScript types
import Go from 'tree-sitter-go';

function parse(code: string): Parser.SyntaxNode {
  const parser = new Parser();
  // @ts-expect-error -- setLanguage accepts any Language object
  parser.setLanguage(Go);
  return parser.parse(code).rootNode;
}

describe('InterfaceBuilder', () => {
  const builder = new InterfaceBuilder();

  describe('extract()', () => {
    it('returns empty array when no interfaces', () => {
      const code = 'package main\n';
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result).toHaveLength(0);
    });

    it('extracts a simple interface', () => {
      const code = `package main

type Runner interface {
  Run()
  Stop()
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Runner');
      expect(result[0].packageName).toBe('main');
      expect(result[0].exported).toBe(true);
    });

    it('extracts interface methods', () => {
      const code = `package main

type Store interface {
  Get(key string) (string, error)
  Set(key string, value string)
  Delete(key string) error
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result[0].methods).toHaveLength(3);
      expect(result[0].methods[0].name).toBe('Get');
      expect(result[0].methods[1].name).toBe('Set');
      expect(result[0].methods[2].name).toBe('Delete');
    });

    it('extracts embedded interfaces', () => {
      const code = `package main

type ReadWriter interface {
  Reader
  Writer
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result[0].embeddedInterfaces).toContain('Reader');
      expect(result[0].embeddedInterfaces).toContain('Writer');
    });
  });
});

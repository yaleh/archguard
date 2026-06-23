/**
 * Tests for StructBuilder — struct/type-alias extraction
 */

import { describe, it, expect } from 'vitest';
import { StructBuilder } from '../../../../src/plugins/golang/builders/struct-builder.js';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

function parse(code: string): Parser.SyntaxNode {
  const parser = new Parser();
  // @ts-ignore
  parser.setLanguage(Go);
  return parser.parse(code).rootNode;
}

describe('StructBuilder', () => {
  const builder = new StructBuilder();

  describe('extract()', () => {
    it('returns empty array when no structs', () => {
      const code = 'package main\n';
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result.structs).toHaveLength(0);
    });

    it('extracts a simple struct', () => {
      const code = `package main

type User struct {
  Name string
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result.structs).toHaveLength(1);
      expect(result.structs[0].name).toBe('User');
      expect(result.structs[0].packageName).toBe('main');
      expect(result.structs[0].exported).toBe(true);
    });

    it('extracts struct fields', () => {
      const code = `package main

type User struct {
  Name string
  Age  int
  email string
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result.structs[0].fields).toHaveLength(3);
      expect(result.structs[0].fields[0].name).toBe('Name');
      expect(result.structs[0].fields[0].type).toBe('string');
      expect(result.structs[0].fields[0].exported).toBe(true);
      expect(result.structs[0].fields[2].name).toBe('email');
      expect(result.structs[0].fields[2].exported).toBe(false);
    });

    it('extracts embedded types', () => {
      const code = `package main

type Admin struct {
  User
  Level int
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result.structs[0].embeddedTypes).toContain('User');
    });

    it('handles type aliases (non-struct types)', () => {
      const code = `package main

type MyInt int
type User struct {
  Name string
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      // Only the struct should be extracted
      expect(result.structs).toHaveLength(1);
      expect(result.structs[0].name).toBe('User');
    });

    it('returns interfaces extracted alongside structs', () => {
      const code = `package main

type Runner interface {
  Run()
}

type Car struct {
  Speed int
}
`;
      const root = parse(code);
      const result = builder.extract('test.go', root, code, 'main');
      expect(result.structs).toHaveLength(1);
      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].name).toBe('Runner');
    });
  });
});

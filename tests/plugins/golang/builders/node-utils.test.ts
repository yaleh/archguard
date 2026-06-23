/**
 * Tests for NodeUtils — shared tree-sitter node traversal helpers
 */

import { describe, it, expect } from 'vitest';
import { NodeUtils } from '../../../../src/plugins/golang/builders/node-utils.js';
import Parser from 'tree-sitter';
// @ts-ignore
import Go from 'tree-sitter-go';

function parse(code: string): Parser.SyntaxNode {
  const parser = new Parser();
  // @ts-ignore
  parser.setLanguage(Go);
  return parser.parse(code).rootNode;
}

describe('NodeUtils', () => {
  describe('isExported()', () => {
    it('returns true for capitalized names', () => {
      expect(NodeUtils.isExported('User')).toBe(true);
      expect(NodeUtils.isExported('MyService')).toBe(true);
      expect(NodeUtils.isExported('A')).toBe(true);
    });

    it('returns false for lowercase names', () => {
      expect(NodeUtils.isExported('user')).toBe(false);
      expect(NodeUtils.isExported('myService')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(NodeUtils.isExported('')).toBe(false);
    });
  });

  describe('nodeText()', () => {
    it('extracts text from a node', () => {
      const root = parse('package main\n\ntype User struct{}');
      const typeDecl = root.descendantsOfType('type_declaration')[0];
      expect(typeDecl).toBeDefined();
      const typeSpec = typeDecl.namedChildren.find((c) => c.type === 'type_spec');
      expect(typeSpec).toBeDefined();
      const nameNode = typeSpec!.childForFieldName('name')!;
      expect(NodeUtils.nodeText(nameNode, 'package main\n\ntype User struct{}')).toBe('User');
    });
  });

  describe('nodeToLocation()', () => {
    it('maps node to source location', () => {
      const code = 'package main\n\ntype User struct{}';
      const root = parse(code);
      const typeDecl = root.descendantsOfType('type_declaration')[0];
      const location = NodeUtils.nodeToLocation(typeDecl, 'test.go');
      expect(location.file).toBe('test.go');
      expect(location.startLine).toBeGreaterThan(0);
      expect(location.endLine).toBeGreaterThanOrEqual(location.startLine);
    });

    it('includes column information', () => {
      const code = 'package main\n\ntype User struct{}';
      const root = parse(code);
      const typeDecl = root.descendantsOfType('type_declaration')[0];
      const location = NodeUtils.nodeToLocation(typeDecl, 'file.go');
      expect(typeof location.startColumn).toBe('number');
      expect(typeof location.endColumn).toBe('number');
    });
  });
});

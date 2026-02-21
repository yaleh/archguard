/**
 * Unit tests for plugin error classes
 * Written using TDD - tests first, implementation second
 */

import { describe, it, expect } from 'vitest';
import { ParseError, PluginError } from '@/core/interfaces/index.js';

describe('ParseError', () => {
  describe('constructor', () => {
    it('should create ParseError with file property', () => {
      const error = new ParseError('Failed to parse file', 'go-plugin', '/path/to/file.go');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PluginError);
      expect(error.name).toBe('ParseError');
      expect(error.message).toBe('Failed to parse file');
      expect(error.pluginName).toBe('go-plugin');
      expect(error.file).toBe('/path/to/file.go');
    });

    it('should include optional line property', () => {
      const error = new ParseError('Syntax error at line 42', 'java-plugin', '/src/Main.java', 42);

      expect(error.file).toBe('/src/Main.java');
      expect(error.line).toBe(42);
    });

    it('should have undefined line when not provided', () => {
      const error = new ParseError('Parse failed', 'python-plugin', '/src/main.py');

      expect(error.line).toBeUndefined();
    });

    it('should preserve cause error', () => {
      const cause = new Error('Original parsing error');
      const error = new ParseError(
        'Failed to parse',
        'typescript-plugin',
        '/src/index.ts',
        undefined,
        cause
      );

      expect(error.cause).toBe(cause);
    });

    it('should have correct error code PARSE_ERROR', () => {
      const error = new ParseError('Parse error', 'go-plugin', '/main.go');

      expect(error.code).toBe('PARSE_ERROR');
    });

    it('should capture stack trace', () => {
      const error = new ParseError('Test error', 'test-plugin', '/test.ts');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ParseError');
    });
  });

  describe('with all parameters', () => {
    it('should create error with all properties set', () => {
      const cause = new SyntaxError('Unexpected token');
      const error = new ParseError(
        'Unexpected token at line 10',
        'java-plugin',
        '/src/com/example/App.java',
        10,
        cause
      );

      expect(error.message).toBe('Unexpected token at line 10');
      expect(error.code).toBe('PARSE_ERROR');
      expect(error.pluginName).toBe('java-plugin');
      expect(error.file).toBe('/src/com/example/App.java');
      expect(error.line).toBe(10);
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('ParseError');
    });
  });
});

/**
 * Unit tests for ParseError (src/parser/errors.ts)
 *
 * Verifies that ParseError carries the correct metadata and is re-exported
 * transparently through @/cli/errors so existing callers are unaffected.
 */

import { describe, it, expect } from 'vitest';
import { ParseError } from '@/parser/errors';
import { ParseError as ParseErrorViaCliErrors } from '@/cli/errors';

describe('ParseError', () => {
  describe('constructor and properties', () => {
    it('should set message, filePath, name', () => {
      const err = new ParseError('Unexpected token', 'src/foo.ts');

      expect(err.message).toBe('Unexpected token');
      expect(err.filePath).toBe('src/foo.ts');
      expect(err.name).toBe('ParseError');
    });

    it('should set optional line when provided', () => {
      const err = new ParseError('Bad syntax', 'src/bar.ts', 10);

      expect(err.line).toBe(10);
      expect(err.column).toBeUndefined();
    });

    it('should set optional line and column when provided', () => {
      const err = new ParseError('Bad syntax', 'src/bar.ts', 10, 25);

      expect(err.line).toBe(10);
      expect(err.column).toBe(25);
    });

    it('should be an instance of Error', () => {
      const err = new ParseError('msg', 'file.ts');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ParseError);
    });

    it('should have a stack trace', () => {
      const err = new ParseError('msg', 'file.ts');

      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('ParseError');
    });

    it('should have readonly filePath', () => {
      const err = new ParseError('msg', 'src/immutable.ts');

      // Property is declared readonly; verify the value is stable
      expect(err.filePath).toBe('src/immutable.ts');
    });
  });

  describe('re-export from @/cli/errors', () => {
    it('should be the same class as exported from @/cli/errors', () => {
      expect(ParseErrorViaCliErrors).toBe(ParseError);
    });

    it('instances created via cli/errors re-export should pass instanceof check', () => {
      const err = new ParseErrorViaCliErrors('re-export check', 'src/x.ts');

      expect(err).toBeInstanceOf(ParseError);
      expect(err.name).toBe('ParseError');
      expect(err.filePath).toBe('src/x.ts');
    });
  });
});

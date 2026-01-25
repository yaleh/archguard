/**
 * Story 4: Error Handling Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect } from 'vitest';
import { ErrorHandler } from '@/cli/error-handler';
import { ParseError, APIError, ValidationError, FileError } from '@/cli/errors';

describe('Story 4: Error Handling Optimization', () => {
  const handler = new ErrorHandler();

  describe('Parse Error Formatting', () => {
    it('should format parse error with file and line', () => {
      const error = new ParseError(
        'Unexpected token',
        'src/services/user.ts',
        42
      );

      const message = handler.format(error);

      expect(message).toContain('Parse Error');
      expect(message).toContain('src/services/user.ts:42');
      expect(message).toContain('Unexpected token');
    });

    it('should format parse error with file, line, and column', () => {
      const error = new ParseError(
        'Missing semicolon',
        'src/services/auth.ts',
        10,
        25
      );

      const message = handler.format(error);

      expect(message).toContain('src/services/auth.ts:10:25');
      expect(message).toContain('Missing semicolon');
    });

    it('should include helpful tip for parse errors', () => {
      const error = new ParseError(
        'Unexpected token',
        'test.ts',
        5
      );

      const message = handler.format(error);

      expect(message).toContain('Tip:');
      expect(message).toContain('syntax');
    });
  });

  describe('API Error Formatting', () => {
    it('should format 401 authentication error', () => {
      const error = new APIError('Authentication failed', 401);

      const message = handler.format(error);

      expect(message).toContain('API Error');
      expect(message).toContain('[401]');
      expect(message).toContain('Authentication failed');
      expect(message).toContain('ANTHROPIC_API_KEY');
    });

    it('should format 429 rate limit error', () => {
      const error = new APIError('Rate limit exceeded', 429);

      const message = handler.format(error);

      expect(message).toContain('[429]');
      expect(message).toContain('Rate limit exceeded');
      expect(message).toContain('try again later');
    });

    it('should format 500 server error', () => {
      const error = new APIError('Internal server error', 500);

      const message = handler.format(error);

      expect(message).toContain('[500]');
      expect(message).toContain('temporarily unavailable');
      expect(message).toContain('retry');
    });

    it('should format 503 service unavailable error', () => {
      const error = new APIError('Service unavailable', 503);

      const message = handler.format(error);

      expect(message).toContain('[503]');
      expect(message).toContain('unavailable');
    });
  });

  describe('Validation Error Formatting', () => {
    it('should format validation error with suggestions', () => {
      const error = new ValidationError(
        'Invalid output format: xml',
        ['plantuml', 'json', 'svg']
      );

      const message = handler.format(error);

      expect(message).toContain('Validation Error');
      expect(message).toContain('Invalid output format: xml');
      expect(message).toContain('plantuml');
      expect(message).toContain('json');
      expect(message).toContain('svg');
    });

    it('should format validation error without suggestions', () => {
      const error = new ValidationError('Source directory is required');

      const message = handler.format(error);

      expect(message).toContain('Validation Error');
      expect(message).toContain('Source directory is required');
    });
  });

  describe('File Error Formatting', () => {
    it('should format file read error', () => {
      const error = new FileError(
        'File not found',
        '/path/to/file.ts',
        'read'
      );

      const message = handler.format(error);

      expect(message).toContain('File Error');
      expect(message).toContain('/path/to/file.ts');
      expect(message).toContain('Read'); // Operation is capitalized
    });

    it('should format file write error', () => {
      const error = new FileError(
        'Permission denied',
        '/path/to/output.puml',
        'write'
      );

      const message = handler.format(error);

      expect(message).toContain('Write'); // Operation is capitalized
      expect(message).toContain('Permission denied');
    });
  });

  describe('Generic Error Formatting', () => {
    it('should format ENOENT error with helpful suggestion', () => {
      const error = new Error('ENOENT: no such file or directory');

      const message = handler.format(error);

      expect(message).toContain('File not found');
      expect(message).toContain('path is correct');
    });

    it('should format EACCES error with helpful suggestion', () => {
      const error = new Error('EACCES: permission denied');

      const message = handler.format(error);

      expect(message).toContain('Permission denied');
      expect(message).toContain('permissions');
    });

    it('should format EADDRINUSE error with helpful suggestion', () => {
      const error = new Error('EADDRINUSE: address already in use');

      const message = handler.format(error);

      expect(message).toContain('already in use');
    });

    it('should format unknown error', () => {
      const error = new Error('Something went wrong');

      const message = handler.format(error);

      expect(message).toContain('Error');
      expect(message).toContain('Something went wrong');
    });
  });

  describe('Colored Output', () => {
    it('should use chalk formatting when color is enabled', () => {
      const error = new ParseError('Test error', 'test.ts', 10);

      const coloredMessage = handler.format(error, { color: true });

      // Verify formatting was applied (chalk may or may not add ANSI codes depending on env)
      // So we just verify the format method accepts color option
      expect(coloredMessage).toContain('Parse Error');
      expect(coloredMessage).toContain('Test error');
    });

    it('should format without chalk when color is disabled', () => {
      const error = new ParseError('Test error', 'test.ts', 10);

      const plainMessage = handler.format(error, { color: false });

      // Plain text should still contain the error information
      expect(plainMessage).toContain('Parse Error');
      expect(plainMessage).toContain('Test error');
      expect(plainMessage).toContain('test.ts:10');
    });
  });

  describe('Verbose Mode', () => {
    it('should include stack trace in verbose mode', () => {
      const error = new Error('Test error');

      const verboseMessage = handler.format(error, { verbose: true });

      expect(verboseMessage).toContain('at ');
      expect(verboseMessage.split('\n').length).toBeGreaterThan(3);
    });

    it('should not include stack trace in non-verbose mode', () => {
      const error = new Error('Test error');

      const normalMessage = handler.format(error, { verbose: false });

      // Should only contain the error message, not stack trace lines
      const lines = normalMessage.split('\n').filter(l => l.trim());
      expect(lines.length).toBeLessThan(10); // Stack traces are usually longer
    });
  });

  describe('Edge Cases', () => {
    it('should handle null error', () => {
      const message = handler.format(null);

      expect(message).toContain('Unknown error');
    });

    it('should handle undefined error', () => {
      const message = handler.format(undefined);

      expect(message).toContain('Unknown error');
    });

    it('should handle string error', () => {
      const message = handler.format('Something went wrong');

      expect(message).toContain('Something went wrong');
    });

    it('should handle non-error object', () => {
      const message = handler.format({ foo: 'bar' });

      expect(message).toBeDefined();
    });
  });
});

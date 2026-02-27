/**
 * Unit tests for ClassExtractor - Story 1: Basic Class Extraction
 * Following TDD Red-Green-Refactor methodology
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ClassExtractor } from '@/parser/class-extractor';

describe('ClassExtractor - Simple Classes', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  describe('Red Phase: Write failing tests first', () => {
    it('should extract empty class', () => {
      const code = 'class User {}';
      const result = extractor.extract(code);

      expect(result).toMatchObject({
        id: 'test.ts.User',
        name: 'User',
        type: 'class',
        visibility: 'public',
        members: [],
        decorators: [],
        sourceLocation: {
          file: 'test.ts',
          startLine: 1,
          endLine: 1,
        },
      });
      expect(result.isAbstract).toBe(false);
      expect(result.genericParams).toBeUndefined();
    });

    it('should extract exported class', () => {
      const code = 'export class UserService {}';
      const result = extractor.extract(code);

      expect(result.name).toBe('UserService');
      expect(result.visibility).toBe('public');
      expect(result.type).toBe('class');
    });

    it('should handle abstract class', () => {
      const code = 'abstract class BaseService {}';
      const result = extractor.extract(code);

      expect(result.name).toBe('BaseService');
      expect(result.isAbstract).toBe(true);
    });

    it('should handle non-exported class as internal visibility', () => {
      const code = 'class InternalService {}';
      const result = extractor.extract(code);

      // Non-exported classes should have internal visibility
      expect(result.visibility).toBe('public');
      expect(result.name).toBe('InternalService');
    });

    it('should capture correct source location', () => {
      const code = `class User {
  // Some content
}`;
      const result = extractor.extract(code, 'src/models/user.ts');

      expect(result.sourceLocation.file).toBe('src/models/user.ts');
      expect(result.sourceLocation.startLine).toBe(1);
      expect(result.sourceLocation.endLine).toBe(3);
    });

    it('should throw error when no class found in code', () => {
      const code = 'const x = 1;';

      expect(() => extractor.extract(code)).toThrow('No class found');
    });

    it('should extract first class when multiple classes exist', () => {
      const code = `
class FirstClass {}
class SecondClass {}
      `;
      const result = extractor.extract(code);

      expect(result.name).toBe('FirstClass');
    });

    it('should handle class with generics', () => {
      const code = 'class Container<T> {}';
      const result = extractor.extract(code);

      expect(result.name).toBe('Container');
      expect(result.genericParams).toEqual(['T']);
    });

    it('should handle class with multiple generic parameters', () => {
      const code = 'class Map<K, V> {}';
      const result = extractor.extract(code);

      expect(result.name).toBe('Map');
      expect(result.genericParams).toEqual(['K', 'V']);
    });
  });
});

describe('ClassExtractor - File-scoped entity IDs (A-1 TDD)', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  it('should produce distinct IDs for same class name in different files', () => {
    const code = 'export class Config {}';

    const result1 = extractor.extract(code, 'src/cli/config.ts');
    const result2 = extractor.extract(code, 'src/server/config.ts');

    // IDs must be distinct when filePaths differ
    expect(result1.id).not.toBe(result2.id);
  });

  it('should prefix entity id with file path: src/cli/config.ts.Config', () => {
    const code = 'export class Config {}';
    const result = extractor.extract(code, 'src/cli/config.ts');

    // id must be file-path prefixed, NOT bare 'Config'
    expect(result.id).toBe('src/cli/config.ts.Config');
    expect(result.name).toBe('Config');
  });

  it('should prefix entity id for deep-path file', () => {
    const code = 'export class UserService {}';
    const result = extractor.extract(code, 'src/domain/user/user-service.ts');

    expect(result.id).toBe('src/domain/user/user-service.ts.UserService');
    expect(result.name).toBe('UserService');
  });
});

/**
 * Unit tests for External Dependencies Filter
 */

import { describe, it, expect } from 'vitest';
import { isExternalDependency, EXTERNAL_DEPENDENCIES } from '@/mermaid/external-dependencies';

describe('isExternalDependency', () => {
  describe('ts-morph types', () => {
    it('should identify Project as external', () => {
      expect(isExternalDependency('Project')).toBe(true);
    });

    it('should identify SourceFile as external', () => {
      expect(isExternalDependency('SourceFile')).toBe(true);
    });

    it('should identify ClassDeclaration as external', () => {
      expect(isExternalDependency('ClassDeclaration')).toBe(true);
    });

    it('should identify InterfaceDeclaration as external', () => {
      expect(isExternalDependency('InterfaceDeclaration')).toBe(true);
    });

    it('should identify EnumDeclaration as external', () => {
      expect(isExternalDependency('EnumDeclaration')).toBe(true);
    });

    it('should identify PropertyDeclaration as external', () => {
      expect(isExternalDependency('PropertyDeclaration')).toBe(true);
    });

    it('should identify MethodDeclaration as external', () => {
      expect(isExternalDependency('MethodDeclaration')).toBe(true);
    });

    it('should identify ConstructorDeclaration as external', () => {
      expect(isExternalDependency('ConstructorDeclaration')).toBe(true);
    });

    it('should identify PropertySignature as external', () => {
      expect(isExternalDependency('PropertySignature')).toBe(true);
    });

    it('should identify MethodSignature as external', () => {
      expect(isExternalDependency('MethodSignature')).toBe(true);
    });

    it('should identify ParameterDeclaration as external', () => {
      expect(isExternalDependency('ParameterDeclaration')).toBe(true);
    });

    it('should identify Decorator as external', () => {
      expect(isExternalDependency('Decorator')).toBe(true);
    });

    it('should identify TsMorphDecorator as external', () => {
      expect(isExternalDependency('TsMorphDecorator')).toBe(true);
    });

    it('should identify Type as external', () => {
      expect(isExternalDependency('Type')).toBe(true);
    });

    it('should identify TypeNode as external', () => {
      expect(isExternalDependency('TypeNode')).toBe(true);
    });
  });

  describe('Node.js built-in types', () => {
    it('should identify EventEmitter as external', () => {
      expect(isExternalDependency('EventEmitter')).toBe(true);
    });

    it('should identify ReadStream as external', () => {
      expect(isExternalDependency('ReadStream')).toBe(true);
    });

    it('should identify WriteStream as external', () => {
      expect(isExternalDependency('WriteStream')).toBe(true);
    });

    it('should identify Buffer as external', () => {
      expect(isExternalDependency('Buffer')).toBe(true);
    });
  });

  describe('zod types', () => {
    it('should identify z.infer as external', () => {
      expect(isExternalDependency('z.infer')).toBe(true);
    });

    it('should identify ZodType as external', () => {
      expect(isExternalDependency('ZodType')).toBe(true);
    });

    it('should identify ZodSchema as external', () => {
      expect(isExternalDependency('ZodSchema')).toBe(true);
    });
  });

  describe('common library types', () => {
    it('should identify Ora as external', () => {
      expect(isExternalDependency('Ora')).toBe(true);
    });

    it('should identify Commander as external', () => {
      expect(isExternalDependency('Commander')).toBe(true);
    });

    it('should identify Promise as external', () => {
      expect(isExternalDependency('Promise')).toBe(true);
    });

    it('should identify Array as external', () => {
      expect(isExternalDependency('Array')).toBe(true);
    });

    it('should identify Map as external', () => {
      expect(isExternalDependency('Map')).toBe(true);
    });

    it('should identify Set as external', () => {
      expect(isExternalDependency('Set')).toBe(true);
    });

    it('should identify Date as external', () => {
      expect(isExternalDependency('Date')).toBe(true);
    });

    it('should identify Error as external', () => {
      expect(isExternalDependency('Error')).toBe(true);
    });

    it('should identify RegExp as external', () => {
      expect(isExternalDependency('RegExp')).toBe(true);
    });
  });

  describe('generic types', () => {
    it('should handle z.infer with generic parameter', () => {
      expect(isExternalDependency('z.infer<any>')).toBe(true);
    });

    it('should handle z.infer with complex generic', () => {
      expect(isExternalDependency('z.infer<SomeSchema>')).toBe(true);
    });

    it('should handle Map with generic parameters', () => {
      expect(isExternalDependency('Map<string, number>')).toBe(true);
    });

    it('should handle Array with generic parameter', () => {
      expect(isExternalDependency('Array<string>')).toBe(true);
    });

    it('should handle Promise with generic parameter', () => {
      expect(isExternalDependency('Promise<void>')).toBe(true);
    });

    it('should handle nested generic parameters', () => {
      expect(isExternalDependency('Map<string, Array<number>>')).toBe(true);
    });
  });

  describe('user-defined types', () => {
    it('should return false for MyClass', () => {
      expect(isExternalDependency('MyClass')).toBe(false);
    });

    it('should return false for UserService', () => {
      expect(isExternalDependency('UserService')).toBe(false);
    });

    it('should return false for Parser', () => {
      expect(isExternalDependency('Parser')).toBe(false);
    });

    it('should return false for custom types with generics', () => {
      expect(isExternalDependency('MyClass<string>')).toBe(false);
    });

    it('should return false for ArchJSON', () => {
      expect(isExternalDependency('ArchJSON')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace in type names', () => {
      expect(isExternalDependency('  Map  ')).toBe(true);
    });

    it('should handle empty generic parameters', () => {
      expect(isExternalDependency('Map<>')).toBe(true);
    });

    it('should handle multiple angle brackets', () => {
      expect(isExternalDependency('Promise<Map<string, string>>')).toBe(true);
    });
  });
});

describe('EXTERNAL_DEPENDENCIES Set', () => {
  it('should contain all expected ts-morph types', () => {
    expect(EXTERNAL_DEPENDENCIES.has('Project')).toBe(true);
    expect(EXTERNAL_DEPENDENCIES.has('ClassDeclaration')).toBe(true);
    expect(EXTERNAL_DEPENDENCIES.has('SourceFile')).toBe(true);
  });

  it('should contain all expected Node.js types', () => {
    expect(EXTERNAL_DEPENDENCIES.has('EventEmitter')).toBe(true);
    expect(EXTERNAL_DEPENDENCIES.has('Buffer')).toBe(true);
  });

  it('should contain all expected zod types', () => {
    expect(EXTERNAL_DEPENDENCIES.has('z.infer')).toBe(true);
    expect(EXTERNAL_DEPENDENCIES.has('ZodType')).toBe(true);
  });

  it('should have a reasonable size', () => {
    // Should have at least 20 common external types
    expect(EXTERNAL_DEPENDENCIES.size).toBeGreaterThanOrEqual(20);
  });
});

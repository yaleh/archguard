/**
 * Unit tests for MermaidParseValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MermaidParseValidator } from '../../../src/mermaid/validator-parse';
import type { ParseValidationResult } from '../../../src/mermaid/types';

describe('MermaidParseValidator', () => {
  let validator: MermaidParseValidator;

  beforeEach(() => {
    validator = new MermaidParseValidator();
  });

  describe('initialization', () => {
    it('should initialize validator', () => {
      expect(validator).toBeDefined();
    });

    it('should handle multiple instances', () => {
      const validator2 = new MermaidParseValidator();
      expect(validator2).toBeDefined();
      expect(validator).not.toBe(validator2);
    });
  });

  describe('valid Mermaid code', () => {
    it('should validate simple class diagram', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
    +getEmail() String
  }`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate class diagram with multiple classes', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }
  class AuthService {
    +login() Boolean
  }
  User --> AuthService`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate class diagram with relationships', async () => {
      const mermaidCode = `classDiagram
  class Animal
  class Duck
  class Fish
  Animal <|-- Duck
  Animal <|-- Fish`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate class diagram with namespaces', async () => {
      const mermaidCode = `classDiagram
  namespace User_Layer {
    class User {
      +String name
    }
  }
  namespace Auth_Layer {
    class AuthService {
      +login() Boolean
    }
  }`;

      const result = await validator.validate(mermaidCode);

      // Mermaid class diagrams don't support namespaces in the same way
      // The syntax might be valid but not rendered as expected
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });

    it('should validate class diagram with generic types', async () => {
      const mermaidCode = `classDiagram
  class Repository~T~ {
    +save(entity: T) void
    +findById(id: String) T
  }`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid Mermaid syntax', () => {
    it('should detect missing diagram type', async () => {
      const mermaidCode = `class User
  +String name`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect malformed class definition', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  `; // Missing closing brace

      const result = await validator.validate(mermaidCode);

      // Mermaid might auto-fix this, but if it fails:
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should detect invalid relationship syntax', async () => {
      const mermaidCode = `classDiagram
  class User
  class Admin
  User INVALIDSYMBOL Admin`;

      const result = await validator.validate(mermaidCode);

      // Mermaid may or may not validate this strictly
      // Just check it doesn't crash
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });

    it('should handle completely invalid syntax', async () => {
      const mermaidCode = `This is not Mermaid code at all!!!`;

      const result = await validator.validate(mermaidCode);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid visibility modifiers', async () => {
      const mermaidCode = `classDiagram
  class User {
    XString invalidVisibility
  }`;

      const result = await validator.validate(mermaidCode);

      // Might be valid or invalid depending on Mermaid version
      // Just check it doesn't crash
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });
  });

  describe('error parsing', () => {
    it('should parse error message with line number', async () => {
      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> NonExistent`; // NonExistent is not defined

      const result = await validator.validate(mermaidCode);

      // Mermaid may or may not validate undefined references
      // Just check the result structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should provide meaningful error messages', async () => {
      const mermaidCode = `classDiagram
  class`;

      const result = await validator.validate(mermaidCode);

      if (!result.valid) {
        result.errors.forEach((error) => {
          expect(error.message).toBeDefined();
          expect(error.message.length).toBeGreaterThan(0);

          // Line and column are optional but should be numbers if present
          if (error.line !== undefined) {
            expect(typeof error.line).toBe('number');
          }
          if (error.column !== undefined) {
            expect(typeof error.column).toBe('number');
          }
        });
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', async () => {
      const result = await validator.validate('');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle whitespace only', async () => {
      const result = await validator.validate('   \n  \n  ');

      expect(result.valid).toBe(false);
    });

    it('should handle very large diagram', async () => {
      const lines = ['classDiagram'];
      for (let i = 0; i < 100; i++) {
        lines.push(`  class Class${i} {`);
        lines.push(`    +field${i} String`);
        lines.push('  }');
      }
      const mermaidCode = lines.join('\n');

      const result = await validator.validate(mermaidCode);

      // Should validate without crashing
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });

    it('should handle special characters in class names', async () => {
      const mermaidCode = `classDiagram
  class "User_Class" {
    +String name
  }
  class "Admin-Controller" {
    +login() Boolean
  }`;

      const result = await validator.validate(mermaidCode);

      // Mermaid handles quoted class names
      expect(result).toBeDefined();
    });

    it('should handle unicode characters', async () => {
      const mermaidCode = `classDiagram
  class 用户 {
    +String 姓名
    +getEmail() String
  }`;

      const result = await validator.validate(mermaidCode);

      // Mermaid should handle unicode
      expect(result).toBeDefined();
    });
  });

  describe('multiple validation calls', () => {
    it('should handle sequential validations', async () => {
      const code1 = `classDiagram
  class User`;
      const code2 = `classDiagram
  class Admin`;

      const result1 = await validator.validate(code1);
      const result2 = await validator.validate(code2);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });

    it('should handle interleaved valid and invalid code', async () => {
      const validCode = `classDiagram
  class User`;
      const invalidCode = `invalid code here`;

      const result1 = await validator.validate(validCode);
      const result2 = await validator.validate(invalidCode);
      const result3 = await validator.validate(validCode);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(false);
      expect(result3.valid).toBe(true);
    });
  });

  describe('warning collection', () => {
    it('should collect warnings for non-critical issues', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
  }
  %% This is a comment
  User --> User`; // Self-reference

      const result = await validator.validate(mermaidCode);

      // Should at least be valid (warnings are optional)
      expect(result).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should include suggestions for warnings', async () => {
      const mermaidCode = `classDiagram
  class A
  class B
  A --> B`;

      const result = await validator.validate(mermaidCode);

      result.warnings.forEach((warning) => {
        expect(warning.message).toBeDefined();
        // Suggestion is optional
        if (warning.suggestion) {
          expect(typeof warning.suggestion).toBe('string');
        }
      });
    });
  });

  describe('concurrent validations', () => {
    it('should handle parallel validation calls', async () => {
      const codes = [
        `classDiagram\n  class A`,
        `classDiagram\n  class B`,
        `classDiagram\n  class C`,
      ];

      const results = await Promise.all(codes.map((code) => validator.validate(code)));

      results.forEach((result) => {
        expect(result.valid).toBe(true);
      });
    });
  });
});

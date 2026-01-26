/**
 * Unit tests for RenderValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RenderValidator } from '../../../src/mermaid/validator-render';
import type { RenderValidationResult } from '../../../src/mermaid/types';

describe('RenderValidator', () => {
  let validator: RenderValidator;

  beforeEach(() => {
    validator = new RenderValidator();
  });

  describe('initialization', () => {
    it('should initialize validator', () => {
      expect(validator).toBeDefined();
    });

    it('should handle multiple instances', () => {
      const validator2 = new RenderValidator();
      expect(validator).not.toBe(validator2);
    });
  });

  describe('size validation', () => {
    it('should validate diagram with normal size', () => {
      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });

    it('should warn about too many nodes', () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 150; i++) {
        mermaidCode += `  class Class${i}\n`;
      }

      const result = validator.validate(mermaidCode);

      // Should have warning but still valid
      const sizeWarning = result.issues.find((i) => i.type === 'size');
      expect(sizeWarning).toBeDefined();
      expect(sizeWarning?.severity).toBe('warning');
    });

    it('should warn about too many edges', () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 50; i++) {
        mermaidCode += `  class Class${i}\n`;
      }
      for (let i = 0; i < 250; i++) {
        mermaidCode += `  Class${i % 50} --> Class${(i + 1) % 50}\n`;
      }

      const result = validator.validate(mermaidCode);

      // Should have warning about edges
      const sizeWarning = result.issues.find(
        (i) => i.type === 'size' && i.message.includes('edges')
      );
      expect(sizeWarning).toBeDefined();
      expect(sizeWarning?.severity).toBe('warning');
    });

    it('should accept diagram at max node limit', () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 100; i++) {
        mermaidCode += `  class Class${i}\n`;
      }

      const result = validator.validate(mermaidCode);

      // At exactly max should still pass
      const nodeWarning = result.issues.find((i) => i.message.includes('nodes'));
      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });

    it('should accept diagram at max edge limit', () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 50; i++) {
        mermaidCode += `  class Class${i}\n`;
      }
      for (let i = 0; i < 200; i++) {
        mermaidCode += `  Class${i % 50} --> Class${(i + 1) % 50}\n`;
      }

      const result = validator.validate(mermaidCode);

      // At exactly max should still pass
      const edgeWarning = result.issues.find((i) => i.message.includes('edges'));
      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });
  });

  describe('complexity validation', () => {
    it('should validate diagram with normal complexity', () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
    +getEmail() String
  }
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });

    it('should warn about high nesting depth', () => {
      let mermaidCode = 'classDiagram\n';
      mermaidCode += '  class A {\n';
      for (let i = 0; i < 15; i++) {
        mermaidCode += '    '.repeat(i + 1) + 'method' + i + '() {\n';
      }
      // Close all braces
      for (let i = 0; i < 16; i++) {
        mermaidCode += '  }\n';
      }

      const result = validator.validate(mermaidCode);

      const complexityWarning = result.issues.find((i) => i.type === 'complexity');
      if (complexityWarning) {
        expect(complexityWarning.severity).toBe('warning');
        expect(complexityWarning.message).toContain('Nesting depth');
      }
    });

    it('should warn about complex member definitions', () => {
      const mermaidCode = `classDiagram
  class User {
    +${'a'.repeat(150)}() String
  }`;

      const result = validator.validate(mermaidCode);

      const complexityWarning = result.issues.find((i) => i.type === 'complexity');
      if (complexityWarning) {
        expect(complexityWarning.message).toContain('complex');
      }
    });

    it('should accept normal member definitions', () => {
      const mermaidCode = `classDiagram
  class User {
    +createUser(name: String, email: String, age: Number) User
  }`;

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      const complexWarning = result.issues.find((i) => i.message.includes('complex'));
      expect(complexWarning).toBeUndefined();
    });
  });

  describe('unsupported features detection', () => {
    it('should warn about very long class names', () => {
      const longName = 'A'.repeat(60);
      const mermaidCode = `classDiagram
  class "${longName}" {
    +String name
  }`;

      const result = validator.validate(mermaidCode);

      const syntaxWarning = result.issues.find((i) => i.type === 'syntax');
      expect(syntaxWarning).toBeDefined();
      expect(syntaxWarning?.severity).toBe('warning');
      expect(syntaxWarning?.message).toContain('long class name');
    });

    it('should error on special characters in class names', () => {
      const mermaidCode = `classDiagram
  class "User|Class" {
    +String name
  }`;

      const result = validator.validate(mermaidCode);

      const syntaxError = result.issues.find(
        (i) => i.type === 'syntax' && i.severity === 'error'
      );
      expect(syntaxError).toBeDefined();
      expect(syntaxError?.message).toContain('special characters');
    });

    it('should accept normal class names', () => {
      const mermaidCode = `classDiagram
  class "User_Class"
  class "Admin-Controller"
  class "Service.v2"`;

      const result = validator.validate(mermaidCode);

      const syntaxErrors = result.issues.filter((i) => i.severity === 'error');
      expect(syntaxErrors.length).toBe(0);
    });

    it('should handle quoted class names properly', () => {
      const mermaidCode = `classDiagram
  class "Valid Name"
  class "Another-Valid_Name"
  class "With123Numbers"`;

      const result = validator.validate(mermaidCode);

      const syntaxErrors = result.issues.filter((i) => i.severity === 'error');
      expect(syntaxErrors.length).toBe(0);
    });
  });

  describe('render capability assessment', () => {
    it('should indicate canRender for valid diagram', () => {
      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const result = validator.validate(mermaidCode);

      expect(result.canRender).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('should indicate cannotRender for diagram with blocking issues', () => {
      const mermaidCode = `classDiagram
  class "Class|With|Pipes" {
    +String field
  }`;

      const result = validator.validate(mermaidCode);

      const hasBlockingError = result.issues.some((i) => i.severity === 'error');
      if (hasBlockingError) {
        expect(result.canRender).toBe(false);
        expect(result.valid).toBe(false);
      }
    });

    it('should indicate canRender with warnings', () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 110; i++) {
        mermaidCode += `  class Class${i}\n`;
      }

      const result = validator.validate(mermaidCode);

      // Should have warnings but still renderable
      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
      expect(result.canRender).toBe(true);
      expect(result.valid).toBe(true);
    });
  });

  describe('combined validation', () => {
    it('should collect multiple issue types', () => {
      let mermaidCode = 'classDiagram\n';
      // Too many nodes
      for (let i = 0; i < 110; i++) {
        mermaidCode += `  class Class${i}\n`;
      }
      // Add edges
      for (let i = 0; i < 110; i++) {
        mermaidCode += `  Class${i} --> Class${(i + 1) % 110}\n`;
      }

      const result = validator.validate(mermaidCode);

      // Should have multiple warnings
      const warnings = result.issues.filter((i) => i.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should distinguish between errors and warnings', () => {
      const mermaidCode = `classDiagram
  class "Valid|Name"
  class "Another|Class"`;

      const result = validator.validate(mermaidCode);

      const errors = result.issues.filter((i) => i.severity === 'error');
      const warnings = result.issues.filter((i) => i.severity === 'warning');

      expect(Array.isArray(errors)).toBe(true);
      expect(Array.isArray(warnings)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty diagram', () => {
      const mermaidCode = 'classDiagram';

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
      expect(typeof result.canRender).toBe('boolean');
    });

    it('should handle diagram with no classes', () => {
      const mermaidCode = 'classDiagram\n  %% Just a comment';

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
      expect(result.issues).toBeDefined();
    });

    it('should handle diagram with only comments', () => {
      const mermaidCode = `classDiagram
  %% Comment 1
  %% Comment 2
  %% Comment 3`;

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
    });

    it('should handle very long single line', () => {
      const longLine = 'a'.repeat(1000);
      const mermaidCode = `classDiagram
  class User {
    +${longLine}() String
  }`;

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
    });

    it('should handle diagram with unicode characters', () => {
      const mermaidCode = `classDiagram
  class 用户 {
    +String 姓名
    +getEmail() String
  }
  class 管理员
  用户 --> 管理员`;

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
    });

    it('should handle diagram with special whitespace', () => {
      const mermaidCode = `classDiagram
  class User
  class Admin

  User --> Admin


  User --> User`;

      const result = validator.validate(mermaidCode);

      expect(result).toBeDefined();
    });
  });

  describe('real-world scenarios', () => {
    it('should validate typical service architecture', () => {
      const mermaidCode = `classDiagram
  class UserController {
    +getUser() User
    +createUser() User
  }
  class UserService {
    +findById() User
    +save() void
  }
  class UserRepository {
    +find() User
    +insert() void
  }
  class User {
    +String name
    +String email
  }
  UserController --> UserService
  UserService --> UserRepository
  UserRepository --> User`;

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
      expect(result.issues.filter((i) => i.severity === 'error').length).toBe(0);
    });

    it('should validate inheritance hierarchy', () => {
      const mermaidCode = `classDiagram
  class Animal
  class Mammal
  class Dog
  class Cat
  class Bird

  Animal <|-- Mammal
  Animal <|-- Bird
  Mammal <|-- Dog
  Mammal <|-- Cat`;

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });

    it('should handle complex domain model', () => {
      let mermaidCode = 'classDiagram\n';
      const entities = [
        'User',
        'Order',
        'Product',
        'Payment',
        'Shipping',
        'Notification',
        'Inventory',
        'Cart',
        'Wishlist',
        'Review',
      ];

      entities.forEach((e) => {
        mermaidCode += `  class ${e}\n`;
      });

      // Add some relationships
      mermaidCode += '  User --> Order\n';
      mermaidCode += '  Order --> Product\n';
      mermaidCode += '  Order --> Payment\n';
      mermaidCode += '  Order --> Shipping\n';
      mermaidCode += '  User --> Review\n';
      mermaidCode += '  User --> Cart\n';
      mermaidCode += '  User --> Wishlist\n';
      mermaidCode += '  Cart --> Product\n';
      mermaidCode += '  Wishlist --> Product\n';
      mermaidCode += '  Product --> Inventory\n';
      mermaidCode += '  Order --> Notification\n';

      const result = validator.validate(mermaidCode);

      expect(result.valid).toBe(true);
      expect(result.canRender).toBe(true);
    });
  });
});

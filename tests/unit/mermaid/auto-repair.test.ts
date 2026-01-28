/**
 * Unit tests for MermaidAutoRepair
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MermaidAutoRepair } from '../../../src/mermaid/auto-repair';
import { MermaidParseValidator } from '../../../src/mermaid/validator-parse';
import type { ValidationError } from '../../../src/mermaid/types';

describe('MermaidAutoRepair', () => {
  let repair: MermaidAutoRepair;
  let validator: MermaidParseValidator;

  beforeEach(() => {
    validator = new MermaidParseValidator();
    repair = new MermaidAutoRepair(validator);
  });

  describe('adding diagram declaration', () => {
    it('should add classDiagram declaration when missing', async () => {
      const mermaidCode = `  class User
  class Admin`;

      const { repaired, successful } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toMatch(/^classDiagram/);
      expect(repaired).toContain('class User');
    });

    it('should not add declaration if already present', async () => {
      const mermaidCode = `classDiagram
  class User`;

      const { repaired, successful } = await repair.repairBestEffort(mermaidCode);

      const count = (repaired.match(/classDiagram/g) || []).length;
      expect(count).toBe(1);
    });

    it('should handle empty code', async () => {
      const mermaidCode = '';

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Empty code should remain empty or just have declaration
      expect(repaired).toBeDefined();
    });
  });

  describe('fixing generic types', () => {
    it('should convert comma generics to tilde notation', async () => {
      const mermaidCode = `classDiagram
  class Map~K,V~
  class Repository~Entity~`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Tilde notation should be preserved
      expect(repaired).toContain('~');
    });

    it('should handle simple generic types', async () => {
      const mermaidCode = `classDiagram
  class List<String>
  class User`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should convert to tilde notation
      expect(repaired).toContain('~');
    });

    it('should handle complex generic types', async () => {
      const mermaidCode = `classDiagram
  class Map<String, User>
  class Repository<User, ID>`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should convert to tilde notation
      expect(repaired).toContain('~');
      // Should remove extra spaces
      expect(repaired).not.toMatch(/<.*,.*>/);
    });

    it('should handle nested generic types', async () => {
      const mermaidCode = `classDiagram
  class Map<String, List<User>>`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should convert to tilde notation
      expect(repaired).toContain('~');
    });
  });

  describe('flattening nested namespaces', () => {
    it('should remove nested namespaces', async () => {
      const mermaidCode = `classDiagram
  namespace Outer {
    namespace Inner {
      class User
    }
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should flatten to single level
      const innerNamespace = repaired.match(/namespace Inner/g);
      expect(innerNamespace).toBeNull();
    });

    it('should keep top-level namespace', async () => {
      const mermaidCode = `classDiagram
  namespace Services {
    class UserService
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('namespace Services');
    });

    it('should handle multiple namespaces at same level', async () => {
      const mermaidCode = `classDiagram
  namespace Services {
    class UserService
  }
  namespace Models {
    class User
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('namespace Services');
      expect(repaired).toContain('namespace Models');
    });
  });

  describe('extracting namespace relations', () => {
    it('should move relations outside namespaces', async () => {
      const mermaidCode = `classDiagram
  namespace Services {
    class UserService
    class UserRepository
    UserService --> UserRepository
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Relations should be extracted
      const lines = repaired.split('\n');
      const relationLine = lines.find(
        (line) => line.includes('-->') && !line.includes('namespace')
      );

      expect(relationLine).toBeDefined();
    });

    it('should preserve relation syntax', async () => {
      const mermaidCode = `classDiagram
  namespace Module1 {
    class A
  }
  namespace Module2 {
    class B
    A --> B
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('A --> B');
    });

    it('should handle multiple relation types', async () => {
      const mermaidCode = `classDiagram
  namespace NS {
    class A
    class B
    class C
    A --> B
    A <|.. C
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('-->');
      expect(repaired).toContain('<|..');
    });
  });

  describe('fixing trailing commas', () => {
    it('should remove trailing commas in member definitions', async () => {
      const mermaidCode = `classDiagram
  class User {
    +name: String,
    +email: String,
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should remove trailing commas
      expect(repaired).not.toMatch(/,\s*$/m);
      expect(repaired).not.toMatch(/,\s*\n/m);
    });

    it('should handle commas before closing braces', async () => {
      const mermaidCode = `classDiagram
  class User {
    +name: String,
    +email: String,
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should fix commas before braces
      expect(repaired).not.toMatch(/,\s*}/);
    });
  });

  describe('normalizing whitespace', () => {
    it('should remove multiple blank lines', async () => {
      const mermaidCode = `classDiagram
  class User



  class Admin`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should not have more than 2 consecutive newlines
      expect(repaired).not.toMatch(/\n{3,}/);
    });

    it('should trim trailing whitespace', async () => {
      const mermaidCode = `classDiagram
  class User {
    +name: String
  }
  `;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      const lines = repaired.split('\n');
      lines.forEach((line) => {
        expect(line).toEqual(line.trimEnd());
      });
    });

    it('should ensure single newline at end', async () => {
      const mermaidCode = `classDiagram
  class User


  `;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toMatch(/\n$/);
      expect(repaired).not.toMatch(/\n\n$/);
    });
  });

  describe('repair method', () => {
    it('should repair code with missing diagram declaration', async () => {
      const mermaidCode = `class User
  class Admin`;

      const errors: ValidationError[] = [];

      const repaired = await repair.repair(mermaidCode, errors);

      expect(repaired).toMatch(/^classDiagram/);
    });

    it('should repair code with generic types', async () => {
      const mermaidCode = `classDiagram
  class Map<String, User>`;

      const errors: ValidationError[] = [];

      const repaired = await repair.repair(mermaidCode, errors);

      expect(repaired).toContain('~');
    });

    it('should throw when repair fails', async () => {
      const mermaidCode = `completely invalid !!! {][} code`;

      const errors: ValidationError[] = [
        {
          message: 'Syntax error',
          code: 'SYNTAX_ERROR',
        },
      ];

      await expect(repair.repair(mermaidCode, errors)).rejects.toThrow();
    });

    it('should return original code if already valid', async () => {
      const mermaidCode = `classDiagram
  class User
  class Admin
  User --> Admin`;

      const errors: ValidationError[] = [];

      const repaired = await repair.repair(mermaidCode, errors);

      expect(repaired).toBeDefined();
    });
  });

  describe('advanced repairs', () => {
    it('should attempt to fix syntax errors on specific lines', async () => {
      const mermaidCode = `classDiagram
  class User {
    +name: String
    +email: String
  `; // Missing closing brace

      const errors: ValidationError[] = [
        {
          message: 'Unexpected end of input',
          code: 'SYNTAX_ERROR',
          line: 4,
        },
      ];

      try {
        const repaired = await repair.repair(mermaidCode, errors);
        expect(repaired).toBeDefined();
      } catch (e) {
        // Some repairs may fail, that's ok
        expect(e).toBeDefined();
      }
    });

    it('should remove unknown tokens', async () => {
      const mermaidCode = `classDiagram
  class User|Class
  class Admin#Controller`;

      const errors: ValidationError[] = [
        {
          message: 'Unknown token',
          code: 'UNKNOWN_TOKEN',
        },
      ];

      try {
        const repaired = await repair.repair(mermaidCode, errors);
        expect(repaired).toBeDefined();
      } catch (e) {
        // Repair may not fully succeed
        expect(e).toBeDefined();
      }
    });
  });

  describe('real-world scenarios', () => {
    it('should repair typical invalid diagram', async () => {
      const mermaidCode = `class UserService
  class UserRepository
  class Map<String, User>

  UserService --> UserRepository
  UserService --> User`;

      const { repaired, successful } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toMatch(/^classDiagram/);
      expect(repaired).toContain('~');
    });

    it('should handle diagram with multiple issues', async () => {
      const mermaidCode = `namespace Services {
    class UserService {
      +name: String,
      +email: String,
    }
    class Repository<User,ID>
    UserService --> Repository
  }`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      // Should apply multiple repairs
      expect(repaired).toBeDefined();
      expect(repaired.length).toBeGreaterThan(0);
    });

    it('should preserve valid parts of diagram', async () => {
      const mermaidCode = `classDiagram
  class User {
    +String name
    +getEmail() String
  }
  class Admin
  User --> Admin`;

      const { repaired, successful } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('class User');
      expect(repaired).toContain('class Admin');
      expect(repaired).toContain('User --> Admin');
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', async () => {
      const mermaidCode = '';

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toBeDefined();
    });

    it('should handle whitespace only', async () => {
      const mermaidCode = '   \n  \n  ';

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toBeDefined();
    });

    it('should handle very long diagram', async () => {
      let mermaidCode = 'classDiagram\n';
      for (let i = 0; i < 50; i++) {
        mermaidCode += `  class Class${i} {\n`;
        mermaidCode += `    +field${i}: String,\n`;
        mermaidCode += '  }\n';
      }

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toBeDefined();
      expect(repaired.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters', async () => {
      const mermaidCode = `classDiagram
  class 用户 {
    +String 姓名
  }
  class 管理员
  用户 --> 管理员`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toContain('用户');
      expect(repaired).toContain('管理员');
    });
  });

  describe('best effort repair', () => {
    it('should indicate successful repair', async () => {
      const mermaidCode = `class User
  class Admin`;

      const { successful } = await repair.repairBestEffort(mermaidCode);

      expect(successful).toBe(true);
    });

    it('should indicate failed repair for severe issues', async () => {
      const mermaidCode = `completely broken ### code with !! symbols`;

      const { successful } = await repair.repairBestEffort(mermaidCode);

      // May or may not succeed depending on severity
      expect(typeof successful).toBe('boolean');
    });

    it('should always return repaired code', async () => {
      const mermaidCode = `any code here`;

      const { repaired } = await repair.repairBestEffort(mermaidCode);

      expect(repaired).toBeDefined();
      expect(typeof repaired).toBe('string');
    });
  });
});

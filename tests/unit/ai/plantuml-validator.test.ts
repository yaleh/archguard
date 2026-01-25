/**
 * Unit tests for PlantUMLValidator
 */

import { describe, it, expect } from 'vitest';
import { PlantUMLValidator } from '../../../src/ai/plantuml-validator';
import { ArchJSON } from '../../../src/types';

describe('PlantUMLValidator', () => {
  const validator = new PlantUMLValidator();

  describe('syntax validation', () => {
    it('should validate correct syntax', () => {
      const puml = `
@startuml
class User
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing @startuml', () => {
      const puml = `
class User
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing @startuml');
    });

    it('should detect missing @enduml', () => {
      const puml = `
@startuml
class User
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing @enduml');
    });

    it('should detect duplicate class keyword', () => {
      const puml = `
@startuml
class class User
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Duplicate "class" keyword');
    });

    it('should accept interfaces', () => {
      const puml = `
@startuml
interface IUser
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(true);
    });

    it('should accept enums', () => {
      const puml = `
@startuml
enum Status
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(true);
    });
  });

  describe('completeness validation', () => {
    it('should verify all entities are present', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 5, endLine: 7 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
class User
class Admin
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.missingEntities).toHaveLength(0);
    });

    it('should detect missing entities', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 5, endLine: 7 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
class User
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.missingEntities).toContain('Admin');
    });

    it('should handle interfaces correctly', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'IUser',
            name: 'IUser',
            type: 'interface',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
interface IUser
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(true);
    });

    it('should handle enums correctly', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'Status',
            name: 'Status',
            type: 'enum',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
enum Status
@enduml
      `;

      const result = validator.validateCompleteness(puml, archJson);

      expect(result.isValid).toBe(true);
    });
  });

  describe('style validation', () => {
    it('should suggest theme when missing', () => {
      const puml = `
@startuml
class User
@enduml
      `;

      const result = validator.validateStyle(puml);

      expect(result.isValid).toBe(true); // Style issues don't block
      expect(result.warnings).toContain('Consider adding a theme (!theme cerulean-outline)');
    });

    it('should accept theme when present', () => {
      const puml = `
@startuml
!theme cerulean-outline
class User
@enduml
      `;

      const result = validator.validateStyle(puml);

      expect(result.warnings).not.toContain('Consider adding a theme (!theme cerulean-outline)');
    });

    it('should suggest packages when missing', () => {
      const puml = `
@startuml
class User
class Admin
@enduml
      `;

      const result = validator.validateStyle(puml);

      expect(result.warnings).toContain('Consider grouping classes with packages');
    });

    it('should accept packages when present', () => {
      const puml = `
@startuml
package "domain" {
  class User
}
@enduml
      `;

      const result = validator.validateStyle(puml);

      expect(result.warnings).not.toContain('Consider grouping classes with packages');
    });
  });

  describe('full validation', () => {
    it('should perform complete validation', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
!theme cerulean-outline
class User
@enduml
      `;

      const result = validator.validate(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should report all issues', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 5, endLine: 7 },
          },
        ],
        relations: [],
      };

      const puml = `
class User
      `;

      const result = validator.validate(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      // Should have syntax errors and missing entity
      expect(result.issues.some((i) => i.includes('@startuml'))).toBe(true);
      expect(result.issues.some((i) => i.includes('Admin'))).toBe(true);
    });

    it('should pass with perfect PlantUML', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const puml = `
@startuml
!theme cerulean-outline

package "domain" {
  class User
}

@enduml
      `;

      const result = validator.validate(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty PlantUML', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      const result = validator.validate('', archJson);

      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should handle empty ArchJSON', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      const puml = `
@startuml
!theme cerulean-outline
@enduml
      `;

      const result = validator.validate(puml, archJson);

      expect(result.isValid).toBe(true);
    });

    it('should handle whitespace variations', () => {
      const puml = `

      @startuml


      class User


      @enduml

      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(true);
    });
  });
});

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

    it('should reject entity declarations with generic names', () => {
      const puml = `
@startuml
class "Map<string, string>" as TemplateCache
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors?.some((err) => err.includes('Invalid entity declaration'))).toBe(true);
    });

    it('should reject relationship endpoints with generic names', () => {
      const puml = `
@startuml
class PromptTemplateManager
PromptTemplateManager *-- "Map<string, string>" as TemplateCache
@enduml
      `;

      const result = validator.validateSyntax(puml);

      expect(result.isValid).toBe(false);
      expect(result.errors?.some((err) => err.includes('Invalid relationship endpoint'))).toBe(true);
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

  describe('relationship reference validation', () => {
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
        {
          id: 'IUserRepository',
          name: 'IUserRepository',
          type: 'interface',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 9, endLine: 11 },
        },
      ],
      relations: [],
    };

    it('should pass when all relationships reference defined entities', () => {
      const puml = `
@startuml
class User
class Admin
interface IUserRepository

Admin --|> User
Admin ..|> IUserRepository
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.undefinedReferences).toHaveLength(0);
    });

    it('should detect reference to undefined external type', () => {
      const puml = `
@startuml
class User
class Admin

Admin --|> User
Admin *-- CustomError
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.undefinedReferences?.length).toBeGreaterThan(0);
      expect(result.undefinedReferences?.some((ref) => ref.includes('CustomError'))).toBe(true);
    });

    it('should detect reference to external library type', () => {
      const puml = `
@startuml
class User

User *-- CustomLibrary
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.undefinedReferences?.some((ref) => ref.includes('CustomLibrary'))).toBe(true);
    });

    it('should detect reference to generic type parameter', () => {
      const puml = `
@startuml
class CacheManager

CacheManager ..> T : dependency
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true); // T is in whitelist
    });

    it('should detect reference to Anthropic external type', () => {
      const puml = `
@startuml
class ClaudeConnector

ClaudeConnector *-- Anthropic
ClaudeConnector *-- Anthropic.Message
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true); // Anthropic is in whitelist
    });

    it('should detect reference to Ora external package', () => {
      const puml = `
@startuml
class ProgressReporter

ProgressReporter *-- Ora
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true); // Ora is in whitelist
    });

    it('should ignore built-in types', () => {
      const puml = `
@startuml
class User {
  +name: string
  +age: number
}
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true);
    });

    it('should handle complex relationship syntax', () => {
      const puml = `
@startuml
class User
class Admin
interface IUserRepository

Admin --|> User : extends
Admin ..|> IUserRepository : implements
User --> IUserRepository : uses
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true);
    });

    it('should detect multiple undefined references', () => {
      const puml = `
@startuml
class User

User *-- ExternalType1
User --> ExternalType2
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.undefinedReferences?.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle qualified names correctly', () => {
      const puml = `
@startuml
class User

User *-- "Map<string, string>"
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true); // Map is cleaned and ignored
    });

    it('should recognize external types with <<external>> stereotype', () => {
      const puml = `
@startuml
package "Types (External)" {
  class ArchJSON <<external>>
  class Entity <<external>>
  class Relation <<external>>
}

package "Parser Layer" {
  class TypeScriptParser
  class ClassExtractor
}

TypeScriptParser --> ArchJSON : "produces"
ClassExtractor --> Entity : "extracts"
ClassExtractor --> Relation : "uses"
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.undefinedReferences).toHaveLength(0);
    });

    it('should recognize mixed internal and external types', () => {
      const puml = `
@startuml
class User
class Admin

package "External Dependencies" {
  class ArchJSON <<external>>
  interface Config <<external>>
}

Admin --|> User
Admin --> ArchJSON : "uses"
User --> Config : "loads"
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(true);
      expect(result.undefinedReferences).toHaveLength(0);
    });

    it('should still detect undefined types even when some are marked as external', () => {
      const puml = `
@startuml
class User

package "External" {
  class ValidExternal <<external>>
}

User --> ValidExternal : "ok"
User --> UndefinedType : "error"
@enduml
      `;

      const result = validator.validateRelationshipReferences(puml, archJson);

      expect(result.isValid).toBe(false);
      expect(result.undefinedReferences?.some((ref) => ref.includes('UndefinedType'))).toBe(true);
      expect(result.undefinedReferences?.some((ref) => ref.includes('ValidExternal'))).toBe(false);
    });
  });
});

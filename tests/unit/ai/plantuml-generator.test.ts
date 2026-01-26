/**
 * Unit tests for PlantUMLGenerator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlantUMLGenerator } from '../../../src/ai/plantuml-generator';
import { ArchJSON } from '../../../src/types';
import { DetailLevel } from '../../../src/types/config';

describe('PlantUMLGenerator', () => {
  describe('initialization', () => {
    it('should initialize without API key', () => {
      const generator = new PlantUMLGenerator({});

      expect(generator).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const generator = new PlantUMLGenerator({
        model: 'claude-opus-4-5-20251101',
        maxRetries: 5,
        timeout: 60000,
      });

      expect(generator).toBeDefined();
    });

    it('should accept empty config', () => {
      const generator = new PlantUMLGenerator();

      expect(generator).toBeDefined();
    });
  });

  describe('generate with mocked ClaudeCodeWrapper', () => {
    it('should generate PlantUML for simple class', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
!theme cerulean-outline
class User
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      const puml = await generator.generate(archJson);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('class User');
      expect(puml).toContain('@enduml');
      expect(mockWrapper.generatePlantUML).toHaveBeenCalledWith(archJson, undefined, 'class');
    });

    it('should pass previousPuml to wrapper when provided', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      const previousPuml = '@startuml\nclass OldUser\n@enduml';
      const puml = await generator.generate(archJson, previousPuml);

      expect(puml).toContain('@startuml');
      expect(mockWrapper.generatePlantUML).toHaveBeenCalledWith(archJson, previousPuml, 'class');
    });

    it('should handle wrapper errors', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockRejectedValue(new Error('CLI not found')),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      await expect(generator.generate(archJson)).rejects.toThrow('CLI not found');
    });

    it('should include all entities in generated PlantUML', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
!theme cerulean-outline
class User
class Admin
interface IRepository
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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
            id: 'IRepository',
            name: 'IRepository',
            type: 'interface',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 9, endLine: 11 },
          },
        ],
        relations: [],
      };

      const puml = await generator.generate(archJson);

      expect(puml).toContain('User');
      expect(puml).toContain('Admin');
      expect(puml).toContain('IRepository');
    });
  });

  describe('validation', () => {
    it('should validate PlantUML output with PlantUMLValidator', async () => {
      // Mock wrapper to return invalid PlantUML (missing @enduml)
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      // Should throw validation error
      await expect(generator.generate(archJson)).rejects.toThrow('Validation failed');
    });

    it('should check that all entities are present in PlantUML', async () => {
      // Mock wrapper to return PlantUML missing one entity
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      // Should throw validation error for missing Admin entity
      await expect(generator.generate(archJson)).rejects.toThrow('Validation failed');
    });
  });

  describe('detail level parameter', () => {
    it('should pass level parameter to wrapper in generate()', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      const level: DetailLevel = 'method';
      await generator.generate(archJson, undefined, level);

      expect(mockWrapper.generatePlantUML).toHaveBeenCalledWith(archJson, undefined, level);
    });

    it('should pass level parameter to wrapper in generateAndRender()', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
@enduml
`),
      };

      const mockRenderer = {
        render: vi.fn().mockResolvedValue(undefined),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;
      // @ts-ignore - inject mock for testing
      generator.renderer = mockRenderer;

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

      const pathResolution = {
        name: 'test',
        paths: {
          puml: '/tmp/test.puml',
          png: '/tmp/test.png',
          svg: '/tmp/test.svg',
        },
      };

      const level: DetailLevel = 'package';
      await generator.generateAndRender(archJson, pathResolution, level);

      expect(mockWrapper.generatePlantUML).toHaveBeenCalledWith(archJson, undefined, level);
    });

    it('should use class level by default if not specified', async () => {
      const mockWrapper = {
        generatePlantUML: vi.fn().mockResolvedValue(`@startuml
class User
@enduml
`),
      };

      const generator = new PlantUMLGenerator({});
      // @ts-ignore - inject mock for testing
      generator.wrapper = mockWrapper;

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

      await generator.generate(archJson);

      // Should use 'class' as default level
      expect(mockWrapper.generatePlantUML).toHaveBeenCalledWith(archJson, undefined, 'class');
    });
  });
});

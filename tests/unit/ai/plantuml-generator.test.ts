/**
 * Unit tests for PlantUMLGenerator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlantUMLGenerator } from '../../../src/ai/plantuml-generator';
import { ArchJSON } from '../../../src/types';

describe('PlantUMLGenerator', () => {
  describe('initialization', () => {
    it('should initialize with API key', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });

      expect(generator).toBeDefined();
    });

    it('should throw error without API key', () => {
      expect(() => new PlantUMLGenerator({ apiKey: '' })).toThrow();
    });

    it('should accept custom configuration', () => {
      const generator = new PlantUMLGenerator({
        apiKey: 'test-api-key',
        model: 'claude-opus-4-5-20251101',
        maxRetries: 5,
      });

      expect(generator).toBeDefined();
    });
  });

  describe('PlantUML extraction', () => {
    it('should extract PlantUML from markdown code block', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      const response = `
Here's the PlantUML diagram:

\`\`\`plantuml
@startuml
class User
@enduml
\`\`\`
      `;

      const puml = generator.extractPlantUML(response);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('class User');
      expect(puml).toContain('@enduml');
      expect(puml).not.toContain('```');
    });

    it('should extract PlantUML without language specifier', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      const response = `
\`\`\`
@startuml
interface IUser
@enduml
\`\`\`
      `;

      const puml = generator.extractPlantUML(response);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('interface IUser');
      expect(puml).toContain('@enduml');
    });

    it('should extract raw PlantUML when no code block', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      const response = `
@startuml
!theme cerulean-outline
class User
@enduml
      `;

      const puml = generator.extractPlantUML(response);

      expect(puml).toContain('@startuml');
      expect(puml).toContain('class User');
      expect(puml).toContain('@enduml');
    });

    it('should handle multiple code blocks', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      const response = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`plantuml
@startuml
class User
@enduml
\`\`\`
      `;

      const puml = generator.extractPlantUML(response);

      expect(puml).toContain('@startuml');
      expect(puml).not.toContain('const x = 1');
    });

    it('should trim whitespace', () => {
      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      const response = `

      @startuml
      class User
      @enduml

      `;

      const puml = generator.extractPlantUML(response);

      expect(puml.startsWith('@startuml')).toBe(true);
      expect(puml.endsWith('@enduml')).toBe(true);
    });
  });

  describe('generate with mocked API', () => {
    it('should generate PlantUML for simple class', async () => {
      const mockConnector = {
        chat: vi.fn().mockResolvedValue({
          text: `
\`\`\`plantuml
@startuml
!theme cerulean-outline
class User
@enduml
\`\`\`
          `,
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      };

      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

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
      expect(mockConnector.chat).toHaveBeenCalled();
    });

    it('should retry on validation failure', async () => {
      let callCount = 0;
      const mockConnector = {
        chat: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First call - invalid PlantUML (missing @enduml)
            return {
              text: '@startuml\nclass User',
              usage: { inputTokens: 100, outputTokens: 20 },
            };
          } else {
            // Second call - valid PlantUML
            return {
              text: '@startuml\nclass User\n@enduml',
              usage: { inputTokens: 100, outputTokens: 30 },
            };
          }
        }),
      };

      const generator = new PlantUMLGenerator({
        apiKey: 'test-api-key',
        maxRetries: 3,
      });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

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
      expect(puml).toContain('@enduml');
      expect(callCount).toBe(2);
    });

    it('should fail after max retries', async () => {
      const mockConnector = {
        chat: vi.fn().mockResolvedValue({
          text: 'Invalid PlantUML', // No @startuml or @enduml
          usage: { inputTokens: 100, outputTokens: 10 },
        }),
      };

      const generator = new PlantUMLGenerator({
        apiKey: 'test-api-key',
        maxRetries: 2,
      });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      await expect(generator.generate(archJson)).rejects.toThrow(
        'Failed to generate PlantUML after'
      );
      expect(mockConnector.chat).toHaveBeenCalledTimes(2);
    });

    it('should handle API errors', async () => {
      const mockConnector = {
        chat: vi
          .fn()
          .mockRejectedValue(new Error('API authentication failed')),
      };

      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      };

      await expect(generator.generate(archJson)).rejects.toThrow();
    });

    it('should include all entities in generated PlantUML', async () => {
      const mockConnector = {
        chat: vi.fn().mockResolvedValue({
          text: `
@startuml
!theme cerulean-outline
class User
class Admin
interface IRepository
@enduml
          `,
          usage: { inputTokens: 200, outputTokens: 80 },
        }),
      };

      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

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

  describe('usage tracking', () => {
    it('should track token usage', async () => {
      const mockConnector = {
        chat: vi.fn().mockResolvedValue({
          text: '@startuml\nclass User\n@enduml',
          usage: { inputTokens: 150, outputTokens: 60 },
        }),
      };

      const generator = new PlantUMLGenerator({ apiKey: 'test-api-key' });
      // @ts-ignore - inject mock for testing
      generator.connector = mockConnector;

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

      const usage = generator.getLastUsage();
      expect(usage).toBeDefined();
      expect(usage?.inputTokens).toBe(150);
      expect(usage?.outputTokens).toBe(60);
    });
  });
});

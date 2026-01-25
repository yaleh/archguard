/**
 * Unit tests for PromptBuilder
 */

import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompt-builder';
import { ArchJSON, Entity, Relation } from '../../../src/types';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  describe('basic prompt construction', () => {
    it('should build prompt for simple class', () => {
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
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 5 },
          },
        ],
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      expect(prompt).toContain('PlantUML');
      expect(prompt).toContain('User');
      expect(prompt).toContain('@startuml');
      expect(prompt).toContain('@enduml');
    });

    it('should include class with members', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['service.ts'],
        entities: [
          {
            id: 'UserService',
            name: 'UserService',
            type: 'class',
            visibility: 'public',
            members: [
              {
                name: 'findUser',
                type: 'method',
                visibility: 'public',
                parameters: [{ name: 'id', type: 'string', isOptional: false }],
                returnType: 'User',
              },
              {
                name: 'users',
                type: 'property',
                visibility: 'private',
                fieldType: 'User[]',
              },
            ],
            sourceLocation: { file: 'service.ts', startLine: 1, endLine: 15 },
          },
        ],
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      expect(prompt).toContain('UserService');
      expect(prompt).toContain('findUser');
      expect(prompt).toContain('users');
    });

    it('should include relationships', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'Admin',
            name: 'Admin',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 5 },
          },
          {
            id: 'User',
            name: 'User',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 7, endLine: 12 },
          },
        ],
        relations: [
          {
            id: 'rel1',
            type: 'inheritance',
            source: 'Admin',
            target: 'User',
          },
        ],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      expect(prompt).toContain('Admin');
      expect(prompt).toContain('User');
      expect(prompt).toContain('inheritance');
    });
  });

  describe('few-shot examples', () => {
    it('should include few-shot examples in prompt', () => {
      const simpleArchJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'Test',
            name: 'Test',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(simpleArchJson);

      expect(prompt).toContain('Here are examples');
      expect(prompt).toMatch(/Example \d+:/);
      expect(prompt).toContain('Input:');
      expect(prompt).toContain('Output:');
    });

    it('should include example with inheritance', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('extends');
      expect(prompt).toContain('--|>');
    });

    it('should include example with interface implementation', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('interface');
      expect(prompt).toContain('implements');
      expect(prompt).toContain('..|>');
    });
  });

  describe('output constraints', () => {
    it('should specify PlantUML syntax requirements', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('Requirements:');
      expect(prompt).toContain('valid PlantUML syntax');
      expect(prompt).toContain('@startuml');
      expect(prompt).toContain('@enduml');
    });

    it('should specify visibility modifiers', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('public');
      expect(prompt).toContain('private');
      expect(prompt).toContain('protected');
    });

    it('should specify theme requirement', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('!theme');
      expect(prompt).toContain('cerulean-outline');
    });

    it('should specify relationship arrows', () => {
      const prompt = builder.buildClassDiagramPrompt({
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: [],
        entities: [],
        relations: [],
      });

      expect(prompt).toContain('--|>'); // inheritance
      expect(prompt).toContain('..|>'); // implementation
      expect(prompt).toContain('--*'); // composition
      expect(prompt).toContain('-->'); // dependency
    });
  });

  describe('system prompt', () => {
    it('should include system prompt context', () => {
      const prompt = builder.getSystemPrompt();

      expect(prompt).toContain('software architect');
      expect(prompt).toContain('PlantUML');
      expect(prompt).toBeTruthy();
    });

    it('should specify quality standards', () => {
      const prompt = builder.getSystemPrompt();

      expect(prompt.toLowerCase()).toContain('quality');
      expect(prompt.toLowerCase()).toContain('syntax');
    });
  });

  describe('prompt optimization', () => {
    it('should handle large architecture gracefully', () => {
      const entities: Entity[] = [];
      for (let i = 0; i < 50; i++) {
        entities.push({
          id: `Class${i}`,
          name: `Class${i}`,
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: i, endLine: i + 1 },
        });
      }

      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities,
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      // Should not throw and should contain all classes
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Class0');
      expect(prompt).toContain('Class49');
    });

    it('should handle entities with no members', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'EmptyClass',
            name: 'EmptyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 2 },
          },
        ],
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      expect(prompt).toContain('EmptyClass');
    });
  });

  describe('JSON serialization', () => {
    it('should properly serialize ArchJSON in prompt', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2026-01-25',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'TestClass',
            name: 'TestClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 3 },
          },
        ],
        relations: [],
      };

      const prompt = builder.buildClassDiagramPrompt(archJson);

      // Should contain valid JSON
      expect(prompt).toContain('"version": "1.0"');
      expect(prompt).toContain('"language": "typescript"');
      expect(prompt).toContain('"TestClass"');
    });
  });
});

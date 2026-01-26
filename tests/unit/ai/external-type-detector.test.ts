/**
 * Unit tests for ExternalTypeDetector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExternalTypeDetector } from '@/ai/external-type-detector';
import type { ArchJSON } from '@/types';

describe('ExternalTypeDetector', () => {
  let detector: ExternalTypeDetector;

  beforeEach(() => {
    detector = new ExternalTypeDetector();
  });

  describe('detect()', () => {
    it('should detect external types from relations', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['parser.ts'],
        entities: [
          {
            id: '1',
            name: 'TypeScriptParser',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'parser.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'TypeScriptParser',
            target: 'ArchJSON', // External type
          },
          {
            id: '2',
            type: 'dependency',
            source: 'TypeScriptParser',
            target: 'Entity', // External type
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toContain('ArchJSON');
      expect(result.map((r) => r.name)).toContain('Entity');
    });

    it('should not include defined entities as external', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['parser.ts'],
        entities: [
          {
            id: '1',
            name: 'ClassA',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'parser.ts', startLine: 1, endLine: 10 },
          },
          {
            id: '2',
            name: 'ClassB',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'parser.ts', startLine: 11, endLine: 20 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'ClassA',
            target: 'ClassB', // Not external, defined in entities
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(0);
    });

    it('should filter out built-in types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'Promise', // Built-in, should be filtered
          },
          {
            id: '2',
            type: 'dependency',
            source: 'MyClass',
            target: 'EventEmitter', // Built-in, should be filtered
          },
          {
            id: '3',
            type: 'dependency',
            source: 'MyClass',
            target: 'Project', // ts-morph type, should be filtered
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(0);
    });

    it('should track which entities reference external types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'ParserA',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
          {
            id: '2',
            name: 'ParserB',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 11, endLine: 20 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'ParserA',
            target: 'ArchJSON',
          },
          {
            id: '2',
            type: 'dependency',
            source: 'ParserB',
            target: 'ArchJSON',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      const archJSONRef = result.find((r) => r.name === 'ArchJSON');
      expect(archJSONRef?.referencedBy).toContain('ParserA');
      expect(archJSONRef?.referencedBy).toContain('ParserB');
    });

    it('should detect external types from both source and target', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'Entity', // External in source
            target: 'MyClass',
          },
          {
            id: '2',
            type: 'dependency',
            source: 'MyClass',
            target: 'Relation', // External in target
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toContain('Entity');
      expect(result.map((r) => r.name)).toContain('Relation');
    });
  });

  describe('inferType()', () => {
    it('should infer interface for types ending with Options', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'ParserOptions', // Should be inferred as interface
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('interface');
    });

    it('should infer interface for types ending with Config', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'AppConfig',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('interface');
    });

    it('should infer class for regular types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'ArchJSON',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('class');
    });
  });

  describe('inferPackage()', () => {
    it('should infer "Types" package for ArchJSON type', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'ArchJSON',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].package).toBe('Types');
    });

    it('should infer "Types" package for Entity, Relation, Member types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'Entity',
          },
          {
            id: '2',
            type: 'dependency',
            source: 'MyClass',
            target: 'Relation',
          },
          {
            id: '3',
            type: 'dependency',
            source: 'MyClass',
            target: 'Member',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(3);
      result.forEach((ref) => {
        expect(ref.package).toBe('Types');
      });
    });

    it('should return undefined for unknown types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'UnknownType',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].package).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty relations', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(0);
    });

    it('should handle empty entities', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: [],
        entities: [],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'ExternalA',
            target: 'ExternalB',
          },
        ],
      };

      const result = detector.detect(archJson);

      // Both should be detected as external
      expect(result).toHaveLength(2);
    });

    it('should deduplicate external types', () => {
      const archJson: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: '2024-01-01',
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: '1',
            name: 'MyClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
          },
        ],
        relations: [
          {
            id: '1',
            type: 'dependency',
            source: 'MyClass',
            target: 'ArchJSON',
          },
          {
            id: '2',
            type: 'dependency',
            source: 'MyClass',
            target: 'ArchJSON', // Duplicate
          },
          {
            id: '3',
            type: 'dependency',
            source: 'ArchJSON', // Also references ArchJSON
            target: 'MyClass',
          },
        ],
      };

      const result = detector.detect(archJson);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ArchJSON');
    });
  });
});

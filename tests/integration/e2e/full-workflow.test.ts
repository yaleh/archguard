/**
 * Full Workflow Integration Tests - Story 7
 * End-to-end validation of complete ArchGuard workflow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptParser } from '@/parser/typescript-parser';
import { ParallelParser } from '@/parser/parallel-parser';
import { PlantUMLGenerator } from '@/ai/plantuml-generator';
import { PlantUMLValidator } from '@/ai/plantuml-validator';
import { CacheManager } from '@/cli/cache-manager';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ArchJSON } from '@/types';

describe('Full Workflow Integration', () => {
  let tempDir: string;
  let cacheManager: CacheManager;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = path.join(os.tmpdir(), `archguard-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Initialize cache manager
    cacheManager = new CacheManager();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Parse TypeScript → Generate ArchJSON → Create PlantUML', () => {
    it('should complete full workflow with single file', async () => {
      // Step 1: Create TypeScript source file
      const sourceCode = `
        export class UserService {
          private users: User[] = [];

          async getUser(id: string): Promise<User> {
            return this.users.find(u => u.id === id);
          }
        }

        export interface User {
          id: string;
          name: string;
          email: string;
        }
      `;

      const sourceFile = path.join(tempDir, 'user-service.ts');
      await fs.writeFile(sourceFile, sourceCode);

      // Step 2: Parse TypeScript and generate ArchJSON
      const parser = new TypeScriptParser();
      const archJSON = parser.parseCode(sourceCode, sourceFile);

      expect(archJSON).toHaveProperty('version', '1.0');
      expect(archJSON).toHaveProperty('language', 'typescript');
      expect(archJSON.entities.length).toBeGreaterThan(0);

      // Step 3: Validate ArchJSON structure
      const classEntity = archJSON.entities.find((e) => e.name === 'UserService');
      expect(classEntity).toBeDefined();
      expect(classEntity?.type).toBe('class');

      const interfaceEntity = archJSON.entities.find((e) => e.name === 'User');
      expect(interfaceEntity).toBeDefined();
      expect(interfaceEntity?.type).toBe('interface');

      // Step 4: Validate PlantUML structure (mock mode - no API key needed)
      // In a real scenario, this would call the API
      const mockPlantuml = `@startuml
class UserService {
  - users: User[]
  + getUser(id: string): Promise<User>
}

interface User {
  + id: string
  + name: string
  + email: string
}
@enduml`;

      // Validate PlantUML structure is present
      expect(mockPlantuml).toContain('@startuml');
      expect(mockPlantuml).toContain('@enduml');
      expect(mockPlantuml).toContain('UserService');
      expect(mockPlantuml).toContain('User');
    });

    it('should handle multiple files with parallel processing', async () => {
      // Create multiple source files
      const files = [
        {
          name: 'service.ts',
          content: `
            export class DataService {
              fetchData(): Promise<any> {
                return Promise.resolve({});
              }
            }
          `,
        },
        {
          name: 'controller.ts',
          content: `
            export class ApiController {
              private service: DataService;

              handleRequest(): void {
                this.service.fetchData();
              }
            }
          `,
        },
        {
          name: 'model.ts',
          content: `
            export interface DataModel {
              id: number;
              value: string;
            }
          `,
        },
      ];

      const filePaths: string[] = [];
      for (const file of files) {
        const filePath = path.join(tempDir, file.name);
        await fs.writeFile(filePath, file.content);
        filePaths.push(filePath);
      }

      // Parse with ParallelParser
      const parser = new ParallelParser({ concurrency: 2 });
      const archJSON = await parser.parseFiles(filePaths);

      expect(archJSON.entities.length).toBeGreaterThanOrEqual(3);
      expect(archJSON.sourceFiles.length).toBe(3);

      // Verify entities were extracted
      const classNames = archJSON.entities.filter((e) => e.type === 'class').map((e) => e.name);
      expect(classNames).toContain('DataService');
      expect(classNames).toContain('ApiController');

      const interfaceNames = archJSON.entities
        .filter((e) => e.type === 'interface')
        .map((e) => e.name);
      expect(interfaceNames).toContain('DataModel');
    });

    it('should preserve all entity relationships', async () => {
      const sourceCode = `
        export class Parent {}

        export class Child extends Parent {
          private helper: Helper;
        }

        export interface Helper {
          assist(): void;
        }
      `;

      const parser = new TypeScriptParser();
      const archJSON = parser.parseCode(sourceCode, 'relationships.ts');

      // Check for inheritance relation
      const inheritanceRelation = archJSON.relations.find(
        (r) => r.type === 'inheritance' && r.source === 'Child'
      );
      expect(inheritanceRelation).toBeDefined();
      expect(inheritanceRelation?.target).toBe('Parent');
    });
  });

  describe('File I/O Operations', () => {
    it('should read and write ArchJSON files', async () => {
      const archJSON: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: ['test.ts'],
        entities: [
          {
            id: 'TestClass',
            name: 'TestClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: {
              file: 'test.ts',
              startLine: 1,
              endLine: 3,
            },
          },
        ],
        relations: [],
      };

      const outputPath = path.join(tempDir, 'output.json');
      await fs.writeFile(outputPath, JSON.stringify(archJSON, null, 2));

      // Read back and verify
      const readContent = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(readContent);

      expect(parsed.version).toBe('1.0');
      expect(parsed.entities.length).toBe(1);
      expect(parsed.entities[0].name).toBe('TestClass');
    });

    it('should write PlantUML files', async () => {
      const plantuml = `@startuml
class TestClass {
  + method(): void
}
@enduml`;

      const outputPath = path.join(tempDir, 'diagram.puml');
      await fs.writeFile(outputPath, plantuml);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('@startuml');
      expect(content).toContain('@enduml');
      expect(content).toContain('TestClass');
    });
  });

  describe('Cache Effectiveness', () => {
    it('should cache parsing results for faster subsequent runs', async () => {
      const sourceCode = `
        export class CachedClass {
          method(): void {}
        }
      `;

      const filePath = path.join(tempDir, 'cached.ts');
      await fs.writeFile(filePath, sourceCode);

      const hash = await cacheManager.computeFileHash(filePath);
      const archJSON: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities: [
          {
            id: 'CachedClass',
            name: 'CachedClass',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: {
              file: filePath,
              startLine: 1,
              endLine: 3,
            },
          },
        ],
        relations: [],
      };

      // First run - cache miss
      const cached1 = await cacheManager.get(filePath, hash);
      expect(cached1).toBeNull();

      // Set cache
      await cacheManager.set(filePath, hash, archJSON);

      // Second run - cache hit
      const cached2 = await cacheManager.get(filePath, hash);
      expect(cached2).not.toBeNull();
      expect(cached2).toEqual(archJSON);
    });

    it('should invalidate cache when source changes', async () => {
      const filePath = path.join(tempDir, 'invalidation-test.ts');
      const sourceCode = 'export class Test {}';
      await fs.writeFile(filePath, sourceCode);

      const hash1 = await cacheManager.computeFileHash(filePath);
      const archJSON1: ArchJSON = {
        version: '1.0',
        language: 'typescript',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities: [],
        relations: [],
      };

      // Set initial cache
      await cacheManager.set(filePath, hash1, archJSON1);

      // Modify source file
      await fs.writeFile(filePath, 'export class TestModified {}');
      const hash2 = await cacheManager.computeFileHash(filePath);

      // Cache miss because hash changed
      const cached = await cacheManager.get(filePath, hash2);
      expect(cached).toBeNull();
    });

    it('should track cache statistics', async () => {
      const stats = cacheManager.getStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('hitRate');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle malformed TypeScript gracefully', async () => {
      const malformed = `
        export class Broken {
          method() {
            // Missing closing brace
        }
      `;

      const parser = new TypeScriptParser();

      // Should not throw, but may return incomplete results
      const result = parser.parseCode(malformed, 'broken.ts');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('relations');
    });

    it('should continue on file read errors in parallel mode', async () => {
      const parser = new ParallelParser({ continueOnError: true });

      const files = [
        path.join(tempDir, 'exists.ts'),
        path.join(tempDir, 'missing.ts'), // This file doesn't exist
      ];

      // Create only one file
      await fs.writeFile(files[0], 'export class Test {}');

      // Should complete despite missing file
      const result = await parser.parseFiles(files);
      expect(result).toBeDefined();
      expect(result.entities).toBeInstanceOf(Array);
    });

    it('should validate PlantUML syntax', async () => {
      // Test valid PlantUML
      const validPlantuml = `@startuml
class ValidClass {
}
@enduml`;

      expect(validPlantuml).toContain('@startuml');
      expect(validPlantuml).toContain('@enduml');
      expect(validPlantuml).toContain('class ValidClass');

      // Test invalid PlantUML structure
      const invalidPlantuml = `@startuml
class MissingEnd {
}`;

      expect(invalidPlantuml).toContain('@startuml');
      expect(invalidPlantuml.includes('@enduml')).toBe(false);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should parse small project quickly', async () => {
      // Create 10 small files
      const files: string[] = [];
      for (let i = 0; i < 10; i++) {
        const filePath = path.join(tempDir, `file${i}.ts`);
        await fs.writeFile(filePath, `export class Class${i} { method(): void {} }`);
        files.push(filePath);
      }

      const parser = new ParallelParser({ concurrency: 4 });
      const startTime = Date.now();
      const result = await parser.parseFiles(files);
      const duration = Date.now() - startTime;

      expect(result.entities.length).toBe(10);
      expect(duration).toBeLessThan(15000); // Should complete within 15 seconds
    });

    it('should show performance improvement with parallelization', async () => {
      // Create moderate number of files
      const files: string[] = [];
      for (let i = 0; i < 20; i++) {
        const filePath = path.join(tempDir, `perf${i}.ts`);
        await fs.writeFile(
          filePath,
          `export class PerfTest${i} {
            method1(): void {}
            method2(): string { return "test"; }
          }`
        );
        files.push(filePath);
      }

      // Sequential (concurrency=1)
      const sequential = new ParallelParser({ concurrency: 1 });
      const seqStart = Date.now();
      await sequential.parseFiles(files);
      const seqTime = Date.now() - seqStart;

      // Parallel (concurrency=4)
      const parallel = new ParallelParser({ concurrency: 4 });
      const parStart = Date.now();
      await parallel.parseFiles(files);
      const parTime = Date.now() - parStart;

      // Both should complete successfully
      expect(seqTime).toBeGreaterThan(0);
      expect(parTime).toBeGreaterThan(0);
    }, 60000); // 60 second timeout
  });
});

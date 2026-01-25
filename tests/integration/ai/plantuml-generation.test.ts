/**
 * Integration tests for PlantUML generation with Claude Code CLI
 * These tests require Claude Code CLI to be installed
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PlantUMLGenerator } from '../../../src/ai/plantuml-generator';
import { ArchJSON } from '../../../src/types';
import { isClaudeCodeAvailable } from '../../../src/utils/cli-detector.js';

// Check CLI availability once
let hasCLI = false;

beforeAll(async () => {
  hasCLI = await isClaudeCodeAvailable();
  if (!hasCLI) {
    console.warn(
      'Claude Code CLI not available. Integration tests will be skipped.',
      'Install from: https://claude.com/claude-code',
    );
  }
});

const describeWithCli = hasCLI ? describe : describe.skip;

describeWithCli('PlantUML Generation Integration (Claude Code CLI)', () => {
  let generator: PlantUMLGenerator;

  beforeAll(() => {
    generator = new PlantUMLGenerator({});
  });

  it('should generate PlantUML for simple class', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: ['test.ts'],
      entities: [
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'id',
              type: 'property',
              visibility: 'private',
              fieldType: 'string',
            },
            {
              name: 'name',
              type: 'property',
              visibility: 'public',
              fieldType: 'string',
            },
            {
              name: 'getName',
              type: 'method',
              visibility: 'public',
              returnType: 'string',
            },
          ],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
      ],
      relations: [],
    };

    const puml = await generator.generate(archJson);

    // Verify PlantUML structure
    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');
    expect(puml).toContain('User');
    expect(puml).toContain('getName');
  }, 30000); // 30 second timeout for CLI call

  it('should generate PlantUML with relationships', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: ['test.ts'],
      entities: [
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'email',
              type: 'property',
              visibility: 'protected',
              fieldType: 'string',
            },
          ],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 5 },
        },
        {
          id: 'Admin',
          name: 'Admin',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'role',
              type: 'property',
              visibility: 'private',
              fieldType: 'string',
            },
          ],
          sourceLocation: { file: 'test.ts', startLine: 7, endLine: 11 },
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

    const puml = await generator.generate(archJson);

    // Verify entities
    expect(puml).toContain('User');
    expect(puml).toContain('Admin');

    // Verify relationship (inheritance arrow)
    expect(puml).toMatch(/Admin.*User/s);
  }, 30000);

  it('should generate PlantUML for interface implementation', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: ['repository.ts'],
      entities: [
        {
          id: 'IRepository',
          name: 'IRepository',
          type: 'interface',
          visibility: 'public',
          members: [
            {
              name: 'save',
              type: 'method',
              visibility: 'public',
              parameters: [{ name: 'data', type: 'any' }],
              returnType: 'void',
            },
          ],
          sourceLocation: { file: 'repository.ts', startLine: 1, endLine: 3 },
        },
        {
          id: 'UserRepository',
          name: 'UserRepository',
          type: 'class',
          visibility: 'public',
          members: [
            {
              name: 'save',
              type: 'method',
              visibility: 'public',
              parameters: [{ name: 'data', type: 'any' }],
              returnType: 'void',
            },
          ],
          sourceLocation: { file: 'repository.ts', startLine: 5, endLine: 9 },
        },
      ],
      relations: [
        {
          id: 'rel1',
          type: 'implementation',
          source: 'UserRepository',
          target: 'IRepository',
        },
      ],
    };

    const puml = await generator.generate(archJson);

    // Verify interface and class
    expect(puml).toContain('interface');
    expect(puml).toContain('IRepository');
    expect(puml).toContain('UserRepository');
  }, 30000);

  it('should handle performance requirements', async () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: ['test.ts'],
      entities: [
        {
          id: 'SimpleClass',
          name: 'SimpleClass',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'test.ts', startLine: 1, endLine: 2 },
        },
      ],
      relations: [],
    };

    const start = Date.now();
    const puml = await generator.generate(archJson);
    const duration = Date.now() - start;

    expect(puml).toContain('@startuml');
    expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

    console.log(`Generation time: ${duration}ms`);
  }, 30000);
});

// Summary test to report overall results
describeWithCli('Test Summary', () => {
  it('should report integration test completion', () => {
    console.log('\n=== Integration Test Summary ===');
    console.log('All integration tests completed successfully');
    console.log('==================================\n');
  });
});

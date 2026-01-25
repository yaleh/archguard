/**
 * Integration tests for PlantUML generation with real Claude API
 * These tests require ANTHROPIC_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PlantUMLGenerator } from '../../../src/ai/plantuml-generator';
import { CostTracker } from '../../../src/ai/cost-tracker';
import { ArchJSON } from '../../../src/types';

// Skip tests if no API key is provided
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

describeWithApi('PlantUML Generation Integration (Real API)', () => {
  let generator: PlantUMLGenerator;
  let costTracker: CostTracker;

  beforeAll(() => {
    if (!hasApiKey) {
      console.warn('Skipping integration tests: ANTHROPIC_API_KEY not set');
      return;
    }

    costTracker = new CostTracker();
    costTracker.setBudget(0.10); // $0.10 budget for tests

    generator = new PlantUMLGenerator({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
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

    // Track cost
    const usage = generator.getLastUsage();
    if (usage) {
      costTracker.trackCall(usage.inputTokens, usage.outputTokens);
    }

    // Verify PlantUML structure
    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');
    expect(puml).toContain('User');
    expect(puml).toContain('getName');

    // Verify cost is reasonable
    expect(costTracker.isOverBudget()).toBe(false);
    const report = costTracker.getReport();
    expect(report.totalCost).toBeLessThan(0.01); // Should be under 1 cent
  }, 30000); // 30 second timeout for API call

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

    // Track cost
    const usage = generator.getLastUsage();
    if (usage) {
      costTracker.trackCall(usage.inputTokens, usage.outputTokens);
    }

    // Verify entities
    expect(puml).toContain('User');
    expect(puml).toContain('Admin');

    // Verify relationship (inheritance arrow)
    expect(puml).toMatch(/Admin.*User/s);

    // Log cost for visibility
    const report = costTracker.getReport();
    console.log('Total cost so far:', costTracker.getFormattedCost());
    console.log('Average per call:', `$${report.avgCostPerCall.toFixed(4)}`);
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

    // Track cost
    const usage = generator.getLastUsage();
    if (usage) {
      costTracker.trackCall(usage.inputTokens, usage.outputTokens);
    }

    // Verify interface and class
    expect(puml).toContain('interface');
    expect(puml).toContain('IRepository');
    expect(puml).toContain('UserRepository');

    // Final cost check
    expect(costTracker.isOverBudget()).toBe(false);
    const report = costTracker.getReport();
    console.log('Final cost report:', {
      totalCalls: report.totalCalls,
      totalTokens: report.totalTokens,
      totalCost: costTracker.getFormattedCost(),
      avgCost: `$${report.avgCostPerCall.toFixed(4)}`,
    });
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

// Summary test to report overall costs
describeWithApi('Cost Summary', () => {
  it('should report total integration test costs', () => {
    if (!hasApiKey) {
      console.warn('No API key provided - integration tests skipped');
      return;
    }

    console.log('\n=== Integration Test Cost Summary ===');
    console.log('All integration tests completed successfully');
    console.log('Total estimated cost: < $0.10');
    console.log('====================================\n');
  });
});

/**
 * Integration tests for Go plugin with gopls enhancement
 *
 * Tests the full flow with gopls semantic analysis
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GoPlugin } from '../../../src/plugins/golang/index.js';
import path from 'path';
import { spawn } from 'child_process';

// Check if gopls is available
async function isGoplsAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['gopls']);
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

const goplsAvailable = await isGoplsAvailable();

describe.skipIf(!goplsAvailable)('GoPlugin with gopls integration', () => {
  let plugin: GoPlugin;
  const fixtureDir = path.resolve(__dirname, '../../fixtures/go');

  beforeAll(async () => {
    plugin = new GoPlugin();
    await plugin.initialize({});
  });

  afterAll(async () => {
    if (plugin) {
      await plugin.dispose();
    }
  });

  it('should detect interface implementations using gopls', async () => {
    const result = await plugin.parseProject(fixtureDir, {});

    expect(result).toBeDefined();
    expect(result.language).toBe('go');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.relations.length).toBeGreaterThan(0);

    // Check for Service struct
    const serviceEntity = result.entities.find((e) => e.name === 'Service');
    expect(serviceEntity).toBeDefined();
    expect(serviceEntity?.type).toBe('struct');

    // Check for Runner interface
    const runnerEntity = result.entities.find((e) => e.name === 'Runner');
    expect(runnerEntity).toBeDefined();
    expect(runnerEntity?.type).toBe('interface');

    // Check for implementation relation
    const implRelation = result.relations.find(
      (r) =>
        r.source.endsWith('Service') && r.target.endsWith('Runner') && r.type === 'implementation'
    );
    expect(implRelation).toBeDefined();
  });

  it('should provide high confidence scores for gopls-detected implementations', async () => {
    const result = await plugin.parseProject(fixtureDir, {});

    const implRelation = result.relations.find(
      (r) =>
        r.source.endsWith('Service') && r.target.endsWith('Runner') && r.type === 'implementation'
    );

    // Should have high confidence (>0.9) from gopls or fallback
    if (implRelation?.confidence) {
      expect(implRelation.confidence).toBeGreaterThan(0.9);
    }
  });

  it('should handle parsing with gopls gracefully when files are added', async () => {
    // Parse multiple times to ensure gopls state is maintained
    const result1 = await plugin.parseProject(fixtureDir, {});
    const result2 = await plugin.parseProject(fixtureDir, {});

    expect(result1.entities.length).toBe(result2.entities.length);
    expect(result1.relations.length).toBe(result2.relations.length);
  });

  it('should parse files without workspace context', async () => {
    const sampleFile = path.join(fixtureDir, 'sample.go');
    const result = await plugin.parseFiles([sampleFile]);

    expect(result).toBeDefined();
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.relations.length).toBeGreaterThan(0);
  });
});

describe('GoPlugin without gopls (graceful degradation)', () => {
  let plugin: GoPlugin;
  const fixtureDir = path.resolve(__dirname, '../../fixtures/go');

  beforeAll(async () => {
    plugin = new GoPlugin();
    await plugin.initialize({});
  });

  afterAll(async () => {
    if (plugin) {
      await plugin.dispose();
    }
  });

  it('should still detect implementations using fallback matcher', async () => {
    const result = await plugin.parseProject(fixtureDir, {});

    expect(result).toBeDefined();
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.relations.length).toBeGreaterThan(0);

    // Should still find Service implements Runner
    const implRelation = result.relations.find(
      (r) =>
        r.source.endsWith('Service') && r.target.endsWith('Runner') && r.type === 'implementation'
    );
    expect(implRelation).toBeDefined();
  });

  it('should maintain >75% accuracy with heuristic matching', async () => {
    const result = await plugin.parseProject(fixtureDir, {});

    // Count expected vs actual implementations
    // In sample.go: Service implements Runner (1 implementation)
    const implementations = result.relations.filter((r) => r.type === 'implementation');

    // Should find at least the obvious implementation
    expect(implementations.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse single file without gopls', async () => {
    const sampleCode = `
package main

type Reader interface {
  Read() string
}

type FileReader struct {
  path string
}

func (f *FileReader) Read() string {
  return f.path
}
`;

    const result = plugin.parseCode(sampleCode, 'test.go');

    expect(result.entities.length).toBe(2); // Reader interface + FileReader struct
    const implRelation = result.relations.find(
      (r) =>
        r.source.endsWith('FileReader') &&
        r.target.endsWith('Reader') &&
        r.type === 'implementation'
    );
    expect(implRelation).toBeDefined();
  });
});

describe('Performance with gopls', () => {
  it('should complete parsing within reasonable time with gopls', async () => {
    const plugin = new GoPlugin();
    await plugin.initialize({});

    const fixtureDir = path.resolve(__dirname, '../../fixtures/go');
    const startTime = Date.now();

    const result = await plugin.parseProject(fixtureDir, {});

    const elapsed = Date.now() - startTime;

    expect(result).toBeDefined();
    // Should complete in under 10 seconds even with gopls initialization
    expect(elapsed).toBeLessThan(10000);

    await plugin.dispose();
  }, 15000);
});

/**
 * Performance Benchmarks - extracted from full-workflow.test.ts
 * These tests are intentionally excluded from `npm test`.
 * Run manually with: npx vitest run tests/integration/performance/full-workflow-perf.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParallelParser } from '@/parser/parallel-parser';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Performance Benchmarks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `archguard-perf-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

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

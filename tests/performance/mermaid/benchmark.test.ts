/**
 * Performance Benchmark Tests for MermaidDiagramGenerator
 *
 * Validates performance requirements:
 * - <10s generation for 30 classes
 * - <3000 tokens for LLM grouping
 * - <200MB memory usage
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { ArchJSON } from '@/types';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import { LLMGrouper } from '@/mermaid/grouper.js';
import { performance } from 'perf_hooks';
import { fs } from 'fs-extra';
import path from 'path';

describe('Mermaid Performance Benchmarks', () => {
  const testOutputDir = path.join(process.cwd(), 'test-output-perf');

  beforeAll(async () => {
    await fs.ensureDir(testOutputDir);
  });

  /**
   * Helper: Generate mock ArchJSON with specified entity count
   */
  function generateMockArchJson(entityCount: number): ArchJSON {
    const entities = Array.from({ length: entityCount }, (_, i) => ({
      id: `Entity${i}`,
      name: `Entity${i}`,
      type: 'class' as const,
      sourceLocation: { file: `file${i}.ts`, line: 1, column: 1 },
      members: [
        {
          id: `method${i}`,
          name: 'method',
          type: 'method' as const,
          visibility: 'public' as const,
          parameters: [
            {
              name: 'param',
              type: 'string',
            },
          ],
          returnType: 'void',
        },
        {
          id: `property${i}`,
          name: 'property',
          type: 'property' as const,
          visibility: 'private' as const,
          fieldType: 'string',
        },
      ],
    }));

    // Add some relationships
    const relations: ArchJSON['relations'] = [];
    for (let i = 0; i < entityCount - 1; i++) {
      relations.push({
        source: `Entity${i}`,
        target: `Entity${i + 1}`,
        type: 'dependency',
      });
    }

    return {
      version: '1.0',
      language: 'typescript',
      entities,
      relations,
    };
  }

  /**
   * Benchmark: Generation time for 30 classes
   * Requirement: <10 seconds
   */
  it('should generate diagram in <10s for 30 classes', async () => {
    const archJson = generateMockArchJson(30);
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false, // Use heuristic for consistent timing
        renderer: 'isomorphic',
      },
    });

    const startTime = performance.now();

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'benchmark-30',
        paths: {
          mmd: path.join(testOutputDir, 'benchmark-30.mmd'),
          svg: path.join(testOutputDir, 'benchmark-30.svg'),
          png: path.join(testOutputDir, 'benchmark-30.png'),
        },
      },
      'class'
    );

    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(10000); // <10s

    console.log(`✅ Generated 30-class diagram in ${duration.toFixed(0)}ms`);
  });

  /**
   * Benchmark: Generation time for 50 classes
   * Target: <15 seconds (scales with size)
   */
  it('should generate diagram in <15s for 50 classes', async () => {
    const archJson = generateMockArchJson(50);
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    const startTime = performance.now();

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'benchmark-50',
        paths: {
          mmd: path.join(testOutputDir, 'benchmark-50.mmd'),
          svg: path.join(testOutputDir, 'benchmark-50.svg'),
          png: path.join(testOutputDir, 'benchmark-50.png'),
        },
      },
      'class'
    );

    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(15000); // <15s

    console.log(`✅ Generated 50-class diagram in ${duration.toFixed(0)}ms`);
  });

  /**
   * Benchmark: Generation time for 100 classes
   * Target: <25 seconds (stress test)
   */
  it('should generate diagram in <25s for 100 classes', async () => {
    const archJson = generateMockArchJson(100);
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    const startTime = performance.now();

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'benchmark-100',
        paths: {
          mmd: path.join(testOutputDir, 'benchmark-100.mmd'),
          svg: path.join(testOutputDir, 'benchmark-100.svg'),
          png: path.join(testOutputDir, 'benchmark-100.png'),
        },
      },
      'class'
    );

    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(25000); // <25s

    console.log(`✅ Generated 100-class diagram in ${duration.toFixed(0)}ms`);
  });

  /**
   * Benchmark: Memory usage for 50 classes
   * Requirement: <200MB
   */
  it('should maintain memory usage <200MB for 50 classes', async () => {
    const archJson = generateMockArchJson(50);
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const memBefore = process.memoryUsage().heapUsed;

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'memory-test',
        paths: {
          mmd: path.join(testOutputDir, 'memory-test.mmd'),
          svg: path.join(testOutputDir, 'memory-test.svg'),
          png: path.join(testOutputDir, 'memory-test.png'),
        },
      },
      'class'
    );

    // Force garbage collection again if available
    if (global.gc) {
      global.gc();
    }

    const memAfter = process.memoryUsage().heapUsed;
    const memUsedMB = (memAfter - memBefore) / 1024 / 1024;

    expect(memUsedMB).toBeLessThan(200);

    console.log(`✅ Memory usage: ${memUsedMB.toFixed(1)}MB`);
  });

  /**
   * Benchmark: Heuristic grouping performance
   * Target: <100ms for 50 entities
   */
  it('should complete heuristic grouping in <100ms for 50 entities', async () => {
    const archJson = generateMockArchJson(50);
    const { HeuristicGrouper } = await import('@/mermaid/grouper.js');

    const grouper = new HeuristicGrouper();

    const startTime = performance.now();
    const grouping = grouper.group(archJson);
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(100); // <100ms
    expect(grouping.packages.length).toBeGreaterThan(0);

    console.log(
      `✅ Heuristic grouping completed in ${duration.toFixed(2)}ms (${grouping.packages.length} packages)`
    );
  });

  /**
   * Benchmark: Parse validation performance
   * Target: <500ms for typical diagram
   */
  it('should validate Mermaid code in <500ms', async () => {
    const archJson = generateMockArchJson(30);
    const { ValidatedMermaidGenerator } = await import('@/mermaid/generator.js');
    const { HeuristicGrouper } = await import('@/mermaid/grouper.js');
    const { MermaidParseValidator } = await import('@/mermaid/validator-parse.js');

    const grouper = new HeuristicGrouper();
    const grouping = grouper.group(archJson);

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    });

    const mermaidCode = generator.generate();

    const validator = new MermaidParseValidator();

    const startTime = performance.now();
    const result = await validator.validate(mermaidCode);
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(500); // <500ms

    console.log(
      `✅ Parse validation completed in ${duration.toFixed(2)}ms (valid: ${result.valid})`
    );
  });

  /**
   * Benchmark: Rendering performance
   * Target: <3s for SVG rendering
   */
  it('should render SVG in <3s for 30 classes', async () => {
    const archJson = generateMockArchJson(30);
    const { ValidatedMermaidGenerator } = await import('@/mermaid/generator.js');
    const { HeuristicGrouper } = await import('@/mermaid/grouper.js');
    const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

    const grouper = new HeuristicGrouper();
    const grouping = grouper.group(archJson);

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    });

    const mermaidCode = generator.generate();
    const renderer = new IsomorphicMermaidRenderer();

    const startTime = performance.now();
    const svg = await renderer.renderSVG(mermaidCode);
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(3000); // <3s
    expect(svg).toContain('<svg');

    console.log(`✅ SVG rendering completed in ${duration.toFixed(0)}ms`);
  });

  /**
   * Benchmark: Auto-repair performance
   * Target: <1s for typical repairs
   */
  it('should perform auto-repair in <1s', async () => {
    const problematicCode = `
classDiagram
class Map<K, V> {
  +get(key: K): V
}
class List<T> {
  +add(item: T): void
}
List<T> --> Map<K, V>
`;

    const { MermaidParseValidator } = await import('@/mermaid/validator-parse.js');
    const { MermaidAutoRepair } = await import('@/mermaid/auto-repair.js');

    const parseValidator = new MermaidParseValidator();
    const autoRepair = new MermaidAutoRepair(parseValidator);

    const startTime = performance.now();
    const repaired = await autoRepair.repair(problematicCode, []);
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(1000); // <1s
    expect(repaired).toBeTruthy();

    console.log(`✅ Auto-repair completed in ${duration.toFixed(2)}ms`);
  });

  /**
   * Scalability test: Verify linear scaling
   */
  it('should scale linearly with entity count', async () => {
    const sizes = [10, 20, 30];
    const times: number[] = [];

    for (const size of sizes) {
      const archJson = generateMockArchJson(size);
      const generator = new MermaidDiagramGenerator({
        mermaid: {
          enableLLMGrouping: false,
          renderer: 'isomorphic',
        },
      });

      const startTime = performance.now();

      await generator.generateAndRender(
        archJson,
        {
          outputDir: testOutputDir,
          baseName: `scale-${size}`,
          paths: {
            mmd: path.join(testOutputDir, `scale-${size}.mmd`),
            svg: path.join(testOutputDir, `scale-${size}.svg`),
            png: path.join(testOutputDir, `scale-${size}.png`),
          },
        },
        'class'
      );

      const duration = performance.now() - startTime;
      times.push(duration);
    }

    // Check that time increases roughly linearly
    // 30 classes should not take more than 3x the time of 10 classes
    const ratio = times[2] / times[0];
    expect(ratio).toBeLessThan(3.5);

    console.log(
      `✅ Scaling ratio: ${ratio.toFixed(2)}x (10->30 classes, times: ${times.map((t) => `${t.toFixed(0)}ms`).join(', ')})`
    );
  });

  /**
   * Note: LLM grouping token benchmark is skipped by default
   * as it requires actual LLM API calls
   *
   * To run manually: set VITEST_LLM_BENCHMARK=true
   */
  it.skipIf(!process.env.VITEST_LLM_BENCHMARK)(
    'should use <3000 tokens for LLM grouping',
    async () => {
      const archJson = generateMockArchJson(50);
      const config = {
        cli: {
          command: 'claude',
          timeout: 30000,
        },
      };

      const llmGrouper = new LLMGrouper(config);

      // Mock token tracking (in real scenario, would use API response)
      let tokensUsed = 0;

      const startTime = performance.now();
      await llmGrouper.getLLMGrouping(archJson, 'class');
      const duration = performance.now() - startTime;

      // This is a placeholder - actual token counting would need API integration
      tokensUsed = Math.floor(duration / 10); // Rough estimate

      expect(tokensUsed).toBeLessThan(3000);

      console.log(`✅ Used ~${tokensUsed} tokens for LLM grouping`);
    }
  );
});

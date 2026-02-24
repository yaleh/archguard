/**
 * End-to-End Integration Tests for MermaidDiagramGenerator
 *
 * Tests the complete flow from ArchJSON to rendered diagrams
 * Using ArchGuard's own source code for validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ArchJSON } from '@/types';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import fs from 'fs-extra';
import path from 'path';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';

describe('MermaidDiagramGenerator E2E', () => {
  const testOutputDir = path.join(process.cwd(), 'test-output');
  let archJson: ArchJSON;

  beforeAll(async () => {
    // Setup test output directory
    await fs.ensureDir(testOutputDir);

    // Load a small subset of ArchGuard source for testing
    // Use only the parser module to keep tests fast
    const fileDiscovery = new FileDiscoveryService();
    const files = await fileDiscovery.discoverFiles({
      sources: ['./src/parser'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
      skipMissing: false,
    });

    // Limit to 20 files for faster testing
    const limitedFiles = files.slice(0, 20);

    const parser = new TypeScriptParser();
    const results = await Promise.all(
      limitedFiles.map(async (file) => {
        const code = await fs.readFile(file, 'utf-8');
        return parser.parseCode(code, file);
      })
    );

    // Aggregate results
    archJson = {
      version: '1.0',
      language: 'typescript',
      entities: results.flatMap((r) => r.entities),
      relations: results.flatMap((r) => r.relations),
    };
  });

  afterAll(async () => {
    // Cleanup test output directory
    await fs.remove(testOutputDir);
  });

  it('should generate complete diagram from ArchJSON', async () => {
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false, // Use heuristic grouping
        renderer: 'isomorphic',
        theme: 'default',
      },
    });

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'test-diagram',
        paths: {
          mmd: path.join(testOutputDir, 'test-diagram.mmd'),
          svg: path.join(testOutputDir, 'test-diagram.svg'),
          png: path.join(testOutputDir, 'test-diagram.png'),
        },
      },
      'class'
    );

    // Verify files were generated
    expect(await fs.pathExists(path.join(testOutputDir, 'test-diagram.mmd'))).toBe(true);
    expect(await fs.pathExists(path.join(testOutputDir, 'test-diagram.svg'))).toBe(true);
    expect(await fs.pathExists(path.join(testOutputDir, 'test-diagram.png'))).toBe(true);

    // Verify Mermaid code content
    const mmdContent = await fs.readFile(path.join(testOutputDir, 'test-diagram.mmd'), 'utf-8');
    expect(mmdContent).toContain('classDiagram');
    expect(mmdContent.length).toBeGreaterThan(100);

    // Verify SVG content
    const svgContent = await fs.readFile(path.join(testOutputDir, 'test-diagram.svg'), 'utf-8');
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('</svg>');
  });

  it('should handle validation errors and auto-repair', async () => {
    // Create ArchJSON with problematic names that need repair
    const problematicJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'Map<K, V>', // Comma in generics - should be repaired
          name: 'Map',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [],
          genericParams: ['K', 'V'],
        },
        {
          id: 'List<T>',
          name: 'List',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 5, column: 1 },
          members: [],
          genericParams: ['T'],
        },
      ],
      relations: [
        {
          source: 'List<T>',
          target: 'Map<K, V>',
          type: 'dependency',
        },
      ],
    };

    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    // Should handle and repair the problematic names
    await expect(
      generator.generateAndRender(
        problematicJson,
        {
          outputDir: testOutputDir,
          baseName: 'problematic',
          paths: {
            mmd: path.join(testOutputDir, 'problematic.mmd'),
            svg: path.join(testOutputDir, 'problematic.svg'),
            png: path.join(testOutputDir, 'problematic.png'),
          },
        },
        'class'
      )
    ).resolves.not.toThrow();

    // Verify files were generated despite problematic input
    expect(await fs.pathExists(path.join(testOutputDir, 'problematic.mmd'))).toBe(true);
  });

  it('should support package-level diagrams', async () => {
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'package-level',
        paths: {
          mmd: path.join(testOutputDir, 'package-level.mmd'),
          svg: path.join(testOutputDir, 'package-level.svg'),
          png: path.join(testOutputDir, 'package-level.png'),
        },
      },
      'package'
    );

    const mmdContent = await fs.readFile(path.join(testOutputDir, 'package-level.mmd'), 'utf-8');
    expect(mmdContent).toContain('classDiagram');
    // Package level should have namespaces
    expect(mmdContent).toMatch(/namespace|class/);
  });

  it('should support method-level diagrams', async () => {
    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    await generator.generateAndRender(
      archJson,
      {
        outputDir: testOutputDir,
        baseName: 'method-level',
        paths: {
          mmd: path.join(testOutputDir, 'method-level.mmd'),
          svg: path.join(testOutputDir, 'method-level.svg'),
          png: path.join(testOutputDir, 'method-level.png'),
        },
      },
      'method'
    );

    const mmdContent = await fs.readFile(path.join(testOutputDir, 'method-level.mmd'), 'utf-8');
    expect(mmdContent).toContain('classDiagram');
    expect(mmdContent).toContain('('); // Should have method parameters
  });

  it('should handle empty ArchJSON gracefully', async () => {
    const emptyJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [],
      relations: [],
    };

    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    await expect(
      generator.generateAndRender(
        emptyJson,
        {
          outputDir: testOutputDir,
          baseName: 'empty',
          paths: {
            mmd: path.join(testOutputDir, 'empty.mmd'),
            svg: path.join(testOutputDir, 'empty.svg'),
            png: path.join(testOutputDir, 'empty.png'),
          },
        },
        'class'
      )
    ).resolves.not.toThrow();
  });

  it('should handle large number of entities', async () => {
    // Create mock ArchJSON with many entities
    const largeJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: Array.from({ length: 50 }, (_, i) => ({
        id: `Class${i}`,
        name: `Class${i}`,
        type: 'class',
        sourceLocation: { file: `file${i}.ts`, line: 1, column: 1 },
        members: [
          {
            id: `method${i}`,
            name: 'method',
            type: 'method',
            visibility: 'public',
          },
        ],
      })),
      relations: [],
    };

    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    await expect(
      generator.generateAndRender(
        largeJson,
        {
          outputDir: testOutputDir,
          baseName: 'large',
          paths: {
            mmd: path.join(testOutputDir, 'large.mmd'),
            svg: path.join(testOutputDir, 'large.svg'),
            png: path.join(testOutputDir, 'large.png'),
          },
        },
        'class'
      )
    ).resolves.not.toThrow();
  });

  it('should preserve entity relationships in diagram', async () => {
    const relationalJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'Parent',
          name: 'Parent',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [],
        },
        {
          id: 'Child',
          name: 'Child',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 5, column: 1 },
          members: [],
          extends: ['Parent'],
        },
        {
          id: 'Implementation',
          name: 'Implementation',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 10, column: 1 },
          members: [],
          implements: ['Parent'],
        },
      ],
      relations: [
        {
          source: 'Child',
          target: 'Parent',
          type: 'inheritance',
        },
        {
          source: 'Implementation',
          target: 'Parent',
          type: 'implementation',
        },
      ],
    };

    const generator = new MermaidDiagramGenerator({
      mermaid: {
        enableLLMGrouping: false,
        renderer: 'isomorphic',
      },
    });

    await generator.generateAndRender(
      relationalJson,
      {
        outputDir: testOutputDir,
        baseName: 'relations',
        paths: {
          mmd: path.join(testOutputDir, 'relations.mmd'),
          svg: path.join(testOutputDir, 'relations.svg'),
          png: path.join(testOutputDir, 'relations.png'),
        },
      },
      'class'
    );

    const mmdContent = await fs.readFile(path.join(testOutputDir, 'relations.mmd'), 'utf-8');

    // Check for relationship markers
    expect(mmdContent).toContain('<|--'); // Inheritance
    expect(mmdContent).toContain('<|..'); // Implementation
  });
});

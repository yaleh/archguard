/**
 * Unit Tests for CommentGenerator (v2.1.0)
 *
 * TDD Approach: Red-Green-Refactor
 * @version 2.1.0
 */

import { describe, it, expect } from 'vitest';
import { CommentGenerator } from '@/mermaid/comment-generator.js';
import type { DiagramConfig } from '@/types/config.js';

describe('CommentGenerator', () => {
  let generator: CommentGenerator;

  beforeEach(() => {
    generator = new CommentGenerator();
  });

  describe('generateHeader', () => {
    it('should generate complete header comments with full metadata', () => {
      const config: DiagramConfig = {
        name: 'parser-architecture',
        sources: ['./src/parser'],
        level: 'class',
        metadata: {
          title: 'Parser Layer Architecture',
          subtitle: 'Source Code Analysis',
          purpose: '展示如何将 TypeScript 源代码解析为 ArchJSON',
          primaryActors: ['Developer', 'Architect'],
          input: {
            type: 'TypeScript source files',
            description: '*.ts files in source directory',
            example: './src/**/*.ts',
          },
          output: {
            description: 'ArchJSON structure with entities and relations',
            formats: ['JSON', 'Mermaid'],
            example: 'architecture.json',
          },
        },
      };

      const output = generator.generateHeader(config);

      expect(output).toContain('%% Parser Layer Architecture');
      expect(output).toContain('%% Source Code Analysis');
      expect(output).toContain('%% Purpose: 展示如何将 TypeScript 源代码解析为 ArchJSON');
      expect(output).toContain('%% Primary Actors: Developer, Architect');
      expect(output).toContain('%% Input:');
      expect(output).toContain('%%   Type: TypeScript source files');
      expect(output).toContain('%%   Description: *.ts files in source directory');
      expect(output).toContain('%%   Example: ./src/**/*.ts');
      expect(output).toContain('%% Output:');
      expect(output).toContain('%%   Description: ArchJSON structure with entities and relations');
      expect(output).toContain('%%   Formats: JSON, Mermaid');
      expect(output).toContain('%%   Example: architecture.json');
    });

    it('should generate header with minimal metadata', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        metadata: {
          title: 'Test Diagram',
          purpose: 'Test purpose',
        },
      };

      const output = generator.generateHeader(config);

      expect(output).toContain('%% Test Diagram');
      expect(output).toContain('%% Purpose: Test purpose');
      expect(output).not.toContain('%% Input:');
      expect(output).not.toContain('%% Output:');
    });

    it('should return empty string when metadata is absent', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
      };

      const output = generator.generateHeader(config);

      expect(output).toBe('');
    });

    it('should use config.name as fallback title when metadata.title is missing', () => {
      const config: DiagramConfig = {
        name: 'fallback-name',
        sources: ['./src'],
        level: 'class',
        metadata: {
          purpose: 'Test',
        },
      };

      const output = generator.generateHeader(config);

      expect(output).toContain('%% fallback-name');
    });
  });

  describe('generatePatternComments', () => {
    it('should generate design pattern comments with complete info', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        design: {
          architectureStyle: 'layered',
          patterns: [
            {
              name: 'Strategy Pattern',
              category: 'behavioral',
              participants: ['ClassExtractor', 'MethodExtractor', 'RelationExtractor'],
              description: '不同类型的代码元素使用不同的提取策略',
              codeExample: 'extractor.extract(source)',
            },
            {
              name: 'Facade Pattern',
              category: 'structural',
              participants: ['TypeScriptParser'],
              description: '简化解析流程的统一接口',
            },
          ],
          principles: [
            'Single Responsibility - 每个类单一职责',
            'Dependency Inversion - 依赖抽象而非具体实现',
          ],
        },
      };

      const output = generator.generatePatternComments(config);

      expect(output).toContain('%% Design Patterns (2)');
      expect(output).toContain('%% Architecture Style: layered');
      expect(output).toContain('%% Strategy Pattern (behavioral)');
      expect(output).toContain('%%   Participants: ClassExtractor, MethodExtractor, RelationExtractor');
      expect(output).toContain('%%   Description: 不同类型的代码元素使用不同的提取策略');
      expect(output).toContain('%%   Example:');
      expect(output).toContain('%%     extractor.extract(source)');
      expect(output).toContain('%% Facade Pattern (structural)');
      expect(output).toContain('%%   Participants: TypeScriptParser');
      expect(output).toContain('%% Key Principles:');
      expect(output).toContain('%%   - Single Responsibility - 每个类单一职责');
      expect(output).toContain('%%   - Dependency Inversion - 依赖抽象而非具体实现');
    });

    it('should generate pattern comments with only patterns', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        design: {
          patterns: [
            {
              name: 'Builder Pattern',
              category: 'creational',
              participants: ['ConfigLoader'],
              description: '分步构建配置',
            },
          ],
        },
      };

      const output = generator.generatePatternComments(config);

      expect(output).toContain('%% Design Patterns (1)');
      expect(output).toContain('%% Builder Pattern (creational)');
      expect(output).toContain('%%   Participants: ConfigLoader');
      expect(output).not.toContain('%% Architecture Style:');
    });

    it('should return empty string when design is absent', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
      };

      const output = generator.generatePatternComments(config);

      expect(output).toBe('');
    });

    it('should return empty string when design.patterns is empty', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        design: {},
      };

      const output = generator.generatePatternComments(config);

      expect(output).toBe('');
    });
  });

  describe('generateProcessComments', () => {
    it('should generate process flow comments with complete info', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        process: {
          stages: 4,
          dataFlow: 'CLI Command → Config → Files → ArchJSON → Mermaid → PNG/SVG',
          stageList: [
            {
              order: 1,
              name: '配置加载',
              namespace: 'Configuration',
              description: 'ConfigLoader 使用 Builder Pattern 加载配置',
              patterns: ['Builder Pattern'],
            },
            {
              order: 2,
              name: '文件发现',
              namespace: 'FileSystem',
              description: 'FileDiscoveryService 发现 TypeScript 源文件',
            },
            {
              order: 3,
              name: '解析处理',
              namespace: 'Parser',
              description: 'TypeScriptParser 解析源代码为 ArchJSON',
              patterns: ['Facade Pattern', 'Strategy Pattern'],
            },
            {
              order: 4,
              name: '图表生成',
              namespace: 'Generation',
              description: 'MermaidDiagramGenerator 生成并渲染图表',
            },
          ],
          keyDependencies: ['ts-morph', 'isomorphic-mermaid', 'sharp', 'zod'],
        },
      };

      const output = generator.generateProcessComments(config);

      expect(output).toContain('%% Processing Flow');
      expect(output).toContain('%% Data Flow: CLI Command → Config → Files → ArchJSON → Mermaid → PNG/SVG');
      expect(output).toContain('%% Stage 1: 配置加载');
      expect(output).toContain('%% ConfigLoader 使用 Builder Pattern 加载配置');
      expect(output).toContain('%% Namespace: Configuration');
      expect(output).toContain('%% Patterns: Builder Pattern');
      expect(output).toContain('%% Stage 2: 文件发现');
      expect(output).toContain('%% Stage 3: 解析处理');
      expect(output).toContain('%% Patterns: Facade Pattern, Strategy Pattern');
      expect(output).toContain('%% Stage 4: 图表生成');
      expect(output).toContain('%% Key Dependencies:');
      expect(output).toContain('%%   - ts-morph');
      expect(output).toContain('%%   - isomorphic-mermaid');
      expect(output).toContain('%%   - sharp');
      expect(output).toContain('%%   - zod');
    });

    it('should generate process comments with only dataFlow', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        process: {
          dataFlow: 'Input → Parse → Output',
        },
      };

      const output = generator.generateProcessComments(config);

      expect(output).toContain('%% Data Flow: Input → Parse → Output');
      expect(output).not.toContain('%% Stage');
    });

    it('should return empty string when process is absent', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
      };

      const output = generator.generateProcessComments(config);

      expect(output).toBe('');
    });
  });

  describe('generateUsageComments', () => {
    it('should generate usage scenario comments', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
        metadata: {
          purpose: '展示 CLI 处理流程',
          input: {
            type: 'CLI Command',
            example: 'archguard analyze -s ./src',
          },
          output: {
            description: '架构图文件',
            example: 'archguard/overview.png',
          },
        },
        process: {
          dataFlow: 'CLI → Config → Parse → Generate',
        },
      };

      const output = generator.generateUsageComments(config);

      expect(output).toContain('%% Usage Scenario');
      expect(output).toContain('%% Purpose: 展示 CLI 处理流程');
      expect(output).toContain('%% User Action:');
      expect(output).toContain('%%   archguard analyze -s ./src');
      expect(output).toContain('%% Processing:');
      expect(output).toContain('%%   CLI → Config → Parse → Generate');
      expect(output).toContain('%% Result:');
      expect(output).toContain('%%   archguard/overview.png');
    });

    it('should return empty string when usage info is incomplete', () => {
      const config: DiagramConfig = {
        name: 'test',
        sources: ['./src'],
        level: 'class',
      };

      const output = generator.generateUsageComments(config);

      expect(output).toBe('');
    });
  });

  describe('generateAll', () => {
    it('should generate complete comments with all sections', () => {
      const config: DiagramConfig = {
        name: 'complete-test',
        sources: ['./src'],
        level: 'class',
        metadata: {
          title: 'Complete Test',
          purpose: 'Test all comment sections',
          input: { type: 'Test Input' },
          output: { description: 'Test Output' },
        },
        design: {
          patterns: [
            {
              name: 'Test Pattern',
              category: 'structural',
              participants: ['TestClass'],
              description: 'Test pattern description',
            },
          ],
        },
        process: {
          dataFlow: 'Input → Output',
        },
      };

      const output = generator.generateAll(config);

      // Should contain all sections
      expect(output).toContain('%% Complete Test');
      expect(output).toContain('%% Purpose: Test all comment sections');
      expect(output).toContain('%% Design Patterns');
      expect(output).toContain('%% Processing Flow');
      expect(output).toContain('%% Usage Scenario');
    });

    it('should handle config with no metadata gracefully', () => {
      const config: DiagramConfig = {
        name: 'minimal',
        sources: ['./src'],
        level: 'class',
      };

      const output = generator.generateAll(config);

      expect(output).toBe('');
    });

    it('should only include non-empty sections', () => {
      const config: DiagramConfig = {
        name: 'partial',
        sources: ['./src'],
        level: 'class',
        metadata: {
          title: 'Partial Test',
        },
      };

      const output = generator.generateAll(config);

      expect(output).toContain('%% Partial Test');
      expect(output).not.toContain('%% Design Patterns');
      expect(output).not.toContain('%% Processing Flow');
    });
  });
});

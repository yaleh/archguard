/**
 * Unit Tests for Enhanced Configuration Types (v2.1)
 *
 * Breaking Change: Metadata enhancement - Diagram self-documentation
 * @version 2.1.0
 */

import { describe, it, expect } from 'vitest';
import type {
  DiagramConfig,
  DiagramMetadata,
  DesignInfo,
  ProcessInfo,
  AnnotationConfig,
  ClassHighlightConfig,
} from '@/types/config.js';

describe('Configuration Types v2.1 - Metadata Enhancement', () => {
  describe('DiagramMetadata', () => {
    it('should accept complete metadata', () => {
      const metadata: DiagramMetadata = {
        title: 'Parser Layer Architecture',
        subtitle: 'Source Code Analysis',
        purpose: '展示如何将 TypeScript 源代码解析为 ArchJSON',
        primaryActors: ['Developer', 'Architect'],
        input: {
          type: 'TypeScript source files',
          description: '*.ts files in the source directory',
          example: './src/**/*.ts',
        },
        output: {
          description: 'ArchJSON structure with entities and relations',
          formats: ['JSON', 'Mermaid'],
          example: 'architecture.json',
        },
      };

      expect(metadata.title).toBe('Parser Layer Architecture');
      expect(metadata.purpose).toBeDefined();
      expect(metadata.input?.type).toBe('TypeScript source files');
      expect(metadata.output?.formats).toEqual(['JSON', 'Mermaid']);
    });

    it('should accept minimal metadata (only title)', () => {
      const metadata: DiagramMetadata = {
        title: 'Test Diagram',
      };

      expect(metadata.title).toBe('Test Diagram');
      expect(metadata.purpose).toBeUndefined();
      expect(metadata.input).toBeUndefined();
    });

    it('should accept empty metadata', () => {
      const metadata: DiagramMetadata = {};

      expect(metadata).toBeDefined();
    });
  });

  describe('DesignInfo', () => {
    it('should accept complete design information', () => {
      const design: DesignInfo = {
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
        decisions: [
          {
            topic: 'Parser Architecture',
            decision: '使用 ts-morph 而非直接使用 TypeScript Compiler API',
            rationale: 'ts-morph 提供更简洁的 API，减少样板代码',
            alternatives: ['TypeScript Compiler API', 'eslint AST'],
          },
        ],
      };

      expect(design.architectureStyle).toBe('layered');
      expect(design.patterns).toHaveLength(2);
      expect(design.patterns[0].category).toBe('behavioral');
      expect(design.principles).toHaveLength(2);
      expect(design.decisions).toBeDefined();
    });

    it('should accept design info with only patterns', () => {
      const design: DesignInfo = {
        patterns: [
          {
            name: 'Builder Pattern',
            category: 'creational',
            participants: ['ConfigLoader'],
            description: '分步构建配置',
          },
        ],
      };

      expect(design.patterns).toHaveLength(1);
      expect(design.architectureStyle).toBeUndefined();
    });
  });

  describe('ProcessInfo', () => {
    it('should accept complete process information', () => {
      const process: ProcessInfo = {
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
      };

      expect(process.stages).toBe(4);
      expect(process.dataFlow).toContain('CLI Command');
      expect(process.stageList).toHaveLength(4);
      expect(process.stageList[0].patterns).toEqual(['Builder Pattern']);
      expect(process.keyDependencies).toContain('ts-morph');
    });

    it('should accept process info with only dataFlow', () => {
      const process: ProcessInfo = {
        dataFlow: 'Input → Parse → Output',
      };

      expect(process.dataFlow).toBe('Input → Parse → Output');
      expect(process.stages).toBeUndefined();
    });
  });

  describe('AnnotationConfig', () => {
    it('should accept complete annotation configuration', () => {
      const annotations: AnnotationConfig = {
        enableComments: true,
        highlightPatterns: true,
        showExternalDeps: true,
        includeUsageExample: true,
      };

      expect(annotations.enableComments).toBe(true);
      expect(annotations.highlightPatterns).toBe(true);
    });

    it('should accept annotation config with only enableComments', () => {
      const annotations: AnnotationConfig = {
        enableComments: false,
      };

      expect(annotations.enableComments).toBe(false);
    });
  });

  describe('ClassHighlightConfig', () => {
    it('should accept complete class highlight configuration', () => {
      const classes: ClassHighlightConfig = {
        highlightClasses: ['ConfigLoader', 'DiagramProcessor', 'ProgressReporter'],
        annotateClasses: [
          {
            className: 'ConfigLoader',
            note: '分步构建: 加载文件 → 合并 CLI 选项 → Zod 验证',
            stereotypes: ['<<Builder>>'],
            responsibility: '加载并验证配置文件',
          },
          {
            className: 'DiagramProcessor',
            note: '处理链: Config → Discovery → Parse → Generate → Render',
            stereotypes: ['<<Chain of Responsibility>>', '<<Core>>'],
            responsibility: '协调整个图表处理流程',
          },
        ],
        visibility: {
          show: ['PublicClass', 'InternalClass'],
          hide: ['PrivateClass', 'TestHelper'],
        },
      };

      expect(classes.highlightClasses).toHaveLength(3);
      expect(classes.annotateClasses).toHaveLength(2);
      expect(classes.annotateClasses[0].stereotypes).toEqual(['<<Builder>>']);
      expect(classes.visibility?.show).toContain('PublicClass');
    });

    it('should accept class highlight config with only highlightClasses', () => {
      const classes: ClassHighlightConfig = {
        highlightClasses: ['CoreClass'],
      };

      expect(classes.highlightClasses).toContain('CoreClass');
      expect(classes.annotateClasses).toBeUndefined();
    });
  });

  describe('DiagramConfig with metadata enhancement', () => {
    it('should accept DiagramConfig with all new fields', () => {
      const config: DiagramConfig = {
        name: 'parser-architecture',
        sources: ['./src/parser'],
        level: 'class',
        description: '旧字段 (deprecated)', // 保留向后兼容

        // 新增元数据字段
        metadata: {
          title: 'Parser Layer Architecture',
          purpose: '展示如何将 TypeScript 源代码解析为 ArchJSON',
          input: {
            type: 'TypeScript source files',
            example: './src/**/*.ts',
          },
          output: {
            description: 'ArchJSON structure',
            formats: ['JSON'],
          },
        },
        design: {
          architectureStyle: 'layered',
          patterns: [
            {
              name: 'Strategy Pattern',
              category: 'behavioral',
              participants: ['ClassExtractor', 'MethodExtractor'],
              description: '不同元素使用不同策略',
            },
          ],
        },
        process: {
          stages: 3,
          dataFlow: 'TypeScript Code → AST → ArchJSON',
        },
        annotations: {
          enableComments: true,
          highlightPatterns: true,
          includeUsageExample: true,
        },
        classes: {
          highlightClasses: ['TypeScriptParser'],
        },
      };

      expect(config.metadata?.title).toBe('Parser Layer Architecture');
      expect(config.design?.patterns).toHaveLength(1);
      expect(config.process?.stages).toBe(3);
      expect(config.annotations?.enableComments).toBe(true);
    });

    it('should accept DiagramConfig without new fields (backward compatibility)', () => {
      const config: DiagramConfig = {
        name: 'simple',
        sources: ['./src'],
        level: 'class',
      };

      expect(config.name).toBe('simple');
      expect(config.metadata).toBeUndefined();
      expect(config.design).toBeUndefined();
    });
  });
});

/**

import { MermaidParseValidator } from './validator-parse.js';
import type { ValidationError } from './types.js';

/**
export class MermaidAutoRepair {
  constructor(private parseValidator: MermaidParseValidator) {}

  /**
  async repair(mermaidCode: string, errors: ValidationError[]): Promise<string> {
    let repaired = mermaidCode;

    repaired = this.addDiagramDeclaration(repaired);
    repaired = this.fixGenericTypes(repaired);
    repaired = this.flattenNestedNamespaces(repaired);
    repaired = this.extractNamespaceRelations(repaired);
    repaired = this.fixTrailingCommas(repaired);
    repaired = this.normalizeWhitespace(repaired);

    const result = await this.parseValidator.validate(repaired);

    if (result.valid) {
      return repaired;
    }

    repaired = await this.attemptAdvancedRepairs(repaired, result.errors);

    const finalResult = await this.parseValidator.validate(repaired);
    if (finalResult.valid) {
      return repaired;
    }

    throw new Error(
      `Cannot repair Mermaid code. Errors: ${finalResult.errors.map((e) => e.message).join(', ')}`
    );
  }

  /**
  private addDiagramDeclaration(code: string): string {
    const trimmed = code.trim();

    const hasDeclaration = /^\s*(classDiagram|flowchart|stateDiagram|erDiagram|gitGraph)/m.test(
      trimmed
    );

    if (!hasDeclaration && trimmed.length > 0) {
      return `classDiagram\n${trimmed}`;
    }

    return code;
  }

  /**
  private fixGenericTypes(code: string): string {
    let repaired = code;

    const genericPattern = /(\w+)<([^>]+)>/g;

    repaired = repaired.replace(genericPattern, (match, className, generics) => {
      const cleanGenerics = generics.replace(/\s*,\s*/g, ',').replace(/\s+/g, '');
      return `${className}~${cleanGenerics}~`;
    });

    return repaired;
  }

  /**
  private flattenNestedNamespaces(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];
    let namespaceDepth = 0;
    let currentNamespace = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('namespace ')) {
        if (namespaceDepth === 0) {
          result.push(line);
          currentNamespace = trimmed;
        }
        namespaceDepth++;
      } else if (trimmed === '}') {
        namespaceDepth--;
        if (namespaceDepth === 0) {
          result.push(line);
          currentNamespace = '';
        }
      } else if (namespaceDepth <= 1) {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
  private extractNamespaceRelations(code: string): string {
    const lines = code.split('\n');
    const relations: string[] = [];
    const result: string[] = [];
    let inNamespace = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('namespace ')) {
        inNamespace = true;
        result.push(line);
      } else if (trimmed === '}') {
        inNamespace = false;
        result.push(line);
      } else if (inNamespace && this.isRelationLine(trimmed)) {
        relations.push(line);
      } else {
        result.push(line);
      }
    }

    if (relations.length > 0) {
      result.push('');
      result.push('// Relations extracted from namespaces');
      result.push(...relations);
    }

    return result.join('\n');
  }

  /**
  private isRelationLine(line: string): boolean {
    const relationPatterns = [
      /\w+\s*-->/,
      /\w+\s*<--/,
      /\w+\s*--/,
      /\w+\s*\.\./,
      /\w+\s*<\|/,
      /\w+\s*\|>/,
    ];

    return relationPatterns.some((pattern) => pattern.test(line));
  }

  /**
  private fixTrailingCommas(code: string): string {
    let repaired = code;

    repaired = repaired.replace(/,(\s*$)/gm, '$1');
    repaired = repaired.replace(/,(\s*\n)/gm, '\n');
    repaired = repaired.replace(/,(\s*})/g, '$1');

    return repaired;
  }

  /**
  private normalizeWhitespace(code: string): string {
    let repaired = code;

    repaired = repaired.replace(/\n{3,}/g, '\n\n');

    repaired = repaired
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');

    repaired = repaired.replace(/\n+$/, '\n');

    return repaired;
  }

  /**
  private async attemptAdvancedRepairs(code: string, errors: ValidationError[]): Promise<string> {
    let repaired = code;

    for (const error of errors) {
      if (error.code === 'SYNTAX_ERROR' && error.line) {
        repaired = this.fixLineError(repaired, error);
      }

      if (error.message.toLowerCase().includes('unknown')) {
        repaired = this.removeUnknownTokens(repaired);
      }

      if (error.message.toLowerCase().includes('unexpected')) {
        repaired = this.fixUnexpectedToken(repaired);
      }
    }

    return repaired;
  }

  /**
  private fixLineError(code: string, error: ValidationError): string {
    const lines = code.split('\n');

    if (error.line && error.line >= 1 && error.line <= lines.length) {
      const lineIndex = error.line - 1;
      const line = lines[lineIndex];

      let fixed = line;

      if (fixed.includes('{') && !fixed.includes('}')) {
        fixed = fixed + ' {';
      }

      if (!fixed.includes('{') && fixed.includes('class')) {
        fixed = fixed + ' {';
      }

      fixed = fixed.replace(/[|{}[\]]/g, '');

      lines[lineIndex] = fixed;
    }

    return lines.join('\n');
  }

  /**
  private removeUnknownTokens(code: string): string {
    const repaired = code;

    const lines = repaired.split('\n');
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) return true;
      if (/^\s*(classDiagram|class|namespace|%%)/.test(trimmed)) return true;
      if (/^\s*\w+\s*(-->\|<--\|--|<\|\.\.|\.\.|-->)/.test(trimmed)) return true;
      if (/^\s*[\+\-#]\s*\w+/.test(trimmed)) return true;

      return !/[|{}\[\]\\]/.test(trimmed);
    });

    return filtered.join('\n');
  }

  /**
  private fixUnexpectedToken(code: string): string {
    let repaired = code;

    repaired = repaired.replace(/\|/g, '_');
    repaired = repaired.replace(/\[/g, '(');
    repaired = repaired.replace(/\]/g, ')');

    return repaired;
  }

  /**
  async repairBestEffort(mermaidCode: string): Promise<{ repaired: string; successful: boolean }> {
    let repaired = mermaidCode;

    repaired = this.addDiagramDeclaration(repaired);
    repaired = this.fixGenericTypes(repaired);
    repaired = this.flattenNestedNamespaces(repaired);
    repaired = this.extractNamespaceRelations(repaired);
    repaired = this.fixTrailingCommas(repaired);
    repaired = this.normalizeWhitespace(repaired);

    const result = await this.parseValidator.validate(repaired);

    return {
      repaired,
      successful: result.valid,
    };
  }
}
/**

import type { DiagramConfig } from '../types/config.js';

/**
export class CommentGenerator {
  /**
  generateHeader(config: DiagramConfig): string {
    const meta = config.metadata;

    if (!meta) return '';

    let output = '\n%% ============================================================\n';
    output += `%% ${meta.title || config.name}\n`;

    if (meta.subtitle) {
      output += `%% ${meta.subtitle}\n`;
    }

    output += '%% ============================================================\n';

    if (meta.purpose) {
      output += `\n%% Purpose: ${meta.purpose}\n`;
    }

    if (meta.primaryActors && meta.primaryActors.length > 0) {
      output += `\n%% Primary Actors: ${meta.primaryActors.join(', ')}\n`;
    }

    if (meta.input || meta.output) {
      output += '\n%% ============================================================\n';

      if (meta.input) {
        output += `\n%% Input:\n`;
        output += `%%   Type: ${meta.input.type}\n`;
        if (meta.input.description) {
          output += `%%   Description: ${meta.input.description}\n`;
        }
        if (meta.input.example) {
          output += `%%   Example: ${meta.input.example}\n`;
        }
      }

      if (meta.output) {
        output += `\n%% Output:\n`;
        output += `%%   Description: ${meta.output.description}\n`;
        if (meta.output.formats) {
          output += `%%   Formats: ${meta.output.formats.join(', ')}\n`;
        }
        if (meta.output.example) {
          output += `%%   Example: ${meta.output.example}\n`;
        }
      }

      output += '\n%% ============================================================\n';
    }

    return output;
  }

  /**
  generatePatternComments(config: DiagramConfig): string {
    const design = config.design;

    if (!design?.patterns || design.patterns.length === 0) {
      return '';
    }

    let output = '\n%% ============================================================\n';
    output += `%% Design Patterns (${design.patterns.length})\n`;
    output += '%% ============================================================\n';

    if (design.architectureStyle) {
      output += `\n%% Architecture Style: ${design.architectureStyle}\n`;
    }

    output += '\n';

    for (const pattern of design.patterns) {
      output += `%% ${pattern.name} (${pattern.category})\n`;
      output += `%%   Participants: ${pattern.participants.join(', ')}\n`;
      output += `%%   Description: ${pattern.description}\n`;

      if (pattern.codeExample) {
        output += `%%   Example:\n%%     ${pattern.codeExample}\n`;
      }

      output += '\n';
    }

    if (design.principles && design.principles.length > 0) {
      output += '%% Key Principles:\n';
      for (const principle of design.principles) {
        output += `%%   - ${principle}\n`;
      }
    }

    output += '%% ============================================================\n';

    return output;
  }

  /**
  generateProcessComments(config: DiagramConfig): string {
    const process = config.process;

    if (!process) return '';

    let output = '\n%% ============================================================\n';
    output += '%% Processing Flow\n';
    output += '%% ============================================================\n';

    if (process.dataFlow) {
      output += `\n%% Data Flow: ${process.dataFlow}\n`;
    }

    if (process.stageList && process.stageList.length > 0) {
      output += '\n';

      for (const stage of process.stageList) {
        output += `\n%% Stage ${stage.order}: ${stage.name}\n`;
        output += `%% ${stage.description}\n`;

        if (stage.namespace) {
          output += `%% Namespace: ${stage.namespace}\n`;
        }

        if (stage.patterns && stage.patterns.length > 0) {
          output += `%% Patterns: ${stage.patterns.join(', ')}\n`;
        }
      }
    }

    if (process.keyDependencies && process.keyDependencies.length > 0) {
      output += '\n%% Key Dependencies:\n';
      for (const dep of process.keyDependencies) {
        output += `%%   - ${dep}\n`;
      }
    }

    output += '\n%% ============================================================\n';

    return output;
  }

  /**
  generateUsageComments(config: DiagramConfig): string {
    const meta = config.metadata;
    const process = config.process;

    if (!meta?.purpose && !process?.dataFlow) {
      return '';
    }

    let output = '\n%% ============================================================\n';
    output += '%% Usage Scenario\n';
    output += '%% ============================================================\n';

    if (meta?.purpose) {
      output += `\n%% Purpose: ${meta.purpose}\n`;
    }

    if (meta?.input?.example) {
      output += `\n%% User Action:\n%%   ${meta.input.example}\n`;
    }

    if (process?.dataFlow) {
      output += `\n%% Processing:\n%%   ${process.dataFlow}\n`;
    }

    if (meta?.output?.example) {
      output += `\n%% Result:\n%%   ${meta.output.example}\n`;
    }

    output += '\n%% ============================================================\n';

    return output;
  }

  /**
  generateAll(config: DiagramConfig): string {
    const parts: string[] = [];

    parts.push(this.generateHeader(config));

    parts.push(this.generateProcessComments(config));

    parts.push(this.generatePatternComments(config));

    parts.push(this.generateUsageComments(config));

    return parts.filter((p) => p.length > 0).join('\n');
  }

  /**
  generateVisibleTitle(config: DiagramConfig): string {
    if (!config.annotations?.enableVisibleTitle) {
      return '';
    }

    const meta = config.metadata;
    if (!meta) {
      return '';
    }

    const sections = config.annotations.visibleTitleSections || [
      'title',
      'subtitle',
      'purpose',
      'input',
      'output',
      'patterns',
      'principles',
      'process',
    ];

    const lines: string[] = [];

    if (sections.includes('title')) {
      if (meta.title) {
        lines.push(`**${meta.title}**`);
      } else {
        lines.push(`**${config.name}**`);
      }
    }

    if (sections.includes('subtitle') && meta.subtitle) {
      lines.push(meta.subtitle);
    }

    if (sections.includes('purpose') && meta.purpose) {
      lines.push(`用途: ${meta.purpose}`);
    }

    if (sections.includes('input') && meta.input) {
      if (meta.input.type) {
        lines.push(`输入: ${meta.input.type}`);
        if (meta.input.example) {
          lines.push(`  示例: ${meta.input.example}`);
        }
      }
    }

    if (sections.includes('output') && meta.output) {
      if (meta.output.description) {
        lines.push(`输出: ${meta.output.description}`);
      }
      if (meta.output.formats) {
        lines.push(`  格式: ${meta.output.formats.join(', ')}`);
      }
    }

    if (sections.includes('patterns')) {
      const design = config.design;
      if (design?.patterns && design.patterns.length > 0) {
        const patternNames = design.patterns.map((p) => p.name).join(', ');
        lines.push(`设计模式: ${patternNames}`);
      }
    }

    if (sections.includes('principles')) {
      const design = config.design;
      if (design?.principles && design.principles.length > 0) {
        lines.push(`原则: ${design.principles.join(', ')}`);
      }
    }

    if (sections.includes('process')) {
      const process = config.process;
      if (process?.dataFlow) {
        lines.push(`流程: ${process.dataFlow}`);
      }
    }

    if (lines.length === 0) {
      return '';
    }

    const content = lines.join('\n');
    return `\nnote for Diagram "${content}"\n`;
  }
}
import type { ArchJSON } from '@/types/index.js';

/**
export class CppPackageFlowchartGenerator {
  generate(archJSON: ArchJSON): string {
    const { entities, relations } = archJSON;

    if (!entities || entities.length === 0) {
      return 'flowchart LR\n  empty["(no packages found)"]';
    }

    const lines: string[] = [
      "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80}}}%%",
      'flowchart LR',
    ];

    const sanitize = (id: string) => id.replace(/[.\-\/]/g, '_');

    for (const entity of entities) {
      const nodeId = sanitize(entity.id || entity.name);
      const label = entity.name;
      lines.push(`  ${nodeId}["${label}"]`);
    }

    const entityIds = new Set(entities.map((e) => sanitize(e.id || e.name)));
    for (const rel of relations ?? []) {
      const srcId = sanitize(rel.source);
      const tgtId = sanitize(rel.target);
      if (!entityIds.has(srcId) || !entityIds.has(tgtId)) continue;

      let arrow = '-->';
      if (rel.type === 'composition') arrow = '-->';
      else if (rel.type === 'aggregation') arrow = '--->';
      lines.push(`  ${srcId} ${arrow} ${tgtId}`);
    }

    return lines.join('\n');
  }
}
/**

import type { ArchJSON } from '../types/index.js';
import type { GlobalConfig, DetailLevel, DiagramConfig } from '../types/config.js';
import type { GroupingDecision } from './types.js';
import { HeuristicGrouper } from './grouper.js';
import { ValidatedMermaidGenerator } from './generator.js';
import { MermaidValidationPipeline } from './validation-pipeline.js';
import { IsomorphicMermaidRenderer } from './renderer.js';
import { MermaidAutoRepair } from './auto-repair.js';
import { type IProgressReporter, NoopProgressReporter } from './progress.js';

/**
export interface MermaidOutputOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Base name for output files (without extension) */
  baseName: string;
  /** Full paths to output files */
  paths: {
    mmd: string;
    svg: string;
    png: string;
  };
}

/**
export interface RenderJob {
  /** Diagram name */
  name: string;
  /** Generated Mermaid code */
  mermaidCode: string;
  /** Output file paths */
  outputPath: {
    mmd: string;
    svg: string;
    png: string;
  };
}

/**
export class MermaidDiagramGenerator {
  private progress: IProgressReporter;

  constructor(
    private config: GlobalConfig,
    progress?: IProgressReporter
  ) {
    this.progress = progress ?? new NoopProgressReporter();
  }

  /**
  async generateOnly(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: DetailLevel,
    diagramConfig?: DiagramConfig
  ): Promise<RenderJob[]> {
    if (!archJson.entities || archJson.entities.length === 0) {
      return [];
    }

    const progress = this.progress;

    try {
      progress.start('🧠 Analyzing architecture...');
      const heuristicGrouper = new HeuristicGrouper();
      const grouping = heuristicGrouper.group(archJson);
      progress.succeed(`✅ Grouping complete: ${grouping.packages.length} groups`);

      progress.start('📝 Generating Mermaid code...');
      const generator = new ValidatedMermaidGenerator(
        archJson,
        {
          level,
          grouping,
          verbose: this.config.verbose || false,
        },
        diagramConfig // v2.1.0: Pass diagram config for metadata comments
      );

      const maxNodesPerDiagram = this.config.maxNodesPerDiagram ?? 150;
      const splitDiagrams =
        level === 'class' || level === 'method'
          ? generator.generateClassDiagrams(maxNodesPerDiagram)
          : [{ name: null as string | null, content: generator.generate() }];

      const isSplit = splitDiagrams.length > 1 || splitDiagrams[0]?.name !== null;
      progress.succeed(
        isSplit
          ? `✅ Mermaid code generated (${splitDiagrams.length} splits)`
          : '✅ Mermaid code generated'
      );

      const baseDir = outputOptions.paths.mmd.replace(/\/[^/]+\.mmd$/, '');

      if (isSplit) {
        progress.succeed(`✅ Skipping validation for ${splitDiagrams.length} split diagrams`);

        return splitDiagrams
          .filter((d) => d.content.trim().length > 'classDiagram'.length)
          .map(({ name, content }) => {
            const safeName = (name ?? outputOptions.baseName).replace(/[^a-zA-Z0-9_-]/g, '_');
            const outputPath =
              name === null
                ? outputOptions.paths
                : {
                    mmd: `${baseDir}/${safeName}.mmd`,
                    svg: `${baseDir}/${safeName}.svg`,
                    png: `${baseDir}/${safeName}.png`,
                  };
            return { name: safeName, mermaidCode: content, outputPath };
          });
      }

      let mermaidCode = splitDiagrams[0].content;

      progress.start('🔍 Validating generated code...');
      const pipeline = new MermaidValidationPipeline(this.config);
      const report = await pipeline.validateFull(mermaidCode, archJson);

      if (!report.overallValid) {
        progress.fail('❌ Validation failed');

        console.error(pipeline.generateReport(report));

        progress.start('🔧 Attempting auto-repair...');
        const parseValidator = pipeline.getParseValidator();
        const autoRepair = new MermaidAutoRepair(parseValidator);

        try {
          const errors =
            report.stages
              .find((s) => s.name === 'parse')
              ?.result?.errors?.map((e: any) => ({
                message: e.message,
                line: e.line,
                column: e.column,
                severity: 'error' as const,
              })) || [];

          mermaidCode = await autoRepair.repair(mermaidCode, errors);

          const repairedReport = await pipeline.validateFull(mermaidCode, archJson);
          if (repairedReport.overallValid) {
            progress.succeed('✅ Repaired successfully');
          } else {
            throw new Error('Auto-repair completed but validation still fails');
          }
        } catch (repairError) {
          progress.fail('❌ Auto-repair failed');
          const errorMessages =
            report.stages
              .find((s) => s.name === 'parse')
              ?.result?.errors?.map((e: any) => `- ${e.message}`)
              .join('\n') || 'Unknown errors';

          throw new Error(`Validation failed and cannot be repaired.\nErrors:\n${errorMessages}`);
        }
      } else {
        progress.succeed('✅ Validation passed');
      }

      const qualityStage = report.stages.find((s) => s.name === 'quality');
      if (qualityStage && qualityStage.result) {
        const metrics = qualityStage.result;
        console.log('\n📊 Quality Metrics:');
        console.log(`  Overall Score: ${metrics.score?.toFixed(1) || 'N/A'}/100`);

        if (metrics.metrics) {
          console.log(`  Readability: ${metrics.metrics.readability?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Completeness: ${metrics.metrics.completeness?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Consistency: ${metrics.metrics.consistency?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Complexity: ${metrics.metrics.complexity?.toFixed(1) || 'N/A'}/100`);
        }

        if (metrics.suggestions && metrics.suggestions.length > 0) {
          console.log('\n⚠️  Quality Suggestions:');
          for (const suggestion of metrics.suggestions.slice(0, 3)) {
            console.log(`  - [${suggestion.impact || 'medium'}] ${suggestion.message}`);
          }
          if (metrics.suggestions.length > 3) {
            console.log(`  ... and ${metrics.suggestions.length - 3} more`);
          }
        }
      }

      return [
        {
          name: outputOptions.baseName,
          mermaidCode,
          outputPath: outputOptions.paths,
        },
      ];
    } catch (error) {
      progress.fail('❌ Generation failed');
      throw error;
    }
  }

  /**
  static async renderJobsInParallel(
    jobs: RenderJob[],
    concurrency: number,
    progress: IProgressReporter = new NoopProgressReporter()
  ): Promise<void> {
    const pMap = (await import('p-map')).default;

    try {
      progress.start(
        `🎨 Rendering ${jobs.length} diagram${jobs.length > 1 ? 's' : ''} in parallel...`
      );

      await pMap(
        jobs,
        async (job) => {
          const rendererOptions: any = {};
          rendererOptions.theme = { name: 'default' };
          rendererOptions.backgroundColor = 'transparent';

          const renderer = new IsomorphicMermaidRenderer(rendererOptions);
          await renderer.renderAndSave(job.mermaidCode, job.outputPath);
        },
        { concurrency }
      );

      progress.succeed(`✅ Rendered ${jobs.length} diagram${jobs.length > 1 ? 's' : ''}`);
    } catch (error) {
      progress.fail('❌ Rendering failed');
      throw error;
    }
  }

  /**
  async generateAndRender(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: DetailLevel,
    diagramConfig?: DiagramConfig
  ): Promise<void> {
    const progress = this.progress;

    try {
      progress.start('📝 Generating Mermaid code...');
      const allRenderJobs = await this.generateOnly(archJson, outputOptions, level, diagramConfig);
      progress.succeed(
        `✅ Generated ${allRenderJobs.length} Mermaid file${allRenderJobs.length > 1 ? 's' : ''}`
      );

      progress.start('🎨 Rendering diagram...');

      const rendererOptions: any = {};
      if (this.config.mermaid) {
        if (this.config.mermaid.theme && typeof this.config.mermaid.theme === 'string') {
          rendererOptions.theme = { name: this.config.mermaid.theme };
        } else if (this.config.mermaid.theme && typeof this.config.mermaid.theme === 'object') {
          rendererOptions.theme = this.config.mermaid.theme;
        }
        if (this.config.mermaid.transparentBackground) {
          rendererOptions.backgroundColor = 'transparent';
        }
      }

      const renderConcurrency = (this.config.concurrency || require('os').cpus().length) * 2;

      await MermaidDiagramGenerator.renderJobsInParallelWithConfig(
        allRenderJobs,
        renderConcurrency,
        rendererOptions
      );

      progress.succeed('✅ Diagram rendered successfully');

      console.log('\n✨ Generated files:');
      if (allRenderJobs.length === 1 && allRenderJobs[0]?.outputPath === outputOptions.paths) {
        console.log(`  📄 ${outputOptions.paths.mmd}`);
        console.log(`  🖼️  ${outputOptions.paths.svg}`);
        console.log(`  📊 ${outputOptions.paths.png}`);
      } else {
        for (const job of allRenderJobs) {
          console.log(`  📄 ${job.outputPath.mmd}`);
        }
      }
    } catch (error) {
      progress.fail('❌ Generation failed');
      throw error;
    }
  }

  /**
  private static async renderJobsInParallelWithConfig(
    jobs: RenderJob[],
    concurrency: number,
    rendererOptions: any
  ): Promise<void> {
    const pMap = (await import('p-map')).default;

    await pMap(
      jobs,
      async (job) => {
        const renderer = new IsomorphicMermaidRenderer(rendererOptions);
        await renderer.renderAndSave(job.mermaidCode, job.outputPath);
      },
      { concurrency }
    );
  }
}
/**

/**
export const EXTERNAL_DEPENDENCIES = new Set([
  'Project',
  'SourceFile',
  'ClassDeclaration',
  'InterfaceDeclaration',
  'EnumDeclaration',
  'PropertyDeclaration',
  'MethodDeclaration',
  'ConstructorDeclaration',
  'PropertySignature',
  'MethodSignature',
  'ParameterDeclaration',
  'Decorator',
  'TsMorphDecorator',
  'Type',
  'TypeNode',

  'EventEmitter',
  'ReadStream',
  'WriteStream',
  'Buffer',

  'z.infer',
  'ZodType',
  'ZodSchema',

  'Ora',
  'Commander',
  'Promise',
  'Array',
  'Map',
  'Set',
  'Date',
  'Error',
  'RegExp',
]);

/**
export function isExternalDependency(typeName: string): boolean {
  const baseName = typeName.split('<')[0].trim();
  return EXTERNAL_DEPENDENCIES.has(baseName);
}
import type { Entity, EntityType, Member, Relation } from '../types/index.js';

export const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  interface: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  enum: 'fill:#fff8c5,stroke:#d4a72c,color:#633c01',
  struct: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  trait: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  abstract_class: 'fill:#fdf4ff,stroke:#d2a8ff,color:#8250df',
  function: 'fill:#f6f8fa,stroke:#d0d7de,color:#57606a',
};

export function entityTypeToClassDef(type: EntityType): string {
  return type === 'class' ? 'classNode' : type;
}

export function normalizeEntityName(name: string): string {
  if (name.startsWith('import(')) {
    const match = name.match(/^import\([^)]+\)\.\s*([\w.]+)/);
    if (match) {
      return match[1];
    }
  }

  if (name.startsWith('import___')) {
    const parts = name.split('___');
    const lastPart = parts[parts.length - 1];
    if (lastPart) return lastPart;
  }

  const scopedMatch = name.match(/(?:\.ts|\.js)\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (scopedMatch) {
    return scopedMatch[1];
  }

  if (name.startsWith('{') || name.includes('=>')) {
    return '[Type]';
  }

  return name;
}

export function escapeId(id: string): string {
  if (!id) return 'Unknown';
  return id.replace(/<[^>]*>$/g, '').replace(/[^a-zA-Z0-9_]/g, '_');
}

export function normalizeTypeName(type: string): string {
  type = type.replace(/import\([^)]+\)\.\s*([\w.]+)/g, '$1');
  type = type.replace(/import___[^_]+___([\w]+)/g, '$1');
  return type;
}

export function sanitizeType(type: string): string {
  if (!type) return 'any';
  let simplified = normalizeTypeName(type);
  let prevLength: number;
  do {
    prevLength = simplified.length;
    simplified = simplified.replace(/\{[^{}]*\}/g, 'object');
  } while (simplified.length !== prevLength && simplified.includes('{'));

  const advancedTypePattern =
    /^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|ReturnType|Parameters|DeepPartial)<.+>$/;
  if (advancedTypePattern.test(simplified)) return 'any';

  simplified = simplified.replace(/\([^)]*\)\s*=>\s*/g, 'Function');
  while (simplified.includes('Promise<')) {
    simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
    simplified = simplified.replace(/\bPromise\b/g, 'any');
  }
  if (simplified.includes('|')) return 'any';
  if (simplified.includes('&')) return 'object';

  let prevLength2: number;
  do {
    prevLength2 = simplified.length;
    simplified = simplified.replace(/Array<[^>]+>/g, 'Array');
  } while (simplified.length !== prevLength2);
  simplified = simplified.replace(/\w+\[\]/g, 'Array');
  simplified = simplified.replace(/Array+/g, 'Array');

  while (simplified.match(/\w+</)) {
    simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
  }
  simplified = simplified.replace(/\bz\.infer\b/g, 'any');
  simplified = simplified.replace(/\s+/g, ' ').trim();
  if (simplified.length > 50 || simplified === '') return 'any';
  return simplified;
}

export function shouldIncludeMember(
  member: Member,
  options: { includePrivate: boolean; includeProtected: boolean }
): boolean {
  if (member.visibility === 'private' && !options.includePrivate) return false;
  if (member.visibility === 'protected' && !options.includeProtected) return false;
  return true;
}

export function getVisibilitySymbol(visibility: Member['visibility']): string {
  switch (visibility) {
    case 'public':
      return '+';
    case 'private':
      return '-';
    case 'protected':
      return '#';
    default:
      return '+';
  }
}

export function generateMemberLine(member: Member): string {
  const visibility = getVisibilitySymbol(member.visibility);
  const staticModifier = member.isStatic ? 'static ' : '';
  const abstractModifier = member.isAbstract ? 'abstract ' : '';

  if (member.type === 'property') {
    const readonly = member.isReadonly ? 'readonly ' : '';
    const optional = member.isOptional ? '?' : '';
    const type = member.fieldType ? `: ${sanitizeType(member.fieldType)}` : '';
    return `${visibility}${staticModifier}${abstractModifier}${readonly}${member.name}${optional}${type}`;
  }

  if (member.type === 'method' || member.type === 'constructor') {
    const asyncModifier = member.isAsync ? 'async ' : '';
    const returnType = member.returnType ? `: ${sanitizeType(member.returnType)}` : '';
    const params =
      member.parameters
        ?.map((parameter) => {
          const optional = parameter.isOptional ? '?' : '';
          const paramType = parameter.type ? `: ${sanitizeType(parameter.type)}` : '';
          return `${parameter.name}${optional}${paramType}`;
        })
        .join(', ') || '';

    return `${visibility}${staticModifier}${abstractModifier}${asyncModifier}${member.name}(${params})${returnType}`;
  }

  return `${visibility}${member.name}`;
}

export function generateRelationLine(
  relation: Relation,
  entityIdToName: Map<string, string>
): string {
  const resolve = (id: string): string =>
    escapeId(normalizeEntityName(entityIdToName.get(id) ?? id));
  const source = resolve(relation.source);
  const target = resolve(relation.target);
  switch (relation.type) {
    case 'inheritance':
      return `${target} <|-- ${source}`;
    case 'implementation':
      return `${target} <|.. ${source}`;
    case 'composition':
      return `${source} *-- ${target}`;
    case 'aggregation':
      return `${source} o-- ${target}`;
    case 'dependency':
    default:
      return `${source} --> ${target}`;
  }
}

export function isNoisyTarget(target: string): boolean {
  return (
    target.startsWith('{') ||
    target.startsWith('"') ||
    target.startsWith("'") ||
    target.startsWith('(') ||
    target.includes('=>') ||
    /^\d/.test(target) ||
    /^[A-Z]$/.test(target) ||
    /^[a-z]\w*\./.test(target)
  );
}

export function generateClassDefinition(
  entity: Entity,
  indent: number,
  options: { includePrivate: boolean; includeProtected: boolean }
): string[] {
  const lines: string[] = [];
  const padding = '  '.repeat(indent);
  const className = escapeId(normalizeEntityName(entity.name));
  lines.push(`${padding}class ${className} {`);
  for (const member of entity.members || []) {
    if (!shouldIncludeMember(member, options)) continue;
    lines.push(`${padding}  ${generateMemberLine(member)}`);
  }
  lines.push(`${padding}}`);
  return lines;
}
import type { ArchJSON } from '../types/index.js';
import type { GroupingDecision, PackageGroup } from './types.js';

export function groupEntitiesByPackage(
  archJson: ArchJSON,
  grouping: GroupingDecision
): PackageGroup[] {
  if (grouping.packages.length === 0) {
    return [
      {
        name: 'Default',
        entities: archJson.entities.map((entity) => entity.id),
        reasoning: 'Default package containing all entities',
      },
    ];
  }

  return grouping.packages.map((pkg) => ({
    name: pkg.name,
    entities: pkg.entities.filter((id) => archJson.entities.some((entity) => entity.id === id)),
    reasoning: pkg.reasoning,
  }));
}
import type { ArchJSON } from '../types/index.js';
import { isExternalDependency } from './external-dependencies.js';

export function validateGeneratorInput(archJson: ArchJSON, verbose: boolean): void {
  const entityIds = new Set(archJson.entities.map((entity) => entity.id));
  const filteredWarnings: string[] = [];

  for (const relation of archJson.relations) {
    const sourceExists = entityIds.has(relation.source);
    const targetExists = entityIds.has(relation.target);

    if (!sourceExists || !targetExists) {
      const sourceIsExternal = !sourceExists && isExternalDependency(relation.source);
      const targetIsExternal = !targetExists && isExternalDependency(relation.target);

      if (!sourceIsExternal || !targetIsExternal) {
        const warningParts: string[] = [];
        if (!sourceExists && !sourceIsExternal) warningParts.push(`source: ${relation.source}`);
        if (!targetExists && !targetIsExternal) warningParts.push(`target: ${relation.target}`);
        if (warningParts.length > 0) {
          filteredWarnings.push(
            `  - ${relation.source} -> ${relation.target} (${warningParts.join(', ')})`
          );
        }
      }
    }
  }

  if (filteredWarnings.length > 0) {
    console.warn(
      `⚠️  Warning: ${filteredWarnings.length} relation(s) reference undefined entities:`
    );
    console.warn(filteredWarnings.join('\n'));
  }

  if (verbose) {
    const filteredCount = archJson.relations.filter(
      (relation) =>
        (!entityIds.has(relation.source) && isExternalDependency(relation.source)) ||
        (!entityIds.has(relation.target) && isExternalDependency(relation.target))
    ).length;
    if (filteredCount > 0) {
      console.debug(`🔇 Filtered ${filteredCount} external dependency warning(s)`);
    }
  }

  for (const entity of archJson.entities) {
    if (entity.name.includes('\n') || entity.name.includes('"')) {
      throw new Error(`Invalid entity name: ${entity.name}`);
    }
  }
}
/**

import path from 'path';
import type { ArchJSON, Entity, Member, Relation } from '../types/index.js';
import type { DiagramConfig } from '../types/config.js';
import { globalEntityTypeRegistry, EntityTypeRegistry } from '@/core/entity-type-registry.js';
import type {
  MermaidDetailLevel,
  GroupingDecision,
  PackageGroup,
  MermaidGeneratorOptions,
  MermaidTheme,
} from './types.js';
import { CommentGenerator } from './comment-generator.js';
import { groupEntitiesByPackage } from './generator-grouping.js';
import { validateGeneratorInput } from './generator-validation.js';

const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  interface: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  enum: 'fill:#fff8c5,stroke:#d4a72c,color:#633c01',
  struct: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  trait: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  abstract_class: 'fill:#fdf4ff,stroke:#d2a8ff,color:#8250df',
  function: 'fill:#f6f8fa,stroke:#d0d7de,color:#57606a',
};

function entityTypeToClassDef(
  type: string,
  registry: EntityTypeRegistry = globalEntityTypeRegistry
): string {
  if (type === 'class') return 'classNode';
  if (type in ENTITY_CLASSDEF_STYLES) return type;
  const custom = registry.get(type);
  if (custom?.mermaidShape && custom.mermaidShape !== 'default') {
    return custom.mermaidShape === 'component' ? 'interface' : 'classNode';
  }
  return 'classNode'; // unknown type: plain box, never throws
}

/**
export class ValidatedMermaidGenerator {
  private readonly archJson: ArchJSON;
  private readonly options: Required<MermaidGeneratorOptions>;
  private readonly diagramConfig?: DiagramConfig;
  private readonly commentGenerator: CommentGenerator;
  private readonly verbose: boolean;
  private _entityIdToName: Map<string, string> | null = null;

  constructor(
    archJson: ArchJSON,
    options: {
      level: MermaidDetailLevel;
      grouping: GroupingDecision;
      theme?: MermaidTheme;
      includePrivate?: boolean;
      includeProtected?: boolean;
      maxDepth?: number;
      verbose?: boolean;
    },
    diagramConfig?: DiagramConfig
  ) {
    this.archJson = archJson;
    this.options = {
      level: options.level,
      grouping: options.grouping,
      theme: options.theme || { name: 'default' },
      includePrivate: options.includePrivate ?? true,
      includeProtected: options.includeProtected ?? true,
      maxDepth: options.maxDepth ?? 3,
    };
    this.diagramConfig = diagramConfig;
    this.verbose = options.verbose ?? false;
    this.commentGenerator = new CommentGenerator();
  }

  /**
  generate(): string {
    validateGeneratorInput(this.archJson, this.verbose);

    let diagramCode: string;
    switch (this.options.level) {
      case 'package':
        diagramCode = this.generatePackageLevel();
        break;
      case 'method':
        diagramCode = this.generateMethodLevel();
        break;
      case 'class':
      default:
        diagramCode = this.generateClassLevel();
        break;
    }

    const diagramLines = diagramCode.split('\n');
    const header = diagramLines.shift() || 'classDiagram';
    const lines: string[] = [header];

    if (this.diagramConfig && this.diagramConfig.annotations?.enableComments !== false) {
      const comments = this.commentGenerator.generateAll(this.diagramConfig);
      if (comments) {
        lines.push(comments);
        lines.push('');
      }
    }

    lines.push(...diagramLines);

    if (this.diagramConfig && this.diagramConfig.annotations?.enableVisibleTitle) {
      const visibleTitle = this.commentGenerator.generateVisibleTitle(this.diagramConfig);
      if (visibleTitle) {
        const position = this.diagramConfig.annotations.titlePosition || 'bottom';

        if (position === 'bottom') {
          lines.push(visibleTitle);
        } else {
          const insertIndex = lines.findIndex(
            (line) => !line.startsWith('%%') && line !== header
          );
          if (insertIndex !== -1) {
            lines.splice(insertIndex, 0, visibleTitle);
          }
        }
      }
    }

    const code = lines.join('\n');
    return this.postProcess(code);
  }

  /**
  private generatePackageLevel(): string {
    if (this.getArchitecturalLayers()) {
      return this.generateLayeredPackageLevel();
    }

    const lines: string[] = ['classDiagram'];

    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);

    for (const group of packageGroups) {
      const entityLines: string[] = [];
      for (const entityId of group.entities) {
        const entity = this.archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          entityLines.push(`    class ${this.escapeId(this.normalizeEntityName(entity.name))}`);
        }
      }
      if (entityLines.length === 0) continue;
      lines.push(`  namespace ${this.escapeId(group.name)} {`);
      lines.push(...entityLines);
      lines.push('  }');
    }

    lines.push(...this.generateRelations(packageGroups));

    return lines.join('\n');
  }

  private getArchitecturalLayers(): Record<string, string> | undefined {
    const layers = this.archJson.extensions?.projectSemantics?.architecturalLayers;
    return layers && Object.keys(layers).length > 0 ? layers : undefined;
  }

  private normalizePackagePath(filePath: string): string {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const workspaceRoot = this.archJson.workspaceRoot?.replace(/\\/g, '/');
    if (workspaceRoot && path.isAbsolute(filePath)) {
      return path.posix.dirname(path.posix.relative(workspaceRoot, normalizedFile));
    }
    return path.posix.dirname(normalizedFile);
  }

  private findMatchingLayer(
    packageName: string,
    layers: Record<string, string>
  ): { key: string; label: string } | null {
    const normalizedPackage = packageName.replace(/\\/g, '/');
    const candidates = Object.entries(layers)
      .map(([key, label]) => ({ key: key.replace(/\\/g, '/'), label }))
      .filter(
        ({ key }) =>
          normalizedPackage === key || normalizedPackage.startsWith(`${key}/`)
      )
      .sort((left, right) => right.key.length - left.key.length);

    return candidates[0] ?? null;
  }

  private generateLayeredPackageLevel(): string {
    const architecturalLayers = this.getArchitecturalLayers();
    if (!architecturalLayers) {
      return this.generatePackageLevel();
    }

    const direction = this.options.grouping.layout?.direction ?? 'TB';
    const lines: string[] = [`flowchart ${direction}`];
    const entityPackageIndex = new Map<string, string>();
    const packageNames: string[] = [];
    const seenPackages = new Set<string>();

    for (const entity of this.archJson.entities) {
      const sourceFile = entity.sourceLocation?.file;
      if (!sourceFile) continue;
      const packageName = this.normalizePackagePath(sourceFile);
      if (!packageName || packageName === '.') continue;
      entityPackageIndex.set(entity.id, packageName);
      entityPackageIndex.set(entity.name, packageName);
      if (!seenPackages.has(packageName)) {
        seenPackages.add(packageName);
        packageNames.push(packageName);
      }
    }

    const groupedPackages = new Map<string, string[]>();
    const unmatchedPackages: string[] = [];
    for (const packageName of packageNames) {
      const layerMatch = this.findMatchingLayer(packageName, architecturalLayers);
      if (!layerMatch) {
        unmatchedPackages.push(packageName);
        continue;
      }
      if (!groupedPackages.has(layerMatch.label)) {
        groupedPackages.set(layerMatch.label, []);
      }
      groupedPackages.get(layerMatch.label)?.push(packageName);
    }

    const nodeIdForPackage = (packageName: string) => this.escapeId(`pkg_${packageName}`);
    for (const [label, layerPackages] of groupedPackages.entries()) {
      if (layerPackages.length === 0) continue;
      lines.push(`  subgraph ${this.escapeId(`layer_${label}`)}["${label}"]`);
      for (const packageName of layerPackages) {
        lines.push(`    ${nodeIdForPackage(packageName)}["${packageName}"]`);
      }
      lines.push('  end');
    }

    for (const packageName of unmatchedPackages) {
      lines.push(`  ${nodeIdForPackage(packageName)}["${packageName}"]`);
    }

    const relationEdges = new Set<string>();
    for (const relation of this.archJson.relations) {
      const sourcePackage =
        entityPackageIndex.get(relation.source) ??
        entityPackageIndex.get(this.normalizeEntityName(relation.source));
      const targetPackage =
        entityPackageIndex.get(relation.target) ??
        entityPackageIndex.get(this.normalizeEntityName(relation.target));

      if (!sourcePackage || !targetPackage || sourcePackage === targetPackage) {
        continue;
      }

      const edge = `  ${nodeIdForPackage(sourcePackage)} --> ${nodeIdForPackage(targetPackage)}`;
      if (!relationEdges.has(edge)) {
        relationEdges.add(edge);
        lines.push(edge);
      }
    }

    return lines.join('\n');
  }

  /**
  private generateClassLevel(): string {
    const lines: string[] = ['classDiagram'];

    for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
      lines.push(`  classDef ${name} ${style}`);
    }
    lines.push('');

    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));
    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));

    const modulePrefixIndex = this.buildModulePrefixIndex(knownEntityIds);

    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        const entityLines: string[] = [];
        for (const entityId of group.entities) {
          const entity = visibleEntities.find((e) => e.id === entityId);
          if (entity) {
            entityLines.push(...this.generateClassDefinition(entity, 2, true));
          }
        }
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${this.escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }

      for (const relation of this.archJson.relations) {
        const sourceKnownDirect =
          knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
        const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
        const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
        const targetOk =
          knownEntityIds.has(relation.target) ||
          knownEntityNames.has(relation.target) ||
          sourceKnownViaPrefix || // Python module-level: skip noisy check for target too
          !this.isNoisyTarget(relation.target);
        if (sourceKnown && targetOk) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }
    } else {
      for (const entity of visibleEntities) {
        lines.push(...this.generateClassDefinition(entity, 1, true));
      }

      for (const relation of this.archJson.relations) {
        const sourceKnownDirect =
          knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
        const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
        const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
        const targetOk =
          knownEntityIds.has(relation.target) ||
          knownEntityNames.has(relation.target) ||
          sourceKnownViaPrefix || // Python module-level: skip noisy check for target too
          !this.isNoisyTarget(relation.target);
        if (sourceKnown && targetOk) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }
    }

    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsClass = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
      if (seenAnnotationsClass.has(normalizedId)) continue;
      seenAnnotationsClass.add(normalizedId);
      lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
    }

    return lines.join('\n');
  }

  /**
  private generateMethodLevel(): string {
    const lines: string[] = ['classDiagram'];

    for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
      lines.push(`  classDef ${name} ${style}`);
    }
    lines.push('');

    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));
    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));

    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        const entityLines: string[] = [];
        for (const entityId of group.entities) {
          const entity = visibleEntities.find((e) => e.id === entityId);
          if (entity) {
            entityLines.push(...this.generateClassDefinition(entity, 2, true));
          }
        }
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${this.escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }
    } else {
      for (const entity of visibleEntities) {
        lines.push(...this.generateClassDefinition(entity, 1, true));
      }
    }

    const modulePrefixIndexMethod = this.buildModulePrefixIndex(knownEntityIds);

    for (const relation of this.archJson.relations) {
      const sourceKnownDirect =
        knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
      const sourceKnownViaPrefix =
        !sourceKnownDirect && modulePrefixIndexMethod.has(relation.source);
      const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
      if (sourceKnown && (sourceKnownViaPrefix || !this.isNoisyTarget(relation.target))) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
    }

    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsMethod = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
      if (seenAnnotationsMethod.has(normalizedId)) continue;
      seenAnnotationsMethod.add(normalizedId);
      lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
    }

    return lines.join('\n');
  }

  /**
  private generateClassDefinition(entity: Entity, indent: number, detailed = false): string[] {
    const lines: string[] = [];
    const padding = '  '.repeat(indent);

    const className = this.escapeId(this.normalizeEntityName(entity.name));
    const classType = 'class'; // Mermaid classDiagram only uses the 'class' keyword
    lines.push(`${padding}${classType} ${className} {`);

    const members = entity.members || [];
    for (const member of members) {
      if (!this.shouldIncludeMember(member)) {
        continue;
      }

      const memberLine = this.generateMemberLine(member, detailed);
      lines.push(`${padding}  ${memberLine}`);
    }

    lines.push(`${padding}}`);


    return lines;
  }

  /**
  private generateMemberLine(member: Member, detailed: boolean): string {
    const visibility = this.getVisibilitySymbol(member.visibility);
    const staticModifier = member.isStatic ? 'static ' : '';
    const abstractModifier = member.isAbstract ? 'abstract ' : '';

    if (member.type === 'property') {
      const readonly = member.isReadonly ? 'readonly ' : '';
      const optional = member.isOptional ? '?' : '';
      const type = member.fieldType ? `: ${this.sanitizeType(member.fieldType)}` : '';
      return `${visibility}${staticModifier}${abstractModifier}${readonly}${member.name}${optional}${type}`;
    } else if (member.type === 'method' || member.type === 'constructor') {
      const async = member.isAsync ? 'async ' : '';
      const returnType = member.returnType ? `: ${this.sanitizeType(member.returnType)}` : '';

      const params =
        member.parameters
          ?.map((p) => {
            const optional = p.isOptional ? '?' : '';
            const paramType = p.type ? `: ${this.sanitizeType(p.type)}` : '';
            return `${p.name}${optional}${paramType}`;
          })
          .join(', ') || '';

      return `${visibility}${staticModifier}${abstractModifier}${async}${member.name}(${params})${returnType}`;
    } else {
      return `${visibility}${member.name}`;
    }
  }

  /**
  private normalizeEntityName(name: string): string {

    if (name.startsWith('import(')) {
      const match = name.match(/^import\([^)]+\)\.\s*([\w.]+)/);
      if (match) {
        return match[2]; // Return the class name after the dot
      }
    }

    if (name.startsWith('import___')) {
      const parts = name.split('___');
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length > 0) {
          return lastPart;
        }
      }
    }

    const scopedMatch = name.match(/(?:\.ts|\.js)\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (scopedMatch) {
      return scopedMatch[1];
    }

    if (name.startsWith('{') || name.includes('=>')) {
      return '[Type]';
    }

    return name;
  }

  private get entityIdToName(): Map<string, string> {
    if (!this._entityIdToName) {
      this._entityIdToName = new Map(this.archJson.entities.map((e) => [e.id, e.name]));
    }
    return this._entityIdToName;
  }

  /**
  private generateRelationLine(relation: Relation): string {
    const resolve = (id: string): string => {
      const simpleName = this.entityIdToName.get(id);
      return this.escapeId(this.normalizeEntityName(simpleName ?? id));
    };
    const source = resolve(relation.source);
    const target = resolve(relation.target);

    switch (relation.type) {
      case 'inheritance':
        return `${target} <|-- ${source}`;
      case 'implementation':
        return `${target} <|.. ${source}`;
      case 'composition':
        return `${source} *-- ${target}`;
      case 'aggregation':
        return `${source} o-- ${target}`;
      case 'dependency':
      default:
        return `${source} --> ${target}`;
    }
  }

  /**
  private isNoisyTarget(target: string): boolean {
    return (
      target.startsWith('{') || // inline object: { host: string }
      target.startsWith('"') || // string literal: "200"
      target.startsWith("'") || // string literal: '200'
      target.startsWith('(') || // function type: (a: A) => B
      target.includes('=>') || // arrow function type
      /^\d/.test(target) || // numeric literal: 100, 200
      /^[A-Z]$/.test(target) || // single-letter generic: T, K, V
      /^[a-z]\w*\./.test(target) // namespace-qualified utility type: z.infer, zod.any
    );
  }

  /**
  private buildModulePrefixIndex(entityIds: Set<string>): Map<string, string> {
    const index = new Map<string, string>();
    for (const entityId of entityIds) {
      const lastDot = entityId.lastIndexOf('.');
      if (lastDot > 0) {
        const moduleId = entityId.substring(0, lastDot);
        if (!index.has(moduleId)) {
          index.set(moduleId, entityId);
        }
      }
    }
    return index;
  }

  /**
  private generateRelations(_packageGroups: PackageGroup[]): string[] {
    const lines: string[] = [];
    const knownEntityNames = new Set(this.archJson.entities.map((e) => e.name));
    const knownEntityIds = new Set(this.archJson.entities.map((e) => e.id));
    const modulePrefixIndex = this.buildModulePrefixIndex(knownEntityIds);

    for (const relation of this.archJson.relations) {
      const sourceKnownDirect =
        knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
      const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
      const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
      if (sourceKnown && (sourceKnownViaPrefix || !this.isNoisyTarget(relation.target))) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
    }

    return lines;
  }

  /**
  private groupEntitiesByPackage(): PackageGroup[] {
    if (this.options.grouping.packages.length === 0) {
      return [
        {
          name: 'Default',
          entities: this.archJson.entities.map((e) => e.id),
          reasoning: 'Default package containing all entities',
        },
      ];
    }

    return this.options.grouping.packages.map((pkg) => ({
      name: pkg.name,
      entities: pkg.entities.filter((id) => this.archJson.entities.some((e) => e.id === id)),
      reasoning: pkg.reasoning,
    }));
  }

  /**
  private shouldIncludeMember(member: Member): boolean {
    if (member.visibility === 'private' && !this.options.includePrivate) {
      return false;
    }
    if (member.visibility === 'protected' && !this.options.includeProtected) {
      return false;
    }
    return true;
  }

  /**
  private getVisibilitySymbol(visibility: Member['visibility']): string {
    switch (visibility) {
      case 'public':
        return '+';
      case 'private':
        return '-';
      case 'protected':
        return '#';
      default:
        return '+';
    }
  }

  /**
  private escapeId(id: string): string {
    if (!id) return 'Unknown';

    let escaped = id;

    escaped = escaped.replace(/<[^>]*>$/g, '');

    return escaped.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
  private sanitizeType(type: string): string {
    if (!type) return 'any';

    type = this.normalizeTypeName(type);

    let simplified = type;

    let prevLength: number;
    do {
      prevLength = simplified.length;
      simplified = simplified.replace(/\{[^{}]*\}/g, 'object');
    } while (simplified.length !== prevLength && simplified.includes('{'));

    const advancedTypePattern =
      /^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|ReturnType|Parameters|DeepPartial)<.+>$/;
    if (advancedTypePattern.test(simplified)) {
      return 'any';
    }

    simplified = simplified.replace(/\([^)]*\)\s*=>\s*/g, 'Function');

    while (simplified.includes('Promise<')) {
      simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
      simplified = simplified.replace(/\bPromise\b/g, 'any');
    }

    if (simplified.includes('|')) {
      return 'any';
    }

    if (simplified.includes('&')) {
      return 'object';
    }

    let prevLength2: number;
    do {
      prevLength2 = simplified.length;
      simplified = simplified.replace(/Array<[^>]+>/g, 'Array');
    } while (simplified.length !== prevLength2); // Keep looping until no more changes
    simplified = simplified.replace(/\w+\[\]/g, 'Array'); // T[] -> Array
    simplified = simplified.replace(/Array+/g, 'Array'); // Collapse ArrayArray -> Array

    while (simplified.match(/\w+</)) {
      simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
    }
    simplified = simplified.replace(/\bz\.infer\b/g, 'any');

    simplified = simplified.replace(/\s+/g, ' ').trim();

    if (simplified.length > 50 || simplified === '') {
      return 'any';
    }

    return simplified;
  }

  /**
  private normalizeTypeName(type: string): string {
    const importPattern = /import\([^)]+\)\.\s*([\w.]+)/g;
    type = type.replace(importPattern, '$1');

    const importPathPattern = /import___[^_]+___([\w]+)/g;
    type = type.replace(importPathPattern, '$1');

    return type;
  }

  /**
  public generateClassDiagrams(
    maxNodesPerDiagram: number
  ): Array<{ name: string | null; content: string }> {
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);

    const visibleEntityIdSet = new Set(visibleEntities.map((e) => e.id));
    const visibleGroups = packageGroups.filter((g) =>
      g.entities.some((id) => visibleEntityIdSet.has(id))
    );

    const totalNodes = visibleEntities.length;

    const shouldSplit =
      totalNodes > maxNodesPerDiagram &&
      visibleGroups.length > 1 &&
      !(visibleGroups.length === 1 && visibleGroups[0].name === 'Default');

    if (!shouldSplit) {
      return [{ name: null, content: this.generate() }];
    }

    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));

    const results: Array<{ name: string | null; content: string }> = [];

    for (const group of visibleGroups) {
      const groupEntityIdSet = new Set(group.entities);
      const groupEntities = visibleEntities.filter((e) => groupEntityIdSet.has(e.id));

      if (groupEntities.length === 0) continue;

      const groupEntityNames = new Set(groupEntities.map((e) => e.name));

      const lines: string[] = ['classDiagram'];

      for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
        lines.push(`  classDef ${name} ${style}`);
      }
      lines.push('');

      lines.push(`  namespace ${this.escapeId(group.name)} {`);
      for (const entity of groupEntities) {
        lines.push(...this.generateClassDefinition(entity, 2, true));
      }
      lines.push('  }');

      const modulePrefixIndexGroup = this.buildModulePrefixIndex(knownEntityIds);

      for (const relation of this.archJson.relations) {
        const sourceInGroupDirect =
          groupEntityIdSet.has(relation.source) || groupEntityNames.has(relation.source);
        const sourceViaPrefix = !sourceInGroupDirect && modulePrefixIndexGroup.has(relation.source);
        const sourceInGroup = sourceInGroupDirect || sourceViaPrefix;
        const targetKnown =
          knownEntityIds.has(relation.target) || knownEntityNames.has(relation.target);
        const targetOk = targetKnown || sourceViaPrefix || !this.isNoisyTarget(relation.target);
        if (sourceInGroup && targetOk) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }

      lines.push('');
      lines.push('  %% Node type annotations');
      const seenAnnotations = new Set<string>();
      for (const entity of groupEntities) {
        const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
        if (seenAnnotations.has(normalizedId)) continue;
        seenAnnotations.add(normalizedId);
        lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
      }

      results.push({ name: group.name, content: this.postProcess(lines.join('\n')) });
    }

    return results;
  }

  /**
  private postProcess(code: string): string {
    let processed = code.trim();

    processed = processed.replace(/\n{3,}/g, '\n\n');

    return processed;
  }
}
/**

import type { ArchJSON } from '../types/index.js';
import type { GroupingDecision, PackageGroup, LayoutDecision, GrouperConfig } from './types.js';

/**
export class HeuristicGrouper {
  private readonly config: Required<GrouperConfig>;

  constructor(config?: Partial<GrouperConfig>) {
    this.config = {
      strategy: 'heuristic',
      maxPackages: config?.maxPackages ?? 10,
      maxEntitiesPerPackage: config?.maxEntitiesPerPackage ?? Infinity,
      customRules: config?.customRules ?? [],
    };
  }

  /**
  group(archJson: ArchJSON): GroupingDecision {
    if (archJson.entities.length === 0) {
      return {
        packages: [],
        layout: {
          direction: 'TB',
          reasoning: 'Default layout for empty architecture',
        },
      };
    }

    const customGrouped = this.applyCustomRules(archJson);
    if (customGrouped) {
      return customGrouped;
    }

    const packages = this.groupByPath(archJson);

    const mergedPackages = this.mergeSmallPackages(packages);

    const limitedPackages = this.applyLimits(mergedPackages);

    const layout = this.generateLayoutDecision(limitedPackages);

    return {
      packages: limitedPackages,
      layout,
    };
  }

  /**
  private applyCustomRules(archJson: ArchJSON): GroupingDecision | null {
    if (this.config.customRules.length === 0) {
      return null;
    }

    const packageMap = new Map<string, string[]>();
    const usedEntityIds = new Set<string>();

    const sortedRules = [...this.config.customRules].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    for (const rule of sortedRules) {
      for (const entity of archJson.entities) {
        if (usedEntityIds.has(entity.id)) {
          continue;
        }

        if (rule.pattern.test(entity.sourceLocation.file)) {
          if (!packageMap.has(rule.packageName)) {
            packageMap.set(rule.packageName, []);
          }
          packageMap.get(rule.packageName).push(entity.id);
          usedEntityIds.add(entity.id);
        }
      }
    }

    if (packageMap.size === 0) {
      return null;
    }

    const packages: PackageGroup[] = Array.from(packageMap.entries()).map(([name, entities]) => ({
      name,
      entities,
      reasoning: 'Grouped by custom rule',
    }));

    return {
      packages,
      layout: {
        direction: 'TB',
        reasoning: 'Layout based on custom grouping rules',
      },
    };
  }

  /**
  private groupByPath(archJson: ArchJSON): PackageGroup[] {
    const packageMap = new Map<string, string[]>();
    const reasoningMap = new Map<string, string>();

    for (const entity of archJson.entities) {
      const isPathBased = entity.type === 'package' || entity.name.includes('/');
      const javaModuleName =
        archJson.language === 'java'
          ? this.extractJavaMavenModuleName(entity.sourceLocation.file)
          : null;
      const packageName = isPathBased
        ? entity.name.split('/')[0]
        : (javaModuleName ?? this.extractPackageName(entity.sourceLocation.file));

      if (!packageMap.has(packageName)) {
        packageMap.set(packageName, []);
      }

      if (javaModuleName) {
        reasoningMap.set(packageName, `Grouped by Maven module: ${packageName}`);
      }

      packageMap.get(packageName).push(entity.id);
      if (isPathBased) {
        reasoningMap.set(packageName, `Grouped by path: ${packageName}/`);
      }
    }

    return Array.from(packageMap.entries()).map(([rawName, entities]) => ({
      name: this.formatPackageName(rawName),
      entities,
      reasoning: reasoningMap.get(rawName) ?? `Grouped by path: ${rawName}`,
    }));
  }

  private extractJavaMavenModuleName(filePath: string): string | null {
    if (!filePath || filePath.trim() === '') {
      return null;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/([^/]+)\/src\/(?:main|test)\/java\//);
    if (!match) {
      return null;
    }

    const moduleName = match[1];
    if (!moduleName || moduleName === 'src') {
      return null;
    }

    return moduleName;
  }

  /**
  private extractPackageName(filePath: string): string {
    if (!filePath || filePath.trim() === '') {
      return 'core';
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');

    const srcIndex = parts.findIndex((p) =>
      ['src', 'lib', 'packages', 'app', 'server', 'client'].includes(p)
    );

    if (srcIndex >= 0) {
      if (parts[srcIndex] === 'packages' && srcIndex + 1 < parts.length) {
        const packageName = parts[srcIndex + 1];
        if (packageName) {
          return packageName;
        }
      }

      if (srcIndex + 1 < parts.length) {
        const nextPart = parts[srcIndex + 1];

        if (
          nextPart &&
          !['index', 'types', 'interfaces', 'utils', 'helpers', 'common', 'shared'].includes(
            nextPart
          )
        ) {
          return nextPart;
        }
      }
    }

    if (parts.length >= 2) {
      const parentDir = parts[parts.length - 2];
      if (parentDir && parentDir !== '.' && parentDir !== '..' && parentDir !== '') {
        return parentDir;
      }
    }

    return 'core';
  }

  /**
  private formatPackageName(dir: string): string {
    const formatted = dir
      .split(/[-_]/)
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
      .join(' ');

    if (!formatted.includes('Layer') && !formatted.includes('Package')) {
      return `${formatted} Layer`;
    }

    return formatted;
  }

  /**
  private mergeSmallPackages(packages: PackageGroup[]): PackageGroup[] {
    const threshold = 2; // Merge packages with <= 2 entities
    const merged: PackageGroup[] = [];
    const skipIndices = new Set<number>();

    for (let i = 0; i < packages.length; i++) {
      if (skipIndices.has(i)) {
        continue;
      }

      const current = packages[i];
      if (!current) continue;

      const isProtectedGroup =
        current.reasoning?.includes('/') ||
        current.reasoning?.startsWith('Grouped by Maven module:');
      if (current.entities.length <= threshold && !isProtectedGroup && i + 1 < packages.length) {
        const next = packages[i + 1];
        const nextIsProtectedGroup =
          next?.reasoning?.includes('/') || next?.reasoning?.startsWith('Grouped by Maven module:');
        if (next && !skipIndices.has(i + 1) && !nextIsProtectedGroup) {
          merged.push({
            name: `${current.name} & ${next.name}`,
            entities: [...current.entities, ...next.entities],
            reasoning: `Merged small packages: ${current.reasoning}, ${next.reasoning}`,
          });
          skipIndices.add(i + 1);
          continue;
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
  private applyLimits(packages: PackageGroup[]): PackageGroup[] {
    let result = [...packages];

    if (result.length > this.config.maxPackages) {
      result = result
        .sort((a, b) => b.entities.length - a.entities.length)
        .slice(0, this.config.maxPackages);
    }

    if (this.config.maxEntitiesPerPackage < Infinity) {
      result = result.map((pkg) => ({
        ...pkg,
        entities: pkg.entities.slice(0, this.config.maxEntitiesPerPackage),
      }));
    }

    return result;
  }

  /**
  private generateLayoutDecision(packages: PackageGroup[]): LayoutDecision {
    let direction: LayoutDecision['direction'] = 'TB';

    if (packages.length <= 2) {
      direction = 'LR'; // Left-to-right for simple structures
    } else if (packages.length > 5) {
      direction = 'TB'; // Top-to-bottom for complex structures
    }

    const reasoning = `Layout direction: ${direction} based on ${packages.length} packages`;

    return {
      direction,
      reasoning,
    };
  }
}
/**

export * from './types.js';

export { ValidatedMermaidGenerator } from './generator.js';

export { HeuristicGrouper } from './grouper.js';

export { MermaidParseValidator } from './validator-parse.js';
export { StructuralValidator } from './validator-structural.js';
export { RenderValidator } from './validator-render.js';
export { QualityValidator } from './validator-quality.js';

export { MermaidValidationPipeline } from './validation-pipeline.js';

export { IsomorphicMermaidRenderer } from './renderer.js';

export { MermaidAutoRepair } from './auto-repair.js';

export { isExternalDependency, EXTERNAL_DEPENDENCIES } from './external-dependencies.js';

export { MermaidDiagramGenerator } from './diagram-generator.js';
export type { MermaidOutputOptions } from './diagram-generator.js';
/**

/**
export function inlineEdgeStyles(svg: string): string {
  const extractCssProperty = (rulePattern: RegExp, property: string): string => {
    const match = svg.match(rulePattern);
    if (!match) return '';

    for (const decl of match[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      if (rawProp.trim().toLowerCase() !== property) continue;
      const value = rawValueParts.join(':').trim();
      if (value) return value;
    }

    return '';
  };

  const flowchartLinkRuleMatch = svg.match(/\.flowchart-link[^{]*\{([^}]+)\}/);
  let flowchartLinkFill = 'none';
  let flowchartLinkStroke = '';
  if (flowchartLinkRuleMatch) {
    for (const decl of flowchartLinkRuleMatch[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      const prop = rawProp.trim().toLowerCase();
      const value = rawValueParts.join(':').trim();
      if (!value) continue;
      if (prop === 'fill') flowchartLinkFill = value;
      if (prop === 'stroke') flowchartLinkStroke = value;
    }
  }

  const relationRuleMatch = svg.match(/\.relation[^{]*\{([^}]+)\}/);
  let relationFill = 'none';
  let relationStroke = '';
  if (relationRuleMatch) {
    for (const decl of relationRuleMatch[1].split(';')) {
      const [rawProp, ...rawValueParts] = decl.split(':');
      if (!rawProp || rawValueParts.length === 0) continue;
      const prop = rawProp.trim().toLowerCase();
      const value = rawValueParts.join(':').trim();
      if (!value) continue;
      if (prop === 'fill') relationFill = value;
      if (prop === 'stroke') relationStroke = value;
    }
  }

  let result = svg.replace(
    /(<path\b[^>]*class="[^"]*\bflowchart-link\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      const hasFill = /\bfill\s*:/.test(style);
      const hasStroke = /\bstroke\s*:/.test(style);
      if (hasFill && (hasStroke || flowchartLinkStroke.length === 0)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      const injected = [
        !hasFill ? `fill:${flowchartLinkFill};` : '',
        !hasStroke && flowchartLinkStroke ? `stroke:${flowchartLinkStroke};` : '',
      ].join('');
      return `${pre}${trimmed ? trimmed + ';' : ''}${injected}${post}`;
    }
  );

  result = result.replace(
    /(<path\b[^>]*class="[^"]*\brelation\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      const hasFill = /\bfill\s*:/.test(style);
      const hasStroke = /\bstroke\s*:/.test(style);
      if (hasFill && (hasStroke || relationStroke.length === 0)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      const injected = [
        !hasFill ? `fill:${relationFill};` : '',
        !hasStroke && relationStroke ? `stroke:${relationStroke};` : '',
      ].join('');
      return `${pre}${trimmed ? trimmed + ';' : ''}${injected}${post}`;
    }
  );

  result = result.replace(
    /(<rect\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
    (_: string, pre: string, style: string, post: string) => {
      if (/\bfill\s*:/.test(style)) return _;
      const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
      return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
    }
  );

  const nodeRectRuleMatch = svg.match(/\.node\s+rect[^{]*\{([^}]+)\}/);
  if (nodeRectRuleMatch) {
    const nodeProps = nodeRectRuleMatch[1]
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(';');
    if (nodeProps) {
      result = result.replace(
        /(<rect\b[^>]*class="[^"]*\bbasic\b[^"]*\blabel-container\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
        (_: string, pre: string, style: string, post: string) => {
          if (/\bfill\s*:/.test(style)) return _;
          const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
          return `${pre}${trimmed ? trimmed + ';' : ''}${nodeProps};${post}`;
        }
      );
    }
  }

  const nodeTextAnchor = extractCssProperty(
    /\.node\s+\.label\s+text[^{]*\{([^}]+)\}/,
    'text-anchor'
  );
  if (nodeTextAnchor) {
    result = result.replace(
      /(<g\b[^>]*class="[^"]*\bnode\b[^"]*"[^>]*>[\s\S]*?<g\b[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>[\s\S]*?<text\b[^>]*\bstyle=")([^"]*?)(")/g,
      (_: string, pre: string, style: string, post: string) => {
        if (/\btext-anchor\s*:/.test(style)) return _;
        const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
        return `${pre}${trimmed ? trimmed + ';' : ''}text-anchor:${nodeTextAnchor};${post}`;
      }
    );
  }

  const clusterTextAnchor = extractCssProperty(
    /\.cluster-label\s+text[^{]*\{([^}]+)\}/,
    'text-anchor'
  );
  if (clusterTextAnchor) {
    result = result.replace(
      /(<g\b[^>]*class="[^"]*\bcluster-label\b[^"]*"[^>]*>[\s\S]*?<text\b[^>]*\bstyle=")([^"]*?)(")/g,
      (_: string, pre: string, style: string, post: string) => {
        if (/\btext-anchor\s*:/.test(style)) return _;
        const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
        return `${pre}${trimmed ? trimmed + ';' : ''}text-anchor:${clusterTextAnchor};${post}`;
      }
    );
  }

  return result;
}

/**
function injectBackground(svg: string): string {
  const bg = 'white';
  const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/);
  if (styleMatch) {
    return svg.replace(/(<svg[^>]*style=")([^"]*)(")/g, `$1$2; background-color: ${bg};$3`);
  }
  return svg.replace(/<svg/, `<svg style="background-color: ${bg};"`);
}

/**
export function postProcessSVG(rawSvg: string, transparentBackground: boolean): string {
  const withEdgeStyles = inlineEdgeStyles(rawSvg);
  if (transparentBackground) {
    return withEdgeStyles;
  }
  if (/<svg[^>]*style="[^"]*background-color/.test(withEdgeStyles)) {
    return withEdgeStyles;
  }
  return injectBackground(withEdgeStyles);
}
/**
export interface IProgressReporter {
  start(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  warn?(message: string): void;
  info?(message: string): void;
}

/** No-op implementation used when no reporter is injected */
export class NoopProgressReporter implements IProgressReporter {
  start(_message: string): void {}
  succeed(_message: string): void {}
  fail(_message: string): void {}
  warn(_message: string): void {}
  info(_message: string): void {}
}
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

export interface WorkerInitData {
  theme: string;
  maxTextSize: number;
  transparentBackground: boolean;
  themeVariables?: Record<string, string>;
}

export interface RenderJob {
  jobId: string;
  mermaidCode: string;
}

export interface RenderResult {
  jobId: string;
  success: boolean;
  svg?: string;
  error?: string;
}

const WORKER_FILE = fileURLToPath(new URL('./render-worker.js', import.meta.url));

function sanitizeWorkerExecArgv(execArgv: string[]): string[] {
  return execArgv.filter((arg) => !arg.startsWith('--input-type='));
}

export class MermaidRenderWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ job: RenderJob }> = [];
  private pending = new Map<string, (r: RenderResult) => void>();
  private workerInFlight = new Map<Worker, string>(); // worker → jobId
  private workerRestarts = new Map<Worker, number>(); // restart count per slot
  private terminating = false;
  private readonly MAX_RESTARTS = 3;

  constructor(
    private readonly poolSize: number,
    private readonly initData: WorkerInitData
  ) {}

  private spawnWorker(): Worker {
    const w = new Worker(WORKER_FILE, {
      workerData: this.initData,
      execArgv: sanitizeWorkerExecArgv(process.execArgv),
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
    });
    w.on('message', (result: RenderResult) => this.onResult(w, result));
    w.on('error', (err) => {
      console.error(`[render-worker] worker error: ${err.message}`);
    });
    w.on('exit', (code) => this.onWorkerExit(w, code));
    this.idle.push(w);
    return w;
  }

  start(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.spawnWorker());
    }
  }

  private onWorkerExit(w: Worker, code: number): void {
    if (code === 0 || this.terminating) return; // Normal/intentional exit

    const jobId = this.workerInFlight.get(w);
    if (jobId) {
      const resolve = this.pending.get(jobId);
      if (resolve) {
        this.pending.delete(jobId);
        resolve({ jobId, success: false, error: `Worker exited unexpectedly (code=${code})` });
      }
      this.workerInFlight.delete(w);
    }

    const idleIdx = this.idle.indexOf(w);
    if (idleIdx !== -1) this.idle.splice(idleIdx, 1);

    const restarts = this.workerRestarts.get(w) ?? 0;
    if (restarts < this.MAX_RESTARTS) {
      console.warn(
        `[render-worker] worker exited (code=${code}), respawning (${restarts + 1}/${this.MAX_RESTARTS})`
      );
      const replacement = this.spawnWorker();
      this.workerRestarts.set(replacement, restarts + 1);
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers[idx] = replacement;
    } else {
      console.error(
        `[render-worker] worker reached max restarts (${this.MAX_RESTARTS}), not respawning`
      );
      const idx = this.workers.indexOf(w);
      if (idx !== -1) this.workers.splice(idx, 1);
    }
    this.workerRestarts.delete(w);
  }

  render(job: Omit<RenderJob, 'jobId'>): Promise<RenderResult> {
    const fullJob: RenderJob = { ...job, jobId: randomUUID() };
    return new Promise((resolve) => {
      this.pending.set(fullJob.jobId, resolve);
      this.dispatch(fullJob);
    });
  }

  private dispatch(job: RenderJob): void {
    const worker = this.idle.pop();
    if (worker) {
      this.workerInFlight.set(worker, job.jobId);
      worker.postMessage(job);
    } else {
      this.queue.push({ job });
    }
  }

  private onResult(worker: Worker, result: RenderResult): void {
    this.workerInFlight.delete(worker);
    const resolve = this.pending.get(result.jobId);
    if (resolve) {
      this.pending.delete(result.jobId);
      resolve(result);
    }
    const next = this.queue.shift();
    if (next) {
      this.workerInFlight.set(worker, next.job.jobId);
      worker.postMessage(next.job);
    } else {
      this.idle.push(worker);
    }
  }

  async terminate(): Promise<void> {
    this.terminating = true;
    await Promise.all(this.workers.map((w) => w.terminate()));

    for (const { job } of this.queue) {
      const resolve = this.pending.get(job.jobId);
      if (resolve) {
        this.pending.delete(job.jobId);
        resolve({ jobId: job.jobId, success: false, error: 'Pool terminated' });
      }
    }
    this.queue = [];

    for (const [jobId, resolve] of this.pending) {
      resolve({ jobId, success: false, error: 'Pool terminated' });
    }
    this.pending.clear();
  }
}
import { workerData, parentPort } from 'worker_threads';
import mermaid from 'isomorphic-mermaid';
import { postProcessSVG } from './post-process-svg.js';
import type { WorkerInitData, RenderJob, RenderResult } from './render-worker-pool.js';

const initData = workerData as WorkerInitData;

mermaid.initialize({
  startOnLoad: false,
  theme: (initData.theme ?? 'default') as
    | 'default'
    | 'base'
    | 'dark'
    | 'forest'
    | 'neutral'
    | 'null',
  securityLevel: 'loose',
  maxTextSize: initData.maxTextSize ?? 200000,
  themeVariables: initData.themeVariables,
});

const handleMessage = async (job: RenderJob): Promise<void> => {
  try {
    const { svg: rawSvg } = await mermaid.render(job.jobId, job.mermaidCode);
    const svg = postProcessSVG(rawSvg, initData.transparentBackground);
    parentPort.postMessage({ jobId: job.jobId, success: true, svg } satisfies RenderResult);
  } catch (e) {
    parentPort.postMessage({
      jobId: job.jobId,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies RenderResult);
  }
};

parentPort.on('message', (job: RenderJob) => {
  handleMessage(job).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    parentPort.postMessage({
      jobId: job.jobId,
      success: false,
      error: `Worker unhandled: ${msg}`,
    } satisfies RenderResult);
  });
});
/**

import fs from 'fs-extra';
import path from 'path';
import mermaid from 'isomorphic-mermaid';
import sharp from 'sharp';
import type { MermaidRendererOptions, MermaidOutputPaths } from './types.js';
export { inlineEdgeStyles } from './post-process-svg.js';
import { inlineEdgeStyles } from './post-process-svg.js';

/**
export class IsomorphicMermaidRenderer {
  private readonly options: Required<MermaidRendererOptions>;
  private initialized = false;

  constructor(options?: Partial<MermaidRendererOptions>) {
    this.options = {
      format: options?.format ?? 'svg',
      theme: options?.theme ?? { name: 'default' },
      backgroundColor: options?.backgroundColor ?? 'white',
      width: options?.width ?? 2000,
      height: options?.height ?? 2000,
    };
  }

  /**
  async renderSVG(mermaidCode: string): Promise<string> {
    this.ensureInitialized();

    try {
      const { svg } = await mermaid.render(this.generateId(), mermaidCode);

      if (this.options.backgroundColor !== 'transparent') {
        const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/);

        if (styleMatch) {
          return svg.replace(
            /(<svg[^>]*style=")([^"]*)(")/,
            `$1$2; background-color: ${this.options.backgroundColor};$3`
          );
        } else {
          return svg.replace(
            /<svg/,
            `<svg style="background-color: ${this.options.backgroundColor};"`
          );
        }
      }

      return svg;
    } catch (error) {
      throw new Error(
        `Failed to render SVG: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
  async renderSVGRaw(mermaidCode: string): Promise<string> {
    this.ensureInitialized();
    try {
      const { svg } = await mermaid.render(this.generateId(), mermaidCode);
      return svg;
    } catch (error) {
      throw new Error(
        `Failed to render SVG: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
  async renderPNG(mermaidCode: string, outputPath: string): Promise<void> {
    try {
      const svg = await this.renderSVG(mermaidCode);
      await this.convertSVGToPNG(svg, outputPath);
    } catch (error) {
      throw new Error(
        `Failed to render PNG to ${outputPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
  async convertSVGToPNG(svg: string, outputPath: string): Promise<void> {
    const svgBuffer = Buffer.from(svg);
    await fs.ensureDir(path.dirname(outputPath));

    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    let density = 300;
    let resizeWidth: number | undefined;
    let resizeHeight: number | undefined;
    const maxPixels = 32767;

    if (viewBoxMatch) {
      const [, , vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);
      const svgWidth = vbWidth || 0;
      const svgHeight = vbHeight || 0;
      const estimatedWidth = svgWidth * (300 / 72);
      const estimatedHeight = svgHeight * (300 / 72);

      if (svgWidth > maxPixels || svgHeight > maxPixels) {
        const scale = Math.min(maxPixels / svgWidth, maxPixels / svgHeight);
        resizeWidth = Math.floor(svgWidth * scale);
        resizeHeight = Math.floor(svgHeight * scale);
        density = 72;
      } else if (estimatedWidth > maxPixels || estimatedHeight > maxPixels) {
        const maxDimension = Math.max(svgWidth, svgHeight);
        density = Math.floor(((maxPixels * 0.9) / maxDimension) * 72);
        density = Math.max(72, Math.min(300, density));
      }
    }

    let pipeline = sharp(svgBuffer, { density, limitInputPixels: false });
    const capWidth = resizeWidth ?? maxPixels;
    const capHeight = resizeHeight ?? maxPixels;
    pipeline = pipeline.resize(capWidth, capHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (this.options.backgroundColor !== 'transparent') {
      pipeline.flatten({
        background: this.parseBackgroundColor(this.options.backgroundColor),
      });
    }

    await pipeline.png().toFile(outputPath);
  }

  /**
  async renderAndSave(mermaidCode: string, paths: MermaidOutputPaths): Promise<void> {
    try {
      await Promise.all([
        fs.ensureDir(path.dirname(paths.mmd)),
        fs.ensureDir(path.dirname(paths.svg)),
        fs.ensureDir(path.dirname(paths.png)),
      ]);

      const [svg] = await Promise.all([
        this.renderSVG(mermaidCode),
        fs.writeFile(paths.mmd, mermaidCode, 'utf-8'),
      ]);

      const processedSvg = inlineEdgeStyles(svg);

      await Promise.all([
        fs.writeFile(paths.svg, processedSvg, 'utf-8'),
        this.convertSVGToPNG(processedSvg, paths.png),
      ]);
    } catch (error) {
      throw new Error(
        `Failed to render and save: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
  private ensureInitialized(): void {
    if (!this.initialized) {
      const config = {
        startOnLoad: false,
        theme: this.options.theme.name ?? 'default',
        securityLevel: 'loose' as const,
        themeVariables: this.options.theme.variables,
        maxTextSize: 200000,
      };

      mermaid.initialize(config);
      this.initialized = true;
    }
  }

  /**
  private generateId(): string {
    return `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
  getOptions(): MermaidRendererOptions {
    return { ...this.options };
  }

  /**
  setOptions(options: Partial<MermaidRendererOptions>): void {
    if (options.format !== undefined) {
      this.options.format = options.format;
    }
    if (options.theme !== undefined) {
      this.options.theme = options.theme;
    }
    if (options.backgroundColor !== undefined) {
      this.options.backgroundColor = options.backgroundColor;
    }
    if (options.width !== undefined) {
      this.options.width = options.width;
    }
    if (options.height !== undefined) {
      this.options.height = options.height;
    }

    if (this.initialized) {
      this.initialized = false;
      this.ensureInitialized();
    }
  }

  /**
  private parseBackgroundColor(color: string): string {
    if (color.startsWith('rgb')) {
      return color;
    }

    const namedColors: Record<string, string> = {
      white: '#FFFFFF',
      black: '#000000',
      red: '#FF0000',
      green: '#00FF00',
      blue: '#0000FF',
      yellow: '#FFFF00',
      cyan: '#00FFFF',
      magenta: '#FF00FF',
      gray: '#808080',
      grey: '#808080',
      lightgray: '#D3D3D3',
      lightgrey: '#D3D3D3',
      darkgray: '#A9A9A9',
      darkgrey: '#A9A9A9',
    };

    const lowerColor = color.toLowerCase();
    if (namedColors[lowerColor]) {
      return namedColors[lowerColor];
    }

    return color;
  }
}
/**

import type { TestAnalysis } from '@/types/extensions/test-analysis.js';
import type { ArchJSON } from '@/types/index.js';

const MAX_NODES_PER_BUCKET = 20;

export class TestCoverageRenderer {
  render(analysis: TestAnalysis, archJson: ArchJSON): string {
    const coveredMap = new Map<string, number>(); // entityId → score
    for (const link of analysis.coverageMap) {
      coveredMap.set(link.sourceEntityId, link.coverageScore);
    }

    const wellTested: string[] = [];
    const partiallyTested: string[] = [];
    const notTested: string[] = [];

    for (const entity of archJson.entities) {
      if (entity.type === 'class' || entity.type === 'interface') {
        const score = coveredMap.get(entity.id) ?? 0;
        const label = this.truncate(entity.name ?? entity.id, 30);
        if (score >= 0.7) wellTested.push(label);
        else if (score >= 0.3) partiallyTested.push(label);
        else notTested.push(label);
      }
    }

    const debugFiles = analysis.testFiles
      .filter((f) => f.testType === 'debug')
      .map((f) => this.truncate(f.id, 30));

    const lines: string[] = ['graph TD'];

    lines.push('  subgraph WT["✓ Well Tested (score ≥ 0.7)"]');
    const wtSlice = wellTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of wtSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (wellTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    wt_more["... +${wellTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    lines.push('  subgraph PT["~ Partially Tested (0.3 ≤ score < 0.7)"]');
    const ptSlice = partiallyTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of ptSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (partiallyTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    pt_more["... +${partiallyTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    lines.push('  subgraph NT["✗ Not Tested (score < 0.3)"]');
    const ntSlice = notTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of ntSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (notTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    nt_more["... +${notTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    if (debugFiles.length > 0) {
      lines.push('  subgraph DO["⚠ Debug Only (zero assertions)"]');
      const doSlice = debugFiles.slice(0, MAX_NODES_PER_BUCKET);
      for (const label of doSlice) {
        lines.push(`    ${this.nodeId('do_' + label)}["${label}"]`);
      }
      if (debugFiles.length > MAX_NODES_PER_BUCKET) {
        lines.push(`    do_more["... +${debugFiles.length - MAX_NODES_PER_BUCKET} more"]`);
      }
      lines.push('  end');
    }

    return lines.join('\n');
  }

  private nodeId(label: string): string {
    return label.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  }

  private truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
  }
}
/**

import type {
  TsModuleGraph,
  TsModuleDependency,
  TsModuleNode,
} from '@/types/extensions/ts-analysis.js';

interface TsModuleGraphRenderOptions {
  architecturalLayers?: Record<string, string>;
}

/**
const SUBGRAPH_DEPTH_STYLES = [
  'fill:#ffffff,stroke:#d0d7de,stroke-width:1px', // depth-1 (palette index 0) — outermost
  'fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px', // depth-2 (palette index 1)
  'fill:#eaeef2,stroke:#8b949e,stroke-width:1px', // depth-3 (palette index 2)
  'fill:#d0d7de,stroke:#57606a,stroke-width:1px', // depth-4+ (palette index 3, clamped)
];

/**
function toNodeId(moduleId: string): string {
  return moduleId.replace(/[/.\-@:]/g, '_') || '__root__';
}

/**
function arrowStyle(strength: number): string {
  if (strength >= 10) return '===>';
  if (strength >= 3) return '==>';
  return '-->';
}

/**
function parentPath(id: string): string | null {
  const slash = id.lastIndexOf('/');
  return slash > 0 ? id.slice(0, slash) : null;
}

function normalizeLayerPrefix(prefix: string): string {
  return prefix.replace(/\\/g, '/').replace(/^@?\//, '').replace(/^src\//, '').replace(/\/+$/, '');
}

function findMatchingLayer(
  moduleId: string,
  layers?: Record<string, string>
): { key: string; label: string } | null {
  if (!layers) return null;

  const normalizedModule = moduleId.replace(/\\/g, '/');
  const candidates = Object.entries(layers)
    .map(([key, label]) => ({ key: normalizeLayerPrefix(key), label }))
    .filter(({ key }) => normalizedModule === key || normalizedModule.startsWith(`${key}/`))
    .sort((left, right) => right.key.length - left.key.length);

  return candidates[0] ?? null;
}

/**
interface TreeNode {
  moduleNode: TsModuleNode | null;
  virtualId?: string;
  children: TreeNode[];
}

/** Return the canonical ID of a tree node (real or virtual). */
function nodeTreeId(node: TreeNode): string {
  return node.moduleNode ? node.moduleNode.id : node.virtualId;
}

/**
function buildForest(internalNodes: TsModuleNode[]): TreeNode[] {
  const realNodeIds = new Set(internalNodes.map((n) => n.id));
  const byId = new Map<string, TreeNode>();
  for (const n of internalNodes) {
    byId.set(n.id, { moduleNode: n, children: [] });
  }

  const trieChildren = new Map<string | null, Set<string>>();
  for (const id of realNodeIds) {
    let cur: string = id;
    let par: string | null = parentPath(cur);
    while (true) {
      if (!trieChildren.has(par)) trieChildren.set(par, new Set());
      trieChildren.get(par).add(cur);
      if (par === null) break;
      cur = par;
      par = parentPath(cur);
    }
  }

  function buildSubtree(parentId: string | null): TreeNode[] {
    const children = trieChildren.get(parentId);
    if (!children) return [];
    const result: TreeNode[] = [];
    for (const childId of children) {
      if (realNodeIds.has(childId)) {
        const treeNode = byId.get(childId);
        for (const c of buildSubtree(childId)) treeNode.children.push(c);
        result.push(treeNode);
      } else {
        const sub = buildSubtree(childId);
        if (sub.length === 0) {
          /* no real descendants — skip */
        } else if (sub.length === 1)
          result.push(sub[0]); // path compression
        else result.push({ moduleNode: null, virtualId: childId, children: sub });
      }
    }
    return result;
  }

  return buildSubtree(null);
}

/**
function emitTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  subgraphStyles: Array<{ id: string; depth: number }>,
  cycleNodeIds: Set<string>,
  options: { collapseSelfGroup?: boolean } = {}
): void {
  const pad = '  '.repeat(depth);
  const id = nodeTreeId(node);
  const nid = toNodeId(id);
  const label = id || '(root)';

  const roleClass =
    node.moduleNode !== null ? (cycleNodeIds.has(id) ? ':::cycle' : ':::internal') : '';

  if (node.children.length === 0) {
    lines.push(`${pad}${nid}["${label}"]${roleClass}`);
  } else if (options.collapseSelfGroup && node.moduleNode !== null) {
    lines.push(`${pad}${nid}["${label}"]${roleClass}`);
    for (const child of node.children) {
      emitTreeNode(child, lines, depth, subgraphStyles, cycleNodeIds);
    }
  } else {
    const sgId = `${nid}_group`;
    subgraphStyles.push({ id: sgId, depth }); // record depth before recursing
    lines.push(`${pad}subgraph ${sgId}["${label}"]`);
    if (node.moduleNode !== null) {
      lines.push(`${pad}  ${nid}["${label}"]${roleClass}`);
    }
    for (const child of node.children) {
      emitTreeNode(child, lines, depth + 1, subgraphStyles, cycleNodeIds);
    }
    lines.push(`${pad}end`);
  }
}

/**
export function renderTsModuleGraph(
  graph: TsModuleGraph,
  options: TsModuleGraphRenderOptions = {}
): string {
  const lines: string[] = [];

  lines.push("%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%");
  lines.push('flowchart LR');
  lines.push('');

  const internalNodes = graph.nodes.filter((n) => n.type !== 'node_modules');
  const externalNodes = graph.nodes.filter((n) => n.type === 'node_modules');

  const cycleNodeIds = new Set(graph.cycles.flatMap((c) => c.modules));

  const subgraphStyles: Array<{ id: string; depth: number }> = [];
  const forest = buildForest(internalNodes);
  const groupedRoots = new Map<string, TreeNode[]>();
  const unmatchedRoots: TreeNode[] = [];
  for (const root of forest) {
    const layerMatch = findMatchingLayer(nodeTreeId(root), options.architecturalLayers);
    if (!layerMatch) {
      unmatchedRoots.push(root);
      continue;
    }
    if (!groupedRoots.has(layerMatch.label)) {
      groupedRoots.set(layerMatch.label, []);
    }
    groupedRoots.get(layerMatch.label)?.push(root);
  }

  for (const [label, roots] of groupedRoots.entries()) {
    const layerGroupId = `layer_${toNodeId(label)}`;
    subgraphStyles.push({ id: layerGroupId, depth: 1 });
    lines.push(`  subgraph ${layerGroupId}["${label}"]`);
    for (const root of roots) {
      emitTreeNode(root, lines, 2, subgraphStyles, cycleNodeIds, {
        collapseSelfGroup: root.moduleNode !== null && nodeTreeId(root) === label,
      });
    }
    lines.push('  end');
  }

  for (const root of unmatchedRoots) {
    emitTreeNode(root, lines, 1, subgraphStyles, cycleNodeIds);
  }

  if (externalNodes.length > 0) {
    lines.push('  subgraph external_deps["External Dependencies"]');
    for (const node of externalNodes) {
      const nid = toNodeId(node.id);
      const label = node.id;
      lines.push(`    ${nid}["${label}"]:::external`);
    }
    lines.push('  end');
  }

  lines.push('  subgraph legend["Legend"]');
  lines.push('    direction LR');
  lines.push('    legend_internal["internal module"]:::internal');
  if (externalNodes.length > 0) {
    lines.push('    legend_external["external dependency"]:::external');
  }
  if (cycleNodeIds.size > 0) {
    lines.push('    legend_cycle["cycle \u26a0"]:::cycle');
  }
  lines.push('    legend_edge["--> depends on (bolder = more imports)"]');
  lines.push('  end');
  lines.push('  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01');
  lines.push('');

  for (const { id, depth } of subgraphStyles) {
    const paletteIndex = Math.min(depth - 1, SUBGRAPH_DEPTH_STYLES.length - 1);
    lines.push(`  style ${id} ${SUBGRAPH_DEPTH_STYLES[paletteIndex]}`);
  }
  if (externalNodes.length > 0) {
    lines.push(`  style external_deps fill:#ffffff,stroke:#d0d7de,stroke-width:1px`);
  }

  lines.push('');

  lines.push('  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329');
  lines.push('  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01');
  lines.push(
    '  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold'
  );
  lines.push('');

  const cycleModuleSets: Array<Set<string>> = graph.cycles.map((c) => new Set(c.modules));
  const isCycleEdge = (edge: TsModuleDependency): boolean =>
    cycleModuleSets.some((s) => s.has(edge.from) && s.has(edge.to));

  const normalEdges: TsModuleDependency[] = [];
  const cycleEdges: TsModuleDependency[] = [];
  for (const edge of graph.edges) {
    if (isCycleEdge(edge)) {
      cycleEdges.push(edge);
    } else {
      normalEdges.push(edge);
    }
  }

  let edgeIndex = 0;
  const cycleEdgeIndices: number[] = [];

  for (const edge of normalEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    edgeIndex++;
  }

  for (const edge of cycleEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    cycleEdgeIndices.push(edgeIndex);
    edgeIndex++;
  }

  if (cycleEdgeIndices.length > 0) {
    lines.push('');
    for (const idx of cycleEdgeIndices) {
      lines.push(`  linkStyle ${idx} stroke:#e74c3c,stroke-width:2px`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
/**

/**
export type MermaidDetailLevel = 'package' | 'class' | 'method';

/**
export type MermaidDiagramType = 'classDiagram' | 'flowchart' | 'stateDiagram';

/**
export interface GroupingDecision {
  packages: PackageGroup[];
  layout: LayoutDecision;
}

/**
export interface PackageGroup {
  name: string;
  entities: string[]; // entity IDs
  reasoning?: string;
}

/**
export interface LayoutDecision {
  direction: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
  reasoning: string;
}

/**
export interface ParseValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

/**
export interface ValidationWarning {
  message: string;
  line?: number;
  suggestion?: string;
}

/**
export interface StructuralValidationResult {
  valid: boolean;
  issues: StructuralIssue[];
}

/**
export interface StructuralIssue {
  type: 'missing-entity' | 'invalid-relation' | 'circular-dependency' | 'orphan-entity';
  message: string;
  entity?: string;
  details?: any;
}

/**
export interface RenderValidationResult {
  valid: boolean;
  canRender: boolean;
  issues: RenderIssue[];
}

/**
export interface RenderIssue {
  type: 'size' | 'complexity' | 'syntax' | 'unsupported-feature';
  message: string;
  severity: 'error' | 'warning';
}

/**
export interface QualityValidationResult {
  valid: boolean;
  score: number; // 0-100
  metrics: QualityMetrics;
  suggestions: QualitySuggestion[];
}

/**
export interface QualityMetrics {
  readability: number;
  completeness: number;
  consistency: number;
  complexity: number;
}

/**
export interface QualitySuggestion {
  type: 'layout' | 'grouping' | 'detail-level' | 'naming';
  message: string;
  impact: 'high' | 'medium' | 'low';
  action?: string;
}

/**
export interface ValidationPipelineResult {
  parse: ParseValidationResult;
  structural: StructuralValidationResult;
  render: RenderValidationResult;
  quality: QualityValidationResult;
  overall: {
    valid: boolean;
    canProceed: boolean;
    blockingIssues: string[];
  };
}

/**
export interface MermaidGeneratorOptions {
  level: MermaidDetailLevel;
  grouping: GroupingDecision;
  theme?: MermaidTheme;
  includePrivate?: boolean;
  includeProtected?: boolean;
  maxDepth?: number;
}

/**
export interface MermaidTheme {
  name?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';
  variables?: Record<string, string>;
}

/**
export interface MermaidRendererOptions {
  format: 'svg' | 'png';
  theme?: MermaidTheme;
  backgroundColor?: string;
  width?: number;
  height?: number;
}

/**
export interface MermaidOutputPaths {
  mmd: string; // .mmd file path
  svg: string; // .svg file path
  png: string; // .png file path
}

/**
export type GrouperStrategy = 'heuristic' | 'llm';

/**
export interface GrouperConfig {
  strategy: GrouperStrategy;
  maxPackages?: number;
  maxEntitiesPerPackage?: number;
  customRules?: GroupingRule[];
}

/**
export interface GroupingRule {
  pattern: RegExp;
  packageName: string;
  priority?: number;
}

/**
export interface LLMGrouperResponse {
  packages: PackageGroup[];
  layout: LayoutDecision;
  reasoning: string;
}
/**

import type { ArchJSON } from '../types/index.js';
import type { ValidationPipelineResult } from './types.js';
import { MermaidParseValidator } from './validator-parse.js';
import { StructuralValidator } from './validator-structural.js';
import { RenderValidator } from './validator-render.js';
import { QualityValidator } from './validator-quality.js';

/**
export class MermaidValidationPipeline {
  private parseValidator: MermaidParseValidator;
  private structuralValidator: StructuralValidator;
  private renderValidator: RenderValidator;
  private qualityValidator: QualityValidator;

  constructor(_config?: any) {
    this.parseValidator = new MermaidParseValidator();
    this.structuralValidator = new StructuralValidator();
    this.renderValidator = new RenderValidator();
    this.qualityValidator = new QualityValidator();
  }

  /**
  async validate(mermaidCode: string, archJson: ArchJSON): Promise<ValidationPipelineResult> {
    const parseResult = await this.parseValidator.validate(mermaidCode);

    const structuralResult = this.structuralValidator.validate(mermaidCode, archJson);

    const renderResult = this.renderValidator.validate(mermaidCode);

    const qualityResult = this.qualityValidator.validate(mermaidCode, archJson);

    const overall = this.calculateOverall({
      parse: parseResult,
      structural: structuralResult,
      render: renderResult,
      quality: qualityResult,
    });

    return {
      parse: parseResult,
      structural: structuralResult,
      render: renderResult,
      quality: qualityResult,
      overall,
    };
  }

  /**
  private calculateOverall(results: {
    parse: { valid: boolean };
    structural: { valid: boolean };
    render: { valid: boolean; canRender: boolean };
    quality: { valid: boolean };
  }): ValidationPipelineResult['overall'] {
    const blockingIssues: string[] = [];

    if (!results.parse.valid) {
      blockingIssues.push('Syntax errors detected - diagram cannot be parsed');
    }


    if (!results.render.canRender) {
      blockingIssues.push('Diagram cannot be rendered due to size or complexity');
    }

    const canProceed = results.parse.valid && results.render.canRender;

    return {
      valid: canProceed && results.structural.valid && results.quality.valid,
      canProceed,
      blockingIssues,
    };
  }

  /**
  async validateFull(
    mermaidCode: string,
    archJson: ArchJSON
  ): Promise<{
    overallValid: boolean;
    stages: Array<{
      name: string;
      result: any;
    }>;
  }> {
    const parseResult = await this.parseValidator.validate(mermaidCode);

    const structuralResult = this.structuralValidator.validate(mermaidCode, archJson);

    const renderResult = this.renderValidator.validate(mermaidCode);

    const qualityResult = this.qualityValidator.validate(mermaidCode, archJson);

    const overall = this.calculateOverall({
      parse: parseResult,
      structural: structuralResult,
      render: renderResult,
      quality: qualityResult,
    });

    return {
      overallValid: overall.canProceed,
      stages: [
        { name: 'parse', result: parseResult },
        { name: 'structural', result: structuralResult },
        { name: 'render', result: renderResult },
        { name: 'quality', result: qualityResult },
      ],
    };
  }

  /**
  getParseValidator(): MermaidParseValidator {
    return this.parseValidator;
  }

  /**
  generateReport(result: {
    overallValid: boolean;
    stages: Array<{
      name: string;
      result: any;
    }>;
  }): string {
    const lines: string[] = [];

    if (result.overallValid) {
      lines.push('✅ Validation Passed\n');
    } else {
      lines.push('❌ Validation Failed\n');
    }

    for (const stage of result.stages) {
      lines.push(`## ${stage.name.charAt(0).toUpperCase() + stage.name.slice(1)} Validation`);

      if (stage.name === 'parse') {
        lines.push(`Status: ${stage.result.valid ? '✅ Valid' : '❌ Invalid'}`);
        if (stage.result.errors && stage.result.errors.length > 0) {
          lines.push(`Errors (${stage.result.errors.length}):`);
          for (const error of stage.result.errors.slice(0, 10)) {
            lines.push(`  - ${error.message}${error.line ? ` (line ${error.line})` : ''}`);
          }
          if (stage.result.errors.length > 10) {
            lines.push(`  ... and ${stage.result.errors.length - 10} more errors`);
          }
        }
      } else if (stage.name === 'structural') {
        lines.push(`Status: ${stage.result.valid ? '✅ Valid' : '❌ Invalid'}`);
        if (stage.result.issues && stage.result.issues.length > 0) {
          lines.push(`Issues (${stage.result.issues.length}):`);
          for (const issue of stage.result.issues.slice(0, 5)) {
            lines.push(`  - [${issue.type}] ${issue.message}`);
          }
          if (stage.result.issues.length > 5) {
            lines.push(`  ... and ${stage.result.issues.length - 5} more issues`);
          }
        }
      } else if (stage.name === 'render') {
        lines.push(`Can Render: ${stage.result.canRender ? '✅ Yes' : '❌ No'}`);
        if (stage.result.issues && stage.result.issues.length > 0) {
          lines.push(`Issues (${stage.result.issues.length}):`);
          for (const issue of stage.result.issues) {
            lines.push(`  - [${issue.severity}] ${issue.message}`);
          }
        }
      } else if (stage.name === 'quality') {
        lines.push(`Score: ${stage.result.score?.toFixed(1) || 'N/A'}/100`);
        if (stage.result.suggestions && stage.result.suggestions.length > 0) {
          lines.push(`Suggestions (${stage.result.suggestions.length}):`);
          for (const suggestion of stage.result.suggestions.slice(0, 3)) {
            lines.push(`  - [${suggestion.impact}] ${suggestion.message}`);
          }
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
  summarize(result: ValidationPipelineResult): string {
    const lines: string[] = [];

    if (result.overall.valid) {
      lines.push('✅ Validation passed');
    } else {
      lines.push('❌ Validation failed');
    }

    lines.push(`\nSyntax: ${result.parse.valid ? '✅ Valid' : '❌ Invalid'}`);
    if (result.parse.errors.length > 0) {
      lines.push(`  Errors: ${result.parse.errors.length}`);
    }

    lines.push(`\nStructure: ${result.structural.valid ? '✅ Valid' : '❌ Invalid'}`);
    if (result.structural.issues.length > 0) {
      lines.push(`  Issues: ${result.structural.issues.length}`);
    }

    lines.push(`\nRender: ${result.render.canRender ? '✅ Ready' : '❌ Cannot render'}`);
    if (result.render.issues.length > 0) {
      lines.push(`  Issues: ${result.render.issues.length}`);
    }

    lines.push(`\nQuality Score: ${result.quality.score}/100`);
    if (result.quality.suggestions.length > 0) {
      lines.push(`  Suggestions: ${result.quality.suggestions.length}`);
    }

    if (result.overall.blockingIssues.length > 0) {
      lines.push('\n🚫 Blocking Issues:');
      result.overall.blockingIssues.forEach((issue) => {
        lines.push(`  - ${issue}`);
      });
    }

    return lines.join('\n');
  }
}
/**

import mermaid from 'isomorphic-mermaid';
import type { ParseValidationResult, ValidationError, ValidationWarning } from './types.js';

/**
export class MermaidParseValidator {
  private initialized = false;

  constructor() {
  }

  /**
  async validate(mermaidCode: string): Promise<ParseValidationResult> {
    this.ensureInitialized();

    if (!mermaidCode || mermaidCode.trim().length === 0) {
      return {
        valid: false,
        errors: [
          {
            message: 'Empty Mermaid code',
            code: 'EMPTY_INPUT',
          },
        ],
        warnings: [],
      };
    }

    try {
      await mermaid.parse(mermaidCode, {
        suppressErrors: false, // We want to catch errors
      });

      return {
        valid: true,
        errors: [],
        warnings: this.collectWarnings(mermaidCode),
      };
    } catch (error) {
      return {
        valid: false,
        errors: this.parseError(error),
        warnings: [],
      };
    }
  }

  /**
  private ensureInitialized(): void {
    if (!this.initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });
      this.initialized = true;
    }
  }

  /**
  private parseError(error: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (error instanceof Error) {
      const message = error.message;
      const lineMatch = message.match(/line\s+(\d+)/i);
      const colMatch = message.match(/column\s+(\d+)/i);

      const validationError: ValidationError = {
        message: this.sanitizeErrorMessage(message),
      };

      if (lineMatch?.[1]) {
        validationError.line = parseInt(lineMatch[1], 10);
      }

      if (colMatch?.[1]) {
        validationError.column = parseInt(colMatch[1], 10);
      }

      if (message.includes('syntax')) {
        validationError.code = 'SYNTAX_ERROR';
      } else if (message.includes('parse')) {
        validationError.code = 'PARSE_ERROR';
      } else if (message.includes('unknown')) {
        validationError.code = 'UNKNOWN_TOKEN';
      } else {
        validationError.code = 'UNKNOWN_ERROR';
      }

      errors.push(validationError);
    } else if (typeof error === 'string') {
      errors.push({
        message: error,
        code: 'UNKNOWN_ERROR',
      });
    } else {
      errors.push({
        message: 'Unknown validation error',
        code: 'UNKNOWN_ERROR',
      });
    }

    return errors;
  }

  /**
  private sanitizeErrorMessage(message: string): string {
    return (
      message
        .replace(/^Parse error: /i, '')
        .replace(/^Syntax error: /i, '')
        .replace(/^Error: /i, '')
        .trim() || 'Unknown error'
    );
  }

  /**
  private collectWarnings(mermaidCode: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    const selfRefMatches = mermaidCode.matchAll(/(\w+)\s+-->\s+\1/g);
    for (const match of selfRefMatches) {
      if (match[1]) {
        warnings.push({
          message: `Self-reference detected: ${match[1]}`,
          suggestion: 'Consider whether this self-reference is intentional',
        });
      }
    }

    const longNameMatches = mermaidCode.matchAll(/class\s+"([^"]{30,})"/g);
    for (const match of longNameMatches) {
      if (match[1]) {
        warnings.push({
          message: `Very long class name: ${match[1].substring(0, 20)}...`,
          suggestion: 'Consider using shorter class names for better readability',
        });
      }
    }

    const memberMatches = mermaidCode.matchAll(/^\s*([+\-#])?\s*(\w+)\s*:/gm);
    for (const match of memberMatches) {
      if (!match[1] && match[2]) {
        warnings.push({
          message: `Member without visibility modifier: ${match[2]}`,
          suggestion: 'Consider adding visibility modifier (+, -, #) for clarity',
        });
      }
    }

    return warnings;
  }
}
/**

import type { ArchJSON } from '../types/index.js';
import type { QualityValidationResult, QualityMetrics, QualitySuggestion } from './types.js';

/**
export class QualityValidator {
  /**
  validate(mermaidCode: string, archJson: ArchJSON): QualityValidationResult {
    const metrics = this.calculateMetrics(mermaidCode, archJson);
    const suggestions = this.generateSuggestions(mermaidCode, archJson, metrics);
    const score = this.calculateScore(metrics);

    return {
      valid: score >= 60, // Acceptable quality threshold
      score,
      metrics,
      suggestions,
    };
  }

  /**
  private calculateMetrics(mermaidCode: string, archJson: ArchJSON): QualityMetrics {
    return {
      readability: this.calculateReadability(mermaidCode, archJson),
      completeness: this.calculateCompleteness(mermaidCode, archJson),
      consistency: this.calculateConsistency(mermaidCode),
      complexity: this.calculateComplexity(mermaidCode, archJson),
    };
  }

  /**
  private calculateReadability(mermaidCode: string, _archJson: ArchJSON): number {
    let score = 100;

    const lines = mermaidCode.split('\n');
    const longLines = lines.filter((line) => line.length > 100);
    score -= longLines.length * 2;

    const maxNesting = this.calculateNestingDepth(mermaidCode);
    score -= (maxNesting - 3) * 5; // Penalty for depth > 3

    const wellIndented = lines.every((line, index) => {
      if (line.trim().length === 0) return true;
      const expectedIndent = this.calculateExpectedIndent(line, lines, index);
      const actualIndent = line.search(/\S/);
      return Math.abs(actualIndent - expectedIndent) <= 2;
    });
    if (wellIndented) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
  private toMermaidId(name: string): string {
    let id = name.replace(/<[^>]*>$/g, '');
    id = id.replace(/[^a-zA-Z0-9_]/g, '_');
    return id;
  }

  /**
  private calculateCompleteness(mermaidCode: string, archJson: ArchJSON): number {
    let entitiesFound = 0;
    for (const entity of archJson.entities) {
      const pat = new RegExp(`\\bclass\\s+${this.escapeRegex(entity.name)}\\b`, 'i');
      if (pat.test(mermaidCode)) {
        entitiesFound++;
      }
    }
    const entityScore =
      archJson.entities.length > 0 ? (entitiesFound / archJson.entities.length) * 100 : 100;

    let relationsFound = 0;
    for (const relation of archJson.relations) {
      const mermaidSource = this.toMermaidId(relation.source);
      const mermaidTarget = this.toMermaidId(relation.target);
      const srcPat = new RegExp(`\\b${this.escapeRegex(mermaidSource)}\\b`);
      const tgtPat = new RegExp(`\\b${this.escapeRegex(mermaidTarget)}\\b`);
      if (srcPat.test(mermaidCode) && tgtPat.test(mermaidCode)) {
        relationsFound++;
      }
    }
    const relationScore =
      archJson.relations.length > 0 ? (relationsFound / archJson.relations.length) * 100 : 100;

    return Math.round((entityScore + relationScore) / 2);
  }

  /**
  private calculateConsistency(mermaidCode: string): number {
    let score = 100;

    const classMatches = Array.from(mermaidCode.matchAll(/\bclass\s+(\w+)/g));
    const classNames = classMatches.map((m) => m[1] ?? '').filter(Boolean);

    const pascalCasePattern = /^[A-Z][a-zA-Z0-9]*$/;
    const nonPascalCase = classNames.filter((name) => name && !pascalCasePattern.test(name));
    score -= nonPascalCase.length * 5;

    const memberMatches = Array.from(mermaidCode.matchAll(/^\s*([+\-#])?\s*\w+/gm));
    const membersWithVisibility = memberMatches.filter((m) => m[1] !== undefined).length;
    const totalMembers = memberMatches.length;

    if (totalMembers > 0) {
      const visibilityConsistency = (membersWithVisibility / totalMembers) * 100;
      if (visibilityConsistency < 80) {
        score -= 10;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
  private calculateComplexity(_mermaidCode: string, archJson: ArchJSON): number {
    let score = 100;

    const entityCount = archJson.entities.length;
    score -= Math.max(0, (entityCount - 20) * 2);

    const relationCount = archJson.relations.length;
    score -= Math.max(0, (relationCount - 30) * 2);

    const entityConnectivity = new Map<string, number>();
    for (const relation of archJson.relations) {
      entityConnectivity.set(relation.source, (entityConnectivity.get(relation.source) ?? 0) + 1);
      entityConnectivity.set(relation.target, (entityConnectivity.get(relation.target) ?? 0) + 1);
    }

    for (const [entity, connections] of entityConnectivity) {
      if (connections > 10) {
        score -= (connections - 10) * 2;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
  private generateSuggestions(
    mermaidCode: string,
    archJson: ArchJSON,
    metrics: QualityMetrics
  ): QualitySuggestion[] {
    const suggestions: QualitySuggestion[] = [];

    if (metrics.readability < 70) {
      suggestions.push({
        type: 'layout',
        message: 'Diagram readability could be improved',
        impact: 'medium',
        action: 'Consider reducing nesting depth and line length',
      });
    }

    if (metrics.completeness < 80) {
      suggestions.push({
        type: 'detail-level',
        message: 'Some entities or relations may be missing',
        impact: 'high',
        action: 'Verify all important entities and their relationships are included',
      });
    }

    if (metrics.consistency < 70) {
      suggestions.push({
        type: 'naming',
        message: 'Naming conventions are not consistent',
        impact: 'low',
        action: 'Use PascalCase for class names consistently',
      });
    }

    if (metrics.complexity < 60) {
      suggestions.push({
        type: 'grouping',
        message: 'Diagram is very complex',
        impact: 'high',
        action: 'Consider splitting into multiple diagrams or using grouping',
      });
    }

    const classMatches = Array.from(mermaidCode.matchAll(/\bclass\s+(\w+)/g));
    if (classMatches.length > 30) {
      suggestions.push({
        type: 'layout',
        message: 'Too many classes in one diagram',
        impact: 'high',
        action: 'Consider creating multiple diagrams at different abstraction levels',
      });
    }

    return suggestions;
  }

  /**
  private calculateScore(metrics: QualityMetrics): number {
    return Math.round(
      metrics.readability * 0.25 +
        metrics.completeness * 0.35 +
        metrics.consistency * 0.2 +
        metrics.complexity * 0.2
    );
  }

  /**
  private calculateExpectedIndent(line: string, lines: string[], index: number): number {
    const trimmed = line.trim();
    if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
      let openBraces = 0;
      for (let i = 0; i < index; i++) {
        const lineContent = lines[i];
        if (lineContent) {
          openBraces += (lineContent.match(/\{/g) || []).length;
          openBraces -= (lineContent.match(/\}/g) || []).length;
        }
      }
      return Math.max(0, openBraces * 2);
    }
    return 0; // Default
  }

  /**
  private calculateNestingDepth(mermaidCode: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of mermaidCode) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }

  /**
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
/**

import type { RenderValidationResult, RenderIssue } from './types.js';

/**
export class RenderValidator {
  private readonly maxNodes = 100;
  private readonly maxEdges = 200;
  private readonly maxDepth = 10;

  /**
  validate(mermaidCode: string): RenderValidationResult {
    const issues: RenderIssue[] = [];

    issues.push(...this.checkSize(mermaidCode));

    issues.push(...this.checkComplexity(mermaidCode));

    issues.push(...this.checkUnsupportedFeatures(mermaidCode));

    const canRender = issues.filter((i) => i.severity === 'error').length === 0;

    return {
      valid: canRender,
      canRender,
      issues,
    };
  }

  /**
  private checkSize(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];

    const nodeMatches = mermaidCode.matchAll(/\bclass\s+(\w+)/g);
    const nodeCount = Array.from(nodeMatches).length;

    if (nodeCount > this.maxNodes) {
      issues.push({
        type: 'size',
        message: `Too many nodes (${nodeCount} > ${this.maxNodes})`,
        severity: 'warning',
      });
    }

    const edgeMatches = mermaidCode.matchAll(/-->|-->|<--|-->/g);
    const edgeCount = Array.from(edgeMatches).length;

    if (edgeCount > this.maxEdges) {
      issues.push({
        type: 'size',
        message: `Too many edges (${edgeCount} > ${this.maxEdges})`,
        severity: 'warning',
      });
    }

    return issues;
  }

  /**
  private checkComplexity(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];

    const maxNesting = this.calculateNestingDepth(mermaidCode);
    if (maxNesting > this.maxDepth) {
      issues.push({
        type: 'complexity',
        message: `Nesting depth too high (${maxNesting} > ${this.maxDepth})`,
        severity: 'warning',
      });
    }

    const complexMemberMatches = mermaidCode.matchAll(/\w+\([^)]{100,}\)/g);
    if (Array.from(complexMemberMatches).length > 0) {
      issues.push({
        type: 'complexity',
        message: 'Some member definitions are very complex and may not render well',
        severity: 'warning',
      });
    }

    return issues;
  }

  /**
  private checkUnsupportedFeatures(mermaidCode: string): RenderIssue[] {
    const issues: RenderIssue[] = [];


    const longClassMatches = mermaidCode.matchAll(/class\s+"([^"]{50,})"/g);
    for (const match of longClassMatches) {
      if (match[1]) {
        issues.push({
          type: 'syntax',
          message: `Very long class name may cause rendering issues: ${match[1].substring(0, 30)}...`,
          severity: 'warning',
        });
      }
    }

    const specialCharMatches = mermaidCode.matchAll(/class\s+([^w\s]+[w\s]*)/g);
    for (const match of specialCharMatches) {
      if (match[1] && /[|{}\[\]()]/.test(match[1])) {
        issues.push({
          type: 'syntax',
          message: `Class name with special characters may cause issues: ${match[1]}`,
          severity: 'error',
        });
      }
    }

    return issues;
  }

  /**
  private calculateNestingDepth(mermaidCode: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of mermaidCode) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }
}
/**

import type { ArchJSON } from '../types/index.js';
import type { StructuralValidationResult, StructuralIssue } from './types.js';

/**
export class StructuralValidator {
  /**
  validate(mermaidCode: string, archJson: ArchJSON): StructuralValidationResult {
    const issues: StructuralIssue[] = [];

    issues.push(...this.checkMissingEntities(mermaidCode, archJson));

    issues.push(...this.checkInvalidRelations(mermaidCode, archJson));

    issues.push(...this.checkCircularDependencies(archJson));

    issues.push(...this.checkOrphanEntities(mermaidCode, archJson));

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
  private checkMissingEntities(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    for (const entity of archJson.entities) {
      const entityPattern = new RegExp(`\\bclass\\s+${this.escapeRegex(entity.name)}\\b`, 'i');
      if (!entityPattern.test(mermaidCode)) {
        issues.push({
          type: 'missing-entity',
          message: `Entity not found in diagram: ${entity.name}`,
          entity: entity.name,
          details: {
            id: entity.id,
            type: entity.type,
          },
        });
      }
    }

    return issues;
  }

  /**
  private checkInvalidRelations(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    for (const relation of archJson.relations) {
      const sourceExists = archJson.entities.some((e) => e.id === relation.source);
      const targetExists = archJson.entities.some((e) => e.id === relation.target);

      if (!sourceExists || !targetExists) {
        issues.push({
          type: 'invalid-relation',
          message: `Relation references undefined entity: ${relation.source} -> ${relation.target}`,
          details: {
            relationId: relation.id,
            relationType: relation.type,
            sourceExists,
            targetExists,
          },
        });
      }
    }

    return issues;
  }

  /**
  private checkCircularDependencies(archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (entityId: string): boolean => {
      if (recursionStack.has(entityId)) {
        return true; // Cycle detected
      }
      if (visited.has(entityId)) {
        return false; // Already checked
      }

      visited.add(entityId);
      recursionStack.add(entityId);

      const outgoingRelations = archJson.relations.filter((r) => r.source === entityId);
      for (const relation of outgoingRelations) {
        if (dfs(relation.target)) {
          return true;
        }
      }

      recursionStack.delete(entityId);
      return false;
    };

    for (const entity of archJson.entities) {
      if (dfs(entity.id)) {
        issues.push({
          type: 'circular-dependency',
          message: `Circular dependency detected involving: ${entity.name}`,
          entity: entity.name,
        });
        break; // Report one cycle at a time
      }
    }

    return issues;
  }

  /**
  private checkOrphanEntities(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    const entityRelationCount = new Map<string, number>();
    for (const entity of archJson.entities) {
      entityRelationCount.set(entity.id, 0);
    }

    for (const relation of archJson.relations) {
      entityRelationCount.set(relation.source, (entityRelationCount.get(relation.source) ?? 0) + 1);
      entityRelationCount.set(relation.target, (entityRelationCount.get(relation.target) ?? 0) + 1);
    }

    for (const [entityId, count] of entityRelationCount.entries()) {
      if (count === 0) {
        const entity = archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          issues.push({
            type: 'orphan-entity',
            message: `Entity has no relations: ${entity.name}`,
            entity: entity.name,
            details: {
              id: entity.id,
            },
          });
        }
      }
    }

    return issues;
  }

  /**
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
/**

import path from 'path';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { DetailLevel } from '@/types/config.js';

/**
export class ArchJSONAggregator {
  /**
  aggregate(archJSON: ArchJSON, level: DetailLevel): ArchJSON {
    switch (level) {
      case 'method':
        return archJSON;

      case 'class':
        return this.aggregateToClassLevel(archJSON);

      case 'package':
        return this.aggregateToPackageLevel(archJSON);

      default:
        throw new Error(`Unknown detail level: ${level}`);
    }
  }

  /**
  private aggregateToClassLevel(archJSON: ArchJSON): ArchJSON {
    return {
      ...archJSON,
      entities: archJSON.entities.map((entity) => ({
        ...entity,
        members: entity.members.filter(
          (member) => member.visibility === 'public' || member.visibility === undefined
        ),
      })),
    };
  }

  /**
  private aggregateToPackageLevel(archJSON: ArchJSON): ArchJSON {
    const { workspaceRoot } = archJSON;
    const packages = this.extractPackages(archJSON.entities, workspaceRoot, archJSON.language);
    const packageRelations = this.analyzePackageDependencies(
      archJSON.entities,
      archJSON.relations,
      workspaceRoot,
      archJSON.language
    );

    const packageEntities: Entity[] = packages.map((pkg) => {
      const firstEntityInPackage = archJSON.entities.find(
        (e) =>
          this.extractPackageFromEntity(e, workspaceRoot, archJSON.language) === pkg
      );

      return {
        id: pkg,
        name: pkg,
        type: 'package',
        visibility: 'public' as const,
        members: [],
        sourceLocation: firstEntityInPackage
          ? firstEntityInPackage.sourceLocation
          : { file: '', startLine: 0, endLine: 0 },
      };
    });

    return {
      ...archJSON,
      entities: packageEntities,
      relations: packageRelations,
    };
  }

  /**
  private extractPackages(
    entities: Entity[],
    workspaceRoot?: string,
    language?: ArchJSON['language']
  ): string[] {
    const packages = new Set<string>();

    for (const entity of entities) {
      const packageName = this.extractPackageFromEntity(entity, workspaceRoot, language);
      packages.add(packageName);
    }

    return Array.from(packages)
      .filter((pkg) => pkg !== '')
      .sort();
  }

  /**
  private extractPackageFromFile(
    filePath: string,
    workspaceRoot?: string,
    language?: ArchJSON['language']
  ): string {
    const directJavaModule = this.extractJavaMavenModule(filePath.replace(/\\/g, '/'), language);
    if (directJavaModule) {
      return directJavaModule;
    }

    if (workspaceRoot && path.isAbsolute(filePath)) {
      const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const javaModule = this.extractJavaMavenModule(rel, language);
      if (javaModule) {
        return javaModule;
      }
      const parts = rel.split('/');
      if (parts.length <= 1) return ''; // file directly in workspaceRoot
      return parts.slice(0, -1).join('/');
    }

    const normalizedPath = filePath.replace(/\\/g, '/');

    let afterSrc: string;
    const srcIndex = normalizedPath.indexOf('/src/');
    if (srcIndex !== -1) {
      afterSrc = normalizedPath.substring(srcIndex + 5); // 5 = length of '/src/'
    } else if (normalizedPath.startsWith('src/')) {
      afterSrc = normalizedPath.substring(4); // 4 = length of 'src/'
    } else {
      afterSrc = normalizedPath;
    }

    const firstSlashIndex = afterSrc.indexOf('/');
    if (firstSlashIndex === -1) {
      return '';
    }

    return afterSrc.substring(0, firstSlashIndex);
  }

  /**
  private extractPackageFromEntity(
    entity: Entity,
    workspaceRoot?: string,
    language?: ArchJSON['language']
  ): string {
    if (language === 'kotlin') {
      const lastDot = entity.id.lastIndexOf('.');
      return lastDot > 0 ? entity.id.slice(0, lastDot) : '';
    }
    return this.extractPackageFromFile(entity.sourceLocation.file, workspaceRoot, language);
  }

  private extractJavaMavenModule(
    relativePath: string,
    language?: ArchJSON['language']
  ): string | null {
    if (language !== 'java') {
      return null;
    }

    const normalized = relativePath.replace(/\\/g, '/');
    const match =
      normalized.match(/^([^/]+)\/src\/(?:main|test)\/java\//) ??
      normalized.match(/\/([^/]+)\/src\/(?:main|test)\/java\//);
    if (!match) return null;
    const moduleName = match[1];
    if (/^java\d+$/.test(moduleName) || moduleName === 'META-INF') {
      return null;
    }
    return moduleName;
  }

  /**
  private analyzePackageDependencies(
    entities: Entity[],
    relations: Relation[],
    workspaceRoot?: string,
    language?: ArchJSON['language']
  ): Relation[] {
    const entityToPackage = new Map<string, string>();
    for (const entity of entities) {
      const packageName = this.extractPackageFromEntity(entity, workspaceRoot, language);
      entityToPackage.set(entity.id, packageName);
    }

    const moduleToPackage = new Map<string, string>();
    for (const [entityId, packageName] of entityToPackage) {
      const lastDot = entityId.lastIndexOf('.');
      if (lastDot > 0) {
        const moduleId = entityId.slice(0, lastDot);
        if (!moduleToPackage.has(moduleId)) {
          moduleToPackage.set(moduleId, packageName);
        }
        let prefix = moduleId;
        let dotIdx: number;
        while ((dotIdx = prefix.lastIndexOf('.')) > 0) {
          prefix = prefix.slice(0, dotIdx);
          if (!moduleToPackage.has(prefix)) {
            moduleToPackage.set(prefix, packageName);
          }
        }
      }
    }

    const packageRelationsMap = new Map<string, Relation>();

    for (const relation of relations) {
      const sourcePackage =
        entityToPackage.get(relation.source) ?? moduleToPackage.get(relation.source);
      const targetPackage =
        entityToPackage.get(relation.target) ?? moduleToPackage.get(relation.target);

      if (
        sourcePackage === undefined ||
        targetPackage === undefined ||
        sourcePackage === '' ||
        targetPackage === '' ||
        sourcePackage === targetPackage
      ) {
        continue;
      }

      const key = `${sourcePackage}:${targetPackage}:${relation.type}`;

      if (!packageRelationsMap.has(key)) {
        packageRelationsMap.set(key, {
          id: `pkg-${sourcePackage}-${targetPackage}`,
          type: relation.type,
          source: sourcePackage,
          target: targetPackage,
        });
      }
    }

    return Array.from(packageRelationsMap.values());
  }
}
import { Project } from 'ts-morph';

/**
export abstract class BaseExtractor {
  protected readonly project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
  }
}
/**

import {
  type ClassDeclaration,
  type MethodDeclaration,
  type PropertyDeclaration,
  type ConstructorDeclaration,
  type Decorator as TsMorphDecorator,
  SyntaxKind,
} from 'ts-morph';
import type { Entity, Visibility, Member, Parameter, Decorator } from '@/types';
import { ParseError } from './errors.js';
import { BaseExtractor } from './base-extractor.js';

/**
export class ClassExtractor extends BaseExtractor {
  /**
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const classDecl = sourceFile.getClasses()[0];

    if (!classDecl) {
      throw new ParseError('No class found in code', filePath);
    }

    return this.extractClass(classDecl, filePath);
  }

  /**
  private extractClass(classDecl: ClassDeclaration, filePath: string): Entity {
    const name = classDecl.getName() || 'Anonymous';

    return {
      id: `${filePath}.${name}`,
      name,
      type: 'class',
      visibility: this.getVisibility(classDecl),
      isAbstract: classDecl.isAbstract(),
      members: this.extractMembers(classDecl),
      decorators: this.extractDecorators(classDecl.getDecorators()),
      genericParams: this.extractGenericParams(classDecl),
      sourceLocation: {
        file: filePath,
        startLine: classDecl.getStartLineNumber(),
        endLine: classDecl.getEndLineNumber(),
      },
    };
  }

  /**
  private getVisibility(_classDecl: ClassDeclaration): Visibility {
    return 'public';
  }

  /**
  private extractGenericParams(classDecl: ClassDeclaration): string[] | undefined {
    const typeParams = classDecl.getTypeParameters();

    if (typeParams.length === 0) {
      return undefined;
    }

    return typeParams.map((param) => param.getName());
  }

  /**
  private extractMembers(classDecl: ClassDeclaration): Member[] {
    const members: Member[] = [];

    for (const property of classDecl.getProperties()) {
      members.push(this.extractProperty(property));
    }

    for (const method of classDecl.getMethods()) {
      members.push(this.extractMethod(method));
    }

    for (const constructor of classDecl.getConstructors()) {
      members.push(this.extractConstructor(constructor));
    }

    return members;
  }

  /**
  private extractProperty(property: PropertyDeclaration): Member {
    const initializer = property.getInitializer();

    return {
      name: property.getName(),
      type: 'property',
      visibility: this.getMemberVisibility(property),
      fieldType: property.getType().getText(),
      isStatic: property.isStatic(),
      isReadonly: property.isReadonly(),
      defaultValue: initializer?.getText(),
      decorators: this.extractDecorators(property.getDecorators()),
    };
  }

  /**
  private extractMethod(method: MethodDeclaration): Member {
    return {
      name: method.getName(),
      type: 'method',
      visibility: this.getMemberVisibility(method),
      isStatic: method.isStatic(),
      isAsync: method.isAsync(),
      isAbstract: method.isAbstract(),
      parameters: this.extractParameters(method),
      returnType: method.getReturnType().getText(),
      decorators: this.extractDecorators(method.getDecorators()),
    };
  }

  /**
  private extractConstructor(constructor: ConstructorDeclaration): Member {
    return {
      name: 'constructor',
      type: 'constructor',
      visibility: this.getConstructorVisibility(constructor),
      parameters: this.extractParameters(constructor),
    };
  }

  /**
  private extractParameters(node: MethodDeclaration | ConstructorDeclaration): Parameter[] {
    return node.getParameters().map((param) => {
      const initializer = param.getInitializer();

      return {
        name: param.getName(),
        type: param.getType().getText(),
        isOptional: param.isOptional() || param.hasInitializer(),
        defaultValue: initializer?.getText(),
      };
    });
  }

  /**
  private getMemberVisibility(node: PropertyDeclaration | MethodDeclaration): Visibility {
    const modifiers = node.getModifiers();

    for (const modifier of modifiers) {
      const kind = modifier.getKind();
      if (kind === SyntaxKind.PrivateKeyword) return 'private';
      if (kind === SyntaxKind.ProtectedKeyword) return 'protected';
      if (kind === SyntaxKind.PublicKeyword) return 'public';
    }

    return 'public';
  }

  /**
  private getConstructorVisibility(constructor: ConstructorDeclaration): Visibility {
    const modifiers = constructor.getModifiers();

    for (const modifier of modifiers) {
      const kind = modifier.getKind();
      if (kind === SyntaxKind.PrivateKeyword) return 'private';
      if (kind === SyntaxKind.ProtectedKeyword) return 'protected';
      if (kind === SyntaxKind.PublicKeyword) return 'public';
    }

    return 'public';
  }

  /**
  private extractDecorators(decorators: TsMorphDecorator[]): Decorator[] {
    if (decorators.length === 0) {
      return [];
    }

    return decorators.map((decorator) => {
      const name = decorator.getName();
      const args = decorator.getArguments();

      const result: Decorator = {
        name,
      };

      if (args.length > 0) {
        result.arguments = args.map((arg) => arg.getText());
      }

      return result;
    });
  }
}
/**

import { type EnumDeclaration } from 'ts-morph';
import type { Entity, Member } from '@/types';
import { ParseError } from './errors.js';
import { BaseExtractor } from './base-extractor.js';

/**
export class EnumExtractor extends BaseExtractor {
  /**
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const enumDecl = sourceFile.getEnums()[0];

    if (!enumDecl) {
      throw new ParseError('No enum found in code', filePath);
    }

    return this.extractEnum(enumDecl, filePath);
  }

  /**
  extractEnum(enumDecl: EnumDeclaration, filePath: string): Entity {
    const name = enumDecl.getName();

    return {
      id: `${filePath}.${name}`,
      name,
      type: 'enum',
      visibility: 'public',
      members: this.extractMembers(enumDecl),
      decorators: [],
      isConst: enumDecl.isConstEnum(),
      sourceLocation: {
        file: filePath,
        startLine: enumDecl.getStartLineNumber(),
        endLine: enumDecl.getEndLineNumber(),
      },
    };
  }

  /**
  private extractMembers(enumDecl: EnumDeclaration): Member[] {
    const members: Member[] = [];

    for (const member of enumDecl.getMembers()) {
      const initializer = member.getInitializer();

      members.push({
        name: member.getName(),
        type: 'property',
        visibility: 'public',
        defaultValue: initializer?.getText(),
      });
    }

    return members;
  }
}
/**
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly line?: number,
    public readonly column?: number
  ) {
    super(message);
    this.name = 'ParseError';
    Error.captureStackTrace(this, this.constructor);
  }
}
/**

import {
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph';
import type { Entity, Member } from '@/types/index.js';

/**
export class FunctionExtractor {
  /**
  extract(sourceFile: SourceFile, relativeFilePath: string): Entity[] {
    const entities: Entity[] = [];

    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      const name = fn.getName();
      if (!name) continue;
      entities.push({
        id: `${relativeFilePath}.${name}`,
        name,
        type: 'function',
        visibility: 'public',
        members: this.extractParamsAsMembers(fn),
        sourceLocation: {
          file: relativeFilePath,
          startLine: fn.getStartLineNumber(),
          endLine: fn.getEndLineNumber(),
        },
      });
    }

    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          const name = decl.getName();
          entities.push({
            id: `${relativeFilePath}.${name}`,
            name,
            type: 'function',
            visibility: 'public',
            members: this.extractParamsAsMembers(init),
            sourceLocation: {
              file: relativeFilePath,
              startLine: decl.getStartLineNumber(),
              endLine: decl.getEndLineNumber(),
            },
          });
        }
      }
    }

    return entities;
  }

  /**
  private extractParamsAsMembers(
    fn: FunctionDeclaration | ArrowFunction | FunctionExpression
  ): Member[] {
    return fn.getParameters().map((p) => ({
      name: p.getName(),
      type: 'field' as const,
      visibility: 'public' as const,
      fieldType: p.getType().getText(),
    }));
  }
}
/**

export { ClassExtractor } from './class-extractor';
export { InterfaceExtractor } from './interface-extractor';
export { EnumExtractor } from './enum-extractor';
export { RelationExtractor } from './relation-extractor';
export { TypeScriptParser } from './typescript-parser';
export { ParallelParser } from './parallel-parser';
export type { ParallelParserOptions, ParsingMetrics } from './parallel-parser';
export { ArchJSONAggregator } from './archjson-aggregator';

export const parserVersion = '0.1.0';
/**

import { type InterfaceDeclaration, type PropertySignature, type MethodSignature } from 'ts-morph';
import type { Entity, Member, Parameter } from '@/types';
import { ParseError } from './errors.js';
import { BaseExtractor } from './base-extractor.js';

/**
export class InterfaceExtractor extends BaseExtractor {
  /**
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const interfaceDecl = sourceFile.getInterfaces()[0];

    if (!interfaceDecl) {
      throw new ParseError('No interface found in code', filePath);
    }

    return this.extractInterface(interfaceDecl, filePath);
  }

  /**
  extractInterface(interfaceDecl: InterfaceDeclaration, filePath: string): Entity {
    const name = interfaceDecl.getName();

    return {
      id: `${filePath}.${name}`,
      name,
      type: 'interface',
      visibility: 'public',
      members: this.extractMembers(interfaceDecl),
      decorators: [],
      extends: this.extractExtends(interfaceDecl),
      genericParams: this.extractGenericParams(interfaceDecl),
      sourceLocation: {
        file: filePath,
        startLine: interfaceDecl.getStartLineNumber(),
        endLine: interfaceDecl.getEndLineNumber(),
      },
    };
  }

  /**
  private extractExtends(interfaceDecl: InterfaceDeclaration): string[] | undefined {
    const extendsExpressions = interfaceDecl.getExtends();

    if (extendsExpressions.length === 0) {
      return undefined;
    }

    return extendsExpressions.map((expr) => expr.getExpression().getText());
  }

  /**
  private extractGenericParams(interfaceDecl: InterfaceDeclaration): string[] | undefined {
    const typeParams = interfaceDecl.getTypeParameters();

    if (typeParams.length === 0) {
      return undefined;
    }

    return typeParams.map((param) => param.getName());
  }

  /**
  private extractMembers(interfaceDecl: InterfaceDeclaration): Member[] {
    const members: Member[] = [];

    for (const property of interfaceDecl.getProperties()) {
      members.push(this.extractPropertySignature(property));
    }

    for (const method of interfaceDecl.getMethods()) {
      members.push(this.extractMethodSignature(method));
    }

    return members;
  }

  /**
  private extractPropertySignature(property: PropertySignature): Member {
    const member: Member = {
      name: property.getName(),
      type: 'property',
      visibility: 'public',
      fieldType: property.getType().getText(),
      isReadonly: property.isReadonly(),
    };

    if (property.hasQuestionToken()) {
      member.isOptional = true;
    }

    return member;
  }

  /**
  private extractMethodSignature(method: MethodSignature): Member {
    return {
      name: method.getName(),
      type: 'method',
      visibility: 'public',
      parameters: this.extractParameters(method),
      returnType: method.getReturnType().getText(),
    };
  }

  /**
  private extractParameters(method: MethodSignature): Parameter[] {
    return method.getParameters().map((param) => {
      const initializer = param.getInitializer();

      return {
        name: param.getName(),
        type: param.getType().getText(),
        isOptional: param.isOptional() || param.hasInitializer(),
        defaultValue: initializer?.getText(),
      };
    });
  }
}
import path from 'path';
import type {
  ArchJSON,
  ArchJSONMetrics,
  RelationType,
  DetailLevel,
  FileStats,
  CycleInfo,
} from '@/types/index.js';

export class MetricsCalculator {
  calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics {
    const { entities, relations } = archJSON;
    const isAtlas = !!archJSON.extensions?.goAtlas;

    const { sccCount, nonTrivialSCCs } = this.computeSCCGroups(archJSON);

    const computeDetails = !isAtlas && level !== 'package';
    const cycles = computeDetails ? this.buildCycleInfos(archJSON, nonTrivialSCCs) : undefined;
    const fileStats = computeDetails ? this.computeFileStats(archJSON, nonTrivialSCCs) : undefined;

    return {
      level,
      entityCount: entities.length,
      relationCount: relations.length,
      relationTypeBreakdown: this.buildTypeBreakdown(relations),
      stronglyConnectedComponents: sccCount,
      inferredRelationRatio: this.calcInferredRatio(relations),
      fileStats,
      cycles,
    };
  }


  private buildTypeBreakdown(
    relations: ArchJSON['relations']
  ): Partial<Record<RelationType, number>> {
    const breakdown: Partial<Record<RelationType, number>> = {};
    for (const r of relations) {
      breakdown[r.type] = (breakdown[r.type] ?? 0) + 1;
    }
    return breakdown;
  }

  private calcInferredRatio(relations: ArchJSON['relations']): number {
    if (relations.length === 0) return 0;
    const inferredCount = relations.filter(
      (r) => r.inferenceSource !== undefined && r.inferenceSource !== 'explicit'
    ).length;
    return Math.round((inferredCount / relations.length) * 100) / 100;
  }


  /**
  private computeSCCGroups(archJSON: ArchJSON): { sccCount: number; nonTrivialSCCs: string[][] } {
    const { entities, relations } = archJSON;
    if (entities.length === 0) return { sccCount: 0, nonTrivialSCCs: [] };

    const entityIds = new Set(entities.map((e) => e.id));
    const validRelations = relations.filter(
      (r) => entityIds.has(r.source) && entityIds.has(r.target)
    );

    const graph = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const id of entityIds) {
      graph.set(id, []);
      transposed.set(id, []);
    }
    for (const r of validRelations) {
      graph.get(r.source).push(r.target);
      transposed.get(r.target).push(r.source);
    }

    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    for (const id of entityIds) {
      if (!visited1.has(id)) this.dfsIterative(id, graph, visited1, finishStack);
    }

    const visited2 = new Set<string>();
    const sccGroups: string[][] = [];
    while (finishStack.length > 0) {
      const node = finishStack.pop();
      if (!visited2.has(node)) {
        const members: string[] = [];
        this.dfsIterative(node, transposed, visited2, members);
        sccGroups.push(members);
      }
    }

    return {
      sccCount: sccGroups.length,
      nonTrivialSCCs: sccGroups.filter((g) => g.length > 1),
    };
  }

  /**
  private buildCycleInfos(archJSON: ArchJSON, nonTrivialSCCs: string[][]): CycleInfo[] {
    const { entities, workspaceRoot } = archJSON;

    const normalise = (rawFile: string): string => {
      if (!rawFile) return '';
      if (workspaceRoot && path.isAbsolute(rawFile)) {
        return path.relative(workspaceRoot, rawFile).replace(/\\/g, '/');
      }
      return rawFile;
    };

    const entityFileMap = new Map<string, string>();
    const entityNameMap = new Map<string, string>();
    for (const e of entities) {
      entityFileMap.set(e.id, normalise(e.sourceLocation?.file ?? ''));
      entityNameMap.set(e.id, e.name);
    }

    return nonTrivialSCCs
      .map((members) => ({
        size: members.length,
        members,
        memberNames: members.map((id) => entityNameMap.get(id) ?? id),
        files: [...new Set(members.map((id) => entityFileMap.get(id) ?? '').filter(Boolean))],
      }))
      .sort((a, b) => b.size - a.size);
  }


  private computeFileStats(archJSON: ArchJSON, nonTrivialSCCs: string[][]): FileStats[] {
    const { entities, relations, workspaceRoot } = archJSON;

    const normalise = (rawFile: string): string => {
      if (!rawFile) return '';
      if (workspaceRoot && path.isAbsolute(rawFile)) {
        return path.relative(workspaceRoot, rawFile).replace(/\\/g, '/');
      }
      return rawFile;
    };

    const fileEntityMap = new Map<string, typeof entities>();
    for (const e of entities) {
      const file = normalise(e.sourceLocation?.file ?? '');
      if (!file) continue;
      if (!fileEntityMap.has(file)) fileEntityMap.set(file, []);
      fileEntityMap.get(file).push(e);
    }

    const entityIds = new Set(entities.map((e) => e.id));
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const r of relations) {
      if (!entityIds.has(r.source) || !entityIds.has(r.target)) continue;
      outDegree.set(r.source, (outDegree.get(r.source) ?? 0) + 1);
      inDegree.set(r.target, (inDegree.get(r.target) ?? 0) + 1);
    }

    const entityFileMap = new Map<string, string>();
    for (const e of entities) {
      entityFileMap.set(e.id, normalise(e.sourceLocation?.file ?? ''));
    }
    const cycleCountPerFile = new Map<string, number>();
    for (const scc of nonTrivialSCCs) {
      const filesInSCC = new Set(scc.map((id) => entityFileMap.get(id) ?? '').filter(Boolean));
      for (const f of filesInSCC) {
        cycleCountPerFile.set(f, (cycleCountPerFile.get(f) ?? 0) + 1);
      }
    }

    const stats: FileStats[] = [];
    for (const [file, ents] of fileEntityMap) {
      let loc = 0;
      let methodCount = 0;
      let fieldCount = 0;
      let filInDegree = 0;
      let filOutDegree = 0;

      for (const e of ents) {
        if (e.sourceLocation.endLine > loc) loc = e.sourceLocation.endLine;
        for (const m of e.members) {
          if (m.type === 'method' || m.type === 'constructor') methodCount++;
          else if (m.type === 'property' || m.type === 'field') fieldCount++;
        }
        filInDegree += inDegree.get(e.id) ?? 0;
        filOutDegree += outDegree.get(e.id) ?? 0;
      }

      stats.push({
        file,
        loc,
        entityCount: ents.length,
        methodCount,
        fieldCount,
        inDegree: filInDegree,
        outDegree: filOutDegree,
        cycleCount: cycleCountPerFile.get(file) ?? 0,
      });
    }

    stats.sort((a, b) => b.inDegree - a.inDegree || b.outDegree - a.outDegree);
    return stats;
  }


  /**
  private dfsIterative(
    start: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    finishList: string[] | null
  ): void {
    const stack: [string, number][] = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const neighbors = graph.get(node) ?? [];
      if (idx < neighbors.length) {
        top[1]++;
        const next = neighbors[idx];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push([next, 0]);
        }
      } else {
        stack.pop();
        if (finishList !== null) finishList.push(node);
      }
    }
  }
}
/**

import { EventEmitter } from 'events';
import os from 'os';
import pLimit from 'p-limit';
import { TypeScriptParser } from './typescript-parser';
import type { ArchJSON, Entity, Relation } from '@/types';
import fs from 'fs/promises';
import type { ParseCache } from './parse-cache.js';

/**
export interface ParallelParserOptions {
  /**
  concurrency?: number;

  /**
  continueOnError?: boolean;

  /**
  workspaceRoot?: string;

  /**
  parseCache?: ParseCache;
}

/**
export interface ParsingMetrics {
  result: ArchJSON;
  parseTime: number;
  filesPerSecond: number;
  fileCount: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

/**
interface ProgressEvent {
  completed: number;
  total: number;
  percentage: number;
}

/**
interface FileCompleteEvent {
  file: string;
  entityCount: number;
  relationCount: number;
}

/**
interface CompletionEvent {
  totalFiles: number;
  successCount: number;
  errorCount: number;
  parseTime: number;
}

/**
export class ParallelParser extends EventEmitter {
  private concurrency: number;
  private continueOnError: boolean;
  private limit: ReturnType<typeof pLimit>;
  private workspaceRoot?: string;
  private parseCache?: ParseCache;

  constructor(options: ParallelParserOptions = {}) {
    super();

    this.concurrency = options.concurrency ?? os.cpus().length;
    this.continueOnError = options.continueOnError ?? true;
    this.workspaceRoot = options.workspaceRoot;
    this.parseCache = options.parseCache;
    this.limit = pLimit(this.concurrency);
  }

  /**
  getConcurrency(): number {
    return this.concurrency;
  }

  /**
  getContinueOnError(): boolean {
    return this.continueOnError;
  }

  /**
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    if (filePaths.length === 0) {
      return this.createEmptyArchJSON();
    }

    this.emit('start', { totalFiles: filePaths.length });

    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    let completedCount = 0;

    const results = await Promise.all(
      filePaths.map((filePath) =>
        this.limit(async () => {
          try {
            this.emit('file:start', { file: filePath });

            const result = await this.parseFile(filePath);

            successCount++;
            completedCount++;

            this.emit('file:complete', {
              file: filePath,
              entityCount: result.entities.length,
              relationCount: result.relations.length,
            } as FileCompleteEvent);

            this.emit('progress', {
              completed: completedCount,
              total: filePaths.length,
              percentage: Math.round((completedCount / filePaths.length) * 100),
            } as ProgressEvent);

            return result;
          } catch (error) {
            errorCount++;
            completedCount++;

            this.emit('file:error', {
              file: filePath,
              error: error instanceof Error ? error.message : String(error),
            });

            this.emit('progress', {
              completed: completedCount,
              total: filePaths.length,
              percentage: Math.round((completedCount / filePaths.length) * 100),
            } as ProgressEvent);

            if (!this.continueOnError) {
              throw error;
            }

            return this.createEmptyArchJSON();
          }
        })
      )
    );

    const merged = this.mergeResults(results);

    const parseTime = Date.now() - startTime;

    this.emit('complete', {
      totalFiles: filePaths.length,
      successCount,
      errorCount,
      parseTime,
    } as CompletionEvent);

    return merged;
  }

  /**
  async parseFilesWithMetrics(filePaths: string[]): Promise<ParsingMetrics> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const result = await this.parseFiles(filePaths);

    const endTime = Date.now();
    const endMemory = process.memoryUsage();

    const parseTime = endTime - startTime;
    const filesPerSecond = filePaths.length / (parseTime / 1000);

    return {
      result,
      parseTime,
      filesPerSecond,
      fileCount: filePaths.length,
      memoryUsage: {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal,
        external: endMemory.external,
        rss: endMemory.rss,
      },
    };
  }

  /**
  private async parseFile(filePath: string): Promise<ArchJSON> {
    try {
      await fs.access(filePath);
    } catch {
      return this.createEmptyArchJSON([filePath]);
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      content = '';
    }

    if (this.parseCache) {
      return this.parseCache.getOrParse(filePath, content, () => {
        const parser = new TypeScriptParser(this.workspaceRoot);
        return parser.parseCode(content, filePath);
      });
    }
    const parser = new TypeScriptParser(this.workspaceRoot);
    return parser.parseCode(content, filePath);
  }

  /**
  private mergeResults(results: ArchJSON[]): ArchJSON {
    if (results.length === 0) {
      return this.createEmptyArchJSON();
    }

    const allEntities: Entity[] = [];
    const allRelations: Relation[] = [];
    const allSourceFiles: string[] = [];

    for (const result of results) {
      allEntities.push(...result.entities);
      allRelations.push(...result.relations);
      allSourceFiles.push(...result.sourceFiles);
    }

    const uniqueRelations = this.deduplicateRelations(allRelations);

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: allSourceFiles,
      entities: allEntities,
      relations: uniqueRelations,
      workspaceRoot: this.workspaceRoot,
    };
  }

  /**
  private deduplicateRelations(relations: Relation[]): Relation[] {
    const seen = new Set<string>();
    const unique: Relation[] = [];

    for (const relation of relations) {
      const key = `${relation.type}:${relation.source}:${relation.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(relation);
      }
    }

    return unique;
  }

  /**
  private createEmptyArchJSON(sourceFiles: string[] = []): ArchJSON {
    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities: [],
      relations: [],
    };
  }
}
/**

import crypto from 'node:crypto';
import type { ArchJSON } from '@/types/index.js';

export class ParseCache {
  private cache = new Map<string, ArchJSON>();

  /**
  getOrParse(filePath: string, content: string, parse: () => ArchJSON): ArchJSON {
    const key = crypto
      .createHash('sha256')
      .update(filePath)
      .update('\0')
      .update(content)
      .digest('hex');

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const result = parse();
    this.cache.set(key, result);
    return result;
  }

  /** Number of entries currently held in the cache */
  get size(): number {
    return this.cache.size;
  }

  /** Remove all cached entries */
  clear(): void {
    this.cache.clear();
  }
}
/**

import {
  type SourceFile,
  type ClassDeclaration,
  type InterfaceDeclaration,
  SyntaxKind,
} from 'ts-morph';
import type { Relation } from '@/types';
import { BaseExtractor } from './base-extractor.js';

/**
function isLocalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/');
}

/**
function collectExternalImportedNames(sourceFile: SourceFile): Set<string> {
  const externalNames = new Set<string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (isLocalModuleSpecifier(specifier)) {
      continue; // local import – keep
    }

    for (const named of importDecl.getNamedImports()) {
      externalNames.add(named.getName());
    }

    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      externalNames.add(defaultImport.getText());
    }

    const namespaceImport = importDecl.getNamespaceImport();
    if (namespaceImport) {
      externalNames.add(namespaceImport.getText());
    }
  }

  return externalNames;
}

/**
export class RelationExtractor extends BaseExtractor {
  /**
  extract(code: string, filePath: string = 'test.ts'): Relation[] {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    return this.extractFromSourceFile(sourceFile);
  }

  /**
  extractFromSourceFile(sourceFile: SourceFile): Relation[] {
    const relations: Relation[] = [];
    const relationSet = new Set<string>();
    const externalNames = collectExternalImportedNames(sourceFile);

    for (const classDecl of sourceFile.getClasses()) {
      relations.push(...this.extractClassRelations(classDecl, relationSet, externalNames));
    }

    for (const interfaceDecl of sourceFile.getInterfaces()) {
      relations.push(...this.extractInterfaceRelations(interfaceDecl, relationSet, externalNames));
    }

    relations.push(...this.extractFunctionRelations(sourceFile, relationSet, externalNames));

    return relations;
  }

  /**
  private extractClassRelations(
    classDecl: ClassDeclaration,
    relationSet: Set<string>,
    externalNames: Set<string> = new Set()
  ): Relation[] {
    const relations: Relation[] = [];
    const className = classDecl.getName();

    if (!className) return relations;

    const extendsExpr = classDecl.getExtends();
    if (extendsExpr) {
      const parentName = extendsExpr.getExpression().getText();
      this.addRelation(relations, relationSet, 'inheritance', className, parentName);
    }

    for (const impl of classDecl.getImplements()) {
      const interfaceName = impl.getExpression().getText();
      this.addRelation(relations, relationSet, 'implementation', className, interfaceName);
    }

    for (const property of classDecl.getProperties()) {
      const propertyType = this.extractTypeName(property.getType().getText());
      if (propertyType && this.isCustomType(propertyType) && !externalNames.has(propertyType)) {
        this.addRelation(relations, relationSet, 'composition', className, propertyType);
      }
    }

    for (const constructor of classDecl.getConstructors()) {
      for (const param of constructor.getParameters()) {
        const paramType = this.extractTypeName(param.getType().getText());
        if (paramType && this.isCustomType(paramType) && !externalNames.has(paramType)) {
          this.addRelation(relations, relationSet, 'composition', className, paramType);
        }
      }
    }

    for (const method of classDecl.getMethods()) {
      const returnType = this.extractTypeName(method.getReturnType().getText());
      if (returnType && this.isCustomType(returnType) && !externalNames.has(returnType)) {
        this.addRelation(relations, relationSet, 'dependency', className, returnType);
      }

      for (const param of method.getParameters()) {
        const paramType = this.extractTypeName(param.getType().getText());
        if (paramType && this.isCustomType(paramType) && !externalNames.has(paramType)) {
          this.addRelation(relations, relationSet, 'dependency', className, paramType);
        }
      }
    }

    return relations;
  }

  /**
  private extractInterfaceRelations(
    interfaceDecl: InterfaceDeclaration,
    relationSet: Set<string>,
    externalNames: Set<string> = new Set()
  ): Relation[] {
    const relations: Relation[] = [];
    const interfaceName = interfaceDecl.getName();

    for (const extendsExpr of interfaceDecl.getExtends()) {
      const parentName = extendsExpr.getExpression().getText();
      this.addRelation(relations, relationSet, 'inheritance', interfaceName, parentName);
    }

    for (const property of interfaceDecl.getProperties()) {
      const propTypeName = this.extractTypeName(property.getType().getText());
      if (
        propTypeName &&
        this.isCustomType(propTypeName) &&
        !externalNames.has(propTypeName) &&
        propTypeName !== interfaceName
      ) {
        this.addRelation(relations, relationSet, 'composition', interfaceName, propTypeName);
      }
    }

    return relations;
  }

  /**
  private extractFunctionRelations(
    sourceFile: SourceFile,
    relationSet: Set<string>,
    externalNames: Set<string>
  ): Relation[] {
    const relations: Relation[] = [];

    const localImportedNames = new Set<string>();
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifierValue();
      if (!isLocalModuleSpecifier(specifier)) {
        continue;
      }
      for (const named of importDecl.getNamedImports()) {
        localImportedNames.add(named.getName());
      }
    }

    const emitDepsForBody = (funcName: string, bodyText: string): void => {
      for (const importedName of localImportedNames) {
        if (importedName === funcName) {
          continue; // skip self
        }
        const wordBoundaryRegex = new RegExp(`\\b${importedName}\\b`);
        if (wordBoundaryRegex.test(bodyText)) {
          this.addRelation(relations, relationSet, 'dependency', funcName, importedName);
        }
      }
    };

    for (const funcDecl of sourceFile.getFunctions()) {
      const funcName = funcDecl.getName();
      if (!funcName) continue;
      const body = funcDecl.getBody();
      if (!body) continue;
      emitDepsForBody(funcName, body.getText());
    }

    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (!initializer) continue;
      if (initializer.getKind() !== SyntaxKind.ArrowFunction) continue;
      const varName = varDecl.getName();
      emitDepsForBody(varName, initializer.getText());
    }

    return relations;
  }

  /**
  private addRelation(
    relations: Relation[],
    relationSet: Set<string>,
    type: Relation['type'],
    source: string,
    target: string
  ): void {
    const relationKey = `${type}:${source}:${target}`;

    if (!relationSet.has(relationKey)) {
      relationSet.add(relationKey);
      relations.push({
        id: `${source}_${type}_${target}`,
        type,
        source,
        target,
      });
    }
  }

  /**
  private extractTypeName(typeText: string): string | null {
    typeText = typeText.trim();

    if (typeText.startsWith('(')) return null;
    if (typeText.startsWith('{')) return null;
    if (typeText.startsWith('[')) return null;

    if (typeText.startsWith('import(')) {
      const match = typeText.match(/^import\([^)]+\)\.\s*([\w.]+)/);
      if (match) {
        return match[2]; // Return the class name after the dot
      }
    }

    if (typeText.startsWith('import___')) {
      const parts = typeText.split('___');
      if (parts.length > 0) {
        const actualTypeName = parts[parts.length - 1];
        if (actualTypeName && actualTypeName.length > 0) {
          return actualTypeName;
        } else if (parts.length > 1) {
          return parts[parts.length - 2];
        }
      }
      return null;
    }

    if (typeText.endsWith('[]')) {
      return this.extractTypeName(typeText.slice(0, -2));
    }

    const genericMatch = typeText.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const containerType = genericMatch[1];
      const innerType = genericMatch[2];

      const typeParams: string[] = [];
      let depth = 0;
      let current = '';

      for (const char of innerType) {
        if (char === '<') depth++;
        if (char === '>') depth--;
        if (char === ',' && depth === 0) {
          typeParams.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) {
        typeParams.push(current.trim());
      }

      for (const param of typeParams) {
        const extracted = this.extractTypeName(param);
        if (extracted) {
          return extracted;
        }
      }

      return null;
    }

    if (typeText.includes('|')) {
      const types = typeText.split('|');
      if (types[0]) {
        return this.extractTypeName(types[0]);
      }
    }

    if (this.isPrimitiveType(typeText)) {
      return null;
    }

    return typeText;
  }

  /**
  private isCustomType(typeName: string): boolean {
    return !this.isPrimitiveType(typeName);
  }

  /**
  private isPrimitiveType(typeName: string): boolean {
    const primitives = new Set([
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'null',
      'undefined',
      'never',
      'object',
      'symbol',
      'bigint',
      'Array',
      'Promise',
      'Date',
      'RegExp',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
    ]);

    return primitives.has(typeName);
  }
}
/**

import path from 'path';
import { Project } from 'ts-morph';
import { findTsConfigPath, loadPathAliases } from '@/utils/tsconfig-finder.js';
import { ClassExtractor } from './class-extractor';
import { InterfaceExtractor } from './interface-extractor';
import { EnumExtractor } from './enum-extractor';
import { RelationExtractor } from './relation-extractor';
import { FunctionExtractor } from './function-extractor';
import type { ArchJSON, Entity, Relation } from '@/types';

/**
export class TypeScriptParser {
  private project: Project;
  private classExtractor: ClassExtractor;
  private interfaceExtractor: InterfaceExtractor;
  private enumExtractor: EnumExtractor;
  private relationExtractor: RelationExtractor;
  private functionExtractor: FunctionExtractor;
  private workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
    this.classExtractor = new ClassExtractor();
    this.interfaceExtractor = new InterfaceExtractor();
    this.enumExtractor = new EnumExtractor();
    this.relationExtractor = new RelationExtractor();
    this.functionExtractor = new FunctionExtractor();
  }

  /**
  private toRelPath(absPath: string): string {
    if (this.workspaceRoot) {
      return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
    }
    return absPath;
  }

  /**
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const entities: Entity[] = [];
    const sourceFiles: string[] = [filePath];

    const relPath = this.toRelPath(filePath);

    for (const classDecl of sourceFile.getClasses()) {
      const entity = this.classExtractor['extractClass'](classDecl, relPath);
      entities.push(entity);
    }

    for (const interfaceDecl of sourceFile.getInterfaces()) {
      const entity = this.interfaceExtractor.extractInterface(interfaceDecl, relPath);
      entities.push(entity);
    }

    for (const enumDecl of sourceFile.getEnums()) {
      const entity = this.enumExtractor.extractEnum(enumDecl, relPath);
      entities.push(entity);
    }

    entities.push(...this.functionExtractor.extract(sourceFile, relPath));

    const rawRelations = this.relationExtractor.extractFromSourceFile(sourceFile);
    const relations = this.qualifyRelations(entities, rawRelations, relPath);

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations,
    };
  }

  /**
  parseProject(
    rootDir: string,
    pattern: string = '**/*.ts',
    externalProject?: Project,
    excludePatterns?: string[]
  ): ArchJSON {
    this.workspaceRoot = rootDir;

    let fsProject: Project;
    if (externalProject) {
      fsProject = externalProject;
    } else {
      const tsConfigFilePath = findTsConfigPath(rootDir);
      const pathAliases = tsConfigFilePath ? loadPathAliases(tsConfigFilePath) : undefined;
      fsProject = pathAliases
        ? new Project({ compilerOptions: { target: 99, ...pathAliases } })
        : new Project({ compilerOptions: { target: 99 } });

      const builtinExcludes = [
        `!${rootDir}/**/*.test.ts`,
        `!${rootDir}/**/*.spec.ts`,
        `!${rootDir}/**/node_modules/**`,
      ];
      const callerExcludes = (excludePatterns ?? []).map((p) =>
        p.startsWith('!') || path.isAbsolute(p) ? p : `!${rootDir}/${p}`
      );
      fsProject.addSourceFilesAtPaths([
        `${rootDir}/${pattern}`,
        ...builtinExcludes,
        ...callerExcludes,
      ]);
    }

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const sourceFiles: string[] = [];

    for (const sourceFile of fsProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      sourceFiles.push(filePath);

      const relPath = this.toRelPath(filePath);

      for (const classDecl of sourceFile.getClasses()) {
        const entity = this.classExtractor['extractClass'](classDecl, relPath);
        entities.push(entity);
      }

      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const entity = this.interfaceExtractor.extractInterface(interfaceDecl, relPath);
        entities.push(entity);
      }

      for (const enumDecl of sourceFile.getEnums()) {
        const entity = this.enumExtractor.extractEnum(enumDecl, relPath);
        entities.push(entity);
      }

      entities.push(...this.functionExtractor.extract(sourceFile, relPath));

      const importedNameToScopedId = new Map<string, string>();
      for (const importDecl of sourceFile.getImportDeclarations()) {
        const importedSourceFile = importDecl.getModuleSpecifierSourceFile();
        if (!importedSourceFile) continue;
        const importedRelPath = this.toRelPath(importedSourceFile.getFilePath());
        for (const named of importDecl.getNamedImports()) {
          const importedName = named.getName();
          importedNameToScopedId.set(importedName, `${importedRelPath}.${importedName}`);
        }
      }

      const fileRelations = this.relationExtractor.extractFromSourceFile(sourceFile);
      const resolvedRelations = fileRelations.map((rel) => {
        const scopedSource = `${relPath}.${rel.source}`;

        let resolvedTarget = rel.target;
        if (importedNameToScopedId.has(rel.target)) {
          resolvedTarget = importedNameToScopedId.get(rel.target)!;
        }

        return {
          ...rel,
          id: `${scopedSource}_${rel.type}_${resolvedTarget}`,
          source: scopedSource,
          target: resolvedTarget,
        };
      });

      relations.push(...resolvedRelations);
    }

    const merged: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations,
    };

    const filtered = this.filterExternalRelations(merged);

    const uniqueRelations = this.deduplicateRelations(filtered.relations);

    return {
      ...filtered,
      relations: uniqueRelations,
    };
  }

  /**
  private qualifyRelations(
    entities: Entity[],
    relations: Relation[],
    filePath: string
  ): Relation[] {
    const nameToId = new Map<string, string>();
    for (const entity of entities) {
      if (!nameToId.has(entity.name)) {
        nameToId.set(entity.name, entity.id);
      }
    }

    return relations.map((rel) => {
      const resolvedSource = nameToId.get(rel.source) ?? `${filePath}.${rel.source}`;
      const resolvedTarget = nameToId.get(rel.target) ?? rel.target;
      if (resolvedSource === rel.source && resolvedTarget === rel.target) {
        return rel; // no change needed
      }
      return {
        ...rel,
        id: `${resolvedSource}_${rel.type}_${resolvedTarget}`,
        source: resolvedSource,
        target: resolvedTarget,
      };
    });
  }

  /**
  private filterExternalRelations(merged: ArchJSON): ArchJSON {
    const entityIds = new Set(merged.entities.map((e) => e.id));
    const EXTERNAL_PATTERNS = [
      /^(string|number|boolean|void|null|undefined|any|unknown|never|object|symbol|bigint)$/,
      /^(NodeJS\.|Buffer$|Error$|Promise$|Map$|Set$|Array$|Record$|WeakMap|WeakSet)/,
      /^\{/,
      /^\[/,
      /^\d+$/,
    ];

    const filteredRelations = merged.relations.filter((rel) => {
      if (entityIds.has(rel.target)) return true;
      if (EXTERNAL_PATTERNS.some((p) => p.test(rel.target))) return false;
      return true;
    });

    return { ...merged, relations: filteredRelations };
  }

  /**
  private deduplicateRelations(relations: Relation[]): Relation[] {
    const seen = new Set<string>();
    const unique: Relation[] = [];

    for (const relation of relations) {
      const key = `${relation.type}:${relation.source}:${relation.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(relation);
      }
    }

    return unique;
  }

  /**
  toJSON(archJson: ArchJSON, pretty: boolean = false): string {
    return JSON.stringify(archJson, null, pretty ? 2 : undefined);
  }
}

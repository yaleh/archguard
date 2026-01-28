/**
 * Mermaid Validation Pipeline
 * Orchestrates all validation steps for Mermaid diagrams
 */

import type { ArchJSON } from '../types/index.js';
import type { ValidationPipelineResult } from './types.js';
import { MermaidParseValidator } from './validator-parse.js';
import { StructuralValidator } from './validator-structural.js';
import { RenderValidator } from './validator-render.js';
import { QualityValidator } from './validator-quality.js';

/**
 * Pipeline for comprehensive Mermaid diagram validation
 */
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
   * Run complete validation pipeline
   */
  async validate(mermaidCode: string, archJson: ArchJSON): Promise<ValidationPipelineResult> {
    // Step 1: Parse validation (syntax check)
    const parseResult = await this.parseValidator.validate(mermaidCode);

    // Step 2: Structural validation (integrity check)
    const structuralResult = this.structuralValidator.validate(mermaidCode, archJson);

    // Step 3: Render validation (can it be rendered?)
    const renderResult = this.renderValidator.validate(mermaidCode);

    // Step 4: Quality validation (how good is it?)
    const qualityResult = this.qualityValidator.validate(mermaidCode, archJson);

    // Calculate overall result
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
   * Calculate overall validation result
   */
  private calculateOverall(results: {
    parse: { valid: boolean };
    structural: { valid: boolean };
    render: { valid: boolean; canRender: boolean };
    quality: { valid: boolean };
  }): ValidationPipelineResult['overall'] {
    const blockingIssues: string[] = [];

    // Parse errors are always blocking
    if (!results.parse.valid) {
      blockingIssues.push('Syntax errors detected - diagram cannot be parsed');
    }

    // Structural issues are warnings, not blocking (external type references are OK)
    // They affect quality score but don't prevent rendering

    // Render blocking
    if (!results.render.canRender) {
      blockingIssues.push('Diagram cannot be rendered due to size or complexity');
    }

    // Quality is advisory, not blocking
    const canProceed = results.parse.valid && results.render.canRender;

    return {
      valid: canProceed && results.structural.valid && results.quality.valid,
      canProceed,
      blockingIssues,
    };
  }

  /**
   * Run complete validation pipeline with detailed stage information
   */
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
    // Step 1: Parse validation
    const parseResult = await this.parseValidator.validate(mermaidCode);

    // Step 2: Structural validation
    const structuralResult = this.structuralValidator.validate(mermaidCode, archJson);

    // Step 3: Render validation
    const renderResult = this.renderValidator.validate(mermaidCode);

    // Step 4: Quality validation
    const qualityResult = this.qualityValidator.validate(mermaidCode, archJson);

    // Calculate overall
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
   * Get the parse validator instance
   */
  getParseValidator(): MermaidParseValidator {
    return this.parseValidator;
  }

  /**
   * Generate a human-readable validation report
   */
  generateReport(result: {
    overallValid: boolean;
    stages: Array<{
      name: string;
      result: any;
    }>;
  }): string {
    const lines: string[] = [];

    // Overall status
    if (result.overallValid) {
      lines.push('✅ Validation Passed\n');
    } else {
      lines.push('❌ Validation Failed\n');
    }

    // Stage-by-stage report
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
   * Get summary of validation results
   */
  summarize(result: ValidationPipelineResult): string {
    const lines: string[] = [];

    // Overall status
    if (result.overall.valid) {
      lines.push('✅ Validation passed');
    } else {
      lines.push('❌ Validation failed');
    }

    // Parse status
    lines.push(`\nSyntax: ${result.parse.valid ? '✅ Valid' : '❌ Invalid'}`);
    if (result.parse.errors.length > 0) {
      lines.push(`  Errors: ${result.parse.errors.length}`);
    }

    // Structural status
    lines.push(`\nStructure: ${result.structural.valid ? '✅ Valid' : '❌ Invalid'}`);
    if (result.structural.issues.length > 0) {
      lines.push(`  Issues: ${result.structural.issues.length}`);
    }

    // Render status
    lines.push(`\nRender: ${result.render.canRender ? '✅ Ready' : '❌ Cannot render'}`);
    if (result.render.issues.length > 0) {
      lines.push(`  Issues: ${result.render.issues.length}`);
    }

    // Quality status
    lines.push(`\nQuality Score: ${result.quality.score}/100`);
    if (result.quality.suggestions.length > 0) {
      lines.push(`  Suggestions: ${result.quality.suggestions.length}`);
    }

    // Blocking issues
    if (result.overall.blockingIssues.length > 0) {
      lines.push('\n🚫 Blocking Issues:');
      result.overall.blockingIssues.forEach((issue) => {
        lines.push(`  - ${issue}`);
      });
    }

    return lines.join('\n');
  }
}

/**
 * Mermaid Comment Generator (v2.1.0)
 *
 * **CRITICAL**: This is a CODE COMPONENT, NOT an LLM Prompt!
 *
 * Layer 2 of Two-Layer Architecture:
 * - Layer 1: Configuration Generation Prompt (for Claude Code, Phase 0)
 * - Layer 2: CommentGenerator (this code, Phase 1)
 *
 * Purpose: Convert configuration metadata into Mermaid comment strings
 * Design: Pure code implementation using string concatenation
 *
 * @module mermaid/comment-generator
 * @version 2.1.0
 */

import type { DiagramConfig } from '../types/config.js';

/**
 * Mermaid comment generator for self-documenting architecture diagrams
 *
 * Generates formatted Mermaid comments from diagram metadata:
 * - Header comments (title, purpose, input/output)
 * - Design pattern comments
 * - Processing flow comments
 * - Usage scenario comments
 */
export class CommentGenerator {
  /**
   * Generate diagram header comments
   *
   * @param config - Diagram configuration with metadata
   * @returns Formatted header comment string
   */
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

    // Input/Output
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
   * Generate design pattern comments
   *
   * @param config - Diagram configuration with design info
   * @returns Formatted design pattern comment string
   */
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
   * Generate processing flow comments
   *
   * @param config - Diagram configuration with process info
   * @returns Formatted process flow comment string
   */
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
   * Generate usage scenario comments
   *
   * @param config - Diagram configuration
   * @returns Formatted usage scenario comment string
   */
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
   * Generate complete comment section
   *
   * Combines all comment types into a single formatted string.
   * Empty sections are automatically filtered out.
   *
   * @param config - Diagram configuration
   * @returns Complete formatted comment string
   */
  generateAll(config: DiagramConfig): string {
    const parts: string[] = [];

    // 1. Header
    parts.push(this.generateHeader(config));

    // 2. Process
    parts.push(this.generateProcessComments(config));

    // 3. Design Patterns
    parts.push(this.generatePatternComments(config));

    // 4. Usage Scenario
    parts.push(this.generateUsageComments(config));

    return parts.filter((p) => p.length > 0).join('\n');
  }

  /**
   * Generate visible title (v2.1.1)
   *
   * Creates a Mermaid note that will be visible in rendered PNG/SVG images.
   * This is different from comment blocks (%%) which are only visible in source.
   *
   * @param config - Diagram configuration
   * @returns Mermaid note syntax string
   */
  generateVisibleTitle(config: DiagramConfig): string {
    // Check if visible title is enabled
    if (!config.annotations?.enableVisibleTitle) {
      return '';
    }

    const meta = config.metadata;
    if (!meta) {
      return '';
    }

    // Get sections to include (default: all)
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

    // Build note content
    const lines: string[] = [];

    // Title
    if (sections.includes('title')) {
      if (meta.title) {
        lines.push(`**${meta.title}**`);
      } else {
        lines.push(`**${config.name}**`);
      }
    }

    // Subtitle
    if (sections.includes('subtitle') && meta.subtitle) {
      lines.push(meta.subtitle);
    }

    // Purpose
    if (sections.includes('purpose') && meta.purpose) {
      lines.push(`用途: ${meta.purpose}`);
    }

    // Input/Output
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

    // Design Patterns
    if (sections.includes('patterns')) {
      const design = config.design;
      if (design?.patterns && design.patterns.length > 0) {
        const patternNames = design.patterns.map((p) => p.name).join(', ');
        lines.push(`设计模式: ${patternNames}`);
      }
    }

    // Principles
    if (sections.includes('principles')) {
      const design = config.design;
      if (design?.principles && design.principles.length > 0) {
        lines.push(`原则: ${design.principles.join(', ')}`);
      }
    }

    // Process
    if (sections.includes('process')) {
      const process = config.process;
      if (process?.dataFlow) {
        lines.push(`流程: ${process.dataFlow}`);
      }
    }

    // Return empty if no content
    if (lines.length === 0) {
      return '';
    }

    // Format as Mermaid note
    // note for Diagram "content" is the syntax
    const content = lines.join('\n');
    return `\nnote for Diagram "${content}"\n`;
  }
}

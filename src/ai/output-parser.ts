/**
 * Output Parser
 *
 * This module provides utilities for parsing Claude Code CLI output
 * and extracting PlantUML diagrams from various formats.
 *
 * @module output-parser
 */

/**
 * Parser class for extracting PlantUML code from CLI output
 *
 * Handles multiple output formats:
 * - Raw PlantUML code
 * - Markdown code blocks (```plantuml)
 * - Mixed content with explanatory text
 */
export class OutputParser {
  /**
   * Extracts PlantUML code from CLI output
   *
   * Supports multiple formats:
   * 1. Markdown code blocks with ```plantuml (preferred)
   * 2. Markdown code blocks with ``` (fallback)
   * 3. Raw PlantUML code with @startuml/@enduml
   * 4. Any content containing @startuml
   *
   * @param output - Raw output from Claude Code CLI
   * @returns Extracted PlantUML code
   * @throws Error if no valid PlantUML code is found
   */
  extractPlantUML(output: string): string {
    // Strategy 1: Try to extract from markdown code blocks with language
    const markdownWithLanguage = this.extractFromMarkdownBlock(output);
    if (markdownWithLanguage) {
      return this.validateAndTrim(markdownWithLanguage);
    }

    // Strategy 2: Try to extract from any markdown code block
    const anyMarkdownBlock = this.extractFromAnyMarkdownBlock(output);
    if (anyMarkdownBlock) {
      return this.validateAndTrim(anyMarkdownBlock);
    }

    // Strategy 3: Try to extract raw PlantUML (between @startuml and @enduml)
    const rawPlantUML = this.extractRawPlantUML(output);
    if (rawPlantUML) {
      return this.validateAndTrim(rawPlantUML);
    }

    // Strategy 4: Check if entire output is PlantUML
    if (output.includes('@startuml') && output.includes('@enduml')) {
      return this.validateAndTrim(output);
    }

    // No PlantUML found
    throw new Error(
      'No PlantUML code found in Claude Code CLI output\n\n' +
        'Expected output format:\n' +
        '  - Markdown code block: ```plantuml\\n@startuml...@enduml\\n```\n' +
        '  - Raw PlantUML: @startuml...@enduml\n\n' +
        'Actual output received:\n' +
        this.truncateOutput(output, 500)
    );
  }

  /**
   * Extracts content from markdown code blocks with language specification
   *
   * @private
   * @param output - CLI output
   * @returns Extracted content or null
   */
  private extractFromMarkdownBlock(output: string): string | null {
    // Pattern: ```plantuml or ```puml
    const patterns = [/```plantuml\n([\s\S]*?)```/gi, /```puml\n([\s\S]*?)```/gi];

    for (const pattern of patterns) {
      const match = pattern.exec(output);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Extracts content from any markdown code block
   *
   * @private
   * @param output - CLI output
   * @returns Extracted content or null
   */
  private extractFromAnyMarkdownBlock(output: string): string | null {
    // Find all code blocks
    const pattern = /```\n([\s\S]*?)```/gi;
    const matches = Array.from(output.matchAll(pattern));

    // Prefer blocks containing PlantUML markers
    for (const match of matches) {
      if (match[1] && (match[1].includes('@startuml') || match[1].includes('@enduml'))) {
        return match[1].trim();
      }
    }

    // If no PlantUML block found, return the first code block (if any)
    if (matches.length > 0 && matches[0] && matches[0][1]) {
      const content = matches[0][1].trim();
      // Only return if it looks like PlantUML
      if (content.includes('@startuml')) {
        return content;
      }
    }

    return null;
  }

  /**
   * Extracts raw PlantUML code (between @startuml and @enduml)
   *
   * @private
   * @param output - CLI output
   * @returns Extracted content or null
   */
  private extractRawPlantUML(output: string): string | null {
    // Find @startuml and @enduml markers
    const startMatch = output.indexOf('@startuml');
    const endMatch = output.indexOf('@enduml');

    if (startMatch === -1 || endMatch === -1) {
      return null;
    }

    // Extract content between markers
    const content = output.substring(startMatch, endMatch + '@enduml'.length);
    return content.trim();
  }

  /**
   * Validates and trims PlantUML content
   *
   * @private
   * @param content - PlantUML content
   * @returns Validated and trimmed content
   * @throws Error if validation fails
   */
  private validateAndTrim(content: string): string {
    const trimmed = content.trim();

    // Basic validation: must have both markers
    if (!trimmed.includes('@startuml')) {
      throw new Error('Invalid PlantUML: Missing @startuml marker');
    }

    if (!trimmed.includes('@enduml')) {
      throw new Error('Invalid PlantUML: Missing @enduml marker');
    }

    return trimmed;
  }

  /**
   * Truncates output for error messages
   *
   * @private
   * @param output - Output to truncate
   * @param maxLength - Maximum length
   * @returns Truncated output
   */
  private truncateOutput(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output;
    }

    return output.substring(0, maxLength) + '\n... (truncated)';
  }
}

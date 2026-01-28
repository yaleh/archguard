/**
 * Response Parser for Mermaid LLM Integration
 *
 * This module provides utilities for parsing Claude Code CLI output
 * and extracting Mermaid diagrams from various formats.
 *
 * @module response-parser
 */

/**
 * Parser class for extracting Mermaid code from CLI output
 *
 * Handles multiple output formats:
 * - Raw Mermaid code
 * - Markdown code blocks (```mermaid)
 * - Mixed content with explanatory text
 */
export class ResponseParser {
  /**
   * Extracts Mermaid code from CLI output
   *
   * Supports multiple formats:
   * 1. Markdown code blocks with ```mermaid (preferred)
   * 2. Markdown code blocks with ``` (fallback)
   * 3. Raw Mermaid code (any content)
   *
   * @param output - Raw output from Claude Code CLI
   * @returns Extracted Mermaid code
   * @throws Error if no valid Mermaid code is found
   */
  extractMermaid(output: string): string {
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

    // Strategy 3: Assume entire output is Mermaid
    return this.validateAndTrim(output);
  }

  /**
   * Extracts content from markdown code blocks with language specification
   *
   * @private
   * @param output - CLI output
   * @returns Extracted content or null
   */
  private extractFromMarkdownBlock(output: string): string | null {
    // Pattern: ```mermaid
    const pattern = /```mermaid\n([\s\S]*?)```/gi;

    const match = pattern.exec(output);
    if (match && match[1]) {
      return match[1].trim();
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

    // If no code blocks found, return null
    if (matches.length === 0) {
      return null;
    }

    // Return the first code block
    if (matches[0] && matches[0][1]) {
      return matches[0][1].trim();
    }

    return null;
  }

  /**
   * Validates and trims Mermaid content
   *
   * @private
   * @param content - Mermaid content
   * @returns Validated and trimmed content
   * @throws Error if validation fails
   */
  private validateAndTrim(content: string): string {
    const trimmed = content.trim();

    // Basic validation: content should not be empty
    if (trimmed.length === 0) {
      throw new Error('Invalid Mermaid: Empty content');
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

  /**
   * Legacy method for backward compatibility
   * @deprecated Use extractMermaid instead
   */
  extractPlantUML(output: string): string {
    return this.extractMermaid(output);
  }
}

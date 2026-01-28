/**
 * Prompt Manager for Mermaid LLM Integration
 *
 * This module manages prompt templates for different diagram types
 * and provides rendering capabilities with variable substitution.
 *
 * @module prompt-manager
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * Template variables that can be substituted in prompts
 */
export interface TemplateVariables {
  /** Architecture JSON data as string */
  ARCH_JSON?: string;

  /** Previous PlantUML diagram (for incremental updates) */
  PREVIOUS_PUML?: string | null;

  /** Additional custom variables */
  [key: string]: string | null | undefined;
}

/**
 * Manager class for loading and rendering prompt templates
 */
export class PromptManager {
  private readonly templatesDir: string;
  private templateCache: Map<string, string>;

  /**
   * Creates a new PromptManager instance
   *
   * @param templatesDir - Directory containing template files (default: ./prompts)
   */
  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? path.join(process.cwd(), 'prompts');
    this.templateCache = new Map();
  }

  /**
   * Loads a template from the templates directory
   *
   * @param templateName - Name of the template (without .txt extension)
   * @returns Promise resolving to the template content
   * @throws Error if template file is not found
   */
  async loadTemplate(templateName: string): Promise<string> {
    // Check cache first
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName);
    }

    // Construct template file path
    const templatePath = path.join(this.templatesDir, `${templateName}.txt`);

    // Check if file exists
    const exists = await fs.pathExists(templatePath);
    if (!exists) {
      throw new Error(
        `Template '${templateName}' not found at ${templatePath}\n\n` +
          `Available templates are located in: ${this.templatesDir}`
      );
    }

    // Read template content
    const content = await fs.readFile(templatePath, 'utf-8');

    // Cache for future use
    this.templateCache.set(templateName, content);

    return content;
  }

  /**
   * Renders a template with provided variables
   *
   * Supports:
   * - Simple variable substitution: {{VARIABLE_NAME}}
   * - Conditional blocks: {{#if VARIABLE}}...{{else}}...{{/if}}
   *
   * @param templateName - Name of the template to render
   * @param variables - Variables to substitute in the template
   * @returns Promise resolving to the rendered template
   */
  async render(templateName: string, variables: TemplateVariables): Promise<string> {
    // Load template
    let content = await this.loadTemplate(templateName);

    // Handle conditionals first: {{#if VAR}}...{{else}}...{{/if}}
    content = this.processConditionals(content, variables);

    // Replace simple variables: {{VAR_NAME}}
    content = this.replaceVariables(content, variables);

    return content;
  }

  /**
   * Clears the template cache
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * Gets the templates directory path
   *
   * @returns The templates directory path
   */
  getTemplatesDir(): string {
    return this.templatesDir;
  }

  /**
   * Processes conditional blocks in template
   *
   * Supports:
   * - Simple conditionals: {{#if VAR}}...{{else}}...{{/if}}
   * - Comparison conditionals: {{#if VAR == "value"}}...{{/if}}
   * - Nested conditionals
   *
   * @private
   * @param content - Template content
   * @param variables - Template variables
   * @returns Processed content
   */
  private processConditionals(content: string, variables: TemplateVariables): string {
    let result = content;

    // Process comparison conditionals first: {{#if VAR == "value"}}...{{/if}}
    // Also handles {{#if VAR == "value"}}...{{else}}...{{/if}}
    const comparisonPattern =
      /\{\{#if\s+(\w+)\s*==\s*"([^"]+)"\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{\/if\}\}/gs;
    result = result.replace(
      comparisonPattern,
      (_match, varName, expectedValue, ifContent, elseContent = '') => {
        const actualValue = variables[varName];
        // Compare variable value with expected value
        return actualValue === expectedValue ? ifContent : elseContent;
      }
    );

    // Process simple conditionals: {{#if VAR}}...{{else}}...{{/if}}
    const simplePattern = /\{\{#if\s+(\w+)\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{\/if\}\}/gs;
    result = result.replace(simplePattern, (_match, varName, ifContent, elseContent = '') => {
      const value = variables[varName];
      // If variable is truthy, use ifContent, else use elseContent
      return value !== undefined && value !== null && value !== '' ? ifContent : elseContent;
    });

    return result;
  }

  /**
   * Replaces variable placeholders with actual values
   *
   * @private
   * @param content - Template content
   * @param variables - Template variables
   * @returns Content with replaced variables
   */
  private replaceVariables(content: string, variables: TemplateVariables): string {
    // Pattern: {{VAR_NAME}}
    const variablePattern = /\{\{(\w+)\}\}/g;

    return content.replace(variablePattern, (match, varName) => {
      const value = variables[varName];
      // If variable exists, use it; otherwise keep placeholder
      return value !== undefined && value !== null ? String(value) : match;
    });
  }
}

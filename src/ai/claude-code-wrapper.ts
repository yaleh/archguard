/**
 * Claude Code CLI Wrapper
 *
 * This module provides a wrapper around the Claude Code CLI for invoking
 * Claude AI through the official Claude Code interface instead of direct API calls.
 *
 * @module claude-code-wrapper
 */

import { execa } from 'execa';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { detectClaudeCodeCLI } from '../utils/cli-detector.js';
import type { ArchJSON } from '../types/index.js';

/**
 * Configuration options for ClaudeCodeWrapper
 */
export interface ClaudeCodeOptions {
  /** Timeout for CLI operations in milliseconds (default: 30000) */
  timeout?: number;

  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;

  /** Working directory for CLI operations */
  workingDir?: string;

  /** Claude model to use (default: claude-3-5-sonnet-20241022) */
  model?: string;
}

/**
 * Wrapper class for executing Claude Code CLI operations
 *
 * Provides methods to check CLI availability, manage temporary files,
 * and invoke Claude for PlantUML generation.
 */
export class ClaudeCodeWrapper {
  readonly options: Required<ClaudeCodeOptions>;

  /**
   * Creates a new ClaudeCodeWrapper instance
   *
   * @param options - Configuration options
   */
  constructor(options: ClaudeCodeOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      maxRetries: options.maxRetries ?? 2,
      workingDir: options.workingDir ?? process.cwd(),
      model: options.model ?? '',  // CLI command is used directly, not a model parameter
    };
  }

  /**
   * Checks if Claude Code CLI is available in the system
   *
   * @returns Promise resolving to true if CLI is available, false otherwise
   */
  async isClaudeCodeAvailable(): Promise<boolean> {
    const result = await detectClaudeCodeCLI();
    return result.available;
  }

  /**
   * Checks CLI availability and throws if not found
   *
   * @throws Error if Claude Code CLI is not found
   */
  async checkCLIAvailability(): Promise<void> {
    const result = await detectClaudeCodeCLI();

    if (!result.available) {
      throw new Error(
        `Claude Code CLI not found${result.error ? ': ' + result.error : ''}\n\n` +
          'Please install Claude Code from: https://docs.anthropic.com/claude-code\n\n' +
          'To verify installation: claude-code --version'
      );
    }
  }

  /**
   * Creates a temporary directory for CLI operations
   *
   * @returns Promise resolving to the temporary directory path
   */
  async createTempDir(): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-'));
    return tempDir;
  }

  /**
   * Cleans up temporary files and directories
   *
   * @param tempDir - Path to the temporary directory to clean up
   */
  async cleanup(tempDir: string): Promise<void> {
    try {
      await fs.remove(tempDir);
    } catch (error) {
      // Log but don't throw - cleanup failures are non-critical
      console.warn(`Warning: Failed to cleanup temp directory ${tempDir}:`, error);
    }
  }

  /**
   * Generates PlantUML diagram from ArchJSON using Claude Code CLI
   *
   * @param archJson - Architecture JSON data
   * @param previousPuml - Optional previous PlantUML for incremental updates
   * @returns Promise resolving to PlantUML code
   * @throws Error if generation fails after all retries
   */
  async generatePlantUML(archJson: ArchJSON, previousPuml?: string): Promise<string> {
    const { PromptTemplateManager } = await import('./prompt-template-manager.js');
    const { OutputParser } = await import('./output-parser.js');

    const templateManager = new PromptTemplateManager();
    const parser = new OutputParser();

    let lastError: Error | null = null;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt++) {
      try {
        // Step 1: Build prompt using template
        const prompt = await templateManager.render('class-diagram', {
          ARCH_JSON: JSON.stringify(archJson, null, 2),
          PREVIOUS_PUML: previousPuml || null,
        });

        // Step 2: Call Claude Code CLI directly with prompt
        const output = await this.callCLI(prompt);

        // Step 3: Extract PlantUML using parser
        const plantUML = parser.extractPlantUML(output);

        // Step 4: Validate PlantUML (basic checks)
        this.validatePlantUML(plantUML, archJson);

        // Success! Return the PlantUML
        return plantUML;

      } catch (error) {
        lastError = error as Error;

        // Classify error to determine if retryable
        const classification = this.classifyError(error as Error);

        // Don't retry if error is not retryable
        if (!classification.retryable) {
          throw this.enhanceError(error as Error, classification);
        }

        // If this was the last attempt, throw
        if (attempt >= this.options.maxRetries + 1) {
          throw new Error(
            `Failed after ${this.options.maxRetries + 1} attempts. Last error: ${lastError.message}`
          );
        }

        // Log retry attempt
        const delay = this.getBackoffDelay(attempt);
        console.warn(
          `Attempt ${attempt}/${this.options.maxRetries + 1} failed (${classification.type}). ` +
          `Retrying in ${delay}ms...`
        );

        // Wait before retry (exponential backoff)
        await this.sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError || new Error('Unknown error in generatePlantUML');
  }

  /**
   * Validates PlantUML output
   *
   * @private
   * @param plantUML - PlantUML code to validate
   * @param archJson - Original ArchJSON for completeness check
   * @throws Error if validation fails
   */
  private validatePlantUML(plantUML: string, archJson: ArchJSON): void {
    // Basic syntax checks
    if (!plantUML.includes('@startuml')) {
      throw new Error('Validation failed: Missing @startuml marker');
    }

    if (!plantUML.includes('@enduml')) {
      throw new Error('Validation failed: Missing @enduml marker');
    }

    // Completeness check: verify all entities are present
    for (const entity of archJson.entities) {
      if (!plantUML.includes(entity.name)) {
        throw new Error(
          `Validation failed: Entity "${entity.name}" not found in generated PlantUML`
        );
      }
    }
  }

  /**
   * Classifies an error to determine retry strategy
   *
   * @private
   * @param error - Error to classify
   * @returns Error classification
   */
  private classifyError(error: Error): { type: string; retryable: boolean } {
    const message = error.message;

    // File not found errors (not retryable)
    if (message.includes('ENOENT')) {
      if (message.includes('claude-code')) {
        return { type: 'CLI_NOT_FOUND', retryable: false };
      }
      return { type: 'FILE_NOT_FOUND', retryable: false };
    }

    // Timeout errors (retryable)
    if (message.includes('timeout') || message.includes('TIMEDOUT')) {
      return { type: 'TIMEOUT', retryable: true };
    }

    // CLI execution errors (check if retryable)
    if (message.includes('spawn') || message.includes('execa')) {
      return { type: 'CLI_EXECUTION_ERROR', retryable: false };
    }

    // Validation errors (not retryable - won't improve with retry)
    if (message.includes('Validation failed')) {
      return { type: 'VALIDATION_ERROR', retryable: false };
    }

    // Default: treat as retryable (e.g., transient network issues)
    return { type: 'UNKNOWN_ERROR', retryable: true };
  }

  /**
   * Enhances error message with helpful context
   *
   * @private
   * @param error - Original error
   * @param classification - Error classification
   * @returns Enhanced error
   */
  private enhanceError(error: Error, classification: { type: string; retryable: boolean }): Error {
    let message = error.message;

    // Add helpful suggestions based on error type
    switch (classification.type) {
      case 'CLI_NOT_FOUND':
        message = `${message}\n\n` +
          'Please ensure Claude Code CLI is installed:\n' +
          '  https://docs.anthropic.com/claude-code\n\n' +
          'Verify installation: claude-code --version';
        break;

      case 'FILE_NOT_FOUND':
        message = `${message}\n\n` +
          'Check file paths and permissions';
        break;

      case 'TIMEOUT':
        message = `${message}\n\n` +
          `Consider increasing timeout (current: ${this.options.timeout}ms)`;
        break;

      case 'VALIDATION_ERROR':
        message = `${message}\n\n` +
          'The generated PlantUML does not meet requirements. ' +
          'This may indicate an issue with the prompt or model response.';
        break;
    }

    const enhancedError = new Error(message);
    enhancedError.stack = error.stack;
    return enhancedError;
  }

  /**
   * Calculates exponential backoff delay
   *
   * @private
   * @param attempt - Current attempt number (1-indexed)
   * @returns Delay in milliseconds
   */
  private getBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, etc.
    return Math.min(1000 * Math.pow(2, attempt - 1), 10000);
  }

  /**
   * Sleeps for specified milliseconds
   *
   * @private
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Invokes Claude Code CLI with given prompt
   *
   * @internal
   * @param prompt - Prompt content to send to Claude
   * @returns Promise resolving to CLI execution result
   */
  async callCLI(prompt: string): Promise<string> {
    try {
      // Execute claude-glm with prompt via stdin to avoid argument size limits
      const result = await execa('claude-glm', [], {
        timeout: this.options.timeout,
        cwd: this.options.workingDir,
        // Pass prompt via stdin to avoid E2BIG (argument list too long) error
        input: prompt,
      });

      // Return the raw output (claude-glm returns PlantUML directly)
      return result.stdout;
    } catch (error) {
      // Rethrow to be handled by retry logic
      throw error;
    }
  }
}

/**
 * Claude Client for Mermaid LLM Integration
 *
 * This module provides a wrapper around the Claude Code CLI for invoking
 * Claude AI through the official Claude Code interface instead of direct API calls.
 *
 * @module claude-client
 */

import { execa } from 'execa';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { detectClaudeCodeCLI } from '../../utils/cli-detector.js';
import type { ArchJSON } from '../../types/index.js';
import type { Config } from '../../cli/config-loader.js';
import type { DetailLevel } from '../../types/config.js';

/**
 * Configuration options for ClaudeClient
 * @deprecated Use Config object instead. Maintained for backward compatibility.
 */
export interface ClaudeClientOptions {
  /** Timeout for CLI operations in milliseconds (default: 30000) */
  timeout?: number;

  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;

  /** Working directory for CLI operations */
  workingDir?: string;

  /** Claude model to use (deprecated, use cli.args in Config) */
  model?: string;
}

/**
 * Internal configuration type that combines both Config and ClaudeClientOptions
 */
interface InternalConfig {
  timeout: number;
  maxRetries: number;
  workingDir: string;
  cliCommand: string;
  cliArgs: string[];
}

/**
 * Client class for executing Claude Code CLI operations
 *
 * Provides methods to check CLI availability, manage temporary files,
 * and invoke Claude for AI-powered operations.
 *
 * Supports both Config objects (preferred) and ClaudeClientOptions (deprecated, for backward compatibility).
 */
export class ClaudeClient {
  readonly options: Required<ClaudeClientOptions>;
  readonly internalConfig: InternalConfig;

  /**
   * Creates a new ClaudeClient instance
   *
   * @param configOrOptions - Full Config object (preferred) or ClaudeClientOptions (deprecated)
   */
  constructor(configOrOptions?: Config | ClaudeClientOptions) {
    // Detect if we received a Config object (has 'cli' property) or ClaudeClientOptions
    const isConfig = configOrOptions && 'cli' in configOrOptions;

    if (isConfig) {
      // Full Config object (preferred path)
      const config = configOrOptions;

      // Initialize with deprecated options structure for backward compatibility
      this.options = {
        timeout: config.cli.timeout,
        maxRetries: 2, // Default value
        workingDir: process.cwd(),
        model: '', // Deprecated
      };

      // Store internal config with CLI settings
      this.internalConfig = {
        timeout: config.cli.timeout,
        maxRetries: 2, // Default value
        workingDir: process.cwd(),
        cliCommand: config.cli.command,
        cliArgs: config.cli.args,
      };
    } else {
      // ClaudeClientOptions (deprecated, backward compatibility)
      const options = (configOrOptions as ClaudeClientOptions) || {};

      this.options = {
        timeout: options.timeout ?? 30000,
        maxRetries: options.maxRetries ?? 2,
        workingDir: options.workingDir ?? process.cwd(),
        model: options.model ?? '',
      };

      // Store internal config with default CLI settings
      this.internalConfig = {
        timeout: options.timeout ?? 30000,
        maxRetries: options.maxRetries ?? 2,
        workingDir: options.workingDir ?? process.cwd(),
        cliCommand: 'claude-glm', // Hardcoded default for backward compatibility
        cliArgs: [],
      };
    }
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
        message =
          `${message}\n\n` +
          'Please ensure Claude Code CLI is installed:\n' +
          '  https://docs.anthropic.com/claude-code\n\n' +
          'Verify installation: claude-code --version';
        break;

      case 'FILE_NOT_FOUND':
        message = `${message}\n\n` + 'Check file paths and permissions';
        break;

      case 'TIMEOUT':
        message =
          `${message}\n\n` + `Consider increasing timeout (current: ${this.options.timeout}ms)`;
        break;

      case 'VALIDATION_ERROR':
        message =
          `${message}\n\n` +
          'The generated output does not meet requirements. ' +
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Invokes Claude Code CLI with given prompt
   *
   * @internal
   * @param prompt - Prompt content to send to Claude
   * @returns Promise resolving to CLI execution result
   */
  async callCLI(prompt: string): Promise<string> {
    // Execute CLI with configured command and args
    const result = await execa(this.internalConfig.cliCommand, this.internalConfig.cliArgs, {
      timeout: this.internalConfig.timeout,
      cwd: this.internalConfig.workingDir,
      // Pass prompt via stdin to avoid E2BIG (argument list too long) error
      input: prompt,
    });

    // Return the raw output
    return result.stdout;
  }
}

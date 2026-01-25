/**
 * Claude Code CLI Detector
 *
 * This module provides utilities to detect the availability and version
 * of the Claude Code CLI in the system.
 *
 * @module cli-detector
 */

import { execa } from 'execa';

/**
 * Result of CLI detection operation
 */
export interface CLIDetectionResult {
  /** Whether Claude Code CLI is available */
  available: boolean;

  /** Version string if available */
  version?: string;

  /** Error message if detection failed */
  error?: string;
}

/**
 * Detects if Claude Code CLI is available in the system
 *
 * Attempts to execute `claude --version` to verify CLI availability
 * and extract version information.
 *
 * @returns Promise resolving to detection result
 *
 * @example
 * ```typescript
 * const result = await detectClaudeCodeCLI();
 * if (result.available) {
 *   console.log(`Claude Code CLI ${result.version} is available`);
 * } else {
 *   console.error(`CLI not found: ${result.error}`);
 * }
 * ```
 */
export async function detectClaudeCodeCLI(): Promise<CLIDetectionResult> {
  try {
    // Try to execute claude --version
    const { stdout } = await execa('claude', ['--version'], {
      timeout: 5000,
      reject: true,
    });

    // Extract version from output
    const version = stdout.trim();

    return {
      available: true,
      version,
    };
  } catch (error) {
    // Classify the error
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a "command not found" error
    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      return {
        available: false,
        error: 'Claude Code CLI not found in system PATH',
      };
    }

    // Check if it's a timeout error
    if (errorMessage.includes('timed out') || errorMessage.includes('ETIMEDOUT')) {
      return {
        available: false,
        error: 'Claude Code CLI detection timed out',
      };
    }

    // Other errors
    return {
      available: false,
      error: `Failed to detect CLI: ${errorMessage}`,
    };
  }
}

/**
 * Checks if Claude Code CLI is available (simple boolean check)
 *
 * @returns Promise resolving to true if CLI is available, false otherwise
 *
 * @example
 * ```typescript
 * if (await isClaudeCodeAvailable()) {
 *   // Proceed with CLI operations
 * } else {
 *   throw new Error('Please install Claude Code CLI');
 * }
 * ```
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  const result = await detectClaudeCodeCLI();
  return result.available;
}

/**
 * Error Handler - User-friendly error message formatting
 */

import chalk from 'chalk';
import { ParseError, APIError, ValidationError, FileError } from './errors.js';

export interface ErrorFormatOptions {
  color?: boolean;
  verbose?: boolean;
}

/**
 * ErrorHandler formats error messages for CLI display
 * Features:
 * - Custom error type formatting
 * - Colored output with chalk
 * - Helpful suggestions for common errors
 * - Verbose mode with stack traces
 * - Error location display (file:line:column)
 * - API error code interpretation
 */
export class ErrorHandler {
  /**
   * Format any error for display
   */
  format(error: unknown, options: ErrorFormatOptions = {}): string {
    const { color = true, verbose = false } = options;

    // Handle null/undefined
    if (error === null || error === undefined) {
      return this.formatUnknownError(color);
    }

    // Handle string errors
    if (typeof error === 'string') {
      return this.formatStringError(error, color);
    }

    // Handle custom error types
    if (error instanceof ParseError) {
      return this.formatParseError(error, color);
    }

    if (error instanceof APIError) {
      return this.formatAPIError(error, color);
    }

    if (error instanceof ValidationError) {
      return this.formatValidationError(error, color);
    }

    if (error instanceof FileError) {
      return this.formatFileError(error, color);
    }

    // Handle standard Error objects
    if (error instanceof Error) {
      return this.formatGenericError(error, color, verbose);
    }

    // Handle unknown error types
    return this.formatUnknownError(color);
  }

  /**
   * Format ParseError
   */
  private formatParseError(error: ParseError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Parse Error') : 'Parse Error';

    let location = error.filePath;
    if (error.line !== undefined) {
      location += `:${error.line}`;
    }
    if (error.column !== undefined) {
      location += `:${error.column}`;
    }

    const locationStr = useColor ? chalk.cyan(location) : location;
    const tipLabel = useColor ? chalk.yellow('Tip:') : 'Tip:';

    return `
${title}
  ${locationStr}
  ${error.message}

${tipLabel} Check the syntax at the specified line.
`;
  }

  /**
   * Format APIError
   */
  private formatAPIError(error: APIError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('API Error') : 'API Error';
    const statusCode = useColor
      ? chalk.yellow(`[${error.statusCode}]`)
      : `[${error.statusCode}]`;

    let suggestion = '';
    if (error.statusCode === 429) {
      suggestion = 'Please try again later or check your rate limits.';
    } else if (error.statusCode === 401 || error.statusCode === 403) {
      suggestion = 'Check your ANTHROPIC_API_KEY environment variable.';
    } else if (error.statusCode >= 500) {
      suggestion = 'Claude API service may be temporarily unavailable. Please retry.';
    }

    const suggestionLabel = useColor ? chalk.yellow('Suggestion:') : 'Suggestion:';

    return `
${title} ${statusCode}
  ${error.message}

${suggestion ? `${suggestionLabel} ${suggestion}\n` : ''}`;
  }

  /**
   * Format ValidationError
   */
  private formatValidationError(error: ValidationError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Validation Error') : 'Validation Error';

    let message = `
${title}
  ${error.message}
`;

    if (error.suggestions.length > 0) {
      const optionsLabel = useColor ? chalk.yellow('Available options:') : 'Available options:';
      const options = error.suggestions.join(', ');
      message += `\n${optionsLabel} ${options}\n`;
    }

    return message;
  }

  /**
   * Format FileError
   */
  private formatFileError(error: FileError, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('File Error') : 'File Error';
    const operation = error.operation.charAt(0).toUpperCase() + error.operation.slice(1);
    const filePath = useColor ? chalk.cyan(error.filePath) : error.filePath;

    return `
${title}
  Operation: ${operation}
  File: ${filePath}
  ${error.message}
`;
  }

  /**
   * Format generic Error
   */
  private formatGenericError(error: Error, useColor: boolean, verbose: boolean): string {
    const title = useColor ? chalk.red.bold('Error') : 'Error';

    // Provide helpful suggestions for common errors
    let suggestion = '';
    if (error.message.includes('ENOENT')) {
      suggestion = 'File not found. Check if the path is correct.';
    } else if (error.message.includes('EACCES')) {
      suggestion = 'Permission denied. Check file permissions.';
    } else if (error.message.includes('EADDRINUSE')) {
      suggestion = 'Port already in use.';
    }

    const tipLabel = useColor ? chalk.yellow('Tip:') : 'Tip:';
    const stack = verbose && error.stack ? `\n${error.stack}` : '';

    return `
${title}
  ${error.message}

${suggestion ? `${tipLabel} ${suggestion}\n` : ''}${stack}`;
  }

  /**
   * Format string error
   */
  private formatStringError(error: string, useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Error') : 'Error';

    return `
${title}
  ${error}
`;
  }

  /**
   * Format unknown error
   */
  private formatUnknownError(useColor: boolean): string {
    const title = useColor ? chalk.red.bold('Error') : 'Error';

    return `
${title}
  Unknown error occurred
`;
  }
}

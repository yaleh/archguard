/**
 * Mermaid Parse Validator
 * Validates Mermaid syntax using isomorphic-mermaid
 */

import mermaid from 'isomorphic-mermaid';
import type {
  ParseValidationResult,
  ValidationError,
  ValidationWarning,
} from './types.js';

/**
 * Validator for Mermaid diagram syntax
 */
export class MermaidParseValidator {
  private initialized = false;

  constructor() {
    // Constructor is intentionally empty
    // Initialization happens lazily on first validation
  }

  /**
   * Validate Mermaid code syntax
   */
  async validate(mermaidCode: string): Promise<ParseValidationResult> {
    // Ensure mermaid is initialized
    this.ensureInitialized();

    // Handle empty input
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
      // Attempt to parse the Mermaid code
      await mermaid.parse(mermaidCode, {
        suppressErrors: false, // We want to catch errors
      });

      // If we get here, parsing succeeded
      return {
        valid: true,
        errors: [],
        warnings: this.collectWarnings(mermaidCode),
      };
    } catch (error) {
      // Parsing failed
      return {
        valid: false,
        errors: this.parseError(error),
        warnings: [],
      };
    }
  }

  /**
   * Ensure mermaid is initialized
   */
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
   * Parse error from mermaid
   */
  private parseError(error: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (error instanceof Error) {
      // Parse error message
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

      // Try to extract error code
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
   * Sanitize error message
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove common mermaid error prefixes
    return (
      message
        .replace(/^Parse error: /i, '')
        .replace(/^Syntax error: /i, '')
        .replace(/^Error: /i, '')
        .trim() || 'Unknown error'
    );
  }

  /**
   * Collect non-critical warnings from the code
   */
  private collectWarnings(mermaidCode: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Check for self-references (potential design issues)
    const selfRefMatches = mermaidCode.matchAll(/(\w+)\s+-->\s+\1/g);
    for (const match of selfRefMatches) {
      if (match[1]) {
        warnings.push({
          message: `Self-reference detected: ${match[1]}`,
          suggestion: 'Consider whether this self-reference is intentional',
        });
      }
    }

    // Check for very long class names (potential readability issues)
    const longNameMatches = mermaidCode.matchAll(/class\s+"([^"]{30,})"/g);
    for (const match of longNameMatches) {
      if (match[1]) {
        warnings.push({
          message: `Very long class name: ${match[1].substring(0, 20)}...`,
          suggestion: 'Consider using shorter class names for better readability',
        });
      }
    }

    // Check for missing visibility modifiers
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

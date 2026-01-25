/**
 * Custom Error Types for CLI
 */

/**
 * Parse Error - when TypeScript file parsing fails
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly line?: number,
    public readonly column?: number
  ) {
    super(message);
    this.name = 'ParseError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * API Error - when Claude API calls fail
 */
export class APIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'APIError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation Error - when configuration or options are invalid
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[] = []
  ) {
    super(message);
    this.name = 'ValidationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * File Error - when file operations fail
 */
export class FileError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly operation: 'read' | 'write' | 'delete' | 'create'
  ) {
    super(message);
    this.name = 'FileError';
    Error.captureStackTrace(this, this.constructor);
  }
}

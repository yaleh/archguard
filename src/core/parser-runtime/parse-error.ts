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

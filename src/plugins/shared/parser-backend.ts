import type { ParserSession } from './syntax-tree.js';

export type ParserLanguage = 'go' | 'java' | 'python' | 'cpp' | 'kotlin';

export interface ParserBackend {
  readonly runtime: 'native';
  createSession(language: ParserLanguage): Promise<ParserSession>;
}

export class ParserInitializationError extends Error {
  constructor(
    readonly language: ParserLanguage,
    readonly backend: string,
    cause: unknown
  ) {
    super(
      `Failed to initialize ${language} parser with ${backend} backend: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause }
    );
    this.name = 'ParserInitializationError';
  }
}

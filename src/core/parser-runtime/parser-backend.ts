import type { ParserRuntimeKind, ParserSession } from './syntax-tree.js';
import { errorMessage } from '@/utils/error-message.js';

/**
 * Backend-agnostic parser contract. Core and the parser layer depend on this
 * shape; the concrete backends (native and portable WASM) live in the
 * plugin runtime layer and are reached through the injected
 * ParserBackendResolver port, never by importing them directly.
 */

export type ParserLanguage = 'go' | 'java' | 'python' | 'cpp' | 'kotlin';

export interface ParserBackend {
  readonly runtime: ParserRuntimeKind;
  createSession(language: ParserLanguage): Promise<ParserSession>;
}

export class ParserInitializationError extends Error {
  constructor(
    readonly language: ParserLanguage,
    readonly backend: string,
    cause: unknown
  ) {
    super(
      `Failed to initialize ${language} parser with ${backend} backend: ${errorMessage(cause)}`,
      { cause }
    );
    this.name = 'ParserInitializationError';
  }
}

import type { ParserRuntimeKind, ParserSession } from './syntax-tree.js';

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
      `Failed to initialize ${language} parser with ${backend} backend: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause }
    );
    this.name = 'ParserInitializationError';
  }
}

/**
 * Select a parser backend by runtime kind.
 *
 * Automatic selection is intentionally not implemented yet: the default is the
 * native backend, and the WASM backend must be requested explicitly (or via
 * the ARCHGUARD_PARSER_BACKEND=wasm environment override, e.g. for forced-WASM
 * test runs).
 */
export async function resolveParserBackend(kind?: ParserRuntimeKind): Promise<ParserBackend> {
  const selected = kind ?? readBackendEnvOverride() ?? 'native';
  if (selected === 'wasm') {
    const { wasmParserBackend } = await import('./wasm-parser-backend.js');
    return wasmParserBackend;
  }
  const { nativeParserBackend } = await import('./native-parser-backend.js');
  return nativeParserBackend;
}

function readBackendEnvOverride(): ParserRuntimeKind | undefined {
  const raw = process.env.ARCHGUARD_PARSER_BACKEND;
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'native' || raw === 'wasm') return raw;
  throw new Error(`Invalid ARCHGUARD_PARSER_BACKEND value "${raw}" (expected "native" or "wasm")`);
}

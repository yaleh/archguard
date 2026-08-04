import type { ParserRuntimeKind, ParserSession } from './syntax-tree.js';
import { errorMessage } from '@/utils/error-message.js';

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

/**
 * Select a parser backend by runtime kind.
 *
 * This is the global, language-agnostic escape hatch retained from TASK-38
 * (forced-WASM test runs). New code should prefer the per-language resolver
 * `selectParserBackendFor()` in parser-runtime.ts, which implements the
 * auto|native|wasm policy with per-language health probing.
 *
 * Environment reconciliation (one canonical mechanism + legacy alias):
 * - ARCHGUARD_PARSER_RUNTIME=wasm|native forces the corresponding backend;
 *   `auto` is not meaningful for this language-agnostic API and is ignored
 *   (per-language auto selection lives in parser-runtime.ts).
 * - ARCHGUARD_PARSER_BACKEND=wasm|native (deprecated TASK-38 alias) applies
 *   only when ARCHGUARD_PARSER_RUNTIME is unset.
 * - Default: native.
 */
export async function resolveParserBackend(kind?: ParserRuntimeKind): Promise<ParserBackend> {
  const selected = kind ?? readRuntimeEnvOverride() ?? readBackendEnvOverride() ?? 'native';
  if (selected === 'wasm') {
    const { wasmParserBackend } = await import('./wasm-parser-backend.js');
    return wasmParserBackend;
  }
  const { nativeParserBackend } = await import('./native-parser-backend.js');
  return nativeParserBackend;
}

function readRuntimeEnvOverride(): ParserRuntimeKind | undefined {
  const raw = process.env.ARCHGUARD_PARSER_RUNTIME;
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'native' || raw === 'wasm') return raw;
  if (raw === 'auto') return undefined; // per-language auto lives in parser-runtime.ts
  throw new Error(
    `Invalid ARCHGUARD_PARSER_RUNTIME value "${raw}" (expected "auto", "native", or "wasm")`
  );
}

function readBackendEnvOverride(): ParserRuntimeKind | undefined {
  const raw = process.env.ARCHGUARD_PARSER_BACKEND;
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'native' || raw === 'wasm') return raw;
  throw new Error(`Invalid ARCHGUARD_PARSER_BACKEND value "${raw}" (expected "native" or "wasm")`);
}

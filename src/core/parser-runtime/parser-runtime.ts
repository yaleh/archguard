/**
 * Language-agnostic parser runtime policy and diagnostics.
 *
 * This module owns the *what was chosen and why* surface — the effective
 * runtime policy, where the choice came from, the diagnostics log, and the
 * selection record shape. The concrete selection machinery (native health
 * probing, per-language caching, backend construction) lives in the plugin
 * runtime layer and depends on this module, not the other way around.
 */
import { isParserRuntimePolicy, type ParserRuntimePolicy } from '@/types/parser-runtime.js';
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import type { ParserRuntimeKind } from './syntax-tree.js';

/** Read the canonical runtime policy from the environment. */
export function readParserRuntimePolicy(env: NodeJS.ProcessEnv = process.env): ParserRuntimePolicy {
  const runtime = env.ARCHGUARD_PARSER_RUNTIME;
  if (runtime !== undefined && runtime !== '') {
    if (isParserRuntimePolicy(runtime)) return runtime;
    throw new Error(
      `Invalid ARCHGUARD_PARSER_RUNTIME value "${runtime}" (expected "auto", "native", or "wasm")`
    );
  }
  // Deprecated TASK-38 alias, kept for backward compatibility; superseded by
  // ARCHGUARD_PARSER_RUNTIME when both are set.
  const backend = env.ARCHGUARD_PARSER_BACKEND;
  if (backend !== undefined && backend !== '') {
    emitDeprecatedAliasWarning();
    if (backend === 'native' || backend === 'wasm') return backend;
    throw new Error(
      `Invalid ARCHGUARD_PARSER_BACKEND value "${backend}" (expected "native" or "wasm")`
    );
  }
  return 'auto';
}

/** True when an environment override (canonical or legacy alias) is set. */
export function hasParserRuntimeEnvOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ARCHGUARD_PARSER_RUNTIME || env.ARCHGUARD_PARSER_BACKEND);
}

/** Where the effective policy came from (TASK-43 effective-runtime visibility). */
export type ParserRuntimeChoiceSource = 'default' | 'env' | 'config' | 'explicit';

export interface ParserBackendSelection {
  readonly language: ParserLanguage;
  readonly policy: ParserRuntimePolicy;
  /** How the effective policy was chosen: default auto, env var, config file, or explicit caller override. */
  readonly source: ParserRuntimeChoiceSource;
  readonly runtime: ParserRuntimeKind;
  readonly backend: ParserBackend;
  /** Why native was rejected in `auto` mode; undefined when native was selected or policy is wasm/native. */
  readonly fallbackReason?: string;
  /** Preformatted diagnostics line: choice plus fallback reason. */
  readonly diagnostic: string;
}

let deprecatedAliasWarningEmitted = false;

/** Loud, exactly-once-per-process stderr warning for the deprecated alias (TASK-43). */
function emitDeprecatedAliasWarning(): void {
  if (deprecatedAliasWarningEmitted) return;
  deprecatedAliasWarningEmitted = true;
  console.error(
    '[parser-runtime] WARNING: ARCHGUARD_PARSER_BACKEND is deprecated and will be removed in a ' +
      'future release; use the canonical ARCHGUARD_PARSER_RUNTIME (auto|native|wasm) instead.'
  );
}

const diagnosticsLog: string[] = [];

/** Selection diagnostics recorded so far (choice plus fallback reason), in order. */
export function getParserRuntimeDiagnostics(): readonly string[] {
  return diagnosticsLog;
}

/** Append a selection diagnostic line to the process-scoped log. */
export function recordParserRuntimeDiagnostic(line: string): void {
  diagnosticsLog.push(line);
}

/**
 * Whether a runtime diagnostic line should be surfaced to the user (TASK-43):
 * always in verbose mode, and always on a fallback event (even non-verbose),
 * so "did my fallback work?" never requires guesswork.
 */
export function runtimeDiagnosticVisible(
  verbose: boolean,
  selection: { fallbackReason?: string }
): boolean {
  return verbose || selection.fallbackReason !== undefined;
}

/** Test hook: clear the diagnostics log and the deprecated-alias warning latch. */
export function resetParserRuntimeDiagnostics(): void {
  diagnosticsLog.length = 0;
  deprecatedAliasWarningEmitted = false;
}

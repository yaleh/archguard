/**
 * Per-language native-first Tree-sitter runtime selection (TASK-39).
 *
 * For each Tree-sitter backed language the resolver independently picks the
 * fastest usable parser backend:
 *
 * - `auto` (default): probe the `(tree-sitter runtime, grammar)` tuple by
 *   loading both, binding the grammar, parsing a minimal fixture, and
 *   validating the root node. Native is used only when the probe passes;
 *   otherwise the portable WASM backend is selected and the fallback reason
 *   is recorded in diagnostics.
 * - `native`: require native; a failed probe raises an actionable
 *   ParserInitializationError and never silently substitutes WASM.
 * - `wasm`: never import native modules; use the bundled web-tree-sitter
 *   backend deterministically.
 *
 * Selections are cached per language for the process lifetime; a backend is
 * never switched after selection, so parser/extractor bugs surface instead of
 * being hidden by mid-run fallback.
 *
 * Module resolution policy: native modules resolve from ArchGuard's own
 * package scope (createRequire relative to native-parser-backend.ts) — never
 * from the analyzed project's node_modules and never from global npm
 * locations. An external module root is honored only when explicitly
 * configured via the `nativeModuleRoot` option or
 * ARCHGUARD_NATIVE_MODULE_ROOT, and the selected native backend parses
 * through the same loaders the probe used.
 */
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import { ParserInitializationError } from './parser-backend.js';
import {
  NativeParserBackend,
  defaultNativeLoaders,
  nativeGrammarModule,
  nativeParserBackend,
  readNativeModuleRootEnv,
  type NativeModuleLoaders,
  type NativeParserLike,
} from './native-parser-backend.js';
import type { ParserRuntimeKind } from './syntax-tree.js';
import { isParserRuntimePolicy, type ParserRuntimePolicy } from '@/types/parser-runtime.js';

export {
  defaultNativeLoaders,
  readNativeModuleRootEnv,
  type NativeModuleLoaders,
} from './native-parser-backend.js';

/** Minimal per-language fixtures used by the native health probe. */
const PROBE_FIXTURES: Record<ParserLanguage, { code: string; rootType: string }> = {
  go: { code: 'package main\n', rootType: 'source_file' },
  java: { code: 'class A {}\n', rootType: 'program' },
  python: { code: 'x = 1\n', rootType: 'module' },
  cpp: { code: 'int main() { return 0; }\n', rootType: 'translation_unit' },
  kotlin: { code: 'fun main() {}\n', rootType: 'source_file' },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Probe the native `(runtime, grammar)` tuple for a language: load both
 * modules, bind the grammar, parse a minimal fixture, and validate the root
 * node type. Throws an Error with an actionable, step-specific message on
 * any failure (missing module, broken binding, ABI mismatch, grammar
 * mismatch).
 */
export function probeNativeBinding(
  language: ParserLanguage,
  loaders: NativeModuleLoaders = defaultNativeLoaders(readNativeModuleRootEnv())
): void {
  let Runtime: ReturnType<NativeModuleLoaders['loadRuntime']>;
  try {
    Runtime = loaders.loadRuntime();
  } catch (error) {
    throw new Error(
      `cannot load native tree-sitter runtime ("tree-sitter"): ${errorMessage(error)}`
    );
  }

  let grammar: unknown;
  try {
    grammar = loaders.loadGrammar(language);
  } catch (error) {
    throw new Error(
      `cannot load native ${language} grammar ("${nativeGrammarModule(language)}"): ${errorMessage(error)}`
    );
  }

  const fixture = PROBE_FIXTURES[language];
  let parser: NativeParserLike | undefined;
  try {
    parser = new Runtime();
    parser.setLanguage(grammar);
  } catch (error) {
    parser?.delete?.();
    throw new Error(
      `cannot bind native ${language} grammar to the tree-sitter runtime (ABI incompatibility?): ${errorMessage(error)}`
    );
  }

  try {
    const tree = parser.parse(fixture.code);
    const rootType = tree?.rootNode?.type;
    if (rootType !== fixture.rootType) {
      throw new Error(
        `probe parsed unexpected root node ${JSON.stringify(rootType)} ` +
          `(expected "${fixture.rootType}") — grammar/runtime mismatch`
      );
    }
  } catch (error) {
    throw new Error(`native ${language} parse health check failed: ${errorMessage(error)}`);
  } finally {
    parser.delete?.();
  }
}

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

export interface SelectParserBackendOptions {
  /** Explicit policy override; defaults to env (ARCHGUARD_PARSER_RUNTIME, legacy ARCHGUARD_PARSER_BACKEND) then 'auto'. */
  policy?: ParserRuntimePolicy;
  /** Annotates where an explicit `policy` came from: 'config' (config file) or 'explicit' (caller default). */
  policySource?: 'config' | 'explicit';
  /** Fault-injection point for tests; bypasses the per-language selection cache. */
  nativeLoaders?: NativeModuleLoaders;
  /** Explicitly trusted external module root for native packages. */
  nativeModuleRoot?: string;
  /** Sink for the selection diagnostic line (e.g. verbose reporter). Never written to stdout by default. */
  onDiagnostic?: (line: string, selection: ParserBackendSelection) => void;
}

const selectionCache = new Map<string, Promise<ParserBackendSelection>>();
const diagnosticsLog: string[] = [];

/** Selection diagnostics recorded so far (choice plus fallback reason), in order. */
export function getParserRuntimeDiagnostics(): readonly string[] {
  return diagnosticsLog;
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

/** Test hook: clear the per-language selection cache and diagnostics log. */
export function resetParserBackendSelectionCache(): void {
  selectionCache.clear();
  diagnosticsLog.length = 0;
  deprecatedAliasWarningEmitted = false;
}

/**
 * Resolve the parser backend for one language according to the effective
 * policy. Selections made with default loaders are cached per
 * `(policy, language)` for the process lifetime; selections with injected
 * loaders or an explicit module root are computed fresh.
 */
export async function selectParserBackendFor(
  language: ParserLanguage,
  options: SelectParserBackendOptions = {}
): Promise<ParserBackendSelection> {
  const policy = options.policy ?? readParserRuntimePolicy();
  const source: ParserRuntimeChoiceSource =
    options.policy !== undefined
      ? (options.policySource ?? 'explicit')
      : hasParserRuntimeEnvOverride()
        ? 'env'
        : 'default';
  const cacheable = options.nativeLoaders === undefined && options.nativeModuleRoot === undefined;
  if (!cacheable) {
    return computeSelection(language, policy, options, source);
  }
  const key = `${policy}:${language}`;
  const cached = selectionCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const selection = computeSelection(language, policy, options, source);
  selectionCache.set(key, selection);
  // Do not cache rejections forever: a forced-native failure must not poison
  // a later auto-mode selection for the same language in long-lived hosts.
  selection.catch(() => selectionCache.delete(key));
  return selection;
}

async function computeSelection(
  language: ParserLanguage,
  policy: ParserRuntimePolicy,
  options: SelectParserBackendOptions,
  source: ParserRuntimeChoiceSource
): Promise<ParserBackendSelection> {
  if (policy === 'wasm') {
    const { wasmParserBackend } = await import('./wasm-parser-backend.js');
    return finishSelection(
      { language, policy, runtime: 'wasm', backend: wasmParserBackend },
      source,
      options
    );
  }

  const moduleRoot = options.nativeModuleRoot ?? readNativeModuleRootEnv();
  const loaders =
    options.nativeLoaders ?? (moduleRoot ? defaultNativeLoaders(moduleRoot) : undefined);
  try {
    probeNativeBinding(language, loaders ?? defaultNativeLoaders());
  } catch (error) {
    const reason = errorMessage(error);
    if (policy === 'native') {
      throw new ParserInitializationError(
        language,
        'native',
        new Error(
          `${reason}\n` +
            `Native tree-sitter is required by policy (ARCHGUARD_PARSER_RUNTIME=native). ` +
            `Install the optional native accelerator packages ("tree-sitter" and ` +
            `"${nativeGrammarModule(language)}") into ArchGuard's own package scope, or set ` +
            `ARCHGUARD_NATIVE_MODULE_ROOT to a trusted module root containing them, or relax ` +
            `the policy to ARCHGUARD_PARSER_RUNTIME=auto|wasm.`
        )
      );
    }
    const { wasmParserBackend } = await import('./wasm-parser-backend.js');
    return finishSelection(
      { language, policy, runtime: 'wasm', backend: wasmParserBackend, fallbackReason: reason },
      source,
      options
    );
  }

  // The native backend parses through the same loaders the probe used, so an
  // explicitly trusted module root (or injected loaders) governs both.
  const backend = loaders ? new NativeParserBackend({ loaders }) : nativeParserBackend;
  return finishSelection({ language, policy, runtime: 'native', backend }, source, options);
}

function finishSelection(
  selection: Omit<ParserBackendSelection, 'diagnostic' | 'source'>,
  source: ParserRuntimeChoiceSource,
  options: SelectParserBackendOptions
): ParserBackendSelection {
  // Effective-runtime one-liner (TASK-43): language -> backend chosen -> source
  // of choice -> fallback reason when applicable.
  const diagnostic = selection.fallbackReason
    ? `[parser-runtime] ${selection.language}: policy=${selection.policy} source=${source} -> ` +
      `${selection.runtime} (native probe failed: ${selection.fallbackReason})`
    : `[parser-runtime] ${selection.language}: policy=${selection.policy} source=${source} -> ${selection.runtime}`;
  diagnosticsLog.push(diagnostic);
  const full: ParserBackendSelection = { ...selection, source, diagnostic };
  options.onDiagnostic?.(diagnostic, full);
  return full;
}

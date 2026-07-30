/**
 * Parser runtime selection policy for the Tree-sitter backed languages
 * (go, java, python, cpp, kotlin).
 *
 * - `auto` (default): probe the native `(tree-sitter runtime, grammar)` tuple
 *   per language with an actual parse health check; use native only when the
 *   probe passes, otherwise fall back to the portable WASM backend and record
 *   the fallback reason.
 * - `native`: require the native backend. A failed probe is an actionable
 *   initialization error; WASM is never silently substituted.
 * - `wasm`: never import native modules; use the bundled web-tree-sitter
 *   backend deterministically.
 *
 * Canonical configuration is the `ARCHGUARD_PARSER_RUNTIME` environment
 * variable (`auto|native|wasm`). The TASK-38 `ARCHGUARD_PARSER_BACKEND`
 * variable (`native|wasm`) is kept as a deprecated alias and is superseded by
 * `ARCHGUARD_PARSER_RUNTIME` when both are set.
 */
export const PARSER_RUNTIME_POLICIES = ['auto', 'native', 'wasm'] as const;

export type ParserRuntimePolicy = (typeof PARSER_RUNTIME_POLICIES)[number];

export function isParserRuntimePolicy(value: unknown): value is ParserRuntimePolicy {
  return (
    typeof value === 'string' && (PARSER_RUNTIME_POLICIES as readonly string[]).includes(value)
  );
}

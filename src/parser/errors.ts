/**
 * Back-compatibility re-export.
 *
 * ParseError moved to the core parser-runtime layer
 * (src/core/parser-runtime/parse-error.ts) so the plugin runtime no longer has
 * to import the parser layer for an error type. Kept so existing importers
 * (src/cli/errors, the extractors, tests) keep resolving.
 */
export { ParseError } from '@/core/parser-runtime/parse-error.js';

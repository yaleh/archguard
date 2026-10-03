/**
 * Core parser-runtime surface: the language-agnostic syntax-tree contract,
 * backend/error types, the ParseError type, runtime policy + diagnostics, and
 * the resolver port. The concrete backends live in the plugin runtime layer.
 */
export * from './syntax-tree.js';
export * from './parser-backend.js';
export * from './parse-error.js';
export * from './parser-runtime.js';
export * from './parser-backend-resolver.js';

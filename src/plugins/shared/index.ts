/**
 * Shared infrastructure for tree-sitter based language plugins.
 */
export { QueryLoader, type QuerySet, type QueryCompiler } from './query-loader.js';
export { CaptureMapper, collectNamespace, type CaptureGroup } from './capture-mapper.js';
export type { ParserQueryLike, QueryCaptureLike, QueryMatchLike } from './syntax-tree.js';

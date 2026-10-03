/**
 * Back-compatibility re-export.
 *
 * The language-agnostic syntax-tree type surface moved to the core
 * parser-runtime layer (see TASK gap-layer-mutual-plugin-runtime-core-parser)
 * so that core and parser no longer have to depend on the plugin runtime for
 * types. This path is kept so existing plugin/consumer imports keep resolving.
 */
export * from '@/core/parser-runtime/syntax-tree.js';

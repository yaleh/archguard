/**
 * ArchIndexBuilder — re-export shim for backward compatibility.
 *
 * The domain functions now live in @/core/query/arch-index-builder.
 * All existing import sites continue to work without changes.
 */

export { buildArchIndex } from '@/core/query/arch-index-builder.js';

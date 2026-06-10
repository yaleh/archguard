/**
 * ArchIndex — re-export shim for backward compatibility.
 *
 * The domain types and constants now live in @/core/query/arch-index.
 * All existing import sites continue to work without changes.
 */

export { ARCH_INDEX_VERSION } from '@/core/query/arch-index.js';
export type { ArchIndex } from '@/core/query/arch-index.js';

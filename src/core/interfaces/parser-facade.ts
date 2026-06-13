import type { ArchJSON } from '@/types/index.js';

/**
 * Minimal interface for parallel-file parsing used by CLI processors.
 * Decouples CLI layer from the concrete ParallelParser implementation.
 */
export interface IParserFacade {
  parseFiles(filePaths: string[]): Promise<ArchJSON>;
}

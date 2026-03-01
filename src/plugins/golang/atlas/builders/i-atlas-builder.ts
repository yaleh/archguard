import type { GoRawData } from '../../types.js';

/**
 * Common contract for all Atlas graph builders.
 *
 * Each builder takes raw Go parse data and produces a typed graph structure.
 */
export interface IAtlasBuilder<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build(rawData: GoRawData, options?: any): Promise<T>;
}

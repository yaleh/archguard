/**
 * Refactor Slice / Expected Delta — public library surface.
 *
 * Consumers depend only on this module (and therefore only on ArchGuard's release
 * artifacts), never on the frozen layer-map prototype under docs/.
 *
 * @example
 * ```ts
 * import { simulateRefactorSlice } from '@yalehwang/archguard';
 *
 * const report = simulateRefactorSlice({ graph: moduleGraph, slice });
 * if (report.status === 'evaluated') {
 *   console.log(report.computedDelta.sccAfter, report.guards.clean);
 * }
 * ```
 */

export { simulateRefactorSlice } from './simulate.js';
export type * from './types.js';

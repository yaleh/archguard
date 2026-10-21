/**
 * DiagramResult — the per-diagram outcome shape produced by
 * `cli/processors/diagram-processor` and consumed by diagram index rendering
 * (`cli/utils/diagram-index-generator`) and CLI result display.
 *
 * Extracted to `src/types` (rather than defined in the `processors` consumer)
 * so the shape is owned by the leaf types layer instead of one of its
 * consumers, keeping `cli/utils` from reverse-importing `cli/processors`.
 *
 * @module types/diagram-result
 */

import type { ArchJSONMetrics } from './index.js';

/**
 * Result from processing a single diagram
 */
export interface DiagramResult {
  /** Diagram name */
  name: string;
  /** Whether processing succeeded */
  success: boolean;
  /** Output file paths (if successful) */
  paths?: {
    mmd?: string;
    puml?: string;
    svg?: string;
    png?: string;
    json?: string;
  };
  /**
   * Every source artifact actually written for this diagram (if successful).
   *
   * `paths` only names the primary artifact; a class diagram may be split into
   * one file per layer/namespace (and per oversized-group chunk), and a Go
   * Atlas diagram emits one file per layer. The manifest and index.md use this
   * list to enumerate real on-disk products.
   */
  outputs?: string[];
  /** Processing statistics (if successful) */
  stats?: {
    entities: number;
    relations: number;
    parseTime: number;
  };
  /** Error message (if failed) */
  error?: string;
  /**
   * Structural metrics for this diagram (computed regardless of output format).
   * Used by DiagramIndexGenerator to render index.md stats tables.
   * Only present when success === true.
   */
  metrics?: ArchJSONMetrics;
}

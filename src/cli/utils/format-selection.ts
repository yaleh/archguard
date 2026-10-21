/**
 * Format selection — the single normalization point for "which outputs do we
 * want?".
 *
 * Four entry points feed this module: the CLI (`-f` repeatable), the config
 * file (global `formats` and per-diagram `formats`), the MCP `archguard_analyze`
 * tool (`formats` array), and programmatic callers. They all speak the same
 * shape (`OutputFormats`, an ordered array), and this module turns that shape
 * into one resolved set.
 *
 * Rules:
 * - Precedence is OVERRIDE, not union: the first non-empty source wins
 *   entirely. Sources are checked in this order:
 *     CLI/MCP > per-diagram > global config > default.
 * - Within the winning source, order is preserved and duplicates are dropped
 *   (first occurrence wins).
 * - An empty/absent selection at every level falls back to `['mermaid']`.
 *
 * What is selected here is only the artifact set. How each format is produced
 * is the router's business (json → `.json`, plantuml → emit `.puml`,
 * mermaid → `.mmd` + `.svg`/`.png`).
 *
 * @module cli/utils/format-selection
 */

import type { OutputFormat, OutputFormats } from '@/types/config-mermaid.js';

/** The default when no source selects anything. */
export const DEFAULT_FORMATS: readonly OutputFormat[] = ['mermaid'];

/**
 * The ordered sources, strongest first. `undefined` and `[]` both mean
 * "this source did not select anything" (Commander hands an empty array for a
 * repeatable option that never appeared, so this distinction matters).
 */
export interface FormatSelectionSources {
  /** CLI `-f` / MCP `formats` — highest precedence. */
  cli?: OutputFormats;
  /** Per-diagram `formats` — overrides the global config for that diagram. */
  diagram?: OutputFormats;
  /** Global config `formats`. */
  global?: OutputFormats;
}

/**
 * Resolve the ordered, de-duplicated format set for one output.
 *
 * @param sources - Candidate selections, strongest first.
 * @returns The winning set, or `['mermaid']` when nothing selected.
 */
export function resolveFormats(sources: FormatSelectionSources = {}): OutputFormat[] {
  for (const candidate of [sources.cli, sources.diagram, sources.global]) {
    if (candidate && candidate.length > 0) {
      return dedupe(candidate);
    }
  }
  return [...DEFAULT_FORMATS];
}

/** Drop repeated formats, keeping first-seen order. */
function dedupe(formats: readonly OutputFormat[]): OutputFormat[] {
  return [...new Set(formats)];
}

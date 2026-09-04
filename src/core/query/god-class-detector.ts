/**
 * God-class detector — class-level single-responsibility analysis.
 *
 * Flags class-like entities that exceed size or coupling thresholds. Unlike
 * `archguard_detect_god_packages` (Go Atlas, package-level), this operates on
 * individual class entities using the standard ArchJSON any language plugin
 * emits (Dart today; the computation is language-agnostic).
 *
 * Pure domain logic — no filesystem, no side effects. Lives in the core query
 * layer so both the MCP tool and the CLI `query` command call the same code
 * (ADR-007 §1).
 *
 * Metrics per entity:
 *   - methodCount   = members of type 'method' | 'constructor'
 *   - fieldCount    = members of type 'field' | 'property'
 *   - loc           = class-declaration span in source lines
 *                     (= sourceLocation.endLine - startLine + 1), the physical
 *                     body of the class from its `class X` line to its closing
 *                     `}` — an exact line count, not an approximation.
 *   - fanIn / fanOut = distinct internal relation neighbors (unique source /
 *                     target entity counts, within the parsed scope).
 */

import type { Entity } from '@/types/index.js';

/** One flagged god-class candidate with the thresholds it violated. */
export interface GodClassEntry {
  name: string;
  id: string;
  file: string;
  methodCount: number;
  fieldCount: number;
  loc: number;
  fanIn: number;
  fanOut: number;
  /** Violated thresholds, e.g. ['tooManyMethods', 'highLoc']. */
  reasons: string[];
}

export interface GodClassThresholds {
  /** Method count cutoff; 0 disables this dimension. */
  minMethods: number;
  /** Field count cutoff; 0 disables this dimension. */
  minFields: number;
  /** Class body LOC cutoff; 0 disables this dimension. */
  minLoc: number;
  /** Fan-in cutoff; 0 disables this dimension. */
  minFanIn: number;
}

/**
 * Default cutoffs shared by the MCP tool (`archguard_detect_god_classes`) and
 * the CLI `query --god-classes`. Keep in one place so the two entry points
 * never drift apart.
 */
export const DEFAULT_GOD_CLASS_THRESHOLDS: GodClassThresholds = {
  minMethods: 30,
  minFields: 30,
  minLoc: 800,
  minFanIn: 40,
};

/**
 * Compute god-class candidates from entities + relations.
 *
 * @param entities  all entities in the scope (full detail incl. members)
 * @param relations raw relations; only internal edges (both endpoints present) count
 * @param thresholds numeric cutoffs — 0 disables that dimension
 */
export function detectGodClasses(
  entities: readonly Entity[],
  relations: readonly { source: string; target: string }[],
  thresholds: GodClassThresholds
): GodClassEntry[] {
  const ids = new Set(entities.map((e) => e.id));

  // fan-in / fan-out are DISTINCT neighbor counts. A single source class with
  // several relation types to the same target (e.g. both implementation and
  // composition) is one dependent, not several; self-edges are not real
  // dependencies and are ignored. Using a Set per endpoint deduplicates both.
  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();
  for (const r of relations) {
    if (r.source === r.target) continue;
    if (!ids.has(r.source) || !ids.has(r.target)) continue;
    let inSet = fanIn.get(r.target);
    if (!inSet) {
      inSet = new Set();
      fanIn.set(r.target, inSet);
    }
    inSet.add(r.source);
    let outSet = fanOut.get(r.source);
    if (!outSet) {
      outSet = new Set();
      fanOut.set(r.source, outSet);
    }
    outSet.add(r.target);
  }

  const entries: GodClassEntry[] = [];
  for (const e of entities) {
    // Only class-like entities are god-class candidates. Enums map to type
    // 'enum'; extensions/mixins map to 'class' but carry a decorator (name
    // 'extension' | 'mixin'), so filter those out too — an enum with many
    // constants or an extension with many helpers is not a "god class".
    const isExtensionOrMixin = e.decorators?.some(
      (d) => d.name === 'extension' || d.name === 'mixin'
    );
    if (e.type === 'enum' || isExtensionOrMixin) continue;

    let methodCount = 0;
    let fieldCount = 0;
    for (const m of e.members) {
      if (m.type === 'method' || m.type === 'constructor') methodCount++;
      else if (m.type === 'field' || m.type === 'property') fieldCount++;
    }
    const loc =
      e.sourceLocation?.endLine && e.sourceLocation?.startLine
        ? e.sourceLocation.endLine - e.sourceLocation.startLine + 1
        : 0;
    const fi = fanIn.get(e.id)?.size ?? 0;
    const fo = fanOut.get(e.id)?.size ?? 0;

    const reasons: string[] = [];
    if (thresholds.minMethods > 0 && methodCount >= thresholds.minMethods)
      reasons.push('tooManyMethods');
    if (thresholds.minFields > 0 && fieldCount >= thresholds.minFields)
      reasons.push('tooManyFields');
    if (thresholds.minLoc > 0 && loc >= thresholds.minLoc) reasons.push('highLoc');
    if (thresholds.minFanIn > 0 && fi >= thresholds.minFanIn) reasons.push('highFanIn');
    if (reasons.length === 0) continue;

    entries.push({
      name: e.name,
      id: e.id,
      file: e.sourceLocation?.file ?? '',
      methodCount,
      fieldCount,
      loc,
      fanIn: fi,
      fanOut: fo,
      reasons,
    });
  }

  // LOC first (physical size dominates god-class severity), then violation
  // count, then method count.
  entries.sort(
    (a, b) => b.loc - a.loc || b.reasons.length - a.reasons.length || b.methodCount - a.methodCount
  );
  return entries;
}

/**
 * Refactor Slice / Expected Delta — input & output types.
 *
 * This is the stable product surface of the semantics prototyped (and verified)
 * in the frozen layer-map prototype. The prototype stays frozen as the reference
 * implementation; its field names are carried over verbatim so the parity test
 * can compare the two on the same input.
 *
 * The graph type is the existing {@link TsModuleGraph} — deliberately NOT a new
 * graph type. Directory-level nodes + edges + cycles only; no I/O, no git.
 */

import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';

/** A file relocation intent: which symbols of `file` move from dir `from` to dir `to`. */
export interface SliceMove {
  file?: string;
  from: string;
  to: string;
  symbols: string[];
  note?: string;
}

/**
 * A caller-declared "these symbols stay put in `dir`" (NEW, additive).
 *
 * This is the vocabulary a *partial* migration needs: when one directory edge's
 * `importedNames` contains both symbols that move and symbols that stay, the
 * caller must be able to say — explicitly — that the remaining names were
 * inspected and stay. Without it the only options are hand-arithmetic or a
 * file-level split first. An undeclared name is NEVER defaulted to "stays":
 * it stays `not-evaluated`. `stays` is a declaration, not a fallback.
 */
export interface SliceStay {
  dir: string;
  symbols: string[];
  note?: string;
}

/** A caller-declared consumer (needed because same-directory imports are invisible on a directory graph). */
export interface SliceConsumer {
  file?: string;
  dir: string;
  imports: string[];
}

/** A directory-level edge (from -> to). */
export interface SliceEdge {
  from: string;
  to: string;
}

/**
 * The explicit cut declaration. ArchGuard never invents a slice — the caller
 * supplies it. Everything here is either the cut, a guard, or a prediction.
 */
export interface RefactorSliceDeclaration {
  /**
   * Directory node id that is the concern, OR a file path (normalized to the
   * internal dir that contains it). Must resolve to an internal node of the graph.
   */
  subject: string;
  concern?: string;
  /** Provenance declared by the caller; echoed as-is into `provenance.slice`. */
  provenance?: Record<string, unknown>;
  proposedCut: {
    moves: SliceMove[];
    /** Symbols explicitly declared to stay put. The vocabulary for partial migration. */
    stays?: SliceStay[];
    consumers?: SliceConsumer[];
    note?: string;
  };
  /** Human-written prediction; physically partitioned from the computed delta. */
  declaredPrediction?: {
    sccSize?: number;
    sccMembers?: string[];
    source?: string;
  };
  /** Guards: edges that must not newly appear / dirs that must not be touched. */
  mustNotChange?: {
    forbiddenNewEdges?: SliceEdge[];
    untouchedDirs?: string[];
    note?: string;
  };
  /** Mechanically-enforced negative control: restoring these edges must restore before-SCC membership. */
  negativeControl: {
    description?: string;
    restoreEdges: SliceEdge[];
  };
}

/**
 * `certainty` is present ONLY when the edge is structurally unknown (a
 * barrel / re-export edge whose coupling the directory graph cannot fully see).
 * Its absence means `deterministic`. It is never emitted as a fake
 * `'deterministic'` value, so an undeclared input keeps byte-identical edges.
 */
export type SliceEdgeCertainty = 'unknown';

/** Edge removed by the cut (importedNames fully covered by a move's symbols). */
export interface SliceDeltaRemovedEdge {
  from: string;
  to: string;
  valueStrength: number | null;
  typeOnlyStrength: number | null;
  importedNames: string[];
  /**
   * `intra-directory` (retargeted into the source dir itself) or
   * `retargeted-to:<dir>` (comma-joined for a legal multi-destination edge).
   */
  becomes: string;
  certainty?: SliceEdgeCertainty;
}

/** Edge the cut would newly create (from retarget or from a declared consumer). */
export interface SliceDeltaAddedEdge {
  from: string;
  to: string;
  source: 'retarget-from-removed-edge' | 'declared-consumer';
  via?: string | null;
  certainty?: SliceEdgeCertainty;
}

/**
 * An edge the cut produces that ALREADY exists before the cut. Recorded rather
 * than silently dropped, so the report never hides a coupling the cut touches.
 * The directory-level graph carries no symbol→file localization, so the strength
 * increment cannot be computed — `strength` is always null and the note says so.
 */
export interface SliceDeltaStrengthenedEdge {
  from: string;
  to: string;
  source: 'retarget-from-removed-edge' | 'declared-consumer';
  via?: string | null;
  effect: 'strengthens-existing-edge';
  strength: null;
  note: string;
}

/** Why a directory left the subject's SCC after the cut — recomputed reachability, not copied text. */
export interface SliceDeltaWhyLeft {
  dir: string;
  inEdgeSourcesBefore: string[];
  inEdgeSourcesAfter: string[];
  inCycleAfter: boolean;
  reason: string;
}

/** A graph-visible consumer affected by the cut. */
export interface SliceDeltaAffectedConsumer {
  edge: string;
  sourceDir: string;
  movedFromDir: string;
  movedToDir: string;
  importedNames: string[];
  becomes: string;
  explainedBy: string[];
}

/** A caller-declared consumer, reconciled against the graph. */
export interface SliceDeltaDeclaredConsumer {
  declared: SliceConsumer;
  status: 'graph-visible' | 'intra-directory' | 'unverifiable';
  movedToDir: string;
  note?: string;
}

/**
 * Per-affected-edge accounting (NEW report section). Turns the three
 * ClaudeCodeUI rejections into *information*: which names move where, which
 * were explicitly declared staying, which (if any) are unaccounted, and
 * whether the edge is a barrel/re-export the directory graph cannot fully see.
 */
export interface SliceDeltaAccountingEntry {
  edge: string;
  names: string[];
  moving: Array<{ name: string; to: string }>;
  staying: string[];
  unaccounted: string[];
  /** Distinct destinations the moved names go to. */
  destinations: string[];
  /** True when the edge's target re-exports from a moved-from dir (unknown coupling). */
  barrel: boolean;
  certainty: 'deterministic' | 'unknown';
}

/** A graph-visible unresolved alias reference (never fed into the delta). */
export interface SliceDeltaUnresolvedAliasRef {
  from: string;
  specifier: string;
}

/**
 * The explicit "here is what the graph cannot see" section (NEW). None of it
 * feeds `computedDelta`; it exists so uncertainty is declared rather than
 * silently folded into a deterministic-looking edge count.
 */
export interface SliceDeltaUnknowns {
  unresolvedAliasRefs: SliceDeltaUnresolvedAliasRef[];
  unevaluatedDynamicImports: number;
  /** Affected edges that are barrel/re-export edges. */
  barrelEdges: string[];
}

/** A must-not-change violation. */
export interface SliceDeltaViolation {
  kind: 'forbidden-new-edge' | 'untouched-dir-changed';
  edge?: string;
  dir?: string;
  edges?: string[];
}

export interface SliceDeltaCurrent {
  sccMembers: string[];
  sccSize: number;
  subjectFanIn: number;
  relevantEdges: Array<{ from: string; to: string; importedNames: string[] }>;
}

export interface SliceDeltaComputed {
  /** Which inputs were actually consumed to compute this section (honesty field). */
  inputsUsed: string[];
  removedEdges: SliceDeltaRemovedEdge[];
  addedEdges: SliceDeltaAddedEdge[];
  strengthenedEdges: SliceDeltaStrengthenedEdge[];
  sccBefore: string[];
  sccAfter: string[];
  sccLeft: string[];
  sccRemaining: string[];
  subjectFanInAfter: number;
  whyLeft: SliceDeltaWhyLeft[];
}

export interface SliceDeltaNegativeControl {
  description: string | null;
  restoreEdges: SliceEdge[];
  beforeSccMembers: string[];
  afterSccMembers: string[];
  subjectSccMembersAfterRestore: string[];
  subjectBackInScc: boolean;
  restoresBeforeMembership: boolean;
  falsified: boolean;
  /** Explanation for a `falsified === false` outcome; null when the negative control holds. */
  reason: string | null;
}

export interface SliceDeltaGuards {
  clean: boolean;
  violations: number;
  negativeControlFalsified: boolean;
}

export interface SliceDeltaComparison {
  relation: 'agrees' | 'diverges' | 'size-agrees-members-unknown' | 'incomparable';
  declaredSccSize?: number | null;
  observedSccSize?: number | null;
  computedSccSize: number;
  sizeMatches: boolean;
  membersMatch: boolean | null;
}

export interface SliceDeltaPredictionComparison {
  declaredVsComputed: SliceDeltaComparison | null;
  observedVsComputed: SliceDeltaComparison | null;
}

/** A fully evaluated report (guards may still be triggered — see `guards.clean`). */
export interface SliceDeltaEvaluatedReport {
  status: 'evaluated';
  subject: string;
  concern: string | null;
  /** Caller-injected provenance段; the pure core only carries it, never reads the environment. */
  provenance: unknown;
  current: SliceDeltaCurrent;
  proposedCut: {
    moves: SliceMove[];
    /** Echoed only when the declaration carried a `stays` clause (additive-only). */
    stays?: SliceStay[];
    declaredConsumerCount: number;
    assumptions: string[];
  };
  affectedConsumers: SliceDeltaAffectedConsumer[];
  declaredConsumers: SliceDeltaDeclaredConsumer[];
  /**
   * Present only when this declaration exercises a partial-migration feature
   * (a `stays` clause, a multi-destination edge, or an unknown/barrel edge).
   * A plain fully-covered cut omits both sections, keeping its report identical
   * to the pre-extension output.
   */
  accounting?: SliceDeltaAccountingEntry[];
  unknowns?: SliceDeltaUnknowns;
  computedDelta: SliceDeltaComputed;
  mustNotChange: {
    forbiddenNewEdges: SliceEdge[];
    untouchedDirs: string[];
    violations: SliceDeltaViolation[];
  };
  negativeControl: SliceDeltaNegativeControl;
  guards: SliceDeltaGuards;
  declaredPrediction: RefactorSliceDeclaration['declaredPrediction'] | null;
  observedDelta: Record<string, unknown> | null;
  predictionComparison: SliceDeltaPredictionComparison;
}

/**
 * Not enough signal to produce a trustworthy reading. Carries NO half-computed
 * delta: consumers must never mistake a partial report for an evaluated one.
 */
export interface SliceDeltaNotEvaluatedReport {
  status: 'not-evaluated';
  reason: string;
}

export type SliceDeltaReport = SliceDeltaEvaluatedReport | SliceDeltaNotEvaluatedReport;

/** Input to the pure entry point. */
export interface SimulateRefactorSliceInput {
  graph: TsModuleGraph;
  slice: RefactorSliceDeclaration;
  /** Posterior reading; physically partitioned from the computed delta. */
  observed?: Record<string, unknown> | null;
  /** Provenance段 injected by the adapter (CLI/MCP); the core does not read the environment. */
  provenance?: unknown;
}

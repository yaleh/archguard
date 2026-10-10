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
  /** Directory node id that is the concern (must be an internal node of the graph). */
  subject: string;
  concern?: string;
  /** Provenance declared by the caller; echoed as-is into `provenance.slice`. */
  provenance?: Record<string, unknown>;
  proposedCut: {
    moves: SliceMove[];
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

/** Edge removed by the cut (importedNames fully covered by a move's symbols). */
export interface SliceDeltaRemovedEdge {
  from: string;
  to: string;
  valueStrength: number | null;
  typeOnlyStrength: number | null;
  importedNames: string[];
  /** `intra-directory` (retargeted into the source dir itself) or `retargeted-to:<dir>`. */
  becomes: string;
}

/** Edge the cut would newly create (from retarget or from a declared consumer). */
export interface SliceDeltaAddedEdge {
  from: string;
  to: string;
  source: 'retarget-from-removed-edge' | 'declared-consumer';
  via?: string | null;
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
    declaredConsumerCount: number;
    assumptions: string[];
  };
  affectedConsumers: SliceDeltaAffectedConsumer[];
  declaredConsumers: SliceDeltaDeclaredConsumer[];
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

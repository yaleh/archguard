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
    /**
     * Destinations explicitly declared to be NEWLY CREATED directories (additive).
     *
     * A directory named here becomes a new node of the simulated graph even though
     * it is ABSENT from the input graph. This is the ONLY way a `move.to` may name
     * a directory the graph does not contain: an UNDECLARED non-internal `to` stays
     * `not-evaluated`. A declared-new dir has NO readings of its own — its
     * `fileCount` / `stats` are unknown (emitted as `null`, never `0`), and its
     * edges are exactly the ones THIS cut creates by retargeting (no path invents
     * an edge or a count for it).
     */
    newDirs?: string[];
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
  /** Present only when some of the edge's names stay: the original edge SURVIVES. */
  survives?: true;
  /** Always `null` for a surviving edge — the directory graph cannot compute the increment. */
  strength?: null;
  note?: string;
}

/** A graph-visible unresolved alias reference (never fed into the delta). */
export interface SliceDeltaUnresolvedAliasRef {
  from: string;
  specifier: string;
}

/**
 * A node materialized SOLELY from a `proposedCut.newDirs` declaration (NEW).
 *
 * Its `fileCount` / `stats` are UNKNOWN — emitted as `null`, never `0` and never a
 * guessed number — because the directory is absent from the analysed graph: the
 * tool has not inspected it and must not invent a reading. Its `inboundEdges` are
 * exactly the edges this cut creates by retargeting into it; it has no outgoing
 * edges on a directory graph (the moved files' own imports are not visible), which
 * the `note` says explicitly rather than reporting a fabricated zero.
 */
export interface SliceDeltaSyntheticNode {
  id: string;
  fileCount: null;
  stats: null;
  /** Edges this cut creates INTO the new node (`"<from> -> <id>"`), sorted. */
  inboundEdges: string[];
  note: string;
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
  /**
   * Edges that carry a moved symbol's NAME but neither enter a moved-from dir nor
   * structurally re-export from one. A directory graph cannot prove two same-named
   * symbols are one entity, so these edges are left UNCHANGED (never removed and never
   * retargeted) and listed here as the remaining name-collision limitation. Present
   * only when non-empty, so an unaffected cut keeps byte-identical diagnostics.
   */
  nameCollisionEdges?: string[];
  /**
   * Names declared in `proposedCut.moves[].symbols` / `proposedCut.stays[].symbols`
   * that appear on NO edge's `importedNames`.
   *
   * THE SET OPERATION, exactly (no heuristic):
   * ```
   *   referenced          := ⋃ { e.importedNames : e ∈ moduleGraph.edges }   // internal AND external
   *   unreferencedSymbols := declaredNames \ referenced                      // sorted; present iff non-empty
   * ```
   * The reference set includes EVERY edge of the graph — internal (dir→dir) and
   * external (dir→package). It excludes same-directory imports, which a directory
   * graph does not represent at all (see `proposedCut.assumptions[0]`). It is never a
   * heuristic such as "is the name on a cross-directory edge?", which is the coarser
   * proxy the downstream repair loop had to approximate with (it saw only a subset of
   * the edges). Present only when non-empty, so an unaffected cut keeps byte-identical
   * diagnostics.
   *
   * ⚠️ BOUNDARY — this is a FACT, not a verdict. "Not referenced by any edge" is NOT
   * "does not exist": a symbol that is real but imported only within its OWN directory
   * — or that this cut simply does not route through any reconciled edge — appears
   * here exactly as a name that is on no edge at all does. The graph cannot tell these
   * apart. Do NOT read this field as an existence check; the caller decides.
   * {@link unreferencedSymbolsNote} carries this boundary into the report itself.
   */
  unreferencedSymbols?: string[];
  /**
   * Boundary note that travels with {@link unreferencedSymbols} (present iff it is).
   * It states, inside the report, both the set operation (some edge's `importedNames`,
   * internal or external) and that "not referenced by any edge" is not "does not
   * exist", so a consumer cannot mistake the fact for a verdict.
   */
  unreferencedSymbolsNote?: string;
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
  /**
   * Present only when the cut materializes at least one declared-new directory
   * (`proposedCut.newDirs`). Each entry is the new node's report: counts unknown
   * (`null`), inbound edges only. Omitted for a cut that declares no new dir, so a
   * plain report stays byte-identical to the pre-extension output.
   */
  syntheticNodes?: SliceDeltaSyntheticNode[];
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
    /** Echoed only when the declaration carried a `newDirs` list (additive-only). */
    newDirs?: string[];
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

// ── Slice preflight (discovery, not evaluation) ───────────────────────────────
//
// `preflightSlice` answers the question that precedes a declaration: "given THIS
// subject, which moves / stays / newDirs can I declare at all, and why?" It reads
// only the module graph and never invents a slice, ranks anything, or emits a
// pass/fail. Its output is the vocabulary a caller needs so that the subsequent
// `simulateRefactorSlice` call is evaluated instead of tripping a fail-closed rule
// and forcing the caller to reverse-engineer `accounting`.

/** Input to the pure preflight entry point. */
export interface SlicePreflightInput {
  graph: TsModuleGraph;
  /** Directory node id OR a file path (normalized to its containing internal dir). */
  subject: string;
  /**
   * Optional destinations the caller is considering. Each is CLASSIFIED: an
   * internal node is a legal target as-is; a directory absent from the graph is
   * legal ONLY after being declared in `proposedCut.newDirs`; an existing
   * non-internal node cannot be used at all. Omit it to get the rule plus the
   * full list of internal targets.
   */
  destinations?: string[];
  /** Provenance段 injected by the adapter; the core does not read the environment. */
  provenance?: unknown;
}

/** One symbol that may be moved out of a source directory, with its legal targets. */
export interface SlicePreflightSymbolMove {
  symbol: string;
  /** Internal dirs that are structurally legal `move.to` targets (source dir excluded). */
  destinations: string[];
  /** Absent candidate destinations, each legal only after this `newDirs` declaration. */
  newDirDestinations: Array<{ dir: string; declaration: { newDirs: string[] } }>;
  /** Edges entering the source dir whose `importedNames` carry this symbol. */
  carriedBy: string[];
  reason: string;
}

/**
 * A group of move candidates sharing one `move.from`.
 *
 * Two relationships are enumerated:
 *   - `subject-exports` — the source IS the subject; its incoming edges carry the
 *     names other directories import from it.
 *   - `subject-imports` — the source is a directory the subject imports FROM; the
 *     subject's outgoing edge carries those names. The real claudecodeui cut is of
 *     this shape (`subject=modules/settings`, `from=modules/settings/hooks`).
 */
export interface SlicePreflightMoveGroup {
  from: string;
  relationship: 'subject-exports' | 'subject-imports';
  /** The subject-side edge(s) that justify this group. */
  via: string[];
  /** False when a graph condition makes EVERY move from this source fail closed. */
  legal: boolean;
  /** Blocking codes (see `blocking[]`); empty when legal. */
  blockedBy: string[];
  symbols: SlicePreflightSymbolMove[];
  reason: string;
}

/**
 * A `proposedCut.stays` group that covers one reconciled edge's imported names.
 * `dir` is the directory whose names the edge imports (so the non-moved names
 * "stay" there). An undeclared name is never defaulted to staying.
 */
export interface SlicePreflightStayGroup {
  dir: string;
  symbols: string[];
  edge: string;
  /** The moved-from dir whose cut makes this edge reconciled. */
  forSource: string;
  reason: string;
}

/** An edge a move from `forSource` would reconcile, with the names it forces you to account for. */
export interface SlicePreflightEdgeObligation {
  forSource: string;
  edge: string;
  /** `incoming` = enters the moved-from dir; `barrel` = enters a dir that re-exports from it. */
  kind: 'incoming' | 'barrel';
  from: string;
  to: string;
  importedNames: string[];
  reason: string;
}

/** How a candidate destination would be treated by `simulateRefactorSlice`. */
export interface SlicePreflightDestinationVerdict {
  dir: string;
  kind: 'internal' | 'requires-new-dir' | 'subject-itself' | 'not-an-internal-node';
  legalAsMoveTarget: boolean;
  reason: string;
  /** Present when `requires-new-dir`: the declaration that makes the target legal. */
  declaration?: { newDirs: string[] };
  /** Unresolved alias refs from this destination (they make the cut fail closed). */
  blocking?: string[];
}

/** A graph condition that makes some or all declarations fail closed. */
export interface SlicePreflightBlocking {
  /**
   * `UNRESOLVED_ALIAS_FROM_SOURCE` | `INCOMING_EDGE_WITHOUT_NAMES` |
   * `DESTINATION_EXISTS_NOT_INTERNAL` | `DESTINATION_UNRESOLVED_ALIAS`.
   */
  code: string;
  /** The dir the condition belongs to (a move source or a candidate destination). */
  scope: string;
  reason: string;
  fix: string;
}

/** An outgoing edge of the subject, reported for orientation (not reconciled by a move FROM the subject). */
export interface SlicePreflightOutgoingEdge {
  edge: string;
  to: string;
  importedNames: string[];
  reason: string;
}

/** A preflight answer: declarable vocabulary + the rules that make a declaration legal. */
export interface SlicePreflightEvaluatedReport {
  status: 'preflight';
  /** Normalized internal dir id (a file-path input is resolved to its containing dir). */
  subject: string;
  provenance: unknown;
  current: {
    sccMembers: string[];
    sccSize: number;
    subjectFanIn: number;
    subjectFanOut: number;
    internalDirCount: number;
  };
  outgoing: SlicePreflightOutgoingEdge[];
  declarations: {
    moves: SlicePreflightMoveGroup[];
    stays: SlicePreflightStayGroup[];
    newDirs: {
      /** Candidate destinations absent from the graph — each needs an explicit declaration. */
      required: SlicePreflightDestinationVerdict[];
      rule: string;
    };
  };
  /** Verdicts for every caller-supplied candidate destination (empty when none were supplied). */
  destinations: SlicePreflightDestinationVerdict[];
  legalDestinations: {
    /** Every internal dir (sorted). Each move group excludes its own source dir. */
    internal: string[];
    newDirRule: string;
  };
  edges: SlicePreflightEdgeObligation[];
  blocking: SlicePreflightBlocking[];
  nextSteps: string[];
  notes: string[];
}

/** The preflight could not read the graph/subject — no vocabulary is emitted. */
export interface SlicePreflightNotEvaluatedReport {
  status: 'not-evaluated';
  reason: string;
}

export type SlicePreflightReport = SlicePreflightEvaluatedReport | SlicePreflightNotEvaluatedReport;

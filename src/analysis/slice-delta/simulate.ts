/**
 * simulateRefactorSlice — the deterministic core of Refactor Slice / Expected Delta.
 *
 * Answers exactly one question: "if I apply THIS explicitly-declared cut, what is
 * the architecture delta of this tree?" It never answers "should I cut this way" —
 * the slice is caller-supplied; this core invents no plan, ranks nothing, suggests
 * nothing.
 *
 * Migrated verbatim from the frozen layer-map prototype (the reference
 * implementation). The parity test runs both on the same fixture and asserts
 * `computedDelta` / `negativeControl` / `sccAfter` agree, so the two cannot drift.
 * The semantic rules below are the prototype's, unchanged.
 *
 * ⛔ This module imports NO `fs` / `path` / `child_process`: no I/O, no git probing.
 * Everything that needs the environment (reading the graph, provenance, git
 * consistency) lives in the CLI / MCP adapters, not in this core.
 *
 * Three physically-partitioned readings, none feeding back into another:
 *   - computedDelta      = computed ONLY from (graph, slice.proposedCut, slice.mustNotChange, slice.negativeControl)
 *   - declaredPrediction = the human prediction, echoed as-is
 *   - observedDelta      = an external posterior reading, echoed as-is
 * The anti-stuffing reverse test ("swap observed → computedDelta/negativeControl
 * byte-identical") is the mechanical guarantee, not a convention.
 */

import type { TsModuleGraph, TsModuleDependency } from '@/types/extensions/ts-analysis.js';
import type {
  RefactorSliceDeclaration,
  SimulateRefactorSliceInput,
  SliceDeltaAccountingEntry,
  SliceDeltaAddedEdge,
  SliceDeltaAffectedConsumer,
  SliceDeltaComputed,
  SliceDeltaDeclaredConsumer,
  SliceDeltaEvaluatedReport,
  SliceDeltaNegativeControl,
  SliceDeltaNotEvaluatedReport,
  SliceDeltaRemovedEdge,
  SliceDeltaReport,
  SliceDeltaStrengthenedEdge,
  SliceDeltaSyntheticNode,
  SliceDeltaUnknowns,
  SliceDeltaViolation,
  SliceDeltaWhyLeft,
  SliceEdge,
  SliceMove,
  SlicePreflightBlocking,
  SlicePreflightDestinationVerdict,
  SlicePreflightEdgeObligation,
  SlicePreflightEvaluatedReport,
  SlicePreflightInput,
  SlicePreflightMoveGroup,
  SlicePreflightReport,
  SlicePreflightStayGroup,
  SlicePreflightSymbolMove,
  SliceStay,
} from './types.js';

/** The input fields that feed `computedDelta` and `negativeControl` (honesty field). */
const COMPUTED_INPUTS_USED = [
  'extensions.tsAnalysis.moduleGraph',
  'slice.proposedCut',
  'slice.mustNotChange',
  'slice.negativeControl',
];

const STRENGTH_NOTE =
  '目录级图不携带「符号→文件」定位，无法计算这条边的强度增量；只记录它确实指向一条已存在的边。';

const SURVIVING_NOTE =
  '这条目录边没有消失：声明留在原地的名字仍从该目录 import。目录级图不携带「符号→文件」定位，强度增量不可算，故 strength=null ——不按留在原地/搬走的名字个数折算。';

/**
 * Fixed note on every synthetic (declared-new) node. It states the three
 * honesty invariants mechanically: the counts are unknown (null, not 0), the
 * content is only what this cut moves in, and the outbound edges are "not
 * inspected" rather than "zero".
 */
const SYNTHETIC_NODE_NOTE =
  '这个节点由 proposedCut.newDirs 显式声明为新建目录：除本次切法搬入的符号外没有内容。fileCount / stats 一律 unknown（null）——未查，不是 0，也没有任何被猜出来的读数。它的入边只由本次切法产生（retarget 自被移除的边，见 inboundEdges）；出边在目录级图上不可见（搬入文件自身的 import 不上图），因此不在此列出——是「未查」，不是「没有出边」。';

/**
 * Boundary note that MUST travel with `unknowns.unreferencedSymbols`, inside the
 * report itself. It states the exact set operation (a name is "referenced" iff it
 * appears in SOME edge's `importedNames`, internal or external) and its limit — a
 * name declared in `moves[]`/`stays[]` that appears on no edge may still be a real
 * symbol: the directory graph cannot represent same-directory imports, so a real
 * symbol imported only within its own directory lands here exactly like a name that
 * is on no edge at all. Deliberately phrased as a FACT plus its limitation, never as
 * a check.
 */
const UNREFERENCED_SYMBOLS_NOTE =
  '「未被任何图边引用」不等于「不存在」：本字段的判定是集合运算——该名字是否出现在图中任一 internal 或 external 边的 importedNames 上。目录级图不表示同目录 import（见 proposedCut.assumptions 首条），因此一个只在自己所在目录内被 import 的真实符号同样会出现在这里。本字段只陈述「这些名字不在任何边的 importedNames 上」这一事实，是否真的存在由调用方判断，本实现不做该判断。';

/** Minimal internal-edge view the core works on (mirrors the prototype's `internalEdges`). */
interface GraphEdge {
  from: string;
  to: string;
  valueStrength: number | null;
  typeOnlyStrength: number | null;
  importedNames: string[];
}

function notEvaluated(reason: string): SliceDeltaNotEvaluatedReport {
  return { status: 'not-evaluated', reason };
}

const edgeKeyOf = (from: string, to: string): string => `${from} -> ${to}`;

/**
 * Tarjan: all strongly-connected components of size > 1.
 * Deterministic: members sorted within a component, components sorted among each
 * other, so the same input yields a byte-identical result across runs.
 */
function sccsOf(internalDirs: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const idxOf = new Map(internalDirs.map((d, i) => [d, i]));
  const adj: number[][] = internalDirs.map(() => []);
  for (const e of edges) {
    const a = idxOf.get(e.from);
    const b = idxOf.get(e.to);
    if (a === undefined || b === undefined) continue;
    adj[a].push(b);
  }
  const index = new Array<number>(internalDirs.length).fill(-1);
  const low = new Array<number>(internalDirs.length).fill(0);
  const onStack = new Array<boolean>(internalDirs.length).fill(false);
  const stack: number[] = [];
  const out: string[][] = [];
  let counter = 0;
  const walk = (v: number): void => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adj[v]) {
      if (index[w] === -1) {
        walk(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const comp: number[] = [];
      let w: number;
      do {
        w = stack.pop();
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.map((i) => internalDirs[i]));
    }
  };
  for (let v = 0; v < internalDirs.length; v++) if (index[v] === -1) walk(v);
  return out
    .map((c) => [...c].sort())
    .sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1));
}

function canon(sccs: string[][]): string {
  return JSON.stringify(
    sccs.map((c) => [...c].sort()).sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1))
  );
}

const sameSet = (a: string[], b: string[]): boolean => canon([a]) === canon([b]);

function inSources(dir: string, edges: Array<{ from: string; to: string }>): string[] {
  return [...new Set(edges.filter((e) => e.to === dir).map((e) => e.from))].sort();
}

/**
 * A declaration may name the subject by directory node id OR by a file path
 * (e.g. `modules/settings/hooks/useMcpNavigationSettings.ts`). Normalize the
 * latter to its containing internal directory — the LONGEST internal dir that is
 * a path prefix. A path that matches no internal dir yields `null` (the caller
 * reports `not-evaluated`); it is never silently emptied to the root.
 */
function normalizeSubjectDir(
  raw: string,
  internalDirs: string[],
  internalSet: Set<string>
): string | null {
  if (internalSet.has(raw)) return raw;
  if (typeof raw !== 'string' || raw.length === 0 || !raw.includes('/')) return null;
  const norm = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  let best: string | null = null;
  for (const d of internalDirs) {
    if (d === '') continue;
    if ((norm === d || norm.startsWith(`${d}/`)) && (best === null || d.length > best.length)) {
      best = d;
    }
  }
  return best;
}

/** `unevaluatedDynamicImports` is documented as a number; tolerate an array / absent. */
function dynamicImportCount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (Array.isArray(raw)) return raw.length;
  return 0;
}

/**
 * The pure entry point. Never throws a business exception — insufficient signal
 * yields `{ status: 'not-evaluated', reason }` with no partial delta.
 */
export function simulateRefactorSlice(input: SimulateRefactorSliceInput): SliceDeltaReport {
  const graph: TsModuleGraph | undefined = input?.graph;
  const slice: RefactorSliceDeclaration = input?.slice;
  const observed: Record<string, unknown> | null = input?.observed ?? null;

  // ── Graph ────────────────────────────────────────────────────────────────
  if (
    !graph ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.cycles)
  ) {
    return notEvaluated(
      'graph 输入缺少 extensions.tsAnalysis.moduleGraph（nodes/edges/cycles 不全）'
    );
  }

  const internalDirs = graph.nodes.filter((n) => n.type === 'internal').map((n) => n.id);
  const internalSet = new Set(internalDirs);
  if (internalSet.size === 0) {
    return notEvaluated('moduleGraph 里没有 internal 目录节点，没有可评估的内容');
  }

  const internalEdges: GraphEdge[] = graph.edges
    .filter((e) => internalSet.has(e.from) && internalSet.has(e.to))
    .map((e: TsModuleDependency) => ({
      from: e.from,
      to: e.to,
      valueStrength: e.valueStrength ?? null,
      typeOnlyStrength: e.typeOnlyStrength ?? null,
      importedNames: Array.isArray(e.importedNames) ? e.importedNames : [],
    }));

  // ── Self-check: recomputed SCCs must equal moduleGraph.cycles ─────────────
  // An empty `cycles` array is legal (acyclic graph) — it is not a failure.
  const recomputed = sccsOf(internalDirs, internalEdges);
  const selfReported = (Array.isArray(graph.cycles) ? graph.cycles : []).map((c) =>
    Array.isArray(c) ? c : ((c as { modules?: string[] }).modules ?? [])
  );
  if (canon(recomputed) !== canon(selfReported)) {
    return notEvaluated(
      `自校验失败：按 moduleGraph.edges 重算的 SCC 与 moduleGraph.cycles 不一致，这张图上的模拟不可信 —— 重算=${canon(recomputed)} 自报=${canon(selfReported)}`
    );
  }

  // ── The subject's cycle ──────────────────────────────────────────────────
  // The subject may be a directory node id OR a file path (normalized to its
  // containing internal dir). A value that resolves to neither is a hard
  // not-evaluated — never silently emptied to the root.
  const rawSubject = slice?.subject ?? '';
  const subject = normalizeSubjectDir(rawSubject, internalDirs, internalSet);
  if (subject === null) {
    return notEvaluated(
      `slice.subject=${JSON.stringify(rawSubject)} 不是本图的 internal 目录节点，也不是能归一到某个 internal 目录的文件路径（不静默取空）`
    );
  }
  const beforeScc = (recomputed.find((c) => c.includes(subject)) ?? [subject]).slice().sort();

  // ── Cut: moves (file relocation intent + symbol names; no edge-level command) ─
  const moves: SliceMove[] = slice?.proposedCut?.moves ?? [];
  if (!Array.isArray(moves) || moves.length === 0) {
    return notEvaluated('slice.proposedCut.moves 为空：没有切法就没有 delta 可算');
  }

  // ── proposedCut.newDirs (NEW): "this destination dir is NEWLY CREATED" ──────
  // This is a DECLARATION, not a fallback. A directory named here is allowed as a
  // move's `to` even though it is absent from the graph. Nothing else treats an
  // absent dir as new: an undeclared non-internal `to` still fails closed below.
  const rawNewDirs = slice?.proposedCut?.newDirs;
  if (rawNewDirs !== undefined && !Array.isArray(rawNewDirs)) {
    return notEvaluated('slice.proposedCut.newDirs 不是数组');
  }
  const declaredNewDirs: string[] = Array.isArray(rawNewDirs) ? rawNewDirs : [];
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));
  const newDirSet = new Set<string>();
  for (const d of declaredNewDirs) {
    if (typeof d !== 'string' || d.length === 0) {
      return notEvaluated(
        `proposedCut.newDirs 里有非字符串/空项（${JSON.stringify(d)}）：新目录必须是非空目录 id`
      );
    }
    if (allNodeIds.has(d)) {
      // Declaring an existing graph node "new" is a contradiction — and the one
      // thing that could smuggle a fabricated node in. Never silently ignore it.
      return notEvaluated(
        `proposedCut.newDirs 声明 ${JSON.stringify(d)} 为新目录，但它已是本图的目录节点：不能把已有目录声明为新建（「声明」与「猜」必须分开）`
      );
    }
    newDirSet.add(d);
  }

  for (const m of moves) {
    if (!internalSet.has(m.from)) {
      return notEvaluated(
        `move ${m.file ?? '?'} 的 from=${JSON.stringify(m.from)} 不是本图的 internal 目录节点`
      );
    }
    if (!internalSet.has(m.to) && !newDirSet.has(m.to)) {
      // Fail-closed, but ACTIONABLE: name the legal internal targets AND the two
      // possible fixes (change the target, or declare it new). This is the split
      // between "guessed" and "declared".
      const validDirs = [...internalDirs]
        .sort()
        .map((x) => JSON.stringify(x))
        .join(', ');
      return notEvaluated(
        `move ${m.file ?? '?'} 的 to=${JSON.stringify(m.to)} 既不是本图的 internal 目录节点，也没有在 proposedCut.newDirs 里被显式声明为新目录。` +
          `合法目的地（本图的 internal 目录节点）：[${validDirs}]。` +
          `修复：要么把 to 改成本图已有的 internal 目录节点，要么在 proposedCut.newDirs 里显式声明 ${JSON.stringify(m.to)} 是一个新建目录（除本次搬入的符号外为空）。`
      );
    }
    if (!Array.isArray(m.symbols) || m.symbols.length === 0) {
      return notEvaluated(
        `move ${m.file ?? '?'} 没有声明 symbols：目录粒度上无法把它与任何一条边对账`
      );
    }
    if (m.from === m.to) {
      // `from === to` is not a move. It used to fall into the "mixed destinations"
      // branch and pointed the caller at the wrong fix; now it points at `stays`.
      return notEvaluated(
        `move ${m.file ?? '?'} 的 from === to（${JSON.stringify(m.from)}）：原地不动的符号要用 proposedCut.stays 显式声明，而不是 from === to 的 move`
      );
    }
  }

  const movesFrom = new Set(moves.map((m) => m.from));
  const movesTo = new Set(moves.map((m) => m.to));

  // New nodes actually materialized: declared-new dirs that a move targets. A
  // declared-but-unused newDir adds NOTHING to the graph (no fabricated node).
  const materializedNewDirs = [...newDirSet].filter((d) => movesTo.has(d)).sort();
  // The simulated graph's node set: real internal dirs + materialized new nodes.
  const afterNodes = [...internalDirs, ...materializedNewDirs];

  const symbolsOfDir = new Map<string, Set<string>>();
  for (const m of moves) {
    if (!symbolsOfDir.has(m.from)) symbolsOfDir.set(m.from, new Set());
    for (const s of m.symbols) symbolsOfDir.get(m.from).add(s);
  }

  const destOfSymbol = new Map<string, SliceMove>();
  for (const m of moves) {
    for (const s of m.symbols) {
      const existing = destOfSymbol.get(s);
      if (existing && existing.to !== m.to) {
        return notEvaluated(
          `符号 ${s} 被两处 move 搬向不同目录（${existing.to} 与 ${m.to}）：无法在目录粒度上对账`
        );
      }
      destOfSymbol.set(s, m);
    }
  }

  // ── stays (NEW): explicit "these names were inspected and stay put" ────────
  const stays: SliceStay[] = slice?.proposedCut?.stays ?? [];
  if (!Array.isArray(stays)) {
    return notEvaluated('slice.proposedCut.stays 不是数组');
  }
  const stayedSymbolDir = new Map<string, string>();
  for (const s of stays) {
    if (!internalSet.has(s?.dir)) {
      return notEvaluated(`stays 声明 ${JSON.stringify(s?.dir)} 不是本图的 internal 目录节点`);
    }
    if (!Array.isArray(s.symbols) || s.symbols.length === 0) {
      return notEvaluated(`stays 声明 ${JSON.stringify(s.dir)} 没有声明 symbols：无法对账`);
    }
    for (const sym of s.symbols) {
      const prev = stayedSymbolDir.get(sym);
      if (prev !== undefined && prev !== s.dir) {
        return notEvaluated(
          `符号 ${sym} 被两处 stays 声明留在不同目录（${prev} 与 ${s.dir}）：目的地冲突，无法对账`
        );
      }
      stayedSymbolDir.set(sym, s.dir);
    }
  }
  // A name cannot be declared to move AND to stay — that is two destinations.
  for (const [sym, dir] of stayedSymbolDir) {
    const m = destOfSymbol.get(sym);
    if (m) {
      return notEvaluated(
        `符号 ${sym} 既被 move 搬向 ${m.to} 又被 stays 声明留在 ${dir}：目的地冲突，无法对账`
      );
    }
  }

  // ── NEW fail-closed: an unresolved alias ref whose `from` participates ─────
  // `unresolved` means the edge is MISSING from the graph; if it touches the cut
  // (moved-from / a destination / the subject) the delta's edge SET itself is
  // incomplete, so no number may be emitted.
  const participating = new Set<string>([...movesFrom, ...movesTo, subject]);
  const unresolvedRefs = Array.isArray(graph.unresolved) ? graph.unresolved : [];
  const participatingUnresolved = unresolvedRefs.find((u) => participating.has(u?.from));
  if (participatingUnresolved) {
    return notEvaluated(
      `未解析别名 ref（from=${JSON.stringify(participatingUnresolved.from)} specifier=${JSON.stringify(participatingUnresolved.specifier)}）的 from 目录参与本次切法（moved-from / 目的地 / subject）：该边在图上缺失，delta 的边集合本身不完整，本实现不出数`
    );
  }

  // Dirs that structurally re-export from a moved-from dir — a barrel edge whose
  // extra coupling a directory graph cannot see (recorded as `unknown`, never
  // folded into a deterministic edge count).
  const reexportsFromMoved = new Set<string>();
  for (const e of internalEdges) if (movesFrom.has(e.to)) reexportsFromMoved.add(e.from);

  const assumptions = [
    '目录级图不表示同目录内的 import；搬迁后由「同目录 import 变成跨目录 import」产生的新边，图上结构性看不见，只能由 slice.proposedCut.consumers 显式声明（这类 added 边标 source=declared-consumer）。',
    'importedNames 是目录级边的名字集合，不携带「哪个名字来自哪个文件」的位置信息；因此只有当一个名字集合被某次 move 的 symbols 完整覆盖时才认为该边被这次搬迁解释。',
    '本实现只对账「进入 moved-from 目录的边」，以及「进入某个结构性 re-export from moved-from 目录的边」（reexportsFromMoved 命中的 barrel 边）。除这两类之外，任何一条边即使携带了与某次 move 的符号同名的名字，也不因名字撞上而被对账——目录级图无法证明两个同名符号是同一实体，这类边原样保留并在 unknowns.nameCollisionEdges 里点名，绝不静默删除。目录级边不带「由哪个文件产生」的信息，因此无法判断某条「从 moved-from 目录出发」的边是否随某个文件一并搬走——本实现的 sccAfter 是这条模拟规则下的读数，不是对真实重命名/搬壳操作的完整模拟（保留 façade 还是整体搬迁，需要调用方在切法里自行表达）。',
    // Appended only for a partial-migration declaration, so a plain cut's
    // `proposedCut` stays byte-identical to the pre-extension output.
    ...(stays.length > 0
      ? [
          'proposedCut.stays 是「这些名字我核对过、留在原目录」的显式声明，用于表达部分迁移；没有任何一条路径把「未声明的名字」默认成「留下」——未声明的名字仍然 not-evaluated。凡在 importedNames 里出现的已搬走名字，其所在目录边都会被对账（包括进入某个 re-export/barrel 目录、再转发该名字的边），因此 barrel 边上共同旅行的符号会被一并点名，而不是被静默略过。re-export/barrel 边在 accounting.certainty / unknowns.barrelEdges 里显式标为 unknown。',
        ]
      : []),
    // Appended only when a directory is EXPLICITLY declared new, so a cut without
    // `newDirs` keeps its `proposedCut` byte-identical.
    ...(materializedNewDirs.length > 0
      ? [
          `proposedCut.newDirs 显式声明的目录（[${materializedNewDirs.join(', ')}]）在模拟图里成为新节点：除本次切法搬入的符号外没有内容。它的入边只由本次切法产生（retarget 自被移除、且名字落在该新目录的边）；出边在目录级图上不可见，不作任何假设。该节点的 fileCount / stats 一律 unknown（null）——未查，不编造读数。缺一条显式声明时，指向本图不存在目录的 move 仍然 not-evaluated。`,
        ]
      : []),
  ];

  // ── Reconcile edges the directory graph STRUCTURALLY ties to the move ────────
  // An edge is reconciled ONLY when the graph structurally connects it to the cut:
  // its target IS a moved-from directory, or its target structurally re-exports from
  // one (a barrel edge — `reexportsFromMoved`, computed above). Selection among those
  // is by imported NAME (then each name's destination is decided). A same-NAME
  // collision alone is NOT evidence that two symbols are the same entity: an edge that
  // merely carries a moved name, without either structural tie, is left UNCHANGED and
  // recorded in `unknowns.nameCollisionEdges` — NEVER silently removed. An edge
  // importing ONLY declared-staying names is untouched by the cut and skipped.
  const removedEdges: SliceDeltaRemovedEdge[] = [];
  const addedCandidates: SliceDeltaAddedEdge[] = [];
  const affectedConsumers: SliceDeltaAffectedConsumer[] = [];
  const accounting: SliceDeltaAccountingEntry[] = [];
  const affectedDirs = new Set<string>();
  const nameCollisionEdges: string[] = [];
  let sawMultiDestination = false;
  let sawUnknown = false;
  // Iteration order: edges ENTERING a moved-from dir are reconciled first, then the
  // remaining in-scope edges touched by a moved name (a barrel/re-export edge that
  // forwards the name from another directory). This preserves the pre-extension
  // fail-closed reading EXACTLY for an undeclared input: the same first
  // coverage-shortfall edge (with the same name list) is reported.
  const orderedEdges = [
    ...internalEdges.filter((e) => movesFrom.has(e.to)),
    ...internalEdges.filter((e) => !movesFrom.has(e.to)),
  ];
  for (const e of orderedEdges) {
    const names = e.importedNames;
    if (names.length === 0) {
      // Preserved fail-closed: an edge ENTERING a moved-from dir must carry importedNames.
      if (movesFrom.has(e.to)) {
        return notEvaluated(
          `边 ${edgeKeyOf(e.from, e.to)} 进入被搬迁目录却没有 importedNames，目录粒度上无法对账这次搬迁`
        );
      }
      continue;
    }
    const affected = names.some((n) => destOfSymbol.has(n));
    if (!affected) continue; // nothing that moves appears on this edge
    const barrel = reexportsFromMoved.has(e.to);
    // Scope gate — a structural tie to a move is REQUIRED. `movesFrom.has(e.to)` is the
    // edge entering a moved-from dir; `barrel` is the structurally-proven re-export
    // case (its target imports from a moved-from dir). Any OTHER edge carrying a
    // colliding name is not reconciled: the directory graph cannot prove the name on it
    // is the moved entity, so the edge is kept as-is and the ambiguity is recorded.
    if (!movesFrom.has(e.to) && !barrel) {
      nameCollisionEdges.push(edgeKeyOf(e.from, e.to));
      continue;
    }
    const uncovered = names.filter((n) => !destOfSymbol.has(n) && !stayedSymbolDir.has(n));
    if (uncovered.length > 0) {
      return notEvaluated(
        `切法覆盖不足：边 ${edgeKeyOf(e.from, e.to)} 的 importedNames=[${names.join(', ')}] 中 [${uncovered.join(', ')}] 未被任何 move 的 symbols 覆盖 —— 目录粒度上无法判断这条边是否随搬迁消失，本实现不猜`
      );
    }
    const moving = names.filter((n) => destOfSymbol.has(n));
    const staying = names.filter((n) => stayedSymbolDir.has(n));
    const dests = [...new Set(moving.map((n) => destOfSymbol.get(n).to))];
    if (dests.length > 1) sawMultiDestination = true;
    if (barrel) sawUnknown = true;
    const edgeKeyStr = edgeKeyOf(e.from, e.to);
    affectedDirs.add(e.from);
    affectedDirs.add(e.to);
    const survives = staying.length > 0;
    accounting.push({
      edge: edgeKeyStr,
      names,
      moving: moving.map((n) => ({ name: n, to: destOfSymbol.get(n).to })),
      staying,
      unaccounted: [],
      destinations: dests,
      barrel,
      certainty: barrel ? 'unknown' : 'deterministic',
      ...(survives ? { survives: true, strength: null, note: SURVIVING_NOTE } : {}),
    });
    const certaintyExtra = barrel ? { certainty: 'unknown' as const } : {};
    const movedToDir = dests.join(', ');
    if (staying.length === 0) {
      const becomes =
        dests.length === 1
          ? e.from === dests[0]
            ? 'intra-directory'
            : `retargeted-to:${dests[0]}`
          : `retargeted-to:${movedToDir}`;
      removedEdges.push({
        from: e.from,
        to: e.to,
        valueStrength: e.valueStrength,
        typeOnlyStrength: e.typeOnlyStrength,
        importedNames: names,
        becomes,
        ...certaintyExtra,
      });
      for (const d of dests) {
        if (e.from !== d) {
          addedCandidates.push({
            from: e.from,
            to: d,
            source: 'retarget-from-removed-edge',
            ...certaintyExtra,
          });
        }
      }
      affectedConsumers.push({
        edge: edgeKeyStr,
        sourceDir: e.from,
        movedFromDir: e.to,
        movedToDir,
        importedNames: names,
        becomes,
        explainedBy: moving.map((n) => `${destOfSymbol.get(n).file ?? '?'}#${n}`),
      });
    } else {
      // A PARTIAL migration: some names move, some are explicitly declared staying.
      // The original edge A -> B SURVIVES (its staying names keep it) and each moved
      // name adds A -> D. Its strength increment is not computed (the directory graph
      // carries no symbol→file localization) — same honest labelling as strengthenedEdges.
      for (const d of dests) {
        if (e.from !== d) {
          addedCandidates.push({
            from: e.from,
            to: d,
            source: 'retarget-from-removed-edge',
            ...certaintyExtra,
          });
        }
      }
      affectedConsumers.push({
        edge: edgeKeyStr,
        sourceDir: e.from,
        movedFromDir: e.to,
        movedToDir,
        importedNames: names,
        becomes: 'survives',
        explainedBy: moving.map((n) => `${destOfSymbol.get(n).file ?? '?'}#${n}`),
      });
    }
  }

  // ── Declared consumers: reconcile with the graph; graph-invisible ones补成 added 边 ─
  const declaredConsumers: SliceDeltaDeclaredConsumer[] = [];
  for (const c of slice?.proposedCut?.consumers ?? []) {
    const imports = Array.isArray(c.imports) ? c.imports : [];
    if (!internalSet.has(c.dir)) {
      return notEvaluated(
        `声明消费者 ${c.file ?? '?'} 的 dir=${JSON.stringify(c.dir)} 不是本图的 internal 目录节点`
      );
    }
    const relevant = moves.filter((m) => imports.some((s) => m.symbols.includes(s)));
    if (relevant.length === 0) {
      return notEvaluated(
        `声明消费者 ${c.file ?? '?'} 的 imports=[${imports.join(', ')}] 与任何 move 的 symbols 都不相交：切法输入自相矛盾`
      );
    }
    const dests = [...new Set(relevant.map((m) => m.to))];
    if (dests.length > 1) {
      return notEvaluated(
        `声明消费者 ${c.file ?? '?'} 涉及的 move 指向不同目录（${dests.join(', ')}）：无法对账`
      );
    }
    const dest = dests[0];
    const visible = internalEdges.some(
      (e) =>
        e.from === c.dir &&
        symbolsOfDir.has(e.to) &&
        imports.some((s) => e.importedNames.includes(s))
    );
    if (visible) {
      declaredConsumers.push({ declared: c, status: 'graph-visible', movedToDir: dest });
    } else if (c.dir !== dest) {
      declaredConsumers.push({
        declared: c,
        status: 'intra-directory',
        movedToDir: dest,
        note: '该消费者在搬迁前与目标同目录（图上不可见）；按声明补一条跨目录 added 边',
      });
      addedCandidates.push({
        from: c.dir,
        to: dest,
        source: 'declared-consumer',
        via: c.file ?? null,
      });
    } else {
      declaredConsumers.push({
        declared: c,
        status: 'unverifiable',
        movedToDir: dest,
        note: '图上找不到对应边，且消费者与目的地同目录，本次搬迁不产生跨目录边',
      });
    }
  }

  // ── Apply the cut: after-edge set + recomputed SCCs ──────────────────────
  const removedKeys = new Set(removedEdges.map((e) => edgeKeyOf(e.from, e.to)));
  const afterEdges = internalEdges
    .filter((e) => !removedKeys.has(edgeKeyOf(e.from, e.to)))
    .map((e) => ({ from: e.from, to: e.to }));
  const afterKeys = new Set(afterEdges.map((e) => edgeKeyOf(e.from, e.to)));
  const beforeKeys = new Set(internalEdges.map((e) => edgeKeyOf(e.from, e.to)));

  const addedEdges: SliceDeltaAddedEdge[] = [];
  const strengthenedEdges: SliceDeltaStrengthenedEdge[] = [];
  const strengthenedKeys = new Set<string>();
  for (const a of addedCandidates) {
    const k = edgeKeyOf(a.from, a.to);
    if (afterKeys.has(k)) {
      // The edge already exists ⇒ it is not newly created by this cut. The prototype
      // silently dropped these; record them as strengthened rather than hide them.
      if (!strengthenedKeys.has(k)) {
        strengthenedKeys.add(k);
        strengthenedEdges.push({
          from: a.from,
          to: a.to,
          source: a.source,
          ...(a.via !== undefined ? { via: a.via } : {}),
          effect: 'strengthens-existing-edge',
          strength: null,
          note: STRENGTH_NOTE,
        });
      }
      continue;
    }
    afterKeys.add(k);
    addedEdges.push(a);
    afterEdges.push({ from: a.from, to: a.to });
  }

  // SCC over the simulated graph's node set (real dirs + declared-new nodes).
  const sccsAfter = sccsOf(afterNodes, afterEdges);
  const afterScc = (sccsAfter.find((c) => c.includes(subject)) ?? [subject]).slice().sort();
  const sccLeft = beforeScc.filter((m) => !afterScc.includes(m));

  // ── accounting / unknowns (NEW diagnostics; NEVER feed computedDelta) ─────
  // `accounting` is emitted only when this declaration exercises a partial-migration
  // feature, so a plain fully-covered cut keeps a report identical to the
  // pre-extension output. `unknowns` additionally carries the additive
  // `unreferencedSymbols` fact, so it is emitted whenever it has content —
  // including a plain cut that declares a name on no directory-level edge.
  const emitPartialDiagnostics =
    stays.length > 0 ||
    sawMultiDestination ||
    sawUnknown ||
    materializedNewDirs.length > 0 ||
    nameCollisionEdges.length > 0;
  const relatedDirs = new Set<string>([
    ...beforeScc,
    ...afterScc,
    ...affectedDirs,
    ...movesFrom,
    ...movesTo,
    subject,
  ]);
  // ── unreferencedSymbols (NEW, additive): a precise FACT, never a verdict ──────
  // Names declared in moves[].symbols / stays[].symbols that appear on NO edge's
  // importedNames. The reference set is EXACTLY the union of `importedNames` over
  // EVERY edge of the module graph — internal (dir→dir) AND external (dir→package):
  //
  //   referenced := ⋃ { e.importedNames : e ∈ graph.edges }
  //   unreferencedSymbols := declaredNames \ referenced          (sorted, non-empty only)
  //
  // It is a pure SET difference over the graph the tool actually has — never a
  // heuristic (e.g. "is it on a cross-directory edge?"), which is the coarser proxy
  // the downstream repair loop had to approximate with and that could not see the
  // external edges. What it excludes, deliberately: same-directory imports, which a
  // directory graph does not represent at all (assumptions[0]), and any edge whose
  // coupling the graph collapses — so this list is "not referenced by any
  // directory-level edge", NOT "does not exist". A real symbol imported only within
  // its own directory lands here exactly like a name that is on no edge at all.
  const referencedNames = new Set<string>();
  for (const e of graph.edges) {
    if (!Array.isArray(e.importedNames)) continue;
    for (const n of e.importedNames) referencedNames.add(n);
  }
  const declaredNames = [...new Set([...destOfSymbol.keys(), ...stayedSymbolDir.keys()])];
  const unreferencedSymbols = declaredNames
    .filter((n) => !referencedNames.has(n))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const unknowns: SliceDeltaUnknowns = {
    unresolvedAliasRefs: unresolvedRefs
      .filter((u) => relatedDirs.has(u.from))
      .map((u) => ({ from: u.from, specifier: u.specifier })),
    unevaluatedDynamicImports: dynamicImportCount(graph.unevaluatedDynamicImports),
    barrelEdges: accounting.filter((a) => a.barrel).map((a) => a.edge),
    // Present only when non-empty, so an unaffected legacy cut keeps byte-identical
    // diagnostics. These edges were KEPT (not removed) — the list is the honest出口
    // for the name-collision limitation, not a delta input.
    ...(nameCollisionEdges.length > 0 ? { nameCollisionEdges } : {}),
    // Present only when non-empty. A precise fact plus its boundary note — NOT an
    // existence verdict (see UNREFERENCED_SYMBOLS_NOTE / the SliceDeltaUnknowns docs).
    ...(unreferencedSymbols.length > 0
      ? {
          unreferencedSymbols,
          unreferencedSymbolsNote: UNREFERENCED_SYMBOLS_NOTE,
        }
      : {}),
  };

  // ── must-not-change guards ───────────────────────────────────────────────
  const mustNotChange = slice?.mustNotChange ?? {};
  const violations: SliceDeltaViolation[] = [];
  for (const f of mustNotChange.forbiddenNewEdges ?? []) {
    const k = edgeKeyOf(f.from, f.to);
    if (afterKeys.has(k) && !beforeKeys.has(k)) {
      violations.push({ kind: 'forbidden-new-edge', edge: k });
    }
  }
  for (const d of mustNotChange.untouchedDirs ?? []) {
    const touched = [
      ...removedEdges.map((e) => edgeKeyOf(e.from, e.to)),
      ...addedEdges.map((a) => edgeKeyOf(a.from, a.to)),
      ...strengthenedEdges.map((s) => edgeKeyOf(s.from, s.to)),
    ].filter((k) => k.startsWith(`${d} -> `) || k.endsWith(` -> ${d}`));
    if (touched.length) violations.push({ kind: 'untouched-dir-changed', dir: d, edges: touched });
  }

  // ── negative control: restoring the declared edges must restore before-SCC membership ─
  const restoreEdges: SliceEdge[] = slice?.negativeControl?.restoreEdges ?? [];
  if (!Array.isArray(restoreEdges) || restoreEdges.length === 0) {
    return notEvaluated(
      '缺少 negative control（slice.negativeControl.restoreEdges 为空）：无法证伪的预期 delta 不出结论'
    );
  }
  const restoredEdges = afterEdges.map((e) => ({ from: e.from, to: e.to }));
  const restoredKeys = new Set(restoredEdges.map((e) => edgeKeyOf(e.from, e.to)));
  for (const r of restoreEdges) {
    if (!internalSet.has(r.from) || !internalSet.has(r.to)) {
      return notEvaluated(
        `negative control 的恢复边 ${r.from} -> ${r.to} 不是本图的 internal 目录节点`
      );
    }
    const k = edgeKeyOf(r.from, r.to);
    if (!restoredKeys.has(k)) {
      restoredKeys.add(k);
      restoredEdges.push({ from: r.from, to: r.to });
    }
  }
  const restoredScc = (
    sccsOf(afterNodes, restoredEdges).find((c) => c.includes(subject)) ?? [subject]
  )
    .slice()
    .sort();
  const restoresBeforeMembership = sameSet(restoredScc, beforeScc);
  const subjectBackInScc = restoredScc.length > 1 && restoresBeforeMembership;

  // The criterion is relative to the before-SCC and the dirs that LEFT it — never
  // "subject sits in some size>1 cycle" (that would be trivially satisfied by an
  // unrelated edge and would call a vacuous control falsifiable).
  const falsified = sccLeft.length > 0 && restoresBeforeMembership;
  const negativeControlReason = falsified
    ? null
    : sccLeft.length === 0
      ? '切法没有改变 subject 所在的环（sccLeft 为空）：负对照没有可证伪的内容'
      : !restoresBeforeMembership
        ? `恢复声明的边后 subject 的环成员集合没有回到 before（before=[${beforeScc.join(', ')}] 恢复后=[${restoredScc.join(', ')}]）：负对照不可证伪`
        : '负对照不可证伪';

  const negativeControl: SliceDeltaNegativeControl = {
    description: slice?.negativeControl?.description ?? null,
    restoreEdges,
    beforeSccMembers: beforeScc,
    afterSccMembers: afterScc,
    subjectSccMembersAfterRestore: restoredScc,
    subjectBackInScc,
    restoresBeforeMembership,
    falsified,
    reason: negativeControlReason,
  };

  // ── whyLeft: why each departed dir left (recomputed reachability, not copied text) ─
  const sccOfDirAfter = (dir: string): string[] => sccsAfter.find((c) => c.includes(dir)) ?? [dir];
  const whyLeft: SliceDeltaWhyLeft[] = sccLeft.map((m) => {
    const before = inSources(m, internalEdges);
    const after = inSources(m, afterEdges);
    const nowIn = sccOfDirAfter(m);
    return {
      dir: m,
      inEdgeSourcesBefore: before,
      inEdgeSourcesAfter: after,
      inCycleAfter: nowIn.length > 1,
      reason:
        nowIn.length > 1
          ? `切法后仍在一个 size=${nowIn.length} 的环 [${nowIn.join(', ')}] 里——它离开的是 subject 所在的环，不是所有环`
          : `切法后不再处于任何环：其入边来源 [${after.join(', ') || '（无）'}] 全部落在 subject 的剩余环之外，因此无法经它们回到 subject`,
    };
  });

  // ── Report: computedDelta / negativeControl are complete before declared/observed are read ─
  const guardsClean = violations.length === 0 && negativeControl.falsified === true;

  const relation = (
    sizeMatches: boolean | null,
    membersMatch: boolean | null
  ): 'agrees' | 'diverges' | 'size-agrees-members-unknown' | 'incomparable' => {
    if (sizeMatches === false || membersMatch === false) return 'diverges';
    if (sizeMatches === true && membersMatch === true) return 'agrees';
    if (sizeMatches === true && membersMatch === null) return 'size-agrees-members-unknown';
    return 'incomparable';
  };

  const declaredPrediction = slice?.declaredPrediction ?? null;

  // ── syntheticNodes (NEW): the declared-new nodes' report (counts unknown) ──
  // Emitted only when a declaration actually materialized a new node, so a plain
  // cut's computedDelta keeps its exact key set (byte-identical output).
  const syntheticNodes: SliceDeltaSyntheticNode[] = materializedNewDirs.map((id) => ({
    id,
    fileCount: null,
    stats: null,
    inboundEdges: afterEdges
      .filter((e) => e.to === id)
      .map((e) => edgeKeyOf(e.from, e.to))
      .sort(),
    note: SYNTHETIC_NODE_NOTE,
  }));

  const computedDelta: SliceDeltaComputed = {
    inputsUsed: [...COMPUTED_INPUTS_USED],
    removedEdges,
    addedEdges,
    strengthenedEdges,
    ...(syntheticNodes.length > 0 ? { syntheticNodes } : {}),
    sccBefore: beforeScc,
    sccAfter: afterScc,
    sccLeft,
    sccRemaining: afterScc,
    subjectFanInAfter: inSources(subject, afterEdges).length,
    whyLeft,
  };

  const report: SliceDeltaEvaluatedReport = {
    status: 'evaluated',
    subject,
    concern: slice?.concern ?? null,
    provenance: input?.provenance ?? null,
    current: {
      sccMembers: beforeScc,
      sccSize: beforeScc.length,
      subjectFanIn: inSources(subject, internalEdges).length,
      relevantEdges: removedEdges.map((e) => ({
        from: e.from,
        to: e.to,
        importedNames: e.importedNames,
      })),
    },
    proposedCut: {
      moves,
      ...(stays.length > 0 ? { stays } : {}),
      ...(declaredNewDirs.length > 0 ? { newDirs: declaredNewDirs } : {}),
      declaredConsumerCount: (slice?.proposedCut?.consumers ?? []).length,
      assumptions,
    },
    affectedConsumers,
    declaredConsumers,
    ...(emitPartialDiagnostics ? { accounting } : {}),
    ...(emitPartialDiagnostics || unreferencedSymbols.length > 0 ? { unknowns } : {}),
    computedDelta,
    mustNotChange: {
      forbiddenNewEdges: mustNotChange.forbiddenNewEdges ?? [],
      untouchedDirs: mustNotChange.untouchedDirs ?? [],
      violations,
    },
    negativeControl,
    guards: {
      clean: guardsClean,
      violations: violations.length,
      negativeControlFalsified: negativeControl.falsified,
    },
    declaredPrediction,
    observedDelta: observed,
    predictionComparison: {
      declaredVsComputed: declaredPrediction
        ? (() => {
            const sizeMatches = declaredPrediction.sccSize === afterScc.length;
            const membersMatch = Array.isArray(declaredPrediction.sccMembers)
              ? sameSet(declaredPrediction.sccMembers, afterScc)
              : null;
            return {
              relation: relation(sizeMatches, membersMatch),
              declaredSccSize: declaredPrediction.sccSize ?? null,
              computedSccSize: afterScc.length,
              sizeMatches,
              membersMatch,
            };
          })()
        : null,
      observedVsComputed: observed
        ? (() => {
            const observedSize = observed['sccSize'];
            const observedMembers = observed['sccMembers'];
            const sizeMatches = observedSize === afterScc.length;
            const membersMatch = Array.isArray(observedMembers)
              ? sameSet(observedMembers as string[], afterScc)
              : null;
            return {
              relation: relation(sizeMatches, membersMatch),
              observedSccSize: (observedSize as number | undefined) ?? null,
              computedSccSize: afterScc.length,
              sizeMatches,
              membersMatch,
            };
          })()
        : null,
    },
  };

  return report;
}

// ── Slice preflight (discovery vocabulary, never an evaluation) ──────────────

/** Fixed rule text shared by the report and the MCP adapter. */
const NEW_DIR_RULE =
  '图中不存在的目录只有在 proposedCut.newDirs 里显式声明后才可作为 move.to；声明会把它作为新节点加入模拟图（其 fileCount / stats 一律 unknown，即 null）。未声明的缺失目的地仍然 not-evaluated。已存在的节点不能声明为新建。';

/**
 * Enumerate the declarations a caller may legally write for `subject` — the step
 * BEFORE `simulateRefactorSlice`. Pure: reads only the graph, invents no slice.
 *
 * Two move-source relationships are derived from the subject's edges:
 *   - `subject-exports`: incoming edges (`X -> subject`) carry the names other dirs
 *     import from the subject. A move of one of those names has `from = subject`.
 *   - `subject-imports`: outgoing edges (`subject -> N`) carry names the subject
 *     imports from N. Moving one of them has `from = N`, NOT the subject — this is
 *     the shape of the real claudecodeui cut (subject `modules/settings`, source
 *     `modules/settings/hooks`).
 *
 * For each source it reports every edge a move would reconcile (direct + barrel)
 * and the `stays` group needed to cover the names that do NOT move. Candidate
 * destinations are classified into internal / requires-newDirs / unusable, so a
 * `MOVE_TO_NOT_AN_INTERNAL_DIR` never has to be discovered by tripping it.
 *
 * It never emits `pass` / `fail` / an exit code: a preflight is vocabulary, not a gate.
 */
export function preflightSlice(input: SlicePreflightInput): SlicePreflightReport {
  const graph: TsModuleGraph | undefined = input?.graph;
  const rawSubject = input?.subject ?? '';

  if (
    !graph ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.cycles)
  ) {
    return {
      status: 'not-evaluated',
      reason: 'graph 输入缺少 extensions.tsAnalysis.moduleGraph（nodes/edges/cycles 不全）',
    };
  }

  const internalDirs = graph.nodes
    .filter((n) => n.type === 'internal')
    .map((n) => n.id)
    .sort();
  const internalSet = new Set(internalDirs);
  if (internalSet.size === 0) {
    return {
      status: 'not-evaluated',
      reason: 'moduleGraph 里没有 internal 目录节点，没有可评估的内容',
    };
  }

  const internalEdges: GraphEdge[] = graph.edges
    .filter((e) => internalSet.has(e.from) && internalSet.has(e.to))
    .map((e: TsModuleDependency) => ({
      from: e.from,
      to: e.to,
      valueStrength: e.valueStrength ?? null,
      typeOnlyStrength: e.typeOnlyStrength ?? null,
      importedNames: Array.isArray(e.importedNames) ? e.importedNames : [],
    }));

  // Same self-check as the evaluator: a graph whose reported cycles do not match
  // its edges cannot justify a declaration either.
  const recomputed = sccsOf(internalDirs, internalEdges);
  const selfReported = (Array.isArray(graph.cycles) ? graph.cycles : []).map((c) =>
    Array.isArray(c) ? c : ((c as { modules?: string[] }).modules ?? [])
  );
  if (canon(recomputed) !== canon(selfReported)) {
    return {
      status: 'not-evaluated',
      reason: `自校验失败：按 moduleGraph.edges 重算的 SCC 与 moduleGraph.cycles 不一致，这张图上的 preflight 不可信 —— 重算=${canon(recomputed)} 自报=${canon(selfReported)}`,
    };
  }

  const subject = normalizeSubjectDir(rawSubject, internalDirs, internalSet);
  if (subject === null) {
    return {
      status: 'not-evaluated',
      reason: `slice.subject=${JSON.stringify(rawSubject)} 不是本图的 internal 目录节点，也不是能归一到某个 internal 目录的文件路径（不静默取空）`,
    };
  }

  const beforeScc = (recomputed.find((c) => c.includes(subject)) ?? [subject]).slice().sort();
  const incoming = internalEdges.filter((e) => e.to === subject);
  const outgoing = internalEdges.filter((e) => e.from === subject);

  const unresolvedRefs = Array.isArray(graph.unresolved) ? graph.unresolved : [];
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));

  const blocking: SlicePreflightBlocking[] = [];
  const blockingSeen = new Set<string>();
  const addBlocking = (b: SlicePreflightBlocking): void => {
    const key = `${b.code}|${b.scope}`;
    if (blockingSeen.has(key)) return;
    blockingSeen.add(key);
    blocking.push(b);
  };

  // ── Classify caller-supplied candidate destinations ───────────────────────
  const rawDestinations = Array.isArray(input?.destinations) ? input.destinations : [];
  const destinations: SlicePreflightDestinationVerdict[] = [];
  const blockedDestDirs = new Set<string>();
  for (const raw of rawDestinations) {
    const dir = typeof raw === 'string' ? raw : String(raw);
    if (internalSet.has(dir)) {
      if (dir === subject) {
        destinations.push({
          dir,
          kind: 'subject-itself',
          legalAsMoveTarget: false,
          reason:
            '目的目录等于源目录：from === to 不是搬移，原地不动的符号要用 proposedCut.stays 显式声明',
        });
      } else {
        const refs = unresolvedRefs.filter((u) => u?.from === dir).map((u) => u.specifier);
        if (refs.length > 0) {
          blockedDestDirs.add(dir);
          addBlocking({
            code: 'DESTINATION_UNRESOLVED_ALIAS',
            scope: dir,
            reason: `目的地 ${dir} 有未解析别名 ref（[${refs.join(', ')}]）：该目录参与切法时图上边集合不完整，切法会 not-evaluated`,
            fix: '先解析这些别名（修 tsconfig paths / 重新 analyze），或换一个目的地',
          });
        }
        destinations.push({
          dir,
          kind: 'internal',
          legalAsMoveTarget: refs.length === 0,
          reason:
            refs.length === 0
              ? '本图已有的 internal 目录节点：可直接作为 move.to'
              : '本图 internal 目录，但其自身的未解析别名 ref 会让以它为参与者的切法 not-evaluated',
          ...(refs.length > 0 ? { blocking: refs } : {}),
        });
      }
    } else if (allNodeIds.has(dir)) {
      addBlocking({
        code: 'DESTINATION_EXISTS_NOT_INTERNAL',
        scope: dir,
        reason: `${dir} 是本图已有节点但不是 internal 目录：既不能作为 move.to，也不能写入 proposedCut.newDirs（把已有节点声明为新建会被拒绝）`,
        fix: '改用一个 internal 目录，或使用图中不存在的目录名并写入 proposedCut.newDirs',
      });
      destinations.push({
        dir,
        kind: 'not-an-internal-node',
        legalAsMoveTarget: false,
        reason: '本图已有但不是 internal 目录节点：不能作为 move.to，也不能声明为新建',
      });
    } else {
      destinations.push({
        dir,
        kind: 'requires-new-dir',
        legalAsMoveTarget: true,
        reason:
          '图中不存在该目录：可作为 move.to，但必须在 proposedCut.newDirs 里显式声明为新建；未声明仍然 not-evaluated',
        declaration: { newDirs: [dir] },
      });
    }
  }
  const newDirDestinations = destinations.flatMap((d) =>
    d.kind === 'requires-new-dir' && d.declaration
      ? [{ dir: d.dir, declaration: d.declaration }]
      : []
  );

  // ── Move sources: the subject itself + each internal out-neighbour ────────
  interface SourceSpec {
    from: string;
    relationship: 'subject-exports' | 'subject-imports';
    via: string[];
  }
  const sourceSpecs: SourceSpec[] = [];
  const sourceByDir = new Map<string, SourceSpec>();
  const addSource = (spec: SourceSpec): void => {
    const existing = sourceByDir.get(spec.from);
    if (existing) {
      for (const v of spec.via) if (!existing.via.includes(v)) existing.via.push(v);
      return;
    }
    sourceByDir.set(spec.from, spec);
    sourceSpecs.push(spec);
  };
  addSource({
    from: subject,
    relationship: 'subject-exports',
    via: incoming.map((e) => edgeKeyOf(e.from, e.to)).sort(),
  });
  for (const e of outgoing) {
    if (e.to === subject) continue; // a self-loop is not a second source
    addSource({ from: e.to, relationship: 'subject-imports', via: [edgeKeyOf(e.from, e.to)] });
  }
  sourceSpecs.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const moveGroups: SlicePreflightMoveGroup[] = [];
  const stayGroups: SlicePreflightStayGroup[] = [];
  const obligations: SlicePreflightEdgeObligation[] = [];

  for (const spec of sourceSpecs) {
    const incomingToSource = internalEdges.filter((e) => e.to === spec.from);

    // Names the caller could plausibly move OUT of this source, evidenced by edges:
    //   - subject-exports: every name on an incoming edge (the subject's consumers);
    //   - subject-imports: the names the subject itself imports from the source.
    const candidateNames: string[] = [];
    if (spec.relationship === 'subject-exports') {
      for (const e of incomingToSource) for (const n of e.importedNames) candidateNames.push(n);
    } else {
      for (const e of outgoing) {
        if (e.to !== spec.from) continue;
        for (const n of e.importedNames) candidateNames.push(n);
      }
    }
    const uniqueNames = [...new Set(candidateNames)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (uniqueNames.length === 0) continue; // nothing evidenced to move from here
    const candidateSet = new Set(uniqueNames);

    // Source-level fail-closed conditions: these make EVERY move from here fail.
    const blockedBy: string[] = [];
    const refsFromSource = unresolvedRefs.filter((u) => u?.from === spec.from);
    if (refsFromSource.length > 0) {
      const specs = refsFromSource.map((u) => u.specifier);
      addBlocking({
        code: 'UNRESOLVED_ALIAS_FROM_SOURCE',
        scope: spec.from,
        reason: `源目录 ${spec.from} 有未解析别名 ref（[${specs.join(', ')}]）：任何以它为 move.from 的切法都会 not-evaluated`,
        fix: '先解析这些别名（修 tsconfig paths / 重新 analyze），或换一个 move 源',
      });
      blockedBy.push('UNRESOLVED_ALIAS_FROM_SOURCE');
    }
    const namelessEdges = incomingToSource.filter((e) => e.importedNames.length === 0);
    if (namelessEdges.length > 0) {
      for (const e of namelessEdges) {
        addBlocking({
          code: 'INCOMING_EDGE_WITHOUT_NAMES',
          scope: spec.from,
          reason: `边 ${edgeKeyOf(e.from, e.to)} 进入源目录 ${spec.from} 却没有 importedNames：任何从该目录搬走符号的切法都无法对账`,
          fix: '重新 analyze 以补齐 importedNames，或不要从该目录搬走符号',
        });
      }
      blockedBy.push('INCOMING_EDGE_WITHOUT_NAMES');
    }
    const legal = blockedBy.length === 0;

    // Every edge a move from this source would reconcile: direct incoming edges
    // carrying a candidate name, plus barrel edges (edges into a dir that
    // structurally re-exports from this source) carrying one.
    const barrelDirs = new Set(internalEdges.filter((e) => e.to === spec.from).map((e) => e.from));
    const localObligations: SlicePreflightEdgeObligation[] = [];
    for (const e of incomingToSource) {
      if (e.importedNames.length === 0) continue;
      if (!e.importedNames.some((n) => candidateSet.has(n))) continue;
      localObligations.push({
        forSource: spec.from,
        edge: edgeKeyOf(e.from, e.to),
        kind: 'incoming',
        from: e.from,
        to: e.to,
        importedNames: e.importedNames,
        reason: `进入源目录 ${spec.from} 的边：从该目录搬走符号会把它 retarget 到目的地`,
      });
    }
    for (const e of internalEdges) {
      if (e.to === spec.from) continue; // direct incoming handled above
      if (!barrelDirs.has(e.to)) continue;
      if (e.importedNames.length === 0) continue;
      if (!e.importedNames.some((n) => candidateSet.has(n))) continue;
      localObligations.push({
        forSource: spec.from,
        edge: edgeKeyOf(e.from, e.to),
        kind: 'barrel',
        from: e.from,
        to: e.to,
        importedNames: e.importedNames,
        reason: `barrel/re-export 边：${e.to} 结构性 re-export 自 ${spec.from}，从该目录搬走符号时这条边也会被对账（certainty=unknown）`,
      });
    }
    localObligations.sort((a, b) => (a.edge < b.edge ? -1 : a.edge > b.edge ? 1 : 0));
    obligations.push(...localObligations);

    for (const o of localObligations) {
      stayGroups.push({
        dir: o.to,
        symbols: o.importedNames,
        edge: o.edge,
        forSource: spec.from,
        reason:
          o.kind === 'incoming'
            ? `若只搬走这条边 importedNames 的一部分，其余名字必须写进 proposedCut.stays[dir=${JSON.stringify(o.to)}]；未声明的名字不会被默认留下，全部搬走则不需要`
            : `这条 barrel 边只要有一个被搬走的符号出现就会被对账，它的全部 importedNames 都必须被 move 或 stays 覆盖`,
      });
    }

    const legalInternalTargets = legal
      ? internalDirs.filter((d) => d !== spec.from && !blockedDestDirs.has(d)).sort()
      : [];

    const symbols: SlicePreflightSymbolMove[] = uniqueNames.map((symbol) => {
      const carriedBy = incomingToSource
        .filter((e) => e.importedNames.includes(symbol))
        .map((e) => edgeKeyOf(e.from, e.to))
        .sort();
      return {
        symbol,
        destinations: legalInternalTargets,
        newDirDestinations: legal ? newDirDestinations : [],
        carriedBy,
        reason:
          spec.relationship === 'subject-exports'
            ? `该名字被其他目录从 ${JSON.stringify(spec.from)} import（边 [${carriedBy.join(', ')}]）；move.from 必须是 ${JSON.stringify(spec.from)}`
            : `subject 的出边 [${spec.via.join(', ')}] 显示该名字属于 ${JSON.stringify(spec.from)}，不是 ${JSON.stringify(subject)}；要搬它，move.from 必须是 ${JSON.stringify(spec.from)}`,
      };
    });

    moveGroups.push({
      from: spec.from,
      relationship: spec.relationship,
      via: spec.via.slice().sort(),
      legal,
      blockedBy,
      symbols,
      reason:
        spec.relationship === 'subject-exports'
          ? `subject 自身导出、被外部消费的符号：来自它的 ${incomingToSource.length} 条入边`
          : `subject 的出边把该源目录的名字带入 subject：这些名字属于 ${JSON.stringify(spec.from)}，搬家时 move.from 是它而不是 subject`,
    });
  }

  const namedSources = sourceSpecs.map((s) => JSON.stringify(s.from)).join(', ');

  const nextSteps: string[] = [
    `1. 选择 move 的源目录：declarations.moves[].from（候选：${namedSources}）。move.from 必须精确等于它——把 subject 出边的名字搬走时，from 是对端目录，不是 ${JSON.stringify(subject)}。`,
    '2. 为每个要搬走的符号选一个目的地：本图 internal 目录见 legalDestinations.internal（源目录自身除外）；图中不存在的目录必须先写进 proposedCut.newDirs（每条的 declaration 已给出）。同一个符号只能有一个目的地。',
    '3. 声明 move：{ from: <源目录>, to: <目的地>, symbols: [<符号>] }（可带 file / note）。',
    '4. 对 edges[] 里属于该源的每条边，把不搬走的名字写进 proposedCut.stays[{ dir: <edge.to>, symbols: [...] }]；被搬走的名字不能再出现在 stays 里。',
    '5. 提供 negativeControl.restoreEdges（至少一条、两端都是 internal 目录）：空数组恒为 not-evaluated。',
    '6. 用 archguard_simulate_refactor_slice 复跑；期望 status="evaluated"（guards.clean 另论，不是 preflight 的判据）。',
  ];

  const notes: string[] = [
    '本 preflight 只枚举有图上证据的 move：subject 的入边给出它被外部消费的符号，出边给出它从邻居 import 的符号。它不发明切法、不排序、不判定好坏。',
    '只有「进入 moved-from 目录」的边、以及「进入某个结构性 re-export 该目录的目录」的边会被 reconcile；出边本身不会因搬走 subject 的符号而被 retarget。',
    '每条被 reconcile 的边，其 importedNames 必须 100% 被 move 或 stays 覆盖——少一个名字就是 not-evaluated。stays 是声明，不是默认值。',
    NEW_DIR_RULE,
    '同一个符号不能既被 move 又出现在 stays 里，也不能被两处 move 搬向不同目的地。',
    '本报告不含 pass / fail / exitCode：preflight 只给词汇表，判定留给 archguard_simulate_refactor_slice。',
  ];
  if (rawSubject !== subject) {
    notes.push(
      `subject 输入 ${JSON.stringify(rawSubject)} 已归一化为 internal 目录 ${JSON.stringify(subject)}。`
    );
  }
  if (incoming.length === 0) {
    notes.push(
      `subject ${JSON.stringify(subject)} 没有进入边：图上没有它被其他目录消费的符号，从 subject 自身的 move 没有可对账的边。`
    );
  }
  if (rawDestinations.length === 0) {
    notes.push(
      '未提供 destinations：legalDestinations.internal 列出所有 internal 目录；任何图中不存在的目录都可用 newDirs 规则声明。'
    );
  }

  const report: SlicePreflightEvaluatedReport = {
    status: 'preflight',
    subject,
    provenance: input?.provenance ?? null,
    current: {
      sccMembers: beforeScc,
      sccSize: beforeScc.length,
      subjectFanIn: inSources(subject, internalEdges).length,
      subjectFanOut: outgoing.length,
      internalDirCount: internalDirs.length,
    },
    outgoing: outgoing.map((e) => ({
      edge: edgeKeyOf(e.from, e.to),
      to: e.to,
      importedNames: e.importedNames,
      reason: `subject 从 ${JSON.stringify(e.to)} import 这些名字；它们不属于 subject，要把它们搬走时 move.from 必须是 ${JSON.stringify(e.to)}。`,
    })),
    declarations: {
      moves: moveGroups,
      stays: stayGroups,
      newDirs: {
        required: destinations.filter((d) => d.kind === 'requires-new-dir'),
        rule: NEW_DIR_RULE,
      },
    },
    destinations,
    legalDestinations: {
      internal: [...internalDirs],
      newDirRule: NEW_DIR_RULE,
    },
    edges: obligations,
    blocking,
    nextSteps,
    notes,
  };

  return report;
}

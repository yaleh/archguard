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
  SliceDeltaUnknowns,
  SliceDeltaViolation,
  SliceDeltaWhyLeft,
  SliceEdge,
  SliceMove,
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
  for (const m of moves) {
    if (!internalSet.has(m.from)) {
      return notEvaluated(
        `move ${m.file ?? '?'} 的 from=${JSON.stringify(m.from)} 不是本图的 internal 目录节点`
      );
    }
    if (!internalSet.has(m.to)) {
      return notEvaluated(
        `move ${m.file ?? '?'} 的 to=${JSON.stringify(m.to)} 不是本图的 internal 目录节点`
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
    '本实现只对账「进入 moved-from 目录的边」。目录级边不带「由哪个文件产生」的信息，因此无法判断某条「从 moved-from 目录出发」的边是否随某个文件一并搬走——本实现的 sccAfter 是这条模拟规则下的读数，不是对真实重命名/搬壳操作的完整模拟（保留 façade 还是整体搬迁，需要调用方在切法里自行表达）。',
    // Appended only for a partial-migration declaration, so a plain cut's
    // `proposedCut` stays byte-identical to the pre-extension output.
    ...(stays.length > 0
      ? [
          'proposedCut.stays 是「这些名字我核对过、留在原目录」的显式声明，用于表达部分迁移；没有任何一条路径把「未声明的名字」默认成「留下」——未声明的名字仍然 not-evaluated。凡在 importedNames 里出现的已搬走名字，其所在目录边都会被对账（包括进入某个 re-export/barrel 目录、再转发该名字的边），因此 barrel 边上共同旅行的符号会被一并点名，而不是被静默略过。re-export/barrel 边在 accounting.certainty / unknowns.barrelEdges 里显式标为 unknown。',
        ]
      : []),
  ];

  // ── Reconcile every edge touched by a moved symbol (set judgment on importedNames) ─
  // Selection is by imported NAME (then each name's destination is decided): any
  // edge carrying a moved name is accounted for, including a re-export/barrel edge
  // that forwards the name from a directory other than the moved-from dir. An edge
  // importing ONLY declared-staying names is untouched by the cut and skipped.
  const removedEdges: SliceDeltaRemovedEdge[] = [];
  const addedCandidates: SliceDeltaAddedEdge[] = [];
  const affectedConsumers: SliceDeltaAffectedConsumer[] = [];
  const accounting: SliceDeltaAccountingEntry[] = [];
  const affectedDirs = new Set<string>();
  let sawMultiDestination = false;
  let sawUnknown = false;
  // Iteration order: edges ENTERING a moved-from dir are reconciled first, then the
  // remaining edges touched by a moved name (e.g. a barrel/re-export edge that
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
    const uncovered = names.filter((n) => !destOfSymbol.has(n) && !stayedSymbolDir.has(n));
    if (uncovered.length > 0) {
      return notEvaluated(
        `切法覆盖不足：边 ${edgeKeyOf(e.from, e.to)} 的 importedNames=[${names.join(', ')}] 中 [${uncovered.join(', ')}] 未被任何 move 的 symbols 覆盖 —— 目录粒度上无法判断这条边是否随搬迁消失，本实现不猜`
      );
    }
    const moving = names.filter((n) => destOfSymbol.has(n));
    const staying = names.filter((n) => stayedSymbolDir.has(n));
    const dests = [...new Set(moving.map((n) => destOfSymbol.get(n).to))];
    const barrel = reexportsFromMoved.has(e.to);
    if (dests.length > 1) sawMultiDestination = true;
    if (barrel) sawUnknown = true;
    const edgeKeyStr = edgeKeyOf(e.from, e.to);
    affectedDirs.add(e.from);
    affectedDirs.add(e.to);
    accounting.push({
      edge: edgeKeyStr,
      names,
      moving: moving.map((n) => ({ name: n, to: destOfSymbol.get(n).to })),
      staying,
      unaccounted: [],
      destinations: dests,
      barrel,
      certainty: barrel ? 'unknown' : 'deterministic',
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

  const sccsAfter = sccsOf(internalDirs, afterEdges);
  const afterScc = (sccsAfter.find((c) => c.includes(subject)) ?? [subject]).slice().sort();
  const sccLeft = beforeScc.filter((m) => !afterScc.includes(m));

  // ── accounting / unknowns (NEW diagnostics; NEVER feed computedDelta) ─────
  // Emitted only when this declaration exercises a partial-migration feature, so a
  // plain fully-covered cut keeps a report identical to the pre-extension output.
  const emitPartialDiagnostics = stays.length > 0 || sawMultiDestination || sawUnknown;
  const relatedDirs = new Set<string>([
    ...beforeScc,
    ...afterScc,
    ...affectedDirs,
    ...movesFrom,
    ...movesTo,
    subject,
  ]);
  const unknowns: SliceDeltaUnknowns = {
    unresolvedAliasRefs: unresolvedRefs
      .filter((u) => relatedDirs.has(u.from))
      .map((u) => ({ from: u.from, specifier: u.specifier })),
    unevaluatedDynamicImports: dynamicImportCount(graph.unevaluatedDynamicImports),
    barrelEdges: accounting.filter((a) => a.barrel).map((a) => a.edge),
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
    sccsOf(internalDirs, restoredEdges).find((c) => c.includes(subject)) ?? [subject]
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

  const computedDelta: SliceDeltaComputed = {
    inputsUsed: [...COMPUTED_INPUTS_USED],
    removedEdges,
    addedEdges,
    strengthenedEdges,
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
      declaredConsumerCount: (slice?.proposedCut?.consumers ?? []).length,
      assumptions,
    },
    affectedConsumers,
    declaredConsumers,
    ...(emitPartialDiagnostics ? { accounting, unknowns } : {}),
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

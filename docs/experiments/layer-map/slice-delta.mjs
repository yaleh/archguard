#!/usr/bin/env node
// slice-delta.mjs — Refactor Slice / Expected Delta（确定性原型，不含 LLM）。
//
// 回答的问题只有一个：「**按这份显式给出的切法**动刀，这棵树的 architecture delta 会是什么？」
// 它**不**回答「该不该动这刀」——切法由外部输入提供，本脚本不发明方案、不排序、不建议。
//
// 用法:
//   node docs/experiments/layer-map/slice-delta.mjs <current.arch.json> --slice <slice.json>
//        [--observed <observed.json>] [--json <out.json>]
// 退出码: 0 = 已评估且护栏通过 | 1 = 已评估但护栏被触发 | 2 = 未评估
//
// 三层分区（与 docs/proposals/proposal-architecture-layer-check.md 一致）：
//   - 机械事实：本脚本只读 extensions.tsAnalysis.moduleGraph（nodes/edges/cycles/importedNames）
//   - declared rules：本脚本**不碰** check-layers.mjs / layers.yml，也不产出 pass/fail 这类裁决字段
//   - 语义判断：本脚本**一点都没有**——输出全是图上算出来的事实
//
// predicted / declared / observed 三个读数**物理分区**，互不回灌：
//   - computedDelta      = 只由 (moduleGraph, slice.proposedCut, slice.mustNotChange, slice.negativeControl) 算出
//   - declaredPrediction = slice 里人写的预测，原样搬运，只用于最后装配对比
//   - observedDelta      = 另一个 --observed 文件里的后验读数，只用于最后装配对比
// 装配顺序上，computedDelta 先算完，declared/observed 才被读进对比段——anti-stuffing 由
// tests/unit/architecture/slice-delta.test.ts 的「换掉 observed，computedDelta 逐字节不变」反向测试看住。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const USAGE = `用法: node docs/experiments/layer-map/slice-delta.mjs <current.arch.json> --slice <slice.json> [--observed <observed.json>] [--json <out.json>]
  <current.arch.json>  package 级 ArchJSON（消费 extensions.tsAnalysis.moduleGraph）
  --slice <file>       显式切法输入（subject/concern/proposedCut/mustNotChange/negativeControl/[declaredPrediction]）
  --observed <file>    可选的独立后验读数；只进对比段，不参与任何计算
  --json <file>        把结构化报告写到文件
退出码: 0 = 已评估且护栏通过 | 1 = 已评估但护栏被触发 | 2 = 未评估`;

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const jsonOut = flag('--json');
const slicePath = flag('--slice');
const observedPath = flag('--observed');
const [archPath] = args;

function finish(report, code) {
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(summaryText(report));
  process.exit(code);
}
function notEvaluated(reason, extra = {}) {
  return finish({ status: 'not-evaluated', reason, ...extra }, 2);
}
if (!archPath || !slicePath) finish({ status: 'not-evaluated', reason: `缺少参数`, usage: USAGE }, 2);

// ── 输入 ─────────────────────────────────────────────────────────────────
let arch, slice, observed = null;
try {
  arch = JSON.parse(fs.readFileSync(archPath, 'utf8'));
} catch (e) {
  notEvaluated(`读取 current ArchJSON 失败: ${e.message}`);
}
try {
  slice = JSON.parse(fs.readFileSync(slicePath, 'utf8'));
} catch (e) {
  notEvaluated(`读取 --slice 输入失败: ${e.message}`);
}
if (observedPath) {
  try {
    observed = JSON.parse(fs.readFileSync(observedPath, 'utf8'));
  } catch (e) {
    notEvaluated(`读取 --observed 输入失败: ${e.message}`);
  }
}

const mg = arch?.extensions?.tsAnalysis?.moduleGraph;
if (!mg || !Array.isArray(mg.edges) || !Array.isArray(mg.nodes))
  notEvaluated('current 输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）');

// ── 图：internal 目录 + 目录级边 ──────────────────────────────────────────
const internalDirs = mg.nodes.filter((n) => n.type === 'internal').map((n) => n.id);
const internalSet = new Set(internalDirs);
if (internalSet.size === 0) notEvaluated('moduleGraph 里没有 internal 目录节点，没有可评估的内容');
const internalEdges = mg.edges.filter((e) => internalSet.has(e.from) && internalSet.has(e.to));
const edgeKey = (e) => `${e.from} -> ${e.to}`;

// Tarjan：size > 1 的强连通分量
function sccsOf(edges) {
  const idxOf = new Map(internalDirs.map((d, i) => [d, i]));
  const adj = internalDirs.map(() => []);
  for (const e of edges) adj[idxOf.get(e.from)].push(idxOf.get(e.to));
  const index = new Array(internalDirs.length).fill(-1);
  const low = new Array(internalDirs.length).fill(0);
  const onStack = new Array(internalDirs.length).fill(false);
  const stack = [];
  const out = [];
  let counter = 0;
  const walk = (v) => {
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
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.map((i) => internalDirs[i]));
    }
  };
  for (let v = 0; v < internalDirs.length; v++) if (index[v] === -1) walk(v);
  return out;
}
const canon = (sccs) => JSON.stringify([...sccs].map((c) => [...c].sort()).sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1)));

// ── 自校验：重算的 SCC 必须与 moduleGraph 自报的 cycles 一致 ──────────────
const recomputed = sccsOf(internalEdges);
const selfReported = (Array.isArray(mg.cycles) ? mg.cycles : []).map((c) => (Array.isArray(c) ? c : (c.modules ?? [])));
if (canon(recomputed) !== canon(selfReported))
  notEvaluated(
    `自校验失败：按 moduleGraph.edges 重算的 SCC 与 moduleGraph.cycles 不一致，这张图上的模拟不可信 —— 重算=${canon(recomputed)} 自报=${canon(selfReported)}`
  );

// ── 关注点所在的环 ───────────────────────────────────────────────────────
const subject = slice.subject ?? '';
if (!internalSet.has(subject)) notEvaluated(`slice.subject=${JSON.stringify(subject)} 不是本图的 internal 目录节点`);
const beforeScc = (recomputed.find((c) => c.includes(subject)) ?? [subject]).slice().sort();
const fanInOf = (dir, edges) => edges.filter((e) => e.to === dir).length;
// 某个目录的入边读数（条数 + 值依赖强度之和），用于复现 GOAL-033 的 cliPackageFanIn=2 这类读法
const fanInDetail = (dir, edges) => {
  const ins = edges.filter((e) => e.to === dir);
  return {
    dir,
    inEdges: ins.length,
    inValueStrength: ins.reduce((s, e) => s + (e.valueStrength ?? 0), 0),
    inTypeOnlyStrength: ins.reduce((s, e) => s + (e.typeOnlyStrength ?? 0), 0),
  };
};

// ── 切法：moves（文件搬迁意图 + 符号名），没有任何边级指令 ────────────────
const moves = slice.proposedCut?.moves ?? [];
if (!Array.isArray(moves) || moves.length === 0) notEvaluated('slice.proposedCut.moves 为空：没有切法就没有 delta 可算');
for (const m of moves) {
  if (!internalSet.has(m.from)) notEvaluated(`move ${m.file ?? '?'} 的 from=${JSON.stringify(m.from)} 不是本图的 internal 目录节点`);
  if (!internalSet.has(m.to)) notEvaluated(`move ${m.file ?? '?'} 的 to=${JSON.stringify(m.to)} 不是本图的 internal 目录节点`);
  if (!Array.isArray(m.symbols) || m.symbols.length === 0)
    notEvaluated(`move ${m.file ?? '?'} 没有声明 symbols：目录粒度上无法把它与任何一条边对账`);
}
const symbolsOfDir = new Map(); // 目录 -> Set(该目录被搬走的符号)
for (const m of moves) {
  if (!symbolsOfDir.has(m.from)) symbolsOfDir.set(m.from, new Set());
  for (const s of m.symbols) symbolsOfDir.get(m.from).add(s);
}
// 某个符号名由哪个 move 搬走（用于判定这条边被改指到哪个目录）
const destOfSymbol = new Map();
for (const m of moves) for (const s of m.symbols) {
  if (destOfSymbol.has(s) && destOfSymbol.get(s).to !== m.to)
    notEvaluated(`符号 ${s} 被两处 move 搬向不同目录（${destOfSymbol.get(s).to} 与 ${m.to}）：无法在目录粒度上对账`);
  destOfSymbol.set(s, m);
}

// ── 逐条进入 moved-from 目录的边做对账（用 importedNames 做集合判定）─────
const removedEdges = [];
const addedEdges = [];
const affectedConsumers = [];
const assumptions = [
  '目录级图不表示同目录内的 import；搬迁后由「同目录 import 变成跨目录 import」产生的新边，图上结构性看不见，只能由 slice.proposedCut.consumers 显式声明（这类 added 边标 source=declared-consumer）。',
  'importedNames 是目录级边的名字集合，不携带「哪个名字来自哪个文件」的位置信息；因此只有当一个名字集合被某次 move 的 symbols 完整覆盖时才认为该边被这次搬迁解释。',
];
for (const e of internalEdges) {
  const movedSymbols = symbolsOfDir.get(e.to);
  if (!movedSymbols) continue;
  const names = Array.isArray(e.importedNames) ? e.importedNames : [];
  if (names.length === 0)
    notEvaluated(`边 ${edgeKey(e)} 进入被搬迁目录却没有 importedNames，目录粒度上无法对账这次搬迁`);
  const covered = names.filter((n) => movedSymbols.has(n));
  if (covered.length === 0) continue; // 这条边与本次搬迁无关
  const uncovered = names.filter((n) => !movedSymbols.has(n));
  if (uncovered.length > 0)
    notEvaluated(
      `切法覆盖不足：边 ${edgeKey(e)} 的 importedNames=[${names.join(', ')}] 中 [${uncovered.join(', ')}] 未被任何 move 的 symbols 覆盖 —— 目录粒度上无法判断这条边是否随搬迁消失，本原型不猜`
    );
  const dests = [...new Set(names.map((n) => destOfSymbol.get(n).to))];
  if (dests.length > 0 && dests.some((d) => d !== dests[0]))
    notEvaluated(`边 ${edgeKey(e)} 的 importedNames 被搬向不同目录（${dests.join(', ')}）：无法在目录粒度上对账`);
  const dest = dests[0];
  const becomes = e.from === dest ? 'intra-directory' : `retargeted-to:${dest}`;
  removedEdges.push({
    from: e.from,
    to: e.to,
    valueStrength: e.valueStrength ?? null,
    typeOnlyStrength: e.typeOnlyStrength ?? null,
    importedNames: names,
    becomes,
  });
  if (e.from !== dest) addedEdges.push({ from: e.from, to: dest, source: 'retarget-from-removed-edge' });
  affectedConsumers.push({
    edge: edgeKey(e),
    sourceDir: e.from,
    movedFromDir: e.to,
    movedToDir: dest,
    importedNames: names,
    becomes,
    explainedBy: names.map((n) => `${destOfSymbol.get(n).file ?? '?'}#${n}`),
  });
}

// ── 声明消费者：与图上对账；图上看不见的那些（同目录 import）补成 added 边 ──
const declaredConsumers = [];
for (const c of slice.proposedCut?.consumers ?? []) {
  const imports = Array.isArray(c.imports) ? c.imports : [];
  const relevant = moves.filter((m) => imports.some((s) => m.symbols.includes(s)));
  if (relevant.length === 0)
    notEvaluated(`声明消费者 ${c.file ?? '?'} 的 imports=[${imports.join(', ')}] 与任何 move 的 symbols 都不相交：切法输入自相矛盾`);
  const dests = [...new Set(relevant.map((m) => m.to))];
  if (dests.length > 1) notEvaluated(`声明消费者 ${c.file ?? '?'} 涉及的 move 指向不同目录（${dests.join(', ')}）：无法对账`);
  const dest = dests[0];
  const visible = internalEdges.some((e) => e.from === c.dir && symbolsOfDir.has(e.to) && imports.some((s) => (e.importedNames ?? []).includes(s)));
  if (visible) {
    declaredConsumers.push({ declared: c, status: 'graph-visible', movedToDir: dest });
  } else if (c.dir !== dest) {
    declaredConsumers.push({
      declared: c,
      status: 'intra-directory',
      movedToDir: dest,
      note: '该消费者在搬迁前与目标同目录（图上不可见）；按声明补一条跨目录 added 边',
    });
    addedEdges.push({ from: c.dir, to: dest, source: 'declared-consumer', via: c.file ?? null });
  } else {
    declaredConsumers.push({ declared: c, status: 'unverifiable', movedToDir: dest, note: '图上找不到对应边，且消费者与目的地同目录，本次搬迁不产生跨目录边' });
  }
}

// ── 应用切法：after 边集合 + 重算 SCC ────────────────────────────────────
const removedKeys = new Set(removedEdges.map((e) => `${e.from} -> ${e.to}`));
const afterEdges = internalEdges.filter((e) => !removedKeys.has(edgeKey(e)));
const afterKeys = new Set(afterEdges.map(edgeKey));
const addedDeduped = [];
const strengthenedEdges = [];
for (const a of addedEdges) {
  const k = `${a.from} -> ${a.to}`;
  if (afterKeys.has(k)) {
    // 这条边本来就在：搬迁不会让边集合多出一条，只会让已有边的强度上升。
    // 目录级图不携带「符号 -> 文件」的定位，因此强度增量算不出来，如实记为 strengthened 而不是静默丢弃。
    if (!strengthenedEdges.some((s) => `${s.from} -> ${s.to}` === k)) strengthenedEdges.push({ from: a.from, to: a.to, source: a.source, via: a.via ?? null, effect: 'strengthens-existing-edge' });
    continue;
  }
  afterKeys.add(k);
  addedDeduped.push(a);
  afterEdges.push({ from: a.from, to: a.to });
}
const beforeKeys = new Set(internalEdges.map(edgeKey));
const sccsAfter = sccsOf(afterEdges);
const afterScc = (sccsAfter.find((c) => c.includes(subject)) ?? [subject]).slice().sort();

// ── must-not-change 护栏 ─────────────────────────────────────────────────
const mustNotChange = slice.mustNotChange ?? {};
const violations = [];
for (const f of mustNotChange.forbiddenNewEdges ?? []) {
  const k = `${f.from} -> ${f.to}`;
  if (afterKeys.has(k) && !beforeKeys.has(k)) violations.push({ kind: 'forbidden-new-edge', edge: k });
}
for (const d of mustNotChange.untouchedDirs ?? []) {
  const touched = [...removedEdges.map((e) => `${e.from} -> ${e.to}`), ...addedDeduped.map((a) => `${a.from} -> ${a.to}`)].filter(
    (k) => k.startsWith(`${d} -> `) || k.endsWith(` -> ${d}`)
  );
  if (touched.length) violations.push({ kind: 'untouched-dir-changed', dir: d, edges: touched });
}

// ── negative control：恢复关键边后，判据必须可证伪 ────────────────────────
const restoreEdges = slice.negativeControl?.restoreEdges ?? [];
if (!Array.isArray(restoreEdges) || restoreEdges.length === 0)
  notEvaluated('缺少 negative control（slice.negativeControl.restoreEdges 为空）：无法证伪的预期 delta 不出结论');
const restoredEdges = afterEdges.map((e) => ({ from: e.from, to: e.to }));
const restoredKeys = new Set(restoredEdges.map(edgeKey));
for (const r of restoreEdges) {
  if (!internalSet.has(r.from) || !internalSet.has(r.to))
    notEvaluated(`negative control 的恢复边 ${r.from} -> ${r.to} 不是本图的 internal 目录节点`);
  if (!restoredKeys.has(`${r.from} -> ${r.to}`)) {
    restoredKeys.add(`${r.from} -> ${r.to}`);
    restoredEdges.push({ from: r.from, to: r.to });
  }
}
const restoredScc = (sccsOf(restoredEdges).find((c) => c.includes(subject)) ?? [subject]).slice().sort();
// 判据必须相对 before 才有意义：关注点本来就可能停在一个 size>1 的剩余环里（GOAL-033 的 gate 环），
// 所以「subjectBackInScc = size>1」这种写法会被无关边轻易满足。真正的判据是：
// 恢复关键边之后，**这次切法踢出去的那些目录是否全部回到环里**（即 SCC 恰好恢复成 before 的成员）。
const leftDirs = beforeScc.filter((m) => !afterScc.includes(m));
const leftDirsRejoined = leftDirs.filter((m) => restoredScc.includes(m));
const negativeControl = {
  description: slice.negativeControl?.description ?? null,
  restoreEdges,
  subjectSccMembers: restoredScc,
  leftDirs,
  leftDirsRejoined,
  restoresBeforeMembership: canon([restoredScc]) === canon([beforeScc]),
  falsified: leftDirs.length > 0 && canon([restoredScc]) === canon([beforeScc]),
  ...(leftDirs.length === 0 ? { reason: '本次切法没有让任何目录离开环（leftDirs 为空）：负对照无从证伪' } : {}),
};

// ── provenance（到此为止 computedDelta 已算完；declared/observed 只是搬运）──
function toolVersion() {
  try {
    // path.join(<file>, '..') treats the file as a directory segment and overshoots — dirname first.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}
function provenanceConsistency(workspaceRoot, declaredCommit) {
  if (!declaredCommit) return { status: 'not-checked', reason: 'slice.provenance.commit 未声明' };
  if (!workspaceRoot) return { status: 'not-checked', reason: 'current 输入没有 workspaceRoot' };
  try {
    const head = execFileSync('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return head === declaredCommit
      ? { status: 'match', head, reason: '工作区 HEAD 与 slice.provenance.commit 一致' }
      : { status: 'mismatch', head, reason: `工作区 HEAD=${head} 与 slice.provenance.commit=${declaredCommit} 不一致：这份 ArchJSON 可能不是那个 commit 的树` };
  } catch (e) {
    return { status: 'not-checked', reason: `workspaceRoot 不是 git work tree（git rev-parse 失败）：${String(e.message).split('\n')[0]}` };
  }
}
const provenance = {
  analysis: { source: archPath, workspaceRoot: arch.workspaceRoot ?? null, timestamp: arch.timestamp ?? null, language: arch.language ?? null },
  slice: { source: slicePath, ...(slice.provenance ?? {}) },
  observed: observed ? { source: observedPath, ...(observed.provenance ?? {}) } : null,
  tool: { archguardVersion: toolVersion(), script: 'docs/experiments/layer-map/slice-delta.mjs' },
  provenanceConsistency: provenanceConsistency(arch.workspaceRoot, slice.provenance?.commit),
};

// ── 报告：computedDelta 先于 declared/observed 落位（分区，不回灌）────────
const guardsPassed = violations.length === 0 && negativeControl.falsified === true;
const report = {
  status: 'evaluated',
  subject,
  concern: slice.concern ?? null,
  provenance,
  current: {
    sccMembers: beforeScc,
    sccSize: beforeScc.length,
    subjectFanIn: fanInOf(subject, internalEdges),
    targets: [...symbolsOfDir.keys()].sort().map((d) => fanInDetail(d, internalEdges)),
    relevantEdges: removedEdges.map((e) => ({ from: e.from, to: e.to, importedNames: e.importedNames })),
  },
  proposedCut: {
    moves,
    declaredConsumerCount: (slice.proposedCut?.consumers ?? []).length,
    assumptions,
  },
  affectedConsumers,
  declaredConsumers,
  computedDelta: {
    inputsUsed: ['extensions.tsAnalysis.moduleGraph', 'slice.proposedCut', 'slice.mustNotChange', 'slice.negativeControl'],
    removedEdges,
    addedEdges: addedDeduped,
    strengthenedEdges,
    sccBefore: beforeScc,
    sccAfter: afterScc,
    sccLeft: beforeScc.filter((m) => !afterScc.includes(m)),
    sccRemaining: afterScc,
    subjectFanInAfter: fanInOf(subject, afterEdges),
    targetsAfter: [...symbolsOfDir.keys()].sort().map((d) => fanInDetail(d, afterEdges)),
    // 「为什么离开」是算出来的：自己入边被这次切法削光的算 own-in-edges-removed；
    // 自己入边还在、但那些入边全来自同样离开的目录的，算 transitive（GOAL-033 的 fan-in 属于这一类）。
    whyLeft: beforeScc
      .filter((m) => !afterScc.includes(m))
      .map((m) => {
        const before = fanInDetail(m, internalEdges);
        const after = fanInDetail(m, afterEdges);
        const remainingSources = [...new Set(afterEdges.filter((e) => e.to === m).map((e) => e.from))].sort();
        if (remainingSources.length === 0) return { dir: m, ...after, inEdgesBefore: before.inEdges, leftBecause: 'own-in-edges-removed', via: [] };
        return { dir: m, ...after, inEdgesBefore: before.inEdges, leftBecause: 'transitively-via', via: remainingSources };
      }),
  },
  mustNotChange: { forbiddenNewEdges: mustNotChange.forbiddenNewEdges ?? [], untouchedDirs: mustNotChange.untouchedDirs ?? [], violations },
  negativeControl,
  guards: { passed: guardsPassed, violations: violations.length, negativeControlFalsified: negativeControl.falsified },
  declaredPrediction: slice.declaredPrediction ?? null,
  observedDelta: observed ?? null,
  predictionComparison: {
    declaredVsComputed: slice.declaredPrediction
      ? {
          declaredSccSize: slice.declaredPrediction.sccSize ?? null,
          computedSccSize: afterScc.length,
          sizeMatches: slice.declaredPrediction.sccSize === afterScc.length,
          membersMatch: Array.isArray(slice.declaredPrediction.sccMembers) ? canon([slice.declaredPrediction.sccMembers]) === canon([afterScc]) : null,
        }
      : null,
    observedVsComputed: observed
      ? {
          observedSccSize: observed.sccSize ?? null,
          computedSccSize: afterScc.length,
          sizeMatches: observed.sccSize === afterScc.length,
          membersMatch: Array.isArray(observed.sccMembers) ? canon([observed.sccMembers]) === canon([afterScc]) : null,
        }
      : null,
  },
};
finish(report, guardsPassed ? 0 : 1);

// ── 控制台摘要 ───────────────────────────────────────────────────────────
function summaryText(r) {
  if (r.status === 'not-evaluated') return [`NOT-EVALUATED: ${r.reason}`, r.usage ?? null].filter(Boolean).join('\n');
  const l = [
    `subject=${JSON.stringify(r.subject)}  concern=${r.concern ?? '?'}`,
    `当前环: size=${r.current.sccSize} [${r.current.sccMembers.join(', ')}]  subjectFanIn=${r.current.subjectFanIn}`,
  ];
  for (const t of r.current.targets) l.push(`  搬迁源 ${t.dir}: 入边=${t.inEdges} 值强度=${t.inValueStrength} type-only=${t.inTypeOnlyStrength}`);
  for (const e of r.computedDelta.removedEdges) l.push(`  remove  ${e.from} -> ${e.to}  (${e.becomes})  names=[${e.importedNames.join(', ')}]`);
  for (const a of r.computedDelta.addedEdges) l.push(`  add     ${a.from} -> ${a.to}  (${a.source})`);
  for (const s of r.computedDelta.strengthenedEdges) l.push(`  strengthen ${s.from} -> ${s.to}  (边本已存在，强度增量不可算；source=${s.source})`);
  l.push(`预期环: size=${r.computedDelta.sccAfter.length} [${r.computedDelta.sccAfter.join(', ')}]  离开=${r.computedDelta.sccLeft.join(', ') || '（无）'}`);
  for (const w of r.computedDelta.whyLeft)
    l.push(`  why-left ${w.dir}: 入边 ${w.inEdgesBefore} -> ${w.inEdges}  (${w.leftBecause}${w.via.length ? ': ' + w.via.join(', ') : ''})`);
  for (const v of r.mustNotChange.violations) l.push(`  护栏违例 [${v.kind}] ${v.edge ?? v.dir} ${v.edges ? JSON.stringify(v.edges) : ''}`);
  l.push(`负对照: 恢复 ${r.negativeControl.restoreEdges.map((e) => `${e.from} -> ${e.to}`).join(', ')} -> 环 size=${r.negativeControl.subjectSccMembers.length} falsified=${r.negativeControl.falsified}`);
  if (r.declaredPrediction) l.push(`人写预测: size=${r.declaredPrediction.sccSize ?? '?'}  与计算一致=${r.predictionComparison.declaredVsComputed.sizeMatches}`);
  if (r.observedDelta) l.push(`后验读数: size=${r.observedDelta.sccSize ?? '?'}  与计算一致=${r.predictionComparison.observedVsComputed.sizeMatches}`);
  l.push(`护栏: ${r.guards.passed ? '通过' : '被触发'}`);
  return l.join('\n');
}

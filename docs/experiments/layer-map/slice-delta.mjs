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
// 装配顺序上，computedDelta / negativeControl 先算完，declared/observed 才被读进对比段——anti-stuffing 由
// tests/unit/architecture/slice-delta.test.ts 的「换掉 observed，computedDelta 与 negativeControl 逐字节不变」
// 反向测试看住（机械证据，不是约定）。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const USAGE = `用法: node docs/experiments/layer-map/slice-delta.mjs <current.arch.json> --slice <slice.json> [--observed <observed.json>] [--json <out.json>]
  <current.arch.json>  package 级 ArchJSON（消费 extensions.tsAnalysis.moduleGraph）
  --slice <file>       显式切法输入（subject/concern/proposedCut/mustNotChange/negativeControl/[declaredPrediction]）
  --observed <file>    可选的独立后验读数；只进对比段，不参与任何计算
  --json <file>        把结构化报告写到文件
退出码: 0 = 已评估且护栏通过 | 1 = 已评估但护栏被触发 | 2 = 未评估`;

const SCRIPT_REL = 'docs/experiments/layer-map/slice-delta.mjs';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const jsonOut = flag('--json');
const slicePath = flag('--slice');
const observedPath = flag('--observed');
const [archPath] = args;

function summaryText(r) {
  if (r.status === 'not-evaluated') return `NOT-EVALUATED: ${r.reason}`;
  const q = (d) => (d === '' ? '""' : d);
  const l = [
    `subject=${JSON.stringify(r.subject)}  concern=${r.concern ?? '?'}`,
    `当前环: size=${r.current.sccSize} [${r.current.sccMembers.map(q).join(', ')}]  subjectFanIn=${r.current.subjectFanIn}`,
  ];
  for (const e of r.computedDelta.removedEdges)
    l.push(
      `  remove  ${q(e.from)} -> ${q(e.to)}  (${e.becomes})  names=[${e.importedNames.join(', ')}]`
    );
  for (const a of r.computedDelta.addedEdges)
    l.push(`  add     ${q(a.from)} -> ${q(a.to)}  (${a.source})`);
  l.push(
    `预期环: size=${r.computedDelta.sccAfter.length} [${r.computedDelta.sccAfter.map(q).join(', ')}]  离开=[${r.computedDelta.sccLeft.map(q).join(', ')}]`
  );
  for (const w of r.computedDelta.whyLeft)
    l.push(
      `  why-left ${q(w.dir)}: 入边来源 ${w.inEdgeSourcesBefore.map(q).join(', ') || '（无）'} -> ${w.inEdgeSourcesAfter.map(q).join(', ') || '（无）'}；${w.reason}`
    );
  for (const v of r.mustNotChange.violations)
    l.push(
      `  护栏违例 [${v.kind}] ${v.edge ?? v.dir}${v.edges ? ' ' + JSON.stringify(v.edges) : ''}`
    );
  l.push(
    `负对照: 恢复 [${r.negativeControl.restoreEdges.map((e) => `${q(e.from)} -> ${q(e.to)}`).join(', ')}] -> 环 size=${r.negativeControl.subjectSccMembersAfterRestore.length}` +
      ` subjectBackInScc=${r.negativeControl.subjectBackInScc} falsified=${r.negativeControl.falsified}`
  );
  if (r.declaredPrediction)
    l.push(
      `人写预测(declared): size=${r.declaredPrediction.sccSize ?? '?'}  与计算的关系=${r.predictionComparison.declaredVsComputed.relation}`
    );
  if (r.observedDelta)
    l.push(
      `后验读数(observed): size=${r.observedDelta.sccSize ?? '?'}  与计算的关系=${r.predictionComparison.observedVsComputed.relation}`
    );
  l.push(
    `护栏: violations=${r.guards.violations} negativeControlFalsified=${r.guards.negativeControlFalsified}`
  );
  return l.join('\n');
}
function writeAndExit(report, code, { usage = false } = {}) {
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  if (usage) console.log(USAGE);
  console.log(summaryText(report));
  process.exit(code);
}
function notEvaluated(reason, extra = {}) {
  return writeAndExit({ status: 'not-evaluated', reason, ...extra }, 2);
}

// AC: 无参数（或缺少 --slice）时打印用法并以退出码 2 结束——不是抛异常崩溃。
if (!archPath || !slicePath)
  writeAndExit(
    {
      status: 'not-evaluated',
      reason: '缺少参数：需要 <current.arch.json> 与 --slice <slice.json>',
    },
    2,
    { usage: true }
  );

// ── 输入 ─────────────────────────────────────────────────────────────────
let arch,
  slice,
  observed = null;
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
  notEvaluated(
    'current 输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）'
  );

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
  // 确定性顺序：每个分量内排序 + 分量之间排序（同一输入连续两次运行结果逐字节一致）
  return out
    .map((c) => [...c].sort())
    .sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1));
}
const canon = (sccs) =>
  JSON.stringify(
    sccs.map((c) => [...c].sort()).sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1))
  );
const sameSet = (a, b) => canon([a]) === canon([b]);

// ── 自校验：重算的 SCC 必须与 moduleGraph 自报的 cycles 一致 ──────────────
const recomputed = sccsOf(internalEdges);
const selfReported = (Array.isArray(mg.cycles) ? mg.cycles : []).map((c) =>
  Array.isArray(c) ? c : (c.modules ?? [])
);
if (canon(recomputed) !== canon(selfReported))
  notEvaluated(
    `自校验失败：按 moduleGraph.edges 重算的 SCC 与 moduleGraph.cycles 不一致，这张图上的模拟不可信 —— 重算=${canon(recomputed)} 自报=${canon(selfReported)}`
  );

// ── 关注点所在的环 ───────────────────────────────────────────────────────
const subject = slice.subject ?? '';
if (!internalSet.has(subject))
  notEvaluated(`slice.subject=${JSON.stringify(subject)} 不是本图的 internal 目录节点`);
const beforeScc = (recomputed.find((c) => c.includes(subject)) ?? [subject]).slice().sort();
const inSources = (dir, edges) =>
  [...new Set(edges.filter((e) => e.to === dir).map((e) => e.from))].sort();

// ── 切法：moves（文件搬迁意图 + 符号名），没有任何边级指令 ────────────────
const moves = slice.proposedCut?.moves ?? [];
if (!Array.isArray(moves) || moves.length === 0)
  notEvaluated('slice.proposedCut.moves 为空：没有切法就没有 delta 可算');
for (const m of moves) {
  if (!internalSet.has(m.from))
    notEvaluated(
      `move ${m.file ?? '?'} 的 from=${JSON.stringify(m.from)} 不是本图的 internal 目录节点`
    );
  if (!internalSet.has(m.to))
    notEvaluated(
      `move ${m.file ?? '?'} 的 to=${JSON.stringify(m.to)} 不是本图的 internal 目录节点`
    );
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
for (const m of moves)
  for (const s of m.symbols) {
    if (destOfSymbol.has(s) && destOfSymbol.get(s).to !== m.to)
      notEvaluated(
        `符号 ${s} 被两处 move 搬向不同目录（${destOfSymbol.get(s).to} 与 ${m.to}）：无法在目录粒度上对账`
      );
    destOfSymbol.set(s, m);
  }

const assumptions = [
  '目录级图不表示同目录内的 import；搬迁后由「同目录 import 变成跨目录 import」产生的新边，图上结构性看不见，只能由 slice.proposedCut.consumers 显式声明（这类 added 边标 source=declared-consumer）。',
  'importedNames 是目录级边的名字集合，不携带「哪个名字来自哪个文件」的位置信息；因此只有当一个名字集合被某次 move 的 symbols 完整覆盖时才认为该边被这次搬迁解释。',
  '本原型只对账「**进入** moved-from 目录的边」。目录级边不带「由哪个文件产生」的信息，因此**无法**判断某条「从 moved-from 目录出发」的边是否随某个文件一并搬走——本原型的 sccAfter 是这条模拟规则下的读数，不是对真实重命名/搬壳操作的完整模拟（保留 façade 还是整体搬迁，需要调用方在切法里自行表达）。',
];

// ── 逐条进入 moved-from 目录的边做对账（用 importedNames 做集合判定）─────
const removedEdges = [];
const addedEdges = [];
const affectedConsumers = [];
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
  if (dests.length > 1)
    notEvaluated(
      `边 ${edgeKey(e)} 的 importedNames 被搬向不同目录（${dests.join(', ')}）：无法在目录粒度上对账`
    );
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
  if (e.from !== dest)
    addedEdges.push({ from: e.from, to: dest, source: 'retarget-from-removed-edge' });
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
  if (!internalSet.has(c.dir))
    notEvaluated(
      `声明消费者 ${c.file ?? '?'} 的 dir=${JSON.stringify(c.dir)} 不是本图的 internal 目录节点`
    );
  const relevant = moves.filter((m) => imports.some((s) => m.symbols.includes(s)));
  if (relevant.length === 0)
    notEvaluated(
      `声明消费者 ${c.file ?? '?'} 的 imports=[${imports.join(', ')}] 与任何 move 的 symbols 都不相交：切法输入自相矛盾`
    );
  const dests = [...new Set(relevant.map((m) => m.to))];
  if (dests.length > 1)
    notEvaluated(
      `声明消费者 ${c.file ?? '?'} 涉及的 move 指向不同目录（${dests.join(', ')}）：无法对账`
    );
  const dest = dests[0];
  const visible = internalEdges.some(
    (e) =>
      e.from === c.dir &&
      symbolsOfDir.has(e.to) &&
      imports.some((s) => (e.importedNames ?? []).includes(s))
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
    addedEdges.push({ from: c.dir, to: dest, source: 'declared-consumer', via: c.file ?? null });
  } else {
    declaredConsumers.push({
      declared: c,
      status: 'unverifiable',
      movedToDir: dest,
      note: '图上找不到对应边，且消费者与目的地同目录，本次搬迁不产生跨目录边',
    });
  }
}

// ── 应用切法：after 边集合 + 重算 SCC ────────────────────────────────────
const removedKeys = new Set(removedEdges.map((e) => `${e.from} -> ${e.to}`));
const afterEdges = internalEdges
  .filter((e) => !removedKeys.has(edgeKey(e)))
  .map((e) => ({ from: e.from, to: e.to }));
const afterKeys = new Set(afterEdges.map(edgeKey));
const addedDeduped = [];
for (const a of addedEdges) {
  const k = `${a.from} -> ${a.to}`;
  if (afterKeys.has(k)) continue; // 这条边搬迁前就已存在 ⇒ 不是本次切法新增的
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
  if (afterKeys.has(k) && !beforeKeys.has(k))
    violations.push({ kind: 'forbidden-new-edge', edge: k });
}
for (const d of mustNotChange.untouchedDirs ?? []) {
  const touched = [
    ...removedEdges.map((e) => `${e.from} -> ${e.to}`),
    ...addedDeduped.map((a) => `${a.from} -> ${a.to}`),
  ].filter((k) => k.startsWith(`${d} -> `) || k.endsWith(` -> ${d}`));
  if (touched.length) violations.push({ kind: 'untouched-dir-changed', dir: d, edges: touched });
}

// ── negative control：恢复关键边后，判据必须可证伪 ────────────────────────
const restoreEdges = slice.negativeControl?.restoreEdges ?? [];
if (!Array.isArray(restoreEdges) || restoreEdges.length === 0)
  notEvaluated(
    '缺少 negative control（slice.negativeControl.restoreEdges 为空）：无法证伪的预期 delta 不出结论'
  );
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
const restoredScc = (sccsOf(restoredEdges).find((c) => c.includes(subject)) ?? [subject])
  .slice()
  .sort();
const restoresBeforeMembership = sameSet(restoredScc, beforeScc);
const negativeControl = {
  description: slice.negativeControl?.description ?? null,
  restoreEdges,
  beforeSccMembers: beforeScc,
  afterSccMembers: afterScc,
  subjectSccMembersAfterRestore: restoredScc,
  // 负对照成立 = 把声明的边加回去之后，subject 的环成员集合回到 before（且 after 与 before 不同）
  subjectBackInScc: restoredScc.length > 1 && restoresBeforeMembership,
  restoresBeforeMembership,
  falsified: restoresBeforeMembership && !sameSet(beforeScc, afterScc),
};

// ── whyLeft：离开的目录为什么离开（来自重算可达性，不照抄任何外部文字）────
const sccOfDirAfter = (dir) => sccsAfter.find((c) => c.includes(dir)) ?? [dir];
const whyLeft = beforeScc
  .filter((m) => !afterScc.includes(m))
  .map((m) => {
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

// ── provenance（到此为止 computedDelta / negativeControl 已算完；declared/observed 只是搬运）──
function toolVersion() {
  try {
    return (
      JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
        .version ?? null
    );
  } catch {
    return null;
  }
}
function provenanceConsistency(workspaceRoot, declaredCommit) {
  if (!declaredCommit) return { status: 'not-checked', reason: 'slice.provenance.commit 未声明' };
  if (!workspaceRoot) return { status: 'not-checked', reason: 'current 输入没有 workspaceRoot' };
  try {
    const head = execFileSync('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head === declaredCommit
      ? { status: 'match', head, reason: '工作区 HEAD 与 slice.provenance.commit 一致' }
      : {
          status: 'mismatch',
          head,
          reason: `工作区 HEAD=${head} 与 slice.provenance.commit=${declaredCommit} 不一致：这份 ArchJSON 可能不是那个 commit 的树`,
        };
  } catch (e) {
    return {
      status: 'not-checked',
      reason: `workspaceRoot 不是 git work tree（git rev-parse 失败）：${String(e.message).split('\n')[0]}`,
    };
  }
}
const provenance = {
  analysis: {
    source: archPath,
    workspaceRoot: arch.workspaceRoot ?? null,
    timestamp: arch.timestamp ?? null,
    language: arch.language ?? null,
  },
  slice: { source: slicePath, ...(slice.provenance ?? {}) },
  observed: observed ? { source: observedPath, ...(observed.provenance ?? {}) } : null,
  tool: { archguardVersion: toolVersion(), script: SCRIPT_REL },
  provenanceConsistency: provenanceConsistency(arch.workspaceRoot, slice.provenance?.commit),
};

// ── 报告：computedDelta / negativeControl 先于 declared/observed 落位（分区，不回灌）──
const guardsClean = violations.length === 0 && negativeControl.falsified === true;
// 只报两个独立读数「一致/不一致」，不判谁对谁错。成员集合缺失时如实降级，不把"没比对"说成"一致"。
const relation = (sizeMatches, membersMatch) => {
  if (sizeMatches === false || membersMatch === false) return 'diverges';
  if (sizeMatches === true && membersMatch === true) return 'agrees';
  if (sizeMatches === true && membersMatch === null) return 'size-agrees-members-unknown';
  if (sizeMatches === null) return 'incomparable';
  return 'incomparable';
};
const report = {
  status: 'evaluated',
  subject,
  concern: slice.concern ?? null,
  provenance,
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
    declaredConsumerCount: (slice.proposedCut?.consumers ?? []).length,
    assumptions,
  },
  affectedConsumers,
  declaredConsumers,
  computedDelta: {
    inputsUsed: [
      'extensions.tsAnalysis.moduleGraph',
      'slice.proposedCut',
      'slice.mustNotChange',
      'slice.negativeControl',
    ],
    removedEdges,
    addedEdges: addedDeduped,
    sccBefore: beforeScc,
    sccAfter: afterScc,
    sccLeft: beforeScc.filter((m) => !afterScc.includes(m)),
    sccRemaining: afterScc,
    subjectFanInAfter: inSources(subject, afterEdges).length,
    whyLeft,
  },
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
  declaredPrediction: slice.declaredPrediction ?? null,
  observedDelta: observed ?? null,
  predictionComparison: {
    // 三个独立读数之间的对比：只报「一致/不一致」，不判谁对谁错
    declaredVsComputed: slice.declaredPrediction
      ? (() => {
          const sizeMatches = slice.declaredPrediction.sccSize === afterScc.length;
          const membersMatch = Array.isArray(slice.declaredPrediction.sccMembers)
            ? sameSet(slice.declaredPrediction.sccMembers, afterScc)
            : null;
          return {
            relation: relation(sizeMatches, membersMatch),
            declaredSccSize: slice.declaredPrediction.sccSize ?? null,
            computedSccSize: afterScc.length,
            sizeMatches,
            membersMatch,
          };
        })()
      : null,
    observedVsComputed: observed
      ? (() => {
          const sizeMatches = observed.sccSize === afterScc.length;
          const membersMatch = Array.isArray(observed.sccMembers)
            ? sameSet(observed.sccMembers, afterScc)
            : null;
          return {
            relation: relation(sizeMatches, membersMatch),
            observedSccSize: observed.sccSize ?? null,
            computedSccSize: afterScc.length,
            sizeMatches,
            membersMatch,
          };
        })()
      : null,
  },
};
writeAndExit(report, guardsClean ? 0 : 1);

#!/usr/bin/env node
// check-layers.mjs — 确定性层方向检查（实验原型，不含 LLM 判断）。
//
// 用法: node docs/experiments/layer-map/check-layers.mjs <overview/package.json> [layers.yml] [--html out.html] [--json out.json]
//        [--before <before/overview/package.json>] [--classify-cycles]
// 退出码: 0 = 通过（无新增违例） | 1 = 有新增违例 | 2 = 未评估（输入读不懂，绝不等同于通过）
//
// 取边: ArchGuard 的 extensions.tsAnalysis.moduleGraph.edges（目录级）。
// type-only / 值依赖拆分: 对违例边按【位置】扫描源文件里行首的 import/export ... from 语句
// （注释行、字符串里的文件名不算），与 ArchGuard 的边相互印证而不是替代它。
//
// 两个可选 flag（省略时输出与不加这两个 flag 的版本逐字节相同，纯加法）：
//   --before <json>     另一棵独立评估过的树（package 级 ArchJSON），报告多一个 driftReport 字段：
//                       逐条跨层边分类为 new-and-undeclared / new-and-declared / preexisting-and-undeclared。
//                       判定真的比较两份独立的边集合，不用启发式。
//   --classify-cycles   报告多一个 cycleClassification 字段：moduleGraph.cycles 的每个环分类为
//                       intra-layer / cross-layer-declared / cross-layer-undeclared（纯集合运算）；
//                       另有 bidirectionalAllowedPairs 列出 allowed 里同时存在 A -> B 与 B -> A 的层对。

import fs from 'node:fs';
import path from 'node:path';
import { load as yamlLoad } from 'js-yaml';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const boolFlag = (n) => {
  const i = args.indexOf(n);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const htmlOut = flag('--html');
const jsonOut = flag('--json');
const beforePath = flag('--before');
const classifyCycles = boolFlag('--classify-cycles');
const [archPath, layersPath = new URL('./layers.yml', import.meta.url).pathname] = args;

function finish(report, code) {
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  if (htmlOut) fs.writeFileSync(htmlOut, renderHtml(report));
  console.log(summaryText(report));
  process.exit(code);
}

function notEvaluated(reason) {
  return finish({ status: 'not-evaluated', reason, layers: {}, layerEdges: [], violations: [], gaps: {} }, 2);
}

if (!archPath) notEvaluated('缺少参数: overview/package.json 路径');
let arch, spec;
try {
  arch = JSON.parse(fs.readFileSync(archPath, 'utf8'));
  spec = yamlLoad(fs.readFileSync(layersPath, 'utf8'));
} catch (e) {
  notEvaluated(`读取输入失败: ${e.message}`);
}
const mg = arch?.extensions?.tsAnalysis?.moduleGraph;
if (!mg || !Array.isArray(mg.edges) || !Array.isArray(mg.nodes)) {
  notEvaluated('输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）');
}
if (!spec?.layers || !Array.isArray(spec.allowed)) notEvaluated('layers.yml 缺少 layers 或 allowed');

// --before：另一棵独立评估过的树。读不懂就没有可比对象，给 not-evaluated，绝不退回空 driftReport。
let beforeMg = null;
if (beforePath) {
  try {
    beforeMg = JSON.parse(fs.readFileSync(beforePath, 'utf8'))?.extensions?.tsAnalysis?.moduleGraph;
  } catch (e) {
    notEvaluated(`读取 --before 输入失败: ${e.message}`);
  }
  if (!beforeMg || !Array.isArray(beforeMg.edges) || !Array.isArray(beforeMg.nodes))
    notEvaluated('--before 输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）');
}

// ── glob → 层（最长字面前缀优先）─────────────────────────────────────────
const toRe = (g) =>
  new RegExp(
    '^' +
      g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$'
  );
const rules = [];
for (const [name, def] of Object.entries(spec.layers))
  for (const g of def.globs ?? []) rules.push({ layer: name, glob: g, re: toRe(g), len: g.replace(/\*.*$/, '').length });
rules.sort((a, b) => b.len - a.len);
const ignoreRes = (spec.ignore ?? []).map(toRe);
const layerOf = (dir) => {
  if (ignoreRes.some((r) => r.test(dir))) return 'ignored';
  return rules.find((r) => r.re.test(dir))?.layer ?? null;
};

// ── 目录级边 → 层级边 ────────────────────────────────────────────────────
const internal = new Set(mg.nodes.filter((n) => n.type === 'internal').map((n) => n.id));
const allowed = new Set(spec.allowed.map((s) => s.replace(/\s+/g, ' ').trim()));
const gaps = { unmappedDirs: [], unresolvedEdges: [], externalEdgesIgnored: 0 };
const pair = new Map(); // "A -> B" -> { count, dirEdges: [] }
for (const d of internal) if (layerOf(d) === null) gaps.unmappedDirs.push(d);
for (const e of mg.edges) {
  if (!internal.has(e.from)) continue;
  if (!internal.has(e.to)) {
    if (e.to.startsWith('@/') || e.to.startsWith('.')) gaps.unresolvedEdges.push(`${e.from} -> ${e.to}`);
    else gaps.externalEdgesIgnored++;
    continue;
  }
  const a = layerOf(e.from);
  const b = layerOf(e.to);
  if (!a || !b || a === 'ignored' || b === 'ignored' || a === b) continue;
  const k = `${a} -> ${b}`;
  const v = pair.get(k) ?? { count: 0, dirEdges: [] };
  v.count++;
  v.dirEdges.push(`${e.from} -> ${e.to}`);
  pair.set(k, v);
}

// ── 违例 + 基线棘轮 ──────────────────────────────────────────────────────
const baseline = new Set((spec.known_violations ?? []).map((s) => (typeof s === 'string' ? s : s.edge)));
const layerEdges = [...pair.entries()].map(([edge, v]) => ({
  edge,
  count: v.count,
  allowed: allowed.has(edge),
  baseline: baseline.has(edge),
  dirEdges: v.dirEdges,
}));
const violations = layerEdges.filter((e) => !e.allowed);
const seen = new Set(violations.map((v) => v.edge));
const resolvedBaseline = [...baseline].filter((b) => !seen.has(b));
const newViolations = violations.filter((v) => !v.baseline);

// ── 违例边的 type-only / 值依赖拆分（按位置扫描行首语句）─────────────────
const root = arch.workspaceRoot ?? process.cwd();
const files = (arch.sourceFiles ?? []).map((f) => (path.isAbsolute(f) ? path.relative(root, f) : f));
const STMT = /^[ \t]*(import|export)\s+(type\s+)?([^;'"]*?)\bfrom\s+['"]([^'"]+)['"]|^[ \t]*import\s+['"]([^'"]+)['"]/gm;
function targetDir(spec_, fromFile) {
  let p;
  if (spec_.startsWith('@/')) p = 'src/' + spec_.slice(2);
  else if (spec_.startsWith('.')) p = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec_));
  else return null;
  return path.posix.dirname(p);
}
const wanted = new Map(violations.map((v) => [v.edge, v]));
for (const f of files) {
  const fromDir = path.posix.dirname(f);
  const a = layerOf(fromDir);
  if (!a || a === 'ignored') continue;
  let text;
  try {
    text = fs.readFileSync(path.join(root, f), 'utf8');
  } catch {
    continue;
  }
  for (const m of text.matchAll(STMT)) {
    const sp = m[4] ?? m[5];
    const td = targetDir(sp, f);
    if (td === null) continue;
    const b = layerOf(td);
    const v = wanted.get(`${a} -> ${b}`);
    if (!v) continue;
    const inline = m[3] && /^\{[^}]*\}$/.test(m[3].trim()) && m[3].replace(/[{}]/g, '').split(',').filter(Boolean).every((s) => /^\s*type\s/.test(s));
    const typeOnly = Boolean(m[2]) || Boolean(inline);
    v.files ??= [];
    v.typeOnly ??= 0;
    v.value ??= 0;
    typeOnly ? v.typeOnly++ : v.value++;
    v.files.push({ file: f, to: sp, kind: typeOnly ? 'type' : 'value' });
  }
}

// 什么都没评估到 ≠ 合格：没有 internal 目录或没有任何层间边时，必须给出独立的"未评估"取值
if (internal.size === 0) notEvaluated('moduleGraph 里没有 internal 目录节点，没有可评估的内容');
if (layerEdges.length === 0) notEvaluated('没有评估到任何层间边（layers.yml 的 glob 可能与目录不匹配，或输入为空图）');

// ── B1: --before drift 分类 ──────────────────────────────────────────────
// 把一棵树的目录级边投影成层间边集合（与上面 pair 同一套 internal/layerOf 规则，可复用）。
function layerEdgeSet(graph) {
  const gInternal = new Set(graph.nodes.filter((n) => n.type === 'internal').map((n) => n.id));
  const out = new Set();
  for (const e of graph.edges) {
    if (!gInternal.has(e.from) || !gInternal.has(e.to)) continue;
    const a = layerOf(e.from);
    const b = layerOf(e.to);
    if (!a || !b || a === 'ignored' || b === 'ignored' || a === b) continue;
    out.add(`${a} -> ${b}`);
  }
  return out;
}
let driftReport;
if (beforeMg) {
  const beforePairs = layerEdgeSet(beforeMg); // 真的读了 before 树的 moduleGraph.edges
  const afterPairs = new Set(pair.keys());
  const records = [];
  for (const edge of [...new Set([...beforePairs, ...afterPairs])].sort()) {
    const beforePresent = beforePairs.has(edge);
    const afterPresent = afterPairs.has(edge);
    const declared = allowed.has(edge);
    let classification;
    if (afterPresent && !beforePresent) classification = declared ? 'new-and-declared' : 'new-and-undeclared';
    else if (beforePresent && afterPresent && !declared) classification = 'preexisting-and-undeclared';
    else continue; // preexisting-and-declared（噪声，不列）/ 只出现在 before 的消失边（不是 drift 分类项）
    const [from, to] = edge.split(' -> ');
    records.push({ edge: { from, to }, classification, evidence: { beforePresent, afterPresent, declared } });
  }
  driftReport = records;
}

// ── B2: --classify-cycles ────────────────────────────────────────────────
// "某环的成员是否全部同层 / 相邻方向是否已声明" 是纯集合运算，不需要 LLM。
let cycleClassification;
let bidirectionalAllowedPairs;
if (classifyCycles) {
  const edgeSet = new Set(mg.edges.map((e) => `${e.from} -> ${e.to}`));
  const cycles = Array.isArray(mg.cycles) ? mg.cycles : [];
  cycleClassification = cycles.map((c, i) => {
    const members = Array.isArray(c) ? c : (c.modules ?? []);
    const layerMembership = [...new Set(members.map((m) => layerOf(m) ?? 'unmapped'))];
    const mappedLayers = members.map((m) => layerOf(m)).filter((l) => l && l !== 'ignored');
    const allMapped = mappedLayers.length === members.length;
    let classification;
    if (allMapped && new Set(mappedLayers).size === 1) {
      classification = 'intra-layer'; // 全部成员映射到同一层：check-layers 的跨层方向检查结构上看不见它
    } else {
      let allDeclared = true;
      for (let k = 0; k < members.length; k++) {
        const u = members[k];
        const v = members[(k + 1) % members.length];
        const a = layerOf(u);
        const b = layerOf(v);
        if (!a || !b || a === 'ignored' || b === 'ignored') {
          allDeclared = false; // 相邻成员有一端没映射到层 → 这条方向无从声明
          continue;
        }
        if (a === b) continue; // 同层相邻，没有跨层方向要声明
        if (edgeSet.has(`${u} -> ${v}`) && !allowed.has(`${a} -> ${b}`)) allDeclared = false;
        if (edgeSet.has(`${v} -> ${u}`) && !allowed.has(`${b} -> ${a}`)) allDeclared = false;
      }
      classification = allDeclared ? 'cross-layer-declared' : 'cross-layer-undeclared';
    }
    return { cycleId: `cycle-${i + 1}`, members, layerMembership, classification };
  });
  const bidir = [];
  for (const e of [...allowed]) {
    const [a, b] = e.split(' -> ');
    if (a < b && allowed.has(`${b} -> ${a}`)) bidir.push(`${a} <-> ${b}`);
  }
  bidirectionalAllowedPairs = bidir.sort();
}

const layersOut = Object.fromEntries(
  Object.entries(spec.layers).map(([n, d]) => [n, { rank: d.rank ?? 0, dirs: [...internal].filter((x) => layerOf(x) === n) }])
);
const status = newViolations.length > 0 ? 'fail' : 'pass';
const report = {
  status,
  generatedFrom: { arch: archPath, timestamp: arch.timestamp, layers: layersPath },
  layers: layersOut,
  layerEdges,
  violations,
  newViolations: newViolations.map((v) => v.edge),
  resolvedBaseline,
  gaps,
};
if (beforeMg) report.driftReport = driftReport;
if (classifyCycles) {
  report.cycleClassification = cycleClassification;
  report.bidirectionalAllowedPairs = bidirectionalAllowedPairs;
}
finish(report, status === 'pass' ? 0 : 1);

// ── 输出 ─────────────────────────────────────────────────────────────────
function summaryText(r) {
  if (r.status === 'not-evaluated') return `NOT-EVALUATED: ${r.reason}`;
  const lines = [`数据时间戳: ${r.generatedFrom?.timestamp ?? '?'}`, `status=${r.status}  layerEdges=${r.layerEdges.length}  violations=${r.violations.length}  new=${r.newViolations.length}`];
  for (const v of r.violations)
    lines.push(`  ${v.baseline ? '[baseline]' : '[NEW]     '} ${v.edge}  dirEdges=${v.count}  value=${v.value ?? '?'} type-only=${v.typeOnly ?? '?'}`);
  if (r.resolvedBaseline.length) lines.push(`  已消除的基线项（可从 known_violations 删除）: ${r.resolvedBaseline.join('; ')}`);
  lines.push(`  覆盖缺口: 未映射目录 ${r.gaps.unmappedDirs.length}，未解析别名边 ${r.gaps.unresolvedEdges.length}`);
  // 以下两段仅在传了 --before / --classify-cycles 时存在（对应 report 字段），不影响省略时的逐字节输出。
  if (r.driftReport) {
    const byKind = (k) => r.driftReport.filter((d) => d.classification === k);
    lines.push(
      `  drift（vs --before）: new-and-undeclared=${byKind('new-and-undeclared').length}  new-and-declared=${byKind('new-and-declared').length}  preexisting-and-undeclared=${byKind('preexisting-and-undeclared').length}`
    );
    for (const d of r.driftReport) lines.push(`    [${d.classification}] ${d.edge.from} -> ${d.edge.to}`);
  }
  if (r.cycleClassification) {
    lines.push(`  环分类（--classify-cycles）: ${r.cycleClassification.map((c) => `${c.cycleId}=${c.classification}`).join('  ')}`);
    if (r.bidirectionalAllowedPairs?.length) lines.push(`  双向 allowed 层对（值得人复核）: ${r.bidirectionalAllowedPairs.join('; ')}`);
  }
  return lines.join('\n');
}

function renderHtml(r) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  if (r.status === 'not-evaluated')
    return `<!doctype html><meta charset=utf-8><title>layer map</title><body><h1>未评估</h1><p>${esc(r.reason)}</p>`;
  const byRank = {};
  for (const [n, d] of Object.entries(r.layers)) (byRank[d.rank] ??= []).push([n, d]);
  const rows = Object.keys(byRank)
    .map(Number)
    .sort((a, b) => b - a)
    .map(
      (k) =>
        `<div class=row><span class=rk>rank ${k}</span>${byRank[k]
          .map(([n, d]) => `<div class=box><b>${esc(n)}</b><small>${d.dirs.length} 个目录</small></div>`)
          .join('')}</div>`
    )
    .join('');
  const vt = r.violations
    .map(
      (v) =>
        `<tr class=${v.baseline ? 'base' : 'new'}><td>${esc(v.edge)}</td><td>${v.baseline ? '基线' : '新增'}</td><td>${v.count}</td><td>${v.value ?? '?'}</td><td>${v.typeOnly ?? '?'}</td><td>${esc(
          (v.files ?? []).slice(0, 3).map((f) => `${f.file} → ${f.to}`).join('\n')
        )}</td></tr>`
    )
    .join('');
  return `<!doctype html><meta charset=utf-8><title>archguard layer map</title>
<style>body{font:14px system-ui;margin:24px;max-width:1000px}.row{display:flex;gap:8px;margin:6px 0;align-items:stretch}.rk{width:60px;color:#888;align-self:center}
.box{flex:1;border:1px solid #888;border-radius:6px;padding:8px;background:#f6f8fa}.box small{display:block;color:#666}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}tr.new td{background:#ffe5e5}tr.base td{background:#fff6dd}</style>
<h1>archguard 分层图（草稿，未经人审）</h1><p>数据: ${esc(r.generatedFrom.arch)}（${esc(r.generatedFrom.timestamp)}）· 状态: <b>${r.status}</b>（新增违例 ${r.newViolations.length}）</p>
<h2>层（rank 大的在上，应只依赖下面的层）</h2>${rows}
<h2>违例（allowed 之外的层间边）</h2>
<table><tr><th>方向</th><th>状态</th><th>目录级边</th><th>值依赖</th><th>type-only</th><th>示例</th></tr>${vt || '<tr><td colspan=6>无</td></tr>'}</table>
<h2>覆盖缺口（未评估的部分）</h2>
<ul><li>未映射到任何层的目录: ${r.gaps.unmappedDirs.length ? esc(r.gaps.unmappedDirs.join(', ')) : '无'}</li>
<li>未解析的别名边（在目录级图里不可见）: ${r.gaps.unresolvedEdges.length ? esc(r.gaps.unresolvedEdges.join('; ')) : '无'}</li>
<li>外部依赖边已忽略: ${r.gaps.externalEdgesIgnored}</li>
<li>运行时/编排层（进程、markdown、git）不在 import 图里，本检查不覆盖。</li></ul>`;
}

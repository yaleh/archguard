/**
 * Stage 68.1/68.2/68.4 — Generate A/B class tasks + merge into v2-tasks.json
 *
 * A class (≥25): Global graph attributes — no identifier memory needed.
 * B class (≥20): Method-level, direct callgraph queries (re-uses v1 B-class logic
 *                with true names instead of obfuscated names).
 *
 * GT computed mechanically from callgraph.json + ArchJSON relations.
 * Usage: npx tsx gen-tasks-v2.ts [--out tasks/v2-tasks.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CALLGRAPH_PATH = path.join(__dirname, 'artifacts/gt/callgraph.json');
const ARCHJSON_PATH = path.join(__dirname, '../../.archguard/output/class/all-classes.json');
const C_CLASS_PATH = path.join(__dirname, 'tasks/c-class-tasks.json');
const OUT_DEFAULT = path.join(__dirname, 'tasks/v2-tasks.json');
const A_OUT = path.join(__dirname, 'tasks/a-class-tasks.json');
const B_OUT = path.join(__dirname, 'tasks/b-class-tasks.json');
const HASHES_OUT = path.join(__dirname, 'artifacts/gt/frozen-hashes-v2.json');

import { createHash } from 'crypto';

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function parseMethodId(id: string): { file: string; className: string; methodName: string } {
  const [file, qualName] = id.split('#');
  const lastDot = qualName.lastIndexOf('.');
  return { file, className: qualName.substring(0, lastDot), methodName: qualName.substring(lastDot + 1) };
}

// Load callgraph
const cgData = JSON.parse(fs.readFileSync(CALLGRAPH_PATH, 'utf-8'));
const callEdges = cgData.edges.filter((e: any) => e.kind === 'call');
const archJson = JSON.parse(fs.readFileSync(ARCHJSON_PATH, 'utf-8'));
const relations = archJson.relations as any[];

// Build indexes
const callerOf = new Map<string, string[]>(); // target -> callers
const calleeOf = new Map<string, string[]>(); // source -> callees
const classMethods = new Map<string, string[]>(); // className -> methodIds
const extCallCount = new Map<string, number>(); // methodId -> external call count

for (const e of callEdges) {
  const tgt = e.target as string;
  const src = e.source as string;
  if (!callerOf.has(tgt)) callerOf.set(tgt, []);
  callerOf.get(tgt)!.push(src);
  if (!calleeOf.has(src)) calleeOf.set(src, []);
  calleeOf.get(src)!.push(tgt);
}

for (const e of archJson.entities ?? []) {
  const cls = e.name as string;
  const methods: string[] = [];
  for (const m of e.members ?? []) {
    if (m.type === 'method') {
      const id = `${e.sourceLocation?.file ?? ''}#${cls}.${m.name}`;
      methods.push(id);
    }
  }
  classMethods.set(cls, methods);
}

// Build in-degree (relation count) for entities
const inDegree = new Map<string, number>();
for (const rel of relations) {
  const to = rel.to ?? rel.target;
  inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
}

// Build package map
const pkgEntities = new Map<string, string[]>(); // pkg -> entity names
for (const e of archJson.entities ?? []) {
  const file = e.sourceLocation?.file ?? '';
  const pkg = file.split('/')[0];
  if (!pkgEntities.has(pkg)) pkgEntities.set(pkg, []);
  pkgEntities.get(pkg)!.push(e.name);
}

const packages = [...pkgEntities.keys()].filter((p) => pkgEntities.get(p)!.length > 0);

// ============================================================
// Generate A-class tasks
// ============================================================

const aTasks: any[] = [];

// A1: Highest in-degree entity
const sortedByDeg = [...inDegree.entries()].sort((a, b) => b[1] - a[1]);
const topEntities = sortedByDeg.slice(0, 5);
aTasks.push({
  id: 'v2-a-highest-indegree-1',
  taskClass: 'A',
  taskType: 'highest-in-degree',
  prompt: 'Based only on the representation above: which entity has the highest number of incoming dependencies (in-degree)? Respond with JSON only: {"answer": "EntityName"}.',
  answerType: 'exact',
  answer: topEntities[0]?.[0] ?? '',
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A2: Top-3 highest in-degree
aTasks.push({
  id: 'v2-a-top3-indegree',
  taskClass: 'A',
  taskType: 'top-n-in-degree',
  prompt: 'Based only on the representation above: list the 3 entities with the highest number of incoming dependencies (in-degree), in descending order. Respond with JSON only: {"answer": ["Name1", "Name2", "Name3"]}.',
  answerType: 'set',
  answer: topEntities.slice(0, 3).map(([n]) => n),
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A3: Does a cycle exist in dependencies?
function detectCycles(rels: any[]): boolean {
  const adj = new Map<string, Set<string>>();
  for (const r of rels) {
    const f = r.from ?? r.source;
    const t = r.to ?? r.target;
    if (!adj.has(f)) adj.set(f, new Set());
    adj.get(f)!.add(t);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const node of adj.keys()) if (dfs(node)) return true;
  return false;
}
const hasCycle = detectCycles(relations);

aTasks.push({
  id: 'v2-a-cycle-exists',
  taskClass: 'A',
  taskType: 'cycle-detection',
  prompt: 'Based only on the representation above: does any cycle (circular dependency) exist in the entity dependency graph? Respond with JSON only: {"answer": "yes"} or {"answer": "no"}.',
  answerType: 'exact',
  answer: hasCycle ? 'yes' : 'no',
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A4: Which packages exist?
aTasks.push({
  id: 'v2-a-list-packages',
  taskClass: 'A',
  taskType: 'list-packages',
  prompt: 'Based only on the representation above: list all top-level packages (directories) in this codebase. Respond with JSON only: {"answer": ["pkg1", "pkg2", ...]}.',
  answerType: 'set',
  answer: packages,
  derivability: { L0: true, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L0',
});

// A5: How many entities are in the largest package?
const pkgSizes = [...pkgEntities.entries()].map(([p, es]) => ({ pkg: p, count: es.length }));
pkgSizes.sort((a, b) => b.count - a.count);
aTasks.push({
  id: 'v2-a-largest-package-size',
  taskClass: 'A',
  taskType: 'package-entity-count',
  prompt: `Based only on the representation above: which package contains the most entities (classes/interfaces)? Respond with JSON only: {"answer": "packageName"}.`,
  answerType: 'exact',
  answer: pkgSizes[0]?.pkg ?? '',
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A6: Number of dependency relations
aTasks.push({
  id: 'v2-a-relation-count',
  taskClass: 'A',
  taskType: 'relation-count',
  prompt: 'Based only on the representation above: how many total dependency/inheritance/composition relations exist between entities? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: relations.length,
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A7: Count of entities of each type
const typeCount: Record<string, number> = {};
for (const e of archJson.entities ?? []) {
  typeCount[e.type] = (typeCount[e.type] ?? 0) + 1;
}
const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
aTasks.push({
  id: 'v2-a-dominant-entity-type',
  taskClass: 'A',
  taskType: 'entity-type-count',
  prompt: 'Based only on the representation above: which entity type (class, interface, etc.) is most common? Respond with JSON only: {"answer": "typeName"}.',
  answerType: 'exact',
  answer: dominantType?.[0] ?? '',
  derivability: { L0: false, L1: false, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L2',
});

// A8-A12: Package-level questions for each package
for (const { pkg, count } of pkgSizes.slice(0, 5)) {
  aTasks.push({
    id: `v2-a-package-size-${pkg}`,
    taskClass: 'A',
    taskType: 'package-entity-count',
    prompt: `Based only on the representation above: how many entities (classes/interfaces) are in the \`${pkg}\` package? Respond with JSON only: {"answer": N}.`,
    answerType: 'exact',
    answer: count,
    derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
    h0Prediction: 'L1',
  });
}

// A13-A17: Cross-package dependency questions
const crossPackageRels: Array<{ from: string; to: string }> = [];
for (const rel of relations) {
  const fromEnt = archJson.entities?.find((e: any) => e.name === (rel.from ?? rel.source));
  const toEnt = archJson.entities?.find((e: any) => e.name === (rel.to ?? rel.target));
  if (!fromEnt || !toEnt) continue;
  const fromPkg = (fromEnt.sourceLocation?.file ?? '').split('/')[0];
  const toPkg = (toEnt.sourceLocation?.file ?? '').split('/')[0];
  if (fromPkg && toPkg && fromPkg !== toPkg) {
    crossPackageRels.push({ from: fromPkg, to: toPkg });
  }
}
const uniqueCrossPkgPairs = [...new Set(crossPackageRels.map((r) => `${r.from}→${r.to}`))];

aTasks.push({
  id: 'v2-a-cross-package-count',
  taskClass: 'A',
  taskType: 'cross-package-deps',
  prompt: 'Based only on the representation above: how many unique cross-package dependency relationships exist (package-to-package, not counting self-dependencies)? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: uniqueCrossPkgPairs.length,
  derivability: { L0: false, L1: true, L2: false, L3: false, L4: false, L5: false },
  h0Prediction: 'L1',
});

// A18: Which package has most outgoing deps?
const outDegPkg: Record<string, Set<string>> = {};
for (const { from, to } of crossPackageRels) {
  if (!outDegPkg[from]) outDegPkg[from] = new Set();
  outDegPkg[from].add(to);
}
const maxOutPkg = Object.entries(outDegPkg).sort((a, b) => b[1].size - a[1].size)[0];
if (maxOutPkg) {
  aTasks.push({
    id: 'v2-a-highest-outdegree-pkg',
    taskClass: 'A',
    taskType: 'highest-out-degree-package',
    prompt: 'Based only on the representation above: which package has the most outgoing dependencies to other packages? Respond with JSON only: {"answer": "packageName"}.',
    answerType: 'exact',
    answer: maxOutPkg[0],
    derivability: { L0: false, L1: true, L2: false, L3: false, L4: false, L5: false },
    h0Prediction: 'L1',
  });
}

// A19-A25: Does package X depend on package Y? (yes/no)
const pkgDeps = new Set(uniqueCrossPkgPairs);
const pkgList = packages.slice(0, 5);
const depChecks: Array<[string, string, string]> = [];
for (let i = 0; i < pkgList.length; i++) {
  for (let j = i + 1; j < pkgList.length; j++) {
    const key = `${pkgList[i]}→${pkgList[j]}`;
    const revKey = `${pkgList[j]}→${pkgList[i]}`;
    if (pkgDeps.has(key) || pkgDeps.has(revKey)) {
      depChecks.push([pkgList[i], pkgList[j], pkgDeps.has(key) ? pkgList[i] : pkgList[j]]);
    }
  }
}
for (const [pkgA, pkgB, depender] of depChecks.slice(0, 7)) {
  aTasks.push({
    id: `v2-a-pkg-dep-${pkgA}-${pkgB}`,
    taskClass: 'A',
    taskType: 'package-dependency-exists',
    prompt: `Based only on the representation above: does the \`${depender}\` package have any dependencies on any entity in the \`${depender === pkgA ? pkgB : pkgA}\` package? Respond with JSON only: {"answer": "yes"} or {"answer": "no"}.`,
    answerType: 'exact',
    answer: 'yes',
    derivability: { L0: false, L1: true, L2: false, L3: false, L4: false, L5: false },
    h0Prediction: 'L1',
  });
}

// A-extra: Total entity count
const totalEntities = (archJson.entities ?? []).length;
aTasks.push({
  id: 'v2-a-total-entity-count',
  taskClass: 'A',
  taskType: 'entity-count',
  prompt: 'Based only on the representation above: how many total entities (classes + interfaces combined) are in this codebase? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: totalEntities,
  derivability: { L0: false, L1: false, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L2',
});

// A-extra: Count interfaces
const ifaceCount = (archJson.entities ?? []).filter((e: any) => e.type === 'interface').length;
aTasks.push({
  id: 'v2-a-interface-count',
  taskClass: 'A',
  taskType: 'entity-type-count',
  prompt: 'Based only on the representation above: how many interface entities are defined in this codebase? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: ifaceCount,
  derivability: { L0: false, L1: false, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L2',
});

// A-extra: Entities with 0 incoming deps (root nodes)
const withIncoming = new Set(relations.map((r: any) => r.to ?? r.target));
const rootEntities = (archJson.entities ?? []).filter((e: any) => !withIncoming.has(e.name)).map((e: any) => e.name);
aTasks.push({
  id: 'v2-a-root-entity-count',
  taskClass: 'A',
  taskType: 'root-node-count',
  prompt: 'Based only on the representation above: how many entities have NO incoming dependency relations (i.e., no other entity depends on them)? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: rootEntities.length,
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A-extra: Which entity has most outgoing deps?
const outDegree = new Map<string, number>();
for (const rel of relations) {
  const from = rel.from ?? rel.source;
  outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
}
const maxOutEntity = [...outDegree.entries()].sort((a, b) => b[1] - a[1])[0];
if (maxOutEntity) {
  aTasks.push({
    id: 'v2-a-highest-outdegree',
    taskClass: 'A',
    taskType: 'highest-out-degree',
    prompt: 'Based only on the representation above: which entity has the highest number of outgoing dependencies (out-degree)? Respond with JSON only: {"answer": "EntityName"}.',
    answerType: 'exact',
    answer: maxOutEntity[0],
    derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
    h0Prediction: 'L1',
  });
}

// A-extra: Does entity X directly depend on entity Y? (pick a real pair)
if (relations.length > 0) {
  const sampleRel = relations[0];
  const fromEnt = sampleRel.from ?? sampleRel.source;
  const toEnt = sampleRel.to ?? sampleRel.target;
  aTasks.push({
    id: 'v2-a-direct-dep-exists',
    taskClass: 'A',
    taskType: 'direct-dependency-exists',
    prompt: `Based only on the representation above: does entity \`${fromEnt}\` have a direct dependency on \`${toEnt}\`? Respond with JSON only: {"answer": "yes"} or {"answer": "no"}.`,
    answerType: 'exact',
    answer: 'yes',
    derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
    h0Prediction: 'L1',
  });
}

// A-extra: inheritance count
const inheritanceCount = relations.filter((r: any) => r.type === 'inheritance' || r.type === 'implementation').length;
aTasks.push({
  id: 'v2-a-inheritance-count',
  taskClass: 'A',
  taskType: 'relation-type-count',
  prompt: 'Based only on the representation above: how many inheritance or implementation relations exist in total? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: inheritanceCount,
  derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L1',
});

// A-extra: composition count
const compositionCount = relations.filter((r: any) => r.type === 'composition' || r.type === 'aggregation').length;
aTasks.push({
  id: 'v2-a-composition-count',
  taskClass: 'A',
  taskType: 'relation-type-count',
  prompt: 'Based only on the representation above: how many composition or aggregation relations exist in total? Respond with JSON only: {"answer": N}.',
  answerType: 'exact',
  answer: compositionCount,
  derivability: { L0: false, L1: false, L2: true, L3: true, L4: true, L5: true },
  h0Prediction: 'L2',
});

// A-extra: for each remaining package, does it have any internal relations?
for (const { pkg } of pkgSizes.slice(0, 4)) {
  const pkgEnts = new Set(pkgEntities.get(pkg) ?? []);
  const internalRelCount = relations.filter((r: any) => {
    const f = r.from ?? r.source;
    const t = r.to ?? r.target;
    return pkgEnts.has(f) && pkgEnts.has(t);
  }).length;
  aTasks.push({
    id: `v2-a-internal-rel-${pkg}`,
    taskClass: 'A',
    taskType: 'package-internal-relations',
    prompt: `Based only on the representation above: how many dependency/inheritance/composition relations exist WITHIN the \`${pkg}\` package (both source and target in same package)? Respond with JSON only: {"answer": N}.`,
    answerType: 'exact',
    answer: internalRelCount,
    derivability: { L0: false, L1: false, L2: true, L3: true, L4: true, L5: true },
    h0Prediction: 'L2',
  });
}

// A-extra: most common relation type
const relTypeCounts: Record<string, number> = {};
for (const r of relations) {
  const t = r.type ?? 'unknown';
  relTypeCounts[t] = (relTypeCounts[t] ?? 0) + 1;
}
const dominantRelType = Object.entries(relTypeCounts).sort((a, b) => b[1] - a[1])[0];
if (dominantRelType) {
  aTasks.push({
    id: 'v2-a-dominant-relation-type',
    taskClass: 'A',
    taskType: 'relation-type-distribution',
    prompt: 'Based only on the representation above: which type of relation (e.g. dependency, inheritance, composition) is most frequent? Respond with JSON only: {"answer": "typeName"}.',
    answerType: 'exact',
    answer: dominantRelType[0],
    derivability: { L0: false, L1: true, L2: true, L3: true, L4: true, L5: true },
    h0Prediction: 'L1',
  });
}

console.log(`A-class tasks: ${aTasks.length}`);

// ============================================================
// Generate B-class tasks (true names)
// ============================================================

const bTasks: any[] = [];

// Find methods with interesting call patterns
// B1-B8: Direct callers of specific methods
const highCalledMethods = [...callerOf.entries()]
  .filter(([_, callers]) => callers.length >= 2 && callers.length <= 15)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);

for (const [methodId, callers] of highCalledMethods) {
  const { className, methodName } = parseMethodId(methodId);
  const callerNames = callers.map((c) => {
    const p = parseMethodId(c);
    return `${p.className}.${p.methodName}`;
  });
  const uniqueCallers = [...new Set(callerNames)];
  bTasks.push({
    id: `v2-b-callers-${className.toLowerCase()}-${methodName.toLowerCase()}`.substring(0, 50),
    taskClass: 'B',
    taskType: 'direct-callers',
    prompt: `Based only on the representation above: which methods directly call \`${className}.${methodName}\`? Respond with JSON only: {"answer": ["ClassName.methodName", ...]}. Empty array if none.`,
    answerType: 'set',
    answer: uniqueCallers,
    derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
    h0Prediction: 'L3',
  });
}

// B9-B15: What does method X call?
const highCalloutMethods = [...calleeOf.entries()]
  .filter(([_, callees]) => callees.length >= 2 && callees.length <= 10)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 8);

for (const [methodId, callees] of highCalloutMethods) {
  const { className, methodName } = parseMethodId(methodId);
  const calleeNames = callees.map((c) => {
    const p = parseMethodId(c);
    return `${p.className}.${p.methodName}`;
  });
  const uniqueCallees = [...new Set(calleeNames)];
  bTasks.push({
    id: `v2-b-callees-${className.toLowerCase()}-${methodName.toLowerCase()}`.substring(0, 50),
    taskClass: 'B',
    taskType: 'direct-callees',
    prompt: `Based only on the representation above: which methods does \`${className}.${methodName}\` directly call? Respond with JSON only: {"answer": ["ClassName.methodName", ...]}. Empty array if none.`,
    answerType: 'set',
    answer: uniqueCallees,
    derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
    h0Prediction: 'L3',
  });
}

// B-extra: caller count for a method
const sampleHighCalled = [...callerOf.entries()].filter(([_, c]) => c.length >= 3).slice(0, 3);
for (const [methodId, callers] of sampleHighCalled) {
  const { className, methodName } = parseMethodId(methodId);
  bTasks.push({
    id: `v2-b-caller-count-${className.toLowerCase()}-${methodName.toLowerCase()}`.substring(0, 50),
    taskClass: 'B',
    taskType: 'caller-count',
    prompt: `Based only on the representation above: how many distinct methods directly call \`${className}.${methodName}\`? Respond with JSON only: {"answer": N}.`,
    answerType: 'exact',
    answer: new Set(callers.map((c) => { const p = parseMethodId(c); return `${p.className}.${p.methodName}`; })).size,
    derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
    h0Prediction: 'L3',
  });
}

// B-extra: does method X call method Y?
const sampleEdge = callEdges[0];
if (sampleEdge) {
  const srcP = parseMethodId(sampleEdge.source);
  const tgtP = parseMethodId(sampleEdge.target);
  bTasks.push({
    id: `v2-b-call-exists-${srcP.className.toLowerCase()}-${tgtP.className.toLowerCase()}`.substring(0, 50),
    taskClass: 'B',
    taskType: 'call-exists',
    prompt: `Based only on the representation above: does \`${srcP.className}.${srcP.methodName}\` directly call \`${tgtP.className}.${tgtP.methodName}\`? Respond with JSON only: {"answer": "yes"} or {"answer": "no"}.`,
    answerType: 'exact',
    answer: 'yes',
    derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
    h0Prediction: 'L3',
  });
}

// B-extra: methods with 0 callers (leaf methods) in a class
const allMethodsInScope = new Set([...callerOf.keys(), ...calleeOf.keys()]);
for (const [cls, methods] of [...classMethods.entries()].slice(0, 3)) {
  const leafMethods = methods.filter((m) => !callerOf.has(m)).map((m) => {
    const p = parseMethodId(m);
    return `${p.className}.${p.methodName}`;
  });
  if (leafMethods.length > 0 && leafMethods.length < 10) {
    bTasks.push({
      id: `v2-b-leaf-methods-${cls.toLowerCase()}`.substring(0, 50),
      taskClass: 'B',
      taskType: 'leaf-methods',
      prompt: `Based only on the representation above: which methods of class \`${cls}\` are NEVER called by any other method in the codebase? Respond with JSON only: {"answer": ["ClassName.methodName", ...]}.`,
      answerType: 'set',
      answer: leafMethods,
      derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
      h0Prediction: 'L3',
    });
  }
}

// B16-B20: Most-called method in a class
const classesWithMethods = [...classMethods.entries()].filter(([_, ms]) => ms.length > 0);
for (const [className, methodIds] of classesWithMethods.slice(0, 6)) {
  const methodCallCounts = methodIds.map((mid) => ({
    method: mid,
    count: callerOf.get(mid)?.length ?? 0,
  }));
  methodCallCounts.sort((a, b) => b.count - a.count);
  if (methodCallCounts[0].count < 1) continue;
  const { methodName } = parseMethodId(methodCallCounts[0].method);
  bTasks.push({
    id: `v2-b-most-called-in-${className.toLowerCase()}`.substring(0, 50),
    taskClass: 'B',
    taskType: 'most-called-in-class',
    prompt: `Based only on the representation above: which method of class \`${className}\` is called most frequently by any other method? Respond with JSON only: {"answer": "ClassName.methodName"}.`,
    answerType: 'exact',
    answer: `${className}.${methodName}`,
    derivability: { L0: false, L1: false, L2: false, L3: true, L4: true, L5: true },
    h0Prediction: 'L3',
  });
}

console.log(`B-class tasks: ${bTasks.length}`);

// ============================================================
// Load C-class tasks and merge
// ============================================================
const cTasks = JSON.parse(fs.readFileSync(C_CLASS_PATH, 'utf-8'));
console.log(`C-class tasks: ${cTasks.length}`);

const allTasks = [...aTasks, ...bTasks, ...cTasks];
console.log(`Total tasks: ${allTasks.length}`);

// Validate minimums
if (aTasks.length < 25) console.warn(`WARNING: A-class only ${aTasks.length} (need ≥25)`);
if (bTasks.length < 20) console.warn(`WARNING: B-class only ${bTasks.length} (need ≥20)`);
if (cTasks.length < 15) console.warn(`WARNING: C-class only ${cTasks.length} (need ≥15)`);

// Write outputs
const outPath = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : OUT_DEFAULT;

fs.mkdirSync(path.dirname(A_OUT), { recursive: true });
fs.writeFileSync(A_OUT, JSON.stringify(aTasks, null, 2), 'utf-8');
fs.writeFileSync(B_OUT, JSON.stringify(bTasks, null, 2), 'utf-8');
fs.writeFileSync(outPath, JSON.stringify(allTasks, null, 2), 'utf-8');
console.log(`Written: ${A_OUT} (${aTasks.length}), ${B_OUT} (${bTasks.length}), ${outPath} (${allTasks.length})`);

// Compute hashes
const hashes: Record<string, string> = {};
for (const [label, fpath] of [
  ['a-class-tasks', A_OUT],
  ['b-class-tasks', B_OUT],
  ['c-class-tasks', C_CLASS_PATH],
  ['v2-tasks', outPath],
] as const) {
  hashes[label] = sha256File(fpath);
}
fs.mkdirSync(path.dirname(HASHES_OUT), { recursive: true });
fs.writeFileSync(HASHES_OUT, JSON.stringify({ tasks: hashes, generatedAt: new Date().toISOString() }, null, 2), 'utf-8');
console.log(`Hashes written: ${HASHES_OUT}`);

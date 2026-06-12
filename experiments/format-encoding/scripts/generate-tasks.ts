/**
 * Phase 77 / 78 — Task Generator
 * Generates format-encoding experiment tasks from a C instance.
 *
 * Task classes:
 *   A — Topological: in/out degree, list all entities, count
 *   B — Relational: direct/indirect dependency checks, interface implementers
 *   C — Method-level: method counts, signatures, return types
 *
 * Usage: npx tsx scripts/generate-tasks.ts <archJson.json> [--out tasks.json]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { archJsonToC } from '../lib/corpus.js';
import type { C, CEntity, CRelation } from '../lib/schema.js';

export interface TaskDef {
  id: string;
  taskClass: 'A' | 'B' | 'C';
  taskType: string;
  prompt: string;
  answerType: 'exact' | 'set' | 'boolean' | 'integer';
  answer: string | string[] | boolean | number;
}

function topN<T>(items: T[], key: (t: T) => number, n: number): T[] {
  return [...items].sort((a, b) => key(b) - key(a)).slice(0, n);
}

function buildInDegree(relations: CRelation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of relations) { m.set(r.to, (m.get(r.to) ?? 0) + 1); }
  return m;
}

function buildOutDegree(relations: CRelation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of relations) { m.set(r.from, (m.get(r.from) ?? 0) + 1); }
  return m;
}

function directDeps(entityId: string, relations: CRelation[]): string[] {
  return relations.filter(r => r.from === entityId).map(r => r.to);
}

function directDependents(entityId: string, relations: CRelation[]): string[] {
  return relations.filter(r => r.to === entityId).map(r => r.from);
}

export function generateTasks(c: C, instanceLabel: string): TaskDef[] {
  const tasks: TaskDef[] = [];
  const entityIds = c.entities.map(e => e.id);
  const entityMap = new Map(c.entities.map(e => [e.id, e]));
  const inDeg = buildInDegree(c.relations);
  const outDeg = buildOutDegree(c.relations);

  // Stable random selection (deterministic seeding by entity count)
  const seed = c.entities.length;
  const pick = (arr: string[], i = 0) => arr[(i * 7 + seed) % arr.length];

  // --- Task A: Topological ---

  // A1: highest in-degree entity
  const highestIn = topN(entityIds, id => inDeg.get(id) ?? 0, 1)[0];
  if (highestIn) {
    const candidates = entityIds.filter(id => (inDeg.get(id) ?? 0) === (inDeg.get(highestIn) ?? 0));
    tasks.push({
      id: `${instanceLabel}-A-highest-in-degree`,
      taskClass: 'A',
      taskType: 'highest-in-degree',
      prompt: 'Based only on the representation above: which entity has the highest number of incoming dependencies (in-degree)? If there is a tie, give any one. Respond with JSON: {"answer": "entity-id"}.',
      answerType: 'set',
      answer: candidates,
    });
  }

  // A2: highest out-degree entity
  const highestOut = topN(entityIds, id => outDeg.get(id) ?? 0, 1)[0];
  if (highestOut) {
    const candidates = entityIds.filter(id => (outDeg.get(id) ?? 0) === (outDeg.get(highestOut) ?? 0));
    tasks.push({
      id: `${instanceLabel}-A-highest-out-degree`,
      taskClass: 'A',
      taskType: 'highest-out-degree',
      prompt: 'Based only on the representation above: which entity has the highest number of outgoing dependencies (out-degree)? If there is a tie, give any one. Respond with JSON: {"answer": "entity-id"}.',
      answerType: 'set',
      answer: candidates,
    });
  }

  // A3: total entity count
  tasks.push({
    id: `${instanceLabel}-A-entity-count`,
    taskClass: 'A',
    taskType: 'entity-count',
    prompt: 'Based only on the representation above: how many entities are described? Respond with JSON: {"answer": <integer>}.',
    answerType: 'integer',
    answer: c.entities.length,
  });

  // A4: total relation count
  tasks.push({
    id: `${instanceLabel}-A-relation-count`,
    taskClass: 'A',
    taskType: 'relation-count',
    prompt: 'Based only on the representation above: how many relations (dependencies, inheritance, etc.) are described? Respond with JSON: {"answer": <integer>}.',
    answerType: 'integer',
    answer: c.relations.length,
  });

  // A5: entity with most methods
  const mostMethods = topN(c.entities, e => e.methods.length, 1)[0];
  if (mostMethods && mostMethods.methods.length > 0) {
    const tied = c.entities.filter(e => e.methods.length === mostMethods.methods.length).map(e => e.id);
    tasks.push({
      id: `${instanceLabel}-A-most-methods`,
      taskClass: 'A',
      taskType: 'most-methods',
      prompt: 'Based only on the representation above: which entity has the most methods? If there is a tie, give any one. Respond with JSON: {"answer": "entity-id"}.',
      answerType: 'set',
      answer: tied,
    });
  }

  // --- Task B: Relational ---

  // B1: direct dependencies of a chosen entity
  const entWithDeps = c.entities.filter(e => outDeg.get(e.id) && (outDeg.get(e.id) ?? 0) > 0);
  if (entWithDeps.length > 0) {
    const e = entWithDeps[Math.floor(entWithDeps.length / 3)]!;
    const deps = directDeps(e.id, c.relations);
    tasks.push({
      id: `${instanceLabel}-B-direct-deps-0`,
      taskClass: 'B',
      taskType: 'direct-deps',
      prompt: `Based only on the representation above: list the IDs of all entities that "${e.id}" directly depends on. Respond with JSON: {"answer": ["id1", "id2", ...]}.`,
      answerType: 'set',
      answer: deps,
    });
  }

  // B2: direct dependents of a chosen entity
  const entWithDependents = c.entities.filter(e => inDeg.get(e.id) && (inDeg.get(e.id) ?? 0) > 0);
  if (entWithDependents.length > 0) {
    const e = entWithDependents[Math.floor(entWithDependents.length / 2)]!;
    const dependents = directDependents(e.id, c.relations);
    tasks.push({
      id: `${instanceLabel}-B-direct-dependents-0`,
      taskClass: 'B',
      taskType: 'direct-dependents',
      prompt: `Based only on the representation above: list the IDs of all entities that directly depend on "${e.id}". Respond with JSON: {"answer": ["id1", "id2", ...]}.`,
      answerType: 'set',
      answer: dependents,
    });
  }

  // B3: does entity A directly depend on entity B?
  if (c.relations.length > 0) {
    const rel = c.relations[Math.floor(c.relations.length / 4)]!;
    tasks.push({
      id: `${instanceLabel}-B-direct-dep-check-yes`,
      taskClass: 'B',
      taskType: 'direct-dep-check',
      prompt: `Based only on the representation above: does entity "${rel.from}" directly depend on entity "${rel.to}"? Respond with JSON: {"answer": true} or {"answer": false}.`,
      answerType: 'boolean',
      answer: true,
    });
  }

  // B4: negative case — entity that does NOT depend on another
  const entNoDep = c.entities.find(e => {
    const deps = directDeps(e.id, c.relations);
    return deps.length === 0;
  });
  const anyOtherEnt = c.entities.find(e => e.id !== entNoDep?.id);
  if (entNoDep && anyOtherEnt) {
    tasks.push({
      id: `${instanceLabel}-B-direct-dep-check-no`,
      taskClass: 'B',
      taskType: 'direct-dep-check',
      prompt: `Based only on the representation above: does entity "${entNoDep.id}" directly depend on entity "${anyOtherEnt.id}"? Respond with JSON: {"answer": true} or {"answer": false}.`,
      answerType: 'boolean',
      answer: false,
    });
  }

  // B5: count entities of a given type
  const typeGroups = new Map<string, string[]>();
  for (const e of c.entities) {
    if (!typeGroups.has(e.type)) typeGroups.set(e.type, []);
    typeGroups.get(e.type)!.push(e.id);
  }
  const mostCommonType = [...typeGroups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (mostCommonType) {
    tasks.push({
      id: `${instanceLabel}-B-count-by-type`,
      taskClass: 'B',
      taskType: 'count-by-type',
      prompt: `Based only on the representation above: how many entities have type "${mostCommonType[0]}"? Respond with JSON: {"answer": <integer>}.`,
      answerType: 'integer',
      answer: mostCommonType[1].length,
    });
  }

  // B6: entities with a specific relation type
  const inheritanceRels = c.relations.filter(r => r.type === 'inheritance');
  if (inheritanceRels.length > 0) {
    const subclasses = [...new Set(inheritanceRels.map(r => r.from))];
    tasks.push({
      id: `${instanceLabel}-B-subclasses`,
      taskClass: 'B',
      taskType: 'subclasses',
      prompt: 'Based only on the representation above: list the IDs of all entities that inherit from another entity (i.e. have an inheritance/extends relation). Respond with JSON: {"answer": ["id1", ...]}.',
      answerType: 'set',
      answer: subclasses,
    });
  }

  // --- Task C: Method-level ---

  // C1: method count of a chosen entity
  const entWithMethods = c.entities.filter(e => e.methods.length > 0);
  if (entWithMethods.length > 0) {
    const e = entWithMethods[Math.floor(entWithMethods.length / 3)]!;
    tasks.push({
      id: `${instanceLabel}-C-method-count-0`,
      taskClass: 'C',
      taskType: 'method-count',
      prompt: `Based only on the representation above: how many methods does entity "${e.id}" have? Respond with JSON: {"answer": <integer>}.`,
      answerType: 'integer',
      answer: e.methods.length,
    });
  }

  // C2: method return type
  const entWithTypedMethods = c.entities.filter(e =>
    e.methods.some(m => m.returnType && m.returnType !== 'void')
  );
  if (entWithTypedMethods.length > 0) {
    const e = entWithTypedMethods[Math.floor(entWithTypedMethods.length / 2)]!;
    const m = e.methods.find(m => m.returnType && m.returnType !== 'void')!;
    tasks.push({
      id: `${instanceLabel}-C-return-type-0`,
      taskClass: 'C',
      taskType: 'return-type',
      prompt: `Based only on the representation above: what is the return type of method "${m.name}" in entity "${e.id}"? Respond with JSON: {"answer": "type"}.`,
      answerType: 'exact',
      answer: m.returnType ?? 'void',
    });
  }

  // C3: list all method names for an entity
  if (entWithMethods.length > 0) {
    const e = entWithMethods[Math.floor(entWithMethods.length * 2 / 3)]!;
    const names = e.methods.map(m => m.name);
    tasks.push({
      id: `${instanceLabel}-C-method-names-0`,
      taskClass: 'C',
      taskType: 'method-names',
      prompt: `Based only on the representation above: list the names of all methods defined in entity "${e.id}". Respond with JSON: {"answer": ["name1", "name2", ...]}.`,
      answerType: 'set',
      answer: names,
    });
  }

  return tasks;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1]! : 'artifacts/tasks.json';
  const corpusPaths = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

  if (corpusPaths.length === 0) {
    console.error('Usage: tsx scripts/generate-tasks.ts <archJson.json> [...] [--out tasks.json]');
    process.exit(1);
  }

  const allTasks: TaskDef[] = [];
  for (const p of corpusPaths) {
    const raw = JSON.parse(await readFile(p, 'utf-8'));
    const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
    const label = p.split('/').slice(-3, -1).join('-');
    const tasks = generateTasks(c, label);
    allTasks.push(...tasks);
    console.log(`Generated ${tasks.length} tasks for ${label}`);
  }

  await writeFile(outPath, JSON.stringify(allTasks, null, 2));
  console.log(`Written ${allTasks.length} tasks → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });

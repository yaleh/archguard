/**
 * ArchIndexBuilder — pure function that constructs an ArchIndex from rawArchJSON.
 */

import path from 'path';
import type { ArchJSON, RelationType, CycleInfo } from '@/types/index.js';
import { ARCH_INDEX_VERSION } from './arch-index.js';
import type { ArchIndex } from './arch-index.js';

/**
 * Build an ArchIndex from a rawArchJSON.
 *
 * @param archJson     - The rawArchJSON (e.g. from getPrimaryArchJson())
 * @param archJsonHash - SHA-256 of the serialised arch.json file content
 */
export function buildArchIndex(archJson: ArchJSON, archJsonHash: string): ArchIndex {
  const { entities, relations, language, workspaceRoot } = archJson;

  const entityIds = new Set(entities.map(e => e.id));

  // Build forward maps
  const nameToIds: Record<string, string[]> = {};
  const idToFile: Record<string, string> = {};
  const idToName: Record<string, string> = {};
  const dependents: Record<string, string[]> = {};
  const dependencies: Record<string, string[]> = {};
  const fileToIds: Record<string, string[]> = {};

  for (const entity of entities) {
    // nameToIds
    const bucket = nameToIds[entity.name] ?? [];
    bucket.push(entity.id);
    nameToIds[entity.name] = bucket;

    // idToFile (normalise C++ absolute paths)
    let file = entity.sourceLocation?.file ?? '';
    if (workspaceRoot && path.isAbsolute(file)) {
      file = path.relative(workspaceRoot, file);
    }
    idToFile[entity.id] = file;

    // idToName
    idToName[entity.id] = entity.name;

    // seed empty adjacency lists
    dependents[entity.id] = [];
    dependencies[entity.id] = [];

    // fileToIds
    if (file) {
      const fb = fileToIds[file] ?? [];
      fb.push(entity.id);
      fileToIds[file] = fb;
    }
  }

  // Resolve a relation endpoint: prefer exact entity ID, fall back to unambiguous name match.
  const resolveId = (idOrName: string): string | undefined => {
    if (entityIds.has(idOrName)) return idOrName;
    const candidates = nameToIds[idOrName];
    return candidates?.length === 1 ? candidates[0] : undefined;
  };

  // Internal relations only (both endpoints resolvable to known entity IDs).
  // The TypeScript parser emits mixed formats: some targets are full IDs
  // (e.g. "cli/errors.ts.ParseError"), others are bare class names ("ArchJSON").
  // We resolve bare names when they map unambiguously to a single entity.
  const internalRelations = (relations ?? [])
    .map(r => {
      const src = resolveId(r.source);
      const tgt = resolveId(r.target);
      if (!src || !tgt) return null;
      return src === r.source && tgt === r.target ? r : { ...r, source: src, target: tgt };
    })
    .filter(Boolean) as typeof relations;

  // Populate adjacency + relationsByType
  const relationsByType: Partial<Record<RelationType, [string, string][]>> = {};
  for (const r of internalRelations) {
    dependents[r.target].push(r.source);
    dependencies[r.source].push(r.target);

    const typeBucket = relationsByType[r.type] ?? [];
    typeBucket.push([r.source, r.target]);
    relationsByType[r.type] = typeBucket;
  }

  // SCC (Kosaraju)
  const cycles = computeCycles(entities, internalRelations, idToFile, idToName);

  return {
    version: ARCH_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    archJsonHash,
    language: language ?? 'unknown',
    nameToIds,
    idToFile,
    idToName,
    dependents,
    dependencies,
    relationsByType,
    fileToIds,
    cycles,
  };
}

function computeCycles(
  entities: ArchJSON['entities'],
  relations: ArchJSON['relations'],
  idToFile: Record<string, string>,
  idToName: Record<string, string>,
): CycleInfo[] {
  if (entities.length === 0) return [];

  const graph = new Map<string, string[]>();
  const transposed = new Map<string, string[]>();
  for (const e of entities) {
    graph.set(e.id, []);
    transposed.set(e.id, []);
  }
  for (const r of relations) {
    graph.get(r.source)?.push(r.target);
    transposed.get(r.target)?.push(r.source);
  }

  // Pass 1: finish-order DFS
  const visited1 = new Set<string>();
  const finishStack: string[] = [];
  const dfs = (start: string, adj: Map<string, string[]>, vis: Set<string>, out: string[] | null) => {
    const stack: [string, number][] = [[start, 0]];
    vis.add(start);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top[0]) ?? [];
      if (top[1] < neighbors.length) {
        const next = neighbors[top[1]++];
        if (!vis.has(next)) {
          vis.add(next);
          stack.push([next, 0]);
        }
      } else {
        stack.pop();
        out?.push(top[0]);
      }
    }
  };
  for (const id of graph.keys()) {
    if (!visited1.has(id)) dfs(id, graph, visited1, finishStack);
  }

  // Pass 2: collect SCC members
  const visited2 = new Set<string>();
  const result: CycleInfo[] = [];
  while (finishStack.length) {
    const node = finishStack.pop()!;
    if (!visited2.has(node)) {
      const members: string[] = [];
      dfs(node, transposed, visited2, members);
      if (members.length > 1) {
        result.push({
          size: members.length,
          members,
          memberNames: members.map(id => idToName[id] ?? id),
          files: [...new Set(members.map(id => idToFile[id] ?? '').filter(Boolean))],
        });
      }
    }
  }

  return result.sort((a, b) => b.size - a.size);
}

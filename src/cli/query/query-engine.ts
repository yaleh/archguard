/**
 * QueryEngine — loads a single scope's ArchJSON + ArchIndex and provides query methods.
 *
 * Pure in-memory query object with no disk I/O. Use engine-loader.ts for loading from disk.
 */

import type { ArchJSON, Entity, Relation, RelationType, CycleInfo } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { QueryScopeEntry } from './query-manifest.js';

export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  visibility: string;
  file: string;
  methodCount: number;
  fieldCount: number;
}

export interface QueryEngineOptions {
  archJson: ArchJSON;
  archIndex: ArchIndex;
  scopeEntry: QueryScopeEntry;
}

export class QueryEngine {
  private archJson: ArchJSON;
  private index: ArchIndex;
  private scopeEntry: QueryScopeEntry;
  private entityMap: Map<string, Entity>;

  constructor(options: QueryEngineOptions) {
    this.archJson = options.archJson;
    this.index = options.archIndex;
    this.scopeEntry = options.scopeEntry;
    // Build entity map for fast lookup
    this.entityMap = new Map(options.archJson.entities.map((e) => [e.id, e]));
  }

  // ----------------------------------------------------------------
  // Query methods
  // ----------------------------------------------------------------

  /** Find entities by exact name match. */
  findEntity(name: string): Entity[] {
    const ids = this.index.nameToIds[name] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** BFS along the dependencies direction (what entityName depends on). */
  getDependencies(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependencies', depth);
  }

  /** BFS along the dependents direction (what depends on entityName). */
  getDependents(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependents', depth);
  }

  /** Find entities that implement the given interface (relation.type === 'implementation'). */
  findImplementers(interfaceName: string): Entity[] {
    const pairs = this.index.relationsByType['implementation'] ?? [];
    const ids = this.index.nameToIds[interfaceName] ?? [];
    const targetSet = new Set(ids);
    const implementerIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    return [...new Set(implementerIds)].map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Find subclasses of the given class (relation.type === 'inheritance'). */
  findSubclasses(className: string): Entity[] {
    const pairs = this.index.relationsByType['inheritance'] ?? [];
    const ids = this.index.nameToIds[className] ?? [];
    const targetSet = new Set(ids);
    const subclassIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    return [...new Set(subclassIds)].map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Get all entities defined in a given file. */
  getFileEntities(filePath: string): Entity[] {
    const ids = this.index.fileToIds[filePath] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Return all non-trivial cycles (SCCs with size > 1). */
  getCycles(): CycleInfo[] {
    return this.index.cycles;
  }

  /** Return a summary of the scope. */
  getSummary(): {
    entityCount: number;
    relationCount: number;
    language: string;
    kind: 'parsed' | 'derived';
    topDependedOn: Array<{ name: string; dependentCount: number }>;
  } {
    const topDependedOn = Object.entries(this.index.dependents)
      .map(([id, deps]) => ({
        name: this.index.idToName[id] ?? id,
        dependentCount: deps.length,
      }))
      .sort((a, b) => b.dependentCount - a.dependentCount)
      .slice(0, 10);

    return {
      entityCount: this.archJson.entities.length,
      relationCount: this.archJson.relations.length,
      language: this.archJson.language,
      kind: this.scopeEntry.kind,
      topDependedOn,
    };
  }

  // ----------------------------------------------------------------
  // Search methods
  // ----------------------------------------------------------------

  /** Find entities matching a given EntityType. */
  findByType(entityType: string): Entity[] {
    return this.archJson.entities.filter((e) => {
      if (entityType === 'abstract_class') {
        return e.type === 'abstract_class' || (e.isAbstract && e.type === 'class');
      }
      return e.type === entityType;
    });
  }

  /** Find entities whose total incoming + outgoing edges >= threshold. */
  findHighCoupling(threshold: number = 8): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming + outgoing >= threshold;
    });
  }

  /** Find entities with zero incoming AND zero outgoing edges. */
  findOrphans(): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming === 0 && outgoing === 0;
    });
  }

  /** Find entities that appear in any cycle. */
  findInCycles(): Entity[] {
    const cycleIds = new Set(this.index.cycles.flatMap((c) => c.members));
    return this.archJson.entities.filter((e) => cycleIds.has(e.id));
  }

  /** Return the scope entry associated with this engine. */
  getScopeEntry(): QueryScopeEntry {
    return this.scopeEntry;
  }

  /** Project a full Entity to a compact EntitySummary (no members array). */
  toSummary(entity: Entity): EntitySummary {
    const members = entity.members ?? [];
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      visibility: entity.visibility,
      file: entity.sourceLocation.file,
      methodCount: members.filter((m) => m.type === 'method' || m.type === 'constructor').length,
      fieldCount: members.filter((m) => m.type === 'property' || m.type === 'field').length,
    };
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  private bfs(
    startName: string,
    direction: 'dependencies' | 'dependents',
    maxDepth: number
  ): Entity[] {
    const clampedDepth = Math.max(1, Math.min(5, maxDepth));
    const startIds = this.index.nameToIds[startName] ?? [];
    if (startIds.length === 0) return [];

    const visited = new Set<string>(startIds);
    const result: Entity[] = [];
    let frontier = [...startIds];

    for (let d = 0; d < clampedDepth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const neighbors = this.index[direction][id] ?? [];
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);
            const entity = this.entityMap.get(neighborId);
            if (entity) result.push(entity);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return result;
  }
}

import path from 'path';
import type { ArchJSON, ArchJSONMetrics, RelationType, DetailLevel, FileStats, CycleInfo } from '@/types/index.js';

export class MetricsCalculator {
  calculate(archJSON: ArchJSON, level: DetailLevel): ArchJSONMetrics {
    const { entities, relations } = archJSON;
    const isAtlas = !!archJSON.extensions?.goAtlas;

    // Always compute SCC count — preserves existing behaviour for all levels (including package).
    const { sccCount, nonTrivialSCCs } = this.computeSCCGroups(archJSON);

    // cycles and fileStats only make sense for class/method, non-Atlas.
    const computeDetails = !isAtlas && level !== 'package';
    const cycles    = computeDetails ? this.buildCycleInfos(archJSON, nonTrivialSCCs) : undefined;
    const fileStats = computeDetails ? this.computeFileStats(archJSON, nonTrivialSCCs) : undefined;

    return {
      level,
      entityCount: entities.length,
      relationCount: relations.length,
      relationTypeBreakdown: this.buildTypeBreakdown(relations),
      stronglyConnectedComponents: sccCount,
      inferredRelationRatio: this.calcInferredRatio(relations),
      fileStats,
      cycles,
    };
  }

  // ── Private: type breakdown ───────────────────────────────────────────────

  private buildTypeBreakdown(
    relations: ArchJSON['relations'],
  ): Partial<Record<RelationType, number>> {
    const breakdown: Partial<Record<RelationType, number>> = {};
    for (const r of relations) {
      breakdown[r.type] = (breakdown[r.type] ?? 0) + 1;
    }
    return breakdown;
  }

  private calcInferredRatio(relations: ArchJSON['relations']): number {
    if (relations.length === 0) return 0;
    const inferredCount = relations.filter(
      r => r.inferenceSource !== undefined && r.inferenceSource !== 'explicit',
    ).length;
    return Math.round((inferredCount / relations.length) * 100) / 100;
  }

  // ── Private: Kosaraju SCC ─────────────────────────────────────────────────

  /**
   * Runs Kosaraju on the full entity graph and returns the SCC count and all
   * non-trivial SCC groups (size > 1). Always runs regardless of level or mode,
   * so that stronglyConnectedComponents is computed correctly for every level.
   */
  private computeSCCGroups(archJSON: ArchJSON): { sccCount: number; nonTrivialSCCs: string[][] } {
    const { entities, relations } = archJSON;
    if (entities.length === 0) return { sccCount: 0, nonTrivialSCCs: [] };

    const entityIds = new Set(entities.map(e => e.id));
    const validRelations = relations.filter(r => entityIds.has(r.source) && entityIds.has(r.target));

    // Build forward and transposed adjacency lists
    const graph = new Map<string, string[]>();
    const transposed = new Map<string, string[]>();
    for (const id of entityIds) { graph.set(id, []); transposed.set(id, []); }
    for (const r of validRelations) {
      graph.get(r.source)!.push(r.target);
      transposed.get(r.target)!.push(r.source);
    }

    // Pass 1: collect finish order on forward graph
    const visited1 = new Set<string>();
    const finishStack: string[] = [];
    for (const id of entityIds) {
      if (!visited1.has(id)) this.dfsIterative(id, graph, visited1, finishStack);
    }

    // Pass 2: collect SCC members on transposed graph in reverse finish order
    const visited2 = new Set<string>();
    const sccGroups: string[][] = [];
    while (finishStack.length > 0) {
      const node = finishStack.pop()!;
      if (!visited2.has(node)) {
        const members: string[] = [];
        this.dfsIterative(node, transposed, visited2, members);
        sccGroups.push(members);
      }
    }

    return {
      sccCount: sccGroups.length,
      nonTrivialSCCs: sccGroups.filter(g => g.length > 1),
    };
  }

  /**
   * Maps non-trivial SCC groups to CycleInfo objects (names, files).
   * Only called when level === 'class' | 'method' and not Atlas mode.
   */
  private buildCycleInfos(archJSON: ArchJSON, nonTrivialSCCs: string[][]): CycleInfo[] {
    const { entities, workspaceRoot } = archJSON;

    const normalise = (rawFile: string): string => {
      if (!rawFile) return '';
      if (workspaceRoot && path.isAbsolute(rawFile)) {
        return path.relative(workspaceRoot, rawFile).replace(/\\/g, '/');
      }
      return rawFile;
    };

    const entityFileMap = new Map<string, string>();
    const entityNameMap = new Map<string, string>();
    for (const e of entities) {
      entityFileMap.set(e.id, normalise(e.sourceLocation?.file ?? ''));
      entityNameMap.set(e.id, e.name);
    }

    return nonTrivialSCCs
      .map(members => ({
        size: members.length,
        members,
        memberNames: members.map(id => entityNameMap.get(id) ?? id),
        files: [...new Set(members.map(id => entityFileMap.get(id) ?? '').filter(Boolean))],
      }))
      .sort((a, b) => b.size - a.size);
  }

  // ── Private: file stats ───────────────────────────────────────────────────

  private computeFileStats(archJSON: ArchJSON, nonTrivialSCCs: string[][]): FileStats[] {
    const { entities, relations, workspaceRoot } = archJSON;

    const normalise = (rawFile: string): string => {
      if (!rawFile) return '';
      if (workspaceRoot && path.isAbsolute(rawFile)) {
        return path.relative(workspaceRoot, rawFile).replace(/\\/g, '/');
      }
      return rawFile;
    };

    // Group entities by normalised file path (skip entities with no file)
    const fileEntityMap = new Map<string, typeof entities>();
    for (const e of entities) {
      const file = normalise(e.sourceLocation?.file ?? '');
      if (!file) continue;
      if (!fileEntityMap.has(file)) fileEntityMap.set(file, []);
      fileEntityMap.get(file)!.push(e);
    }

    // Build per-entity degree maps (internal relations only)
    const entityIds = new Set(entities.map(e => e.id));
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const r of relations) {
      if (!entityIds.has(r.source) || !entityIds.has(r.target)) continue;
      outDegree.set(r.source, (outDegree.get(r.source) ?? 0) + 1);
      inDegree.set(r.target, (inDegree.get(r.target) ?? 0) + 1);
    }

    // Build cycleCount per file: count distinct SCCs that touch each file
    const entityFileMap = new Map<string, string>();
    for (const e of entities) {
      entityFileMap.set(e.id, normalise(e.sourceLocation?.file ?? ''));
    }
    const cycleCountPerFile = new Map<string, number>();
    for (const scc of nonTrivialSCCs) {
      // Collect distinct files touched by this SCC, then increment each once
      const filesInSCC = new Set(scc.map(id => entityFileMap.get(id) ?? '').filter(Boolean));
      for (const f of filesInSCC) {
        cycleCountPerFile.set(f, (cycleCountPerFile.get(f) ?? 0) + 1);
      }
    }

    // Build FileStats per file
    const stats: FileStats[] = [];
    for (const [file, ents] of fileEntityMap) {
      let loc = 0;
      let methodCount = 0;
      let fieldCount = 0;
      let filInDegree = 0;
      let filOutDegree = 0;

      for (const e of ents) {
        if (e.sourceLocation.endLine > loc) loc = e.sourceLocation.endLine;
        for (const m of e.members) {
          if (m.type === 'method' || m.type === 'constructor') methodCount++;
          else if (m.type === 'property' || m.type === 'field') fieldCount++;
        }
        filInDegree  += inDegree.get(e.id)  ?? 0;
        filOutDegree += outDegree.get(e.id) ?? 0;
      }

      stats.push({
        file,
        loc,
        entityCount: ents.length,
        methodCount,
        fieldCount,
        inDegree:  filInDegree,
        outDegree: filOutDegree,
        cycleCount: cycleCountPerFile.get(file) ?? 0,
      });
    }

    // Sort by inDegree DESC, outDegree DESC as tiebreaker
    stats.sort((a, b) => b.inDegree - a.inDegree || b.outDegree - a.outDegree);
    return stats;
  }

  // ── Private: iterative DFS ────────────────────────────────────────────────

  /**
   * Iterative DFS to avoid call stack overflow on large graphs.
   * @param finishList - if non-null, nodes are appended in finish order
   */
  private dfsIterative(
    start: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    finishList: string[] | null,
  ): void {
    const stack: [string, number][] = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const neighbors = graph.get(node) ?? [];
      if (idx < neighbors.length) {
        top[1]++;
        const next = neighbors[idx];
        if (!visited.has(next)) { visited.add(next); stack.push([next, 0]); }
      } else {
        stack.pop();
        if (finishList !== null) finishList.push(node);
      }
    }
  }
}

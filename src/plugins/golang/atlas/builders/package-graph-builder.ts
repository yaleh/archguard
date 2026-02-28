import type { GoRawData, GoRawPackage } from '../../types.js';
import type { PackageGraph, PackageNode, PackageDependency, PackageCycle } from '../types.js';
import { GoModResolver } from '../go-mod-resolver.js';

/**
 * Package dependency graph builder
 *
 * Output types defined in ADR-002 (PackageGraph, PackageNode, etc.)
 */
export class PackageGraphBuilder {
  private goModResolver: GoModResolver;

  constructor(goModResolver: GoModResolver) {
    this.goModResolver = goModResolver;
  }

  build(rawData: GoRawData): Promise<PackageGraph> {
    const nodes = this.buildNodes(rawData);
    const edges = this.buildEdges(rawData, nodes);
    const cycles = this.detectCycles(nodes, edges);

    return Promise.resolve({ nodes, edges, cycles });
  }

  private buildNodes(rawData: GoRawData): PackageNode[] {
    return rawData.packages.map((pkg) => ({
      id: pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name,
      name: pkg.fullName || pkg.name,
      type: this.classifyPackageType(pkg),
      fileCount: pkg.sourceFiles.length,
      stats: {
        structs: pkg.structs.length,
        interfaces: pkg.interfaces.length,
        functions: pkg.functions.length,
      },
    }));
  }

  private buildEdges(rawData: GoRawData, nodes: PackageNode[]): PackageDependency[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgeMap = new Map<string, { from: string; to: string; count: number }>();

    for (const pkg of rawData.packages) {
      const fromId = pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name;
      if (!nodeIds.has(fromId)) continue;

      for (const imp of pkg.imports) {
        const importType = this.goModResolver.classifyImport(imp.path);
        if (importType === 'std') continue; // Skip std lib

        const toId = imp.path;
        if (!nodeIds.has(toId)) continue;

        const key = `${fromId}→${toId}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          edgeMap.set(key, { from: fromId, to: toId, count: 1 });
        }
      }
    }

    return [...edgeMap.values()].map((e) => ({
      from: e.from,
      to: e.to,
      strength: e.count,
    }));
  }

  /**
   * Detect cyclic dependencies using DFS
   *
   * Returns PackageCycle[] (ADR-002 v1.2 type with severity)
   */
  private detectCycles(nodes: PackageNode[], edges: PackageDependency[]): PackageCycle[] {
    const graph = new Map<string, string[]>();
    for (const node of nodes) {
      graph.set(node.id, []);
    }
    for (const edge of edges) {
      const neighbors = graph.get(edge.from);
      if (neighbors) {
        neighbors.push(edge.to);
      }
    }

    const cycles: PackageCycle[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      for (const neighbor of graph.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push({
              packages: path.slice(cycleStart),
              severity: 'warning',
            });
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
    }

    return cycles;
  }

  private classifyPackageType(pkg: GoRawPackage): PackageNode['type'] {
    const full = pkg.fullName;
    const segments = full.split('/');
    const isTestutil = segments.some((s) => s === 'testutil' || s === 'hubtest');

    if (full.startsWith('tests/') || full === 'tests') return 'tests';
    if (full.startsWith('examples/')) return 'examples';
    if (isTestutil) return 'testutil';
    if (pkg.name === 'main') return 'cmd';
    if (full.includes('/vendor/')) return 'vendor';
    return 'internal';
  }
}

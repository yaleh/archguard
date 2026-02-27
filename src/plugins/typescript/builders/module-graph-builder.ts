/**
 * ModuleGraphBuilder
 *
 * Builds a TsModuleGraph from ts-morph SourceFile[] using import declarations.
 * Does NOT trigger a second parse — uses the same Project instance already created.
 *
 * Module ID = project-root-relative directory of the source file.
 * e.g. file at /root/src/cli/index.ts with root=/root → module id: "src/cli"
 */

import type { SourceFile } from 'ts-morph';
import type {
  TsModuleGraph,
  TsModuleNode,
  TsModuleDependency,
  TsModuleCycle,
} from '@/types/extensions.js';
import type { Entity } from '@/types/index.js';
import path from 'node:path';

interface EdgeAccumulator {
  strength: number;
  importedNames: Set<string>;
}

export class ModuleGraphBuilder {
  /**
   * Build a TsModuleGraph from source files and entity list.
   *
   * @param projectRoot - Absolute path to the project root
   * @param sourceFiles - ts-morph SourceFile[] from the same Project instance
   * @param entities - Entity list (for stats computation)
   */
  build(projectRoot: string, sourceFiles: SourceFile[], entities: Entity[]): TsModuleGraph {
    // 1. Map file path → module ID (project-root-relative directory)
    const fileToModule = new Map<string, string>();
    for (const sf of sourceFiles) {
      const absPath = sf.getFilePath();
      const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
      const moduleId = path.dirname(relPath).replace(/\\/g, '/');
      // Normalize root-level files: '.' → ''
      fileToModule.set(absPath, moduleId === '.' ? '' : moduleId);
    }

    // 2. Collect all unique module IDs (internal)
    const internalModuleIds = new Set<string>(fileToModule.values());

    // 3. Aggregate edges: (from, to) → { strength, importedNames }
    const edgeMap = new Map<string, EdgeAccumulator>();
    // Track external (node_modules) modules
    const externalModules = new Set<string>();

    for (const sf of sourceFiles) {
      const fromModule = fileToModule.get(sf.getFilePath());

      for (const importDecl of sf.getImportDeclarations()) {
        const resolvedFile = importDecl.getModuleSpecifierSourceFile();

        let toModule: string;

        if (resolvedFile) {
          const absTo = resolvedFile.getFilePath();
          if (fileToModule.has(absTo)) {
            toModule = fileToModule.get(absTo) ?? '';
          } else {
            // File exists in the project but outside our root? Treat as external
            const relTo = path.relative(projectRoot, absTo).replace(/\\/g, '/');
            toModule = path.dirname(relTo).replace(/\\/g, '/');
          }
        } else {
          // Unresolved → node_modules or ambient module
          const specifier = importDecl.getModuleSpecifierValue();
          // Use the bare package name (first path segment)
          toModule = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0];
          externalModules.add(toModule);
        }

        // Skip self-imports
        if (fromModule === toModule) continue;

        const edgeKey = `${fromModule}|||${toModule}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, { strength: 0, importedNames: new Set() });
        }
        const acc = edgeMap.get(edgeKey);
        acc.strength += 1;

        // Collect named imports
        for (const named of importDecl.getNamedImports()) {
          acc.importedNames.add(named.getName());
        }
        // Default import
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
          acc.importedNames.add(defaultImport.getText());
        }
      }
    }

    // 4. Build edges array
    const edges: TsModuleDependency[] = [];
    for (const [key, acc] of edgeMap.entries()) {
      const [from, to] = key.split('|||');
      edges.push({
        from,
        to,
        strength: acc.strength,
        importedNames: [...acc.importedNames],
      });
    }

    // 5. Build node stats from entities
    const entityStatsMap = new Map<
      string,
      { classes: number; interfaces: number; functions: number; enums: number }
    >();

    // Initialize stats for all internal modules
    for (const moduleId of internalModuleIds) {
      entityStatsMap.set(moduleId, { classes: 0, interfaces: 0, functions: 0, enums: 0 });
    }

    // Count entities by module prefix
    for (const entity of entities) {
      // entity.id format: "src/cli/index.ts.MyClass"
      const entityDir = path
        .dirname(entity.id.split('.').slice(0, -1).join('.'))
        .replace(/\\/g, '/');
      const stats = entityStatsMap.get(entityDir);
      if (stats) {
        if (entity.type === 'class') stats.classes++;
        else if (entity.type === 'interface') stats.interfaces++;
        else if (entity.type === 'function') stats.functions++;
        else if (entity.type === 'enum') stats.enums++;
      }
    }

    // 6. Build file count per module
    const fileCountMap = new Map<string, number>();
    for (const moduleId of fileToModule.values()) {
      fileCountMap.set(moduleId, (fileCountMap.get(moduleId) ?? 0) + 1);
    }

    // 7. Build node list
    const nodes: TsModuleNode[] = [];

    // Internal nodes
    for (const moduleId of internalModuleIds) {
      nodes.push({
        id: moduleId,
        name: moduleId || '(root)',
        type: 'internal',
        fileCount: fileCountMap.get(moduleId) ?? 0,
        stats: entityStatsMap.get(moduleId) ?? {
          classes: 0,
          interfaces: 0,
          functions: 0,
          enums: 0,
        },
      });
    }

    // External (node_modules) nodes
    for (const extId of externalModules) {
      nodes.push({
        id: extId,
        name: extId,
        type: 'node_modules',
        fileCount: 0,
        stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
      });
    }

    // 8. Detect cycles via DFS on internal module graph
    const cycles = this.detectCycles(internalModuleIds, edges);

    return { nodes, edges, cycles };
  }

  /**
   * Detect cycles in the internal module graph using iterative DFS.
   * Only considers internal module edges (ignores node_modules).
   */
  private detectCycles(internalModules: Set<string>, edges: TsModuleDependency[]): TsModuleCycle[] {
    // Build adjacency list for internal modules only
    const adj = new Map<string, string[]>();
    for (const mod of internalModules) {
      adj.set(mod, []);
    }
    for (const edge of edges) {
      if (internalModules.has(edge.from) && internalModules.has(edge.to)) {
        adj.get(edge.from)?.push(edge.to);
      }
    }

    // Tarjan's strongly connected components to find cycles
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Map<string, boolean>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let idx = 0;

    const strongConnect = (v: string): void => {
      index.set(v, idx);
      lowlink.set(v, idx);
      idx++;
      stack.push(v);
      onStack.set(v, true);

      for (const w of adj.get(v) ?? []) {
        if (!index.has(w)) {
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
        } else if (onStack.get(w)) {
          lowlink.set(v, Math.min(lowlink.get(v) ?? 0, index.get(w) ?? 0));
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w = '';
        do {
          w = stack.pop() ?? '';
          onStack.set(w, false);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const mod of internalModules) {
      if (!index.has(mod)) {
        strongConnect(mod);
      }
    }

    // SCCs with > 1 node are cycles
    const cycles: TsModuleCycle[] = [];
    for (const scc of sccs) {
      if (scc.length > 1) {
        cycles.push({
          modules: scc,
          severity: scc.length === 2 ? 'warning' : 'error',
        });
      }
    }

    return cycles;
  }
}

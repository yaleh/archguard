/**
 * ModuleGraphBuilder
 *
 * Builds a TsModuleGraph from ts-morph SourceFile[] using import declarations,
 * `export ... from` re-exports and literal dynamic `import()` calls.
 * Does NOT trigger a second parse — uses the same Project instance already created.
 *
 * Module ID = project-root-relative directory of the source file.
 * e.g. file at /root/src/cli/index.ts with root=/root → module id: "src/cli"
 */

import { SyntaxKind } from 'ts-morph';
import type {
  SourceFile,
  CallExpression,
  StringLiteral,
  NoSubstitutionTemplateLiteral,
} from 'ts-morph';
import type {
  TsModuleGraph,
  TsModuleNode,
  TsModuleDependency,
  TsModuleCycle,
  TsModuleUnresolvedRef,
} from '@/types/extensions/ts-analysis.js';
import type { Entity } from '@/types/index.js';
import path from 'node:path';

interface EdgeAccumulator {
  strength: number;
  importedNames: Set<string>;
}

/** Path-alias configuration read from the project's compiler options / tsconfig. */
interface AliasConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * Outcome of trying to map a module specifier to a target module.
 * - `internal`        → an edge to an in-project module (mapped through fileToModule)
 * - `external`        → a bare package → node_modules node
 * - `unresolved-alias`→ an alias-prefixed specifier that could not be resolved
 *                       (recorded in `unresolved`, never as an external node)
 * - `skip`            → a relative specifier that does not resolve inside the project
 *                       (no edge, no phantom node)
 */
type TargetResolution =
  | { kind: 'internal'; module: string }
  | { kind: 'external'; name: string }
  | { kind: 'unresolved-alias' }
  | { kind: 'skip' };

const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts'];

export class ModuleGraphBuilder {
  /**
   * Build a TsModuleGraph from source files and entity list.
   *
   * @param projectRoot - Absolute path to the project root
   * @param sourceFiles - ts-morph SourceFile[] from the same Project instance
   * @param entities - Entity list (for stats computation)
   */
  build(
    projectRoot: string,
    sourceFiles: SourceFile[],
    entities: readonly Entity[]
  ): TsModuleGraph {
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

    // 2b. Path aliases from the shared project's compiler options (baseUrl/paths),
    // so bare `@/types`-style specifiers can be resolved without hardcoding `src/`.
    const aliasConfig = this.deriveAliasConfig(projectRoot, sourceFiles);

    // 3. Aggregate edges: (from, to) → { strength, importedNames }
    const edgeMap = new Map<string, EdgeAccumulator>();
    // Track external (node_modules) modules
    const externalModules = new Set<string>();
    // Alias specifiers that could not be resolved to an internal module
    const unresolved: TsModuleUnresolvedRef[] = [];
    // Dynamic import() calls whose argument was not a string literal
    let unevaluatedDynamicImports = 0;

    const record = (fromModule: string, toModule: string, names: Iterable<string>): void => {
      // Skip self-imports
      if (fromModule === toModule) return;
      const edgeKey = `${fromModule}|||${toModule}`;
      let acc = edgeMap.get(edgeKey);
      if (!acc) {
        acc = { strength: 0, importedNames: new Set() };
        edgeMap.set(edgeKey, acc);
      }
      acc.strength += 1;
      for (const name of names) acc.importedNames.add(name);
    };

    const applyResolution = (
      fromModule: string,
      specifier: string,
      resolution: TargetResolution,
      names: Iterable<string>
    ): void => {
      switch (resolution.kind) {
        case 'internal':
          record(fromModule, resolution.module, names);
          break;
        case 'external':
          externalModules.add(resolution.name);
          record(fromModule, resolution.name, names);
          break;
        case 'unresolved-alias':
          unresolved.push({ from: fromModule, specifier });
          break;
        case 'skip':
          break;
      }
    };

    for (const sf of sourceFiles) {
      const fromModule = fileToModule.get(sf.getFilePath());
      if (fromModule === undefined) continue;

      // 3a. Static imports
      for (const importDecl of sf.getImportDeclarations()) {
        const specifier = importDecl.getModuleSpecifierValue();
        const resolvedFile = importDecl.getModuleSpecifierSourceFile();
        const resolution = this.resolveTarget(
          sf,
          specifier,
          resolvedFile,
          fileToModule,
          aliasConfig
        );

        const names = new Set<string>();
        for (const named of importDecl.getNamedImports()) names.add(named.getName());
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) names.add(defaultImport.getText());

        applyResolution(fromModule, specifier, resolution, names);
      }

      // 3b. `export ... from` re-exports (including `export * from`,
      // `export type ... from`, `export * as ns from`)
      for (const exportDecl of sf.getExportDeclarations()) {
        const specifier = exportDecl.getModuleSpecifierValue();
        if (!specifier) continue; // `export { x }` with no `from` clause
        const resolvedFile = exportDecl.getModuleSpecifierSourceFile();
        const resolution = this.resolveTarget(
          sf,
          specifier,
          resolvedFile,
          fileToModule,
          aliasConfig
        );

        const names = new Set<string>();
        for (const named of exportDecl.getNamedExports()) names.add(named.getName());
        const namespaceExport = exportDecl.getNamespaceExport();
        if (namespaceExport) names.add(namespaceExport.getName());

        applyResolution(fromModule, specifier, resolution, names);
      }

      // 3c. Literal dynamic `import('...')`. Non-literal arguments cannot be
      // evaluated statically: no edge is produced and they are counted.
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!this.isDynamicImportCall(call)) continue;
        const specifier = this.dynamicImportSpecifier(call);
        if (specifier === undefined) {
          unevaluatedDynamicImports += 1;
          continue;
        }
        // ts-morph exposes no module-specifier resolution for a CallExpression
        // argument, so resolve manually against fileToModule (relative + alias).
        const resolution = this.resolveTarget(sf, specifier, undefined, fileToModule, aliasConfig);
        applyResolution(fromModule, specifier, resolution, []);
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
      const rawDir = path.dirname(entity.id.split('.').slice(0, -1).join('.')).replace(/\\/g, '/');
      const entityDir = rawDir === '.' ? '' : rawDir;
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

    const graph: TsModuleGraph = { nodes, edges, cycles };
    if (unresolved.length > 0) graph.unresolved = unresolved;
    if (unevaluatedDynamicImports > 0) {
      graph.unevaluatedDynamicImports = unevaluatedDynamicImports;
    }
    return graph;
  }

  // ── Private: specifier resolution ─────────────────────────────────────────

  /**
   * Resolve a module specifier to an internal module, an external package, or
   * an explicitly-visible unresolved/ skipped outcome.
   */
  private resolveTarget(
    sf: SourceFile,
    specifier: string,
    resolvedFile: SourceFile | null | undefined,
    fileToModule: Map<string, string>,
    aliasConfig: AliasConfig | undefined
  ): TargetResolution {
    if (resolvedFile) {
      const absTo = resolvedFile.getFilePath();
      const mod = fileToModule.get(absTo);
      // File exists in the ts-morph project but outside our source root — skip.
      // This avoids creating phantom ".." module nodes for imports that resolve
      // to e.g. node_modules or sibling directories outside projectRoot.
      return mod !== undefined ? { kind: 'internal', module: mod } : { kind: 'skip' };
    }

    if (specifier.startsWith('.')) {
      // Manual relative resolution: resolve the path against this source file and
      // try common extension/index candidates against the fileToModule map. This
      // handles ts-morph's inability to resolve with ArchGuard's sparse options
      // even though the target file IS already in the project.
      const base = path.resolve(path.dirname(sf.getFilePath()), specifier);
      const mod = this.findModuleForPath(base, fileToModule);
      return mod !== undefined ? { kind: 'internal', module: mod } : { kind: 'skip' };
    }

    // Alias-prefixed specifier: resolve through the tsconfig `paths` mapping.
    if (aliasConfig) {
      const targets = this.matchAliasTargets(specifier, aliasConfig.paths);
      if (targets.length > 0) {
        for (const target of targets) {
          const abs = path.resolve(aliasConfig.baseUrl, target);
          const mod = this.findModuleForPath(abs, fileToModule);
          if (mod !== undefined) return { kind: 'internal', module: mod };
        }
        // Alias matched but the target is not in the project: keep it visible
        // instead of misclassifying it as an external node.
        return { kind: 'unresolved-alias' };
      }
    }

    // Bare package name (first segment, or first two for scoped packages)
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    return { kind: 'external', name };
  }

  /**
   * Expand an absolute path into the candidate file paths that may hold the
   * module, then look each up in fileToModule. Handles extensionless imports,
   * directory-index imports and TS's `.js` → `.ts` specifier convention.
   */
  private findModuleForPath(
    absPath: string,
    fileToModule: Map<string, string>
  ): string | undefined {
    for (const candidate of this.expandCandidates(absPath)) {
      const mod = fileToModule.get(candidate);
      if (mod !== undefined) return mod;
    }
    return undefined;
  }

  private expandCandidates(absPath: string): string[] {
    const candidates: string[] = [absPath];
    for (const jsExt of JS_EXTENSIONS) {
      if (absPath.endsWith(jsExt)) {
        const stem = absPath.slice(0, -jsExt.length);
        candidates.push(stem);
        for (const tsExt of TS_EXTENSIONS) candidates.push(stem + tsExt);
      }
    }
    for (const tsExt of TS_EXTENSIONS) candidates.push(absPath + tsExt);
    candidates.push(absPath + '/index.ts', absPath + '/index.tsx', absPath + '/index.d.ts');
    return [...new Set(candidates)];
  }

  /**
   * Apply the tsconfig `paths` algorithm: an exact key match wins; otherwise the
   * first wildcard pattern (`*`) whose prefix/suffix bracket the specifier is used.
   */
  private matchAliasTargets(specifier: string, paths: Record<string, string[]>): string[] {
    const exact = paths[specifier];
    if (exact) return [...exact];

    for (const [pattern, mapped] of Object.entries(paths)) {
      const starIndex = pattern.indexOf('*');
      if (starIndex === -1) continue;
      const prefix = pattern.slice(0, starIndex);
      const suffix = pattern.slice(starIndex + 1);
      if (
        !specifier.startsWith(prefix) ||
        !specifier.endsWith(suffix) ||
        specifier.length < prefix.length + suffix.length
      ) {
        continue;
      }
      const star = specifier.slice(prefix.length, specifier.length - suffix.length);
      return mapped.map((target) => target.replace('*', star));
    }
    return [];
  }

  /**
   * Read `baseUrl` / `paths` from the shared ts-morph project's compiler options
   * (populated from the nearest tsconfig.json). Returns undefined when the
   * project carries no alias configuration.
   */
  private deriveAliasConfig(
    projectRoot: string,
    sourceFiles: SourceFile[]
  ): AliasConfig | undefined {
    for (const sf of sourceFiles) {
      const getProject = (sf as { getProject?: () => unknown }).getProject;
      if (typeof getProject !== 'function') continue;
      const project = getProject.call(sf) as
        | { getCompilerOptions?: () => { baseUrl?: string; paths?: Record<string, string[]> } }
        | undefined;
      const compilerOptions = project?.getCompilerOptions?.();
      if (!compilerOptions) continue;
      if (!compilerOptions.paths && !compilerOptions.baseUrl) continue;
      const baseUrl = compilerOptions.baseUrl
        ? path.resolve(String(compilerOptions.baseUrl))
        : projectRoot;
      return { baseUrl, paths: compilerOptions.paths ?? {} };
    }
    return undefined;
  }

  // ── Private: dynamic import ───────────────────────────────────────────────

  private isDynamicImportCall(call: CallExpression): boolean {
    return call.getExpression().getKind() === SyntaxKind.ImportKeyword;
  }

  /**
   * Return the static specifier of a dynamic `import()` call, or undefined when
   * the argument is not a string literal / no-substitution template literal.
   */
  private dynamicImportSpecifier(call: CallExpression): string | undefined {
    const first = call.getArguments()[0];
    if (!first) return undefined;
    const kind = first.getKind();
    if (kind === SyntaxKind.StringLiteral) {
      return (first as StringLiteral).getLiteralText();
    }
    if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      return (first as NoSubstitutionTemplateLiteral).getLiteralText();
    }
    return undefined;
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

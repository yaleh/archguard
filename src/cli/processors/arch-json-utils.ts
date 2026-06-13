import type { ArchJSON } from '@/types/index.js';
import { createHash } from 'crypto';

/**
 * Generate a short hash key from an array of source paths.
 * Exported so processors can use the same hashing logic for grouping.
 */
export function hashSources(sources: string[], language?: string): string {
  const normalized = sources
    .map((s) => s.replace(/\\/g, '/'))
    .sort()
    .join('|');
  const identity = `${language ?? 'typescript'}::${normalized}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 8);
}

/**
 * Derive a sub-module ArchJSON from a parent by filtering to entities
 * whose filePath starts with subPath. Relations where both endpoints
 * are in the sub-module are retained. moduleGraph is filtered similarly.
 *
 * @param parent - The parent ArchJSON to derive from
 * @param subPath - The sub-path to filter by (may be absolute)
 * @param workspaceRoot - Optional workspace root; when provided, enables matching
 *   of relative entity filePaths against an absolute subPath. TypeScriptParser
 *   stores filePaths relative to the workspace root (source directory), so without
 *   this parameter, absolute subPaths would never match relative filePaths.
 */
export function deriveSubModuleArchJSON(
  parent: ArchJSON,
  subPath: string,
  workspaceRoot?: string
): ArchJSON {
  const normSub = subPath.replace(/\\/g, '/').replace(/\/$/, '');

  // Compute the relative sub-path for matching against relative entity filePaths.
  // TypeScriptParser stores filePaths relative to workspaceRoot (the source directory).
  let relSub: string | null = null;
  if (workspaceRoot) {
    const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (normSub.startsWith(normRoot + '/')) {
      relSub = normSub.slice(normRoot.length + 1); // e.g., 'shared'
    } else if (normSub === normRoot) {
      relSub = ''; // sub-path IS the root → match everything
    }
  }

  // Filter entities: try absolute match first, then relative if workspaceRoot provided.
  // TypeScriptParser encodes the relative file path in entity.id as "<relPath>.<name>".
  // When filePath is absent, extract it from id: id.slice(0, id.length - name.length - 1).
  const entities = parent.entities.filter((e) => {
    // Primary: explicit filePath field (may be absent in TypeScript parser output)
    let fp = ((e as unknown as { filePath?: string }).filePath ?? '').replace(/\\/g, '/');
    // Fallback: extract relative file path from entity id ("<relPath>.<name>")
    if (!fp && e.name && e.id.endsWith('.' + e.name)) {
      fp = e.id.slice(0, e.id.length - e.name.length - 1).replace(/\\/g, '/');
    }
    // Last-resort fallback for C++ entities (sourceLocation.file is absolute).
    // Also use sourceLocation when fp looks like a bare module prefix (no slash or
    // file extension) — this means the id-heuristic extracted the package name,
    // not an actual file path.
    if (e.sourceLocation?.file && (!fp || (!fp.includes('/') && !fp.includes('.')))) {
      fp = e.sourceLocation.file.replace(/\\/g, '/');
    }
    if (!fp) return false;
    // Absolute path match (original behavior)
    if (fp.startsWith(normSub + '/') || fp === normSub) return true;
    // Relative path match (when workspaceRoot is provided)
    if (relSub !== null) {
      if (relSub === '') return true; // root covers everything
      if (fp.startsWith(relSub + '/') || fp === relSub) return true;
    }
    return false;
  });
  const ids = new Set(entities.map((e) => e.id));

  // Step 1: Relations where source is in sub-module (outgoing relations only)
  const outgoingRelations = (parent.relations ?? []).filter((r) => ids.has(r.source));

  // Step 2: Find cross-module targets (target NOT in sub-module)
  const crossModuleTargetIds = new Set(
    outgoingRelations.filter((r) => !ids.has(r.target)).map((r) => r.target)
  );

  // Step 3: Create stub entities for cross-module targets
  // Stubs are minimal: keep id, name, type, sourceLocation but strip all members
  const stubEntities = parent.entities
    .filter((e) => crossModuleTargetIds.has(e.id))
    .map((e) => ({ ...e, members: [] }));

  // Step 4: Combined entity set (module entities + stubs for cross-module targets)
  const allModuleEntities = [...entities, ...stubEntities];

  // Step 5: All relations involving sub-module entities as source
  const relations = outgoingRelations;

  // Filter moduleGraph if present
  let extensions = parent.extensions;
  const mg = parent.extensions?.tsAnalysis?.moduleGraph;
  if (mg) {
    // TsModuleNode.id is a relative module path (e.g. "src/core").
    // Derive the relative prefix from normSub by taking the last 2 path segments
    // (heuristic for standard src/* layout; works for web-llm case).
    const parts = normSub.split('/').filter(Boolean);
    const relPrefix =
      parts.length >= 2 ? parts.slice(-2).join('/') : (parts[parts.length - 1] ?? normSub);

    const filteredNodes = mg.nodes.filter(
      (n) => n.id === relPrefix || n.id.startsWith(relPrefix + '/')
    );
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = mg.edges.filter(
      (e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)
    );
    const filteredCycles = (mg.cycles ?? []).filter((c) =>
      c.modules.every((m) => filteredNodeIds.has(m))
    );
    extensions = {
      ...parent.extensions,
      tsAnalysis: {
        ...parent.extensions.tsAnalysis,
        moduleGraph: {
          nodes: filteredNodes,
          edges: filteredEdges,
          cycles: filteredCycles,
        } as import('@/types/extensions/ts-analysis.js').TsModuleGraph,
      },
    };
  }

  return { ...parent, entities: allModuleEntities, relations, extensions };
}

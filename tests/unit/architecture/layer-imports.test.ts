import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Layer direction guard.
 *
 * Layer order (CLAUDE.md): types/utils < core, parser < plugins, and
 * mermaid < analysis < cli. A lower layer must never import a higher one.
 *
 * This guard freezes the crossings relocated by
 * gap-layer-violations-relocate-misplaced-types:
 *   - src/analysis/** must not import src/cli/**
 *   - src/core/**     must not import src/cli/** or src/mermaid/**
 * and the one-way direction established by
 * gap-layer-mutual-plugin-runtime-core-parser:
 *   - src/core/** and src/parser/** must not import the plugin runtime
 *     (src/plugins/shared/**), and src/plugins/shared/** must not import
 *     src/parser/**. Types and the resolver port they need now live in
 *     src/core/parser-runtime/.
 *
 * Dependencies are read POSITIONALLY: only a line whose first non-whitespace
 * token begins an `import`/`export` statement counts, and comment lines are
 * skipped. A mere mention of a path inside a comment is not a dependency — a
 * keyword grep would report one, which is the false positive this guard exists
 * to avoid.
 */

interface LayerRule {
  /** Producer prefix (repo-relative POSIX). */
  from: string;
  /** Target prefixes the producer must not import. */
  forbidden: readonly string[];
}

const LAYER_RULES: readonly LayerRule[] = [
  { from: 'src/analysis/', forbidden: ['src/cli/'] },
  { from: 'src/core/', forbidden: ['src/cli/', 'src/mermaid/', 'src/plugins/shared/'] },
  { from: 'src/parser/', forbidden: ['src/plugins/shared/'] },
  { from: 'src/plugins/shared/', forbidden: ['src/parser/'] },
];

const isCommentLine = (line: string): boolean =>
  line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');

const braceDepth = (text: string): number => {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
};

/** Extract the module specifiers from a single (possibly joined) statement. */
function specifiersIn(statement: string): string[] {
  const fromMatch = /\bfrom\s+['"]([^'"]+)['"]/.exec(statement);
  if (fromMatch) return [fromMatch[1]];
  const bare = /^import\s+['"]([^'"]+)['"]/.exec(statement);
  return bare ? [bare[1]] : [];
}

/**
 * Module specifiers of positional `import`/`export ... from` statements. A
 * brace-delimited specifier list may span lines; the statement is accumulated
 * until its braces close. Declaration exports (`export class ... {`) are not
 * accumulated (they do not match `export {`/`export *`/`export type {`), so a
 * `from` appearing later in a class body is never mistaken for an import.
 */
export function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trimStart();
    if (isCommentLine(first)) continue;
    const startsImport = /^import\b/.test(first);
    const startsExportFrom = /^export\s*(type\s*)?[{*]/.test(first);
    if (!startsImport && !startsExportFrom) continue;

    let statement = first;
    while (braceDepth(statement) > 0 && i + 1 < lines.length) {
      i++;
      const next = lines[i].trimStart();
      if (isCommentLine(next)) continue;
      statement += ' ' + next;
    }
    specifiers.push(...specifiersIn(statement));
  }
  return specifiers;
}

/**
 * Resolve an import/export specifier written in `fromRelPath` to a
 * repo-relative POSIX path prefix, or null when it cannot denote a project
 * source module (bare package specifiers, node builtins, absolute paths).
 */
export function resolveSpecifier(fromRelPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), specifier));
  }
  return null;
}

/** Layer violations for a single source file, given its repo-relative path. */
export function findLayerViolations(relPath: string, source: string): string[] {
  const violations: string[] = [];
  for (const rule of LAYER_RULES) {
    if (!relPath.startsWith(rule.from)) continue;
    for (const specifier of moduleSpecifiers(source)) {
      const target = resolveSpecifier(relPath, specifier);
      if (target === null) continue;
      for (const forbidden of rule.forbidden) {
        // `forbidden` ends with '/', so `src/cli/` matches `src/cli/x.ts` but not
        // a hypothetical sibling like `src/cli2/x.ts`.
        if (target.startsWith(forbidden)) {
          violations.push(`${relPath}: '${specifier}' crosses up into ${forbidden.slice(0, -1)}`);
        }
      }
    }
  }
  return violations;
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
}

function scanProject(): string[] {
  const repoRoot = path.resolve('.');
  const srcRoot = path.join(repoRoot, 'src');
  return sourceFiles(srcRoot).flatMap((file) => {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    return findLayerViolations(rel, fs.readFileSync(file, 'utf-8'));
  });
}

describe('layer import direction guard', () => {
  it('no source file crosses up across a declared layer boundary', () => {
    expect(scanProject()).toEqual([]);
  });

  it('flags a positional import that crosses up (core -> cli)', () => {
    const source = "import type { A } from '@/cli/y.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toHaveLength(1);
  });

  it('flags a positional import that crosses up (analysis -> cli, relative form)', () => {
    const source = "import { helper } from '../../cli/z.js';\n";
    expect(findLayerViolations('src/analysis/deep/x.ts', source)).toHaveLength(1);
  });

  it('flags a positional import that crosses up (core -> mermaid)', () => {
    const source = "export type { MermaidOutputOptions } from '@/mermaid/diagram-generator.js';\n";
    expect(findLayerViolations('src/core/interfaces/x.ts', source)).toHaveLength(1);
  });

  it('does NOT flag a mere mention of the path inside a comment', () => {
    const source = '// counterpart lives in @/cli/y.js\nconst x = 1;\n';
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('does NOT flag a block-comment mention of the path', () => {
    const source = '/* moved to @/cli/query/query-manifest.js */\nexport const y = 2;\n';
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('does NOT flag an allowed lower-layer import', () => {
    const source =
      "import type { ArchJSON } from '@/types/index.js';\nimport { e } from '../core/e.js';\n";
    expect(findLayerViolations('src/analysis/x.ts', source)).toEqual([]);
  });

  it('does NOT conflate a sibling directory with the forbidden prefix', () => {
    const source = "import { q } from '@/cli2/not-cli.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('catches a multi-line brace-delimited import that crosses up', () => {
    const source = "import type {\n  A,\n  B,\n} from '@/cli/y.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toHaveLength(1);
  });

  it('flags core -> plugin runtime', () => {
    const source = "import type { SyntaxNodeLike } from '@/plugins/shared/syntax-tree.js';\n";
    expect(findLayerViolations('src/core/rule-engine/x.ts', source)).toHaveLength(1);
  });

  it('flags parser -> plugin runtime', () => {
    const source = "import { resolveParserBackend } from '@/plugins/shared/parser-backend.js';\n";
    expect(findLayerViolations('src/parser/parse-worker.ts', source)).toHaveLength(1);
  });

  it('flags plugin runtime -> parser', () => {
    const source = "import { ParseError } from '@/parser/errors.js';\n";
    expect(findLayerViolations('src/plugins/shared/query-loader.ts', source)).toHaveLength(1);
  });

  it('does NOT flag the plugin runtime importing a lower layer (core/parser-runtime)', () => {
    const source =
      "import { ParserInitializationError } from '@/core/parser-runtime/parser-backend.js';\n";
    expect(findLayerViolations('src/plugins/shared/parser-backend.ts', source)).toEqual([]);
  });

  it('does NOT flag the parser importing a lower layer (core/parser-runtime)', () => {
    const source =
      "import type { ParserRuntimeKind } from '@/core/parser-runtime/syntax-tree.js';\n";
    expect(findLayerViolations('src/parser/parse-worker-pool.ts', source)).toEqual([]);
  });

  it('does NOT conflate a sibling directory with the plugin runtime prefix', () => {
    const source = "import { x } from '@/plugins/shared2/not-shared.js';\n";
    expect(findLayerViolations('src/parser/parse-worker.ts', source)).toEqual([]);
  });

  it('does NOT conflate a sibling directory with the parser prefix', () => {
    const source = "import { x } from '@/parser2/not-parser.js';\n";
    expect(findLayerViolations('src/plugins/shared/query-loader.ts', source)).toEqual([]);
  });
});

/*
 * Directory-level dependency ratchet (AC-394 shape).
 *
 * The positional rules above freeze a handful of named directions. They do not
 * say anything about the shape of the *directory graph*, so a new directory can
 * quietly introduce a cycle or a sideways dependency and still leave those
 * rules green. This section adds the missing ratchets:
 *
 *   1. SCC baseline — the cyclic components of the directory graph are pinned
 *      member-for-member. The baseline ratchets DOWN only: a new cycle is red,
 *      and a recorded cycle that no longer exists is red until the baseline is
 *      lowered (otherwise the reduction is silently unrecorded and the cycle
 *      can come back for free).
 *   2. Directory manifest + node count — every module directory is registered
 *      in DIRECTORY_MANIFEST and counted by NODE_COUNT. A new directory needs
 *      BOTH edits (plus a RECORDED CHANGE note); editing only one is red.
 *   3. New directories must be leaves — an unregistered directory may import
 *      only itself or a registered shared layer, and no other directory may
 *      import it.
 *
 * Import edges are read from the TypeScript syntax tree (ts.createSourceFile),
 * never from raw text: a path mentioned in a comment or string literal is not a
 * dependency. Directory nodes are directories that contain at least one .ts
 * module; data-only directories (src/plugins/packs/**) carry no imports and are
 * therefore not graph nodes.
 *
 * RECORDED CHANGE (2026-10-26, gap-layer-ratchet-scc-leaf-baseline): initial
 * baseline — 52 module directories, 7 cyclic components (see SCC_BASELINE).
 * The seven components are pre-existing debt frozen as-is, not an endorsement;
 * each may only shrink.
 */

/** Bottom shared layers a brand-new leaf directory may depend on. */
const SHARED_LAYERS: readonly string[] = ['src/types', 'src/utils'];

/**
 * Frozen set of module directories (directories holding at least one .ts file).
 * RECORDED CHANGE: adding a directory requires BOTH a manifest entry here and a
 * NODE_COUNT bump, with the change recorded in a RECORDED CHANGE note.
 */
const DIRECTORY_MANIFEST: readonly string[] = [
  'src',
  'src/analysis',
  'src/analysis/duplicates',
  'src/analysis/fitness',
  'src/analysis/gim',
  'src/analysis/git-history',
  'src/analysis/jl',
  'src/analysis/shape-smells',
  'src/analysis/slice-delta',
  'src/cli',
  'src/cli/analyze',
  'src/cli/cache',
  'src/cli/cognitive',
  'src/cli/commands',
  'src/cli/errors',
  'src/cli/git-history',
  'src/cli/mcp',
  'src/cli/mcp/tools',
  'src/cli/processors',
  'src/cli/progress',
  'src/cli/query',
  'src/cli/utils',
  'src/cli/utils/__tests__',
  'src/core',
  'src/core/interfaces',
  'src/core/pack-registry',
  'src/core/parser-runtime',
  'src/core/query',
  'src/core/rule-engine',
  'src/diagram',
  'src/mermaid',
  'src/parser',
  'src/plantuml',
  'src/plugins',
  'src/plugins/cpp',
  'src/plugins/cpp/builders',
  'src/plugins/cpp/mappers',
  'src/plugins/golang',
  'src/plugins/golang/atlas',
  'src/plugins/golang/atlas/builders',
  'src/plugins/golang/atlas/renderers',
  'src/plugins/golang/builders',
  'src/plugins/java',
  'src/plugins/kotlin',
  'src/plugins/kotlin/builders',
  'src/plugins/python',
  'src/plugins/shared',
  'src/plugins/typescript',
  'src/plugins/typescript/builders',
  'src/types',
  'src/types/extensions',
  'src/utils',
];

/**
 * The second registration slot. DIRECTORY_MANIFEST and NODE_COUNT are two
 * independent records of the same fact; both must be updated together.
 */
const NODE_COUNT = 52;

/**
 * Pinned cyclic components of the directory graph (sorted, member-for-member).
 * Fixed slots: a cycle is added or removed only by editing this literal, and
 * only in the shrinking direction.
 */
const SCC_BASELINE: readonly (readonly string[])[] = [
  // analysis: fitness <-> gim
  ['src/analysis/fitness', 'src/analysis/gim'],
  // cli shell: cli -> analyze/commands/mcp -> cli
  ['src/cli', 'src/cli/analyze', 'src/cli/commands', 'src/cli/mcp', 'src/cli/mcp/tools'],
  // cli query <-> processors
  ['src/cli/processors', 'src/cli/query'],
  // parser <-> the TypeScript language plugin
  ['src/parser', 'src/plugins/typescript'],
  // cpp plugin family
  ['src/plugins/cpp', 'src/plugins/cpp/builders', 'src/plugins/cpp/mappers'],
  // golang plugin family
  [
    'src/plugins/golang',
    'src/plugins/golang/atlas',
    'src/plugins/golang/atlas/builders',
    'src/plugins/golang/atlas/renderers',
    'src/plugins/golang/builders',
  ],
  // kotlin plugin family
  ['src/plugins/kotlin', 'src/plugins/kotlin/builders'],
];

/** A module fed to the directory-graph builder. */
export interface ModuleFile {
  /** Repo-relative POSIX path, e.g. `src/cli/analyze/x.ts`. */
  readonly path: string;
  readonly source: string;
}

/** Directory-level import graph; directories are repo-relative POSIX paths. */
export interface DirectoryGraph {
  /** Sorted directory nodes. */
  readonly nodes: readonly string[];
  /** Outgoing edges per node; self-edges are omitted (they carry no direction). */
  readonly edges: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Module specifiers of the import/export statements in `source`, read from the
 * TypeScript syntax tree. Comments and string literals are not visited, so a
 * path mentioned there is never counted as an edge.
 */
export function importSpecifiers(filePath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

const defaultExists = (repoRelative: string): boolean => {
  const absolute = path.resolve(repoRelative);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
};

/**
 * Resolve a specifier written in `fromRelPath` to a repo-relative POSIX module
 * path, or null when it cannot denote a project source module. Aliases (`@/`)
 * and relative specifiers are supported; a directory specifier resolves to its
 * `index.ts`, matching the bundler/tsc extension resolution used elsewhere.
 */
export function resolveModulePath(
  fromRelPath: string,
  specifier: string,
  exists: (repoRelative: string) => boolean = defaultExists
): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = path.posix.normalize(`src/${specifier.slice(2)}`);
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), specifier));
  } else {
    return null;
  }
  const candidates = base.endsWith('.js')
    ? [`${base.slice(0, -3)}.ts`]
    : base.endsWith('.ts')
      ? [base]
      : [`${base}.ts`, `${base}/index.ts`];
  return candidates.find(exists) ?? null;
}

/** Directory node of a repo-relative module path (root files belong to `src`). */
function directoryOf(repoRelative: string): string {
  const directory = path.posix.dirname(repoRelative);
  return directory === '.' ? 'src' : directory;
}

/**
 * Aggregate module-level imports into a directory-level graph. Targets outside
 * `src/` (packages, node builtins) and same-directory imports are dropped.
 */
export function buildDirectoryGraph(
  files: readonly ModuleFile[],
  exists: (repoRelative: string) => boolean = defaultExists
): DirectoryGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  for (const file of files) {
    const from = directoryOf(file.path);
    nodes.add(from);
    for (const specifier of importSpecifiers(file.path, file.source)) {
      const target = resolveModulePath(file.path, specifier, exists);
      if (target === null || !target.startsWith('src/')) continue;
      const to = directoryOf(target);
      nodes.add(to);
      if (to === from) continue;
      const outgoing = edges.get(from) ?? new Set<string>();
      outgoing.add(to);
      edges.set(from, outgoing);
    }
  }
  return { nodes: [...nodes].sort(), edges };
}

/** Tarjan's strongly connected components, deterministic (sorted members/output). */
export function tarjanScc(graph: DirectoryGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let next = 0;

  const adjacency = (node: string): string[] => [...(graph.edges.get(node) ?? [])].sort();
  const lowOf = (node: string): number => low.get(node) ?? 0;

  const visit = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const neighbour of adjacency(node)) {
      if (!index.has(neighbour)) {
        visit(neighbour);
        low.set(node, Math.min(lowOf(node), lowOf(neighbour)));
      } else if (onStack.has(neighbour)) {
        low.set(node, Math.min(lowOf(node), index.get(neighbour) ?? 0));
      }
    }
    if (lowOf(node) === index.get(node)) {
      const component: string[] = [];
      let member = node;
      do {
        member = stack.pop() ?? node;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.sort());
    }
  };

  for (const node of graph.nodes) if (!index.has(node)) visit(node);
  return components.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/** SCCs that are cyclic: more than one member, or an explicit self-loop. */
export function cyclicComponents(graph: DirectoryGraph): string[][] {
  return tarjanScc(graph).filter(
    (component) =>
      component.length > 1 ||
      (graph.edges.get(component[0] ?? '')?.has(component[0] ?? '') ?? false)
  );
}

/**
 * Ratchet judgment for the SCC baseline. Empty means the tree matches the
 * baseline member-for-member. The baseline only ever shrinks: a new cycle is
 * named as an addition, a vanished baseline cycle is named as an unrecorded
 * reduction.
 */
export function sccViolations(
  actual: readonly (readonly string[])[],
  baseline: readonly (readonly string[])[]
): string[] {
  const keyOf = (component: readonly string[]): string => [...component].sort().join(' -> ');
  const actualByKey = new Map(actual.map((component) => [keyOf(component), component]));
  const baselineByKey = new Map(baseline.map((component) => [keyOf(component), component]));
  const violations: string[] = [];
  for (const [key, component] of actualByKey) {
    if (!baselineByKey.has(key)) {
      violations.push(
        `new cycle not in the baseline: [${[...component].sort().join(', ')}] — ` +
          'the SCC baseline ratchets down only'
      );
    }
  }
  for (const [key, component] of baselineByKey) {
    if (!actualByKey.has(key)) {
      violations.push(
        `baseline cycle no longer present: [${[...component].sort().join(', ')}] — ` +
          'ratchet the baseline down to record the reduction'
      );
    }
  }
  return violations.sort();
}

/**
 * Leaf judgment for unregistered directories. A directory outside the manifest
 * must import only itself or a registered shared layer, and no other directory
 * may import it.
 */
export function leafViolations(
  graph: DirectoryGraph,
  registered: ReadonlySet<string>,
  sharedLayers: ReadonlySet<string> = new Set(SHARED_LAYERS)
): string[] {
  const violations: string[] = [];
  for (const node of graph.nodes) {
    if (registered.has(node)) continue;
    for (const target of [...(graph.edges.get(node) ?? [])].sort()) {
      if (target === node || sharedLayers.has(target)) continue;
      violations.push(
        `unregistered directory '${node}' imports '${target}' — a new directory must be a ` +
          'leaf: its outgoing edges may only target itself or a registered shared layer'
      );
    }
    const importers = graph.nodes
      .filter((other) => other !== node && (graph.edges.get(other)?.has(node) ?? false))
      .sort();
    for (const importer of importers) {
      violations.push(
        `unregistered directory '${node}' is imported by '${importer}' — a new directory ` +
          'must be a leaf and cannot be imported by other module directories'
      );
    }
  }
  return violations.sort();
}

/** The two registration slots plus the directory set read from the tree. */
export interface DirectoryRegistration {
  readonly manifest: readonly string[];
  readonly nodeCount: number;
  readonly directories: readonly string[];
}

/**
 * Dual-registration judgment: DIRECTORY_MANIFEST, NODE_COUNT and the actual
 * tree must all agree. A new directory is legal only when the manifest entry,
 * the +1 node count and the RECORDED CHANGE note land together; changing one
 * slot alone is red.
 */
export function registrationViolations(registration: DirectoryRegistration): string[] {
  const { manifest, nodeCount, directories } = registration;
  const violations: string[] = [];
  if (nodeCount !== manifest.length) {
    violations.push(
      `manifest/nodeCount mismatch: NODE_COUNT=${nodeCount} but ` +
        `DIRECTORY_MANIFEST.length=${manifest.length} — a new directory needs BOTH ` +
        'registrations (manifest entry + node count +1) and a RECORDED CHANGE note'
    );
  }
  const manifestSet = new Set(manifest);
  if (manifestSet.size !== manifest.length) {
    violations.push('DIRECTORY_MANIFEST contains duplicate entries');
  }
  const directorySet = new Set(directories);
  for (const directory of [...directorySet].sort()) {
    if (!manifestSet.has(directory)) {
      violations.push(
        `directory '${directory}' is not registered — add it to DIRECTORY_MANIFEST, bump ` +
          'NODE_COUNT by 1 and record the reason with a RECORDED CHANGE note'
      );
    }
  }
  for (const directory of [...manifestSet].sort()) {
    if (!directorySet.has(directory)) {
      violations.push(
        `registered directory '${directory}' no longer exists — ratchet DIRECTORY_MANIFEST ` +
          'and NODE_COUNT down with a RECORDED CHANGE note'
      );
    }
  }
  return violations.sort();
}

function projectModuleFiles(): ModuleFile[] {
  return sourceFiles(path.resolve('src')).map((file) => ({
    path: path.relative(path.resolve('.'), file).split(path.sep).join('/'),
    source: fs.readFileSync(file, 'utf-8'),
  }));
}

function scanDirectoryGraph(): DirectoryGraph {
  return buildDirectoryGraph(projectModuleFiles());
}

function graphOf(edges: Readonly<Record<string, readonly string[]>>): DirectoryGraph {
  const nodes = new Set<string>();
  const edgeMap = new Map<string, ReadonlySet<string>>();
  for (const [from, targets] of Object.entries(edges)) {
    nodes.add(from);
    edgeMap.set(from, new Set(targets));
    for (const target of targets) nodes.add(target);
  }
  return { nodes: [...nodes].sort(), edges: edgeMap };
}

describe('directory-level dependency ratchet', () => {
  const graph = scanDirectoryGraph();
  const registered = new Set(DIRECTORY_MANIFEST);

  it('pins every module directory: manifest and node count are dual-registered', () => {
    // The literal AC assertion, kept explicit so a one-slot edit names itself.
    expect(NODE_COUNT).toBe(DIRECTORY_MANIFEST.length);
    expect(
      registrationViolations({
        manifest: DIRECTORY_MANIFEST,
        nodeCount: NODE_COUNT,
        directories: graph.nodes,
      })
    ).toEqual([]);
  });

  it('holds the cyclic-component baseline member-for-member (down-only ratchet)', () => {
    expect(sccViolations(cyclicComponents(graph), SCC_BASELINE)).toEqual([]);
  });

  it('does not count a path mentioned only in a comment as an import edge', () => {
    const files: ModuleFile[] = [
      {
        path: 'src/core/example.ts',
        source:
          "// import { cli } from '@/cli/example.js'\n" +
          "/* export * from '@/mermaid/example.js' */\n" +
          "import { T } from '@/types/index.js';\n",
      },
    ];
    const fixtureGraph = buildDirectoryGraph(files, () => true);
    expect([...(fixtureGraph.edges.get('src/core') ?? [])]).toEqual(['src/types']);
  });

  it('keeps the unchanged tree green (no synthetic edge invented)', () => {
    expect(sccViolations(cyclicComponents(graph), SCC_BASELINE)).toEqual([]);
    expect(leafViolations(graph, registered, new Set(SHARED_LAYERS))).toEqual([]);
  });

  it('rejects a new directory that imports a sibling directory', () => {
    const newDirectory = 'src/newmod';
    const fixtureGraph = graphOf({
      'src/cli': [],
      [newDirectory]: ['src/cli'],
      'src/types': [],
    });
    const violations = leafViolations(
      fixtureGraph,
      new Set(['src/cli', 'src/types', 'src/utils']),
      new Set(SHARED_LAYERS)
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(newDirectory);
    expect(violations[0]).toContain('src/cli');
    expect(violations[0]).toContain('leaf');
  });

  it('rejects a new directory that other module directories import', () => {
    const newDirectory = 'src/newmod';
    const fixtureGraph = graphOf({
      'src/cli': [newDirectory],
      [newDirectory]: [],
      'src/types': [],
    });
    const violations = leafViolations(
      fixtureGraph,
      new Set(['src/cli', 'src/types', 'src/utils']),
      new Set(SHARED_LAYERS)
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(newDirectory);
    expect(violations[0]).toContain('src/cli');
  });

  it('accepts a new leaf directory that only imports a registered shared layer', () => {
    const newDirectory = 'src/newmod';
    const fixtureGraph = graphOf({ [newDirectory]: ['src/types'], 'src/types': [] });
    const fixtureRegistered = new Set(['src/cli', 'src/types', 'src/utils']);
    expect(leafViolations(fixtureGraph, fixtureRegistered, new Set(SHARED_LAYERS))).toEqual([]);
    // The leaf rule passing does not register it: dual registration still red.
    expect(
      registrationViolations({
        manifest: ['src/cli'],
        nodeCount: 1,
        directories: ['src/cli', newDirectory],
      }).join('\n')
    ).toContain(`directory '${newDirectory}' is not registered`);
  });

  it('rejects a one-slot registration edit (manifest only / node count only)', () => {
    const manifestOnly = registrationViolations({
      manifest: ['src/cli', 'src/newmod'],
      nodeCount: 1,
      directories: ['src/cli', 'src/newmod'],
    });
    expect(manifestOnly.join('\n')).toContain('manifest/nodeCount mismatch');
    expect(manifestOnly.join('\n')).toContain('RECORDED CHANGE');

    const nodeCountOnly = registrationViolations({
      manifest: ['src/cli'],
      nodeCount: 2,
      directories: ['src/cli', 'src/newmod'],
    });
    expect(nodeCountOnly.join('\n')).toContain('manifest/nodeCount mismatch');
    expect(nodeCountOnly.join('\n')).toContain('RECORDED CHANGE');

    // Both slots together (with the tree) are the only green combination.
    expect(
      registrationViolations({
        manifest: ['src/cli', 'src/newmod'],
        nodeCount: 2,
        directories: ['src/cli', 'src/newmod'],
      })
    ).toEqual([]);
  });

  it('flags an injected reverse edge as a new cycle and names its members', () => {
    const line: DirectoryGraph = graphOf({ 'src/a': ['src/b'] });
    expect(sccViolations(cyclicComponents(line), [])).toEqual([]);

    const cycle: DirectoryGraph = graphOf({ 'src/a': ['src/b'], 'src/b': ['src/a'] });
    const violations = sccViolations(cyclicComponents(cycle), []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('new cycle');
    expect(violations[0]).toContain('src/a');
    expect(violations[0]).toContain('src/b');
  });

  it('flags a vanished baseline cycle as an unrecorded reduction', () => {
    const violations = sccViolations([], [['src/a', 'src/b']]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('baseline cycle no longer present');
    expect(violations[0]).toContain('src/a');
    expect(violations[0]).toContain('src/b');
  });
});

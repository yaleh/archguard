/**
 * Stage 60.1/60.2 — method→method call graph via ts-morph findReferences().
 *
 * Implements proposal §1 R1 call-edge criteria (pre-registered):
 *   (i)   filter declaration-self, import statements and pure type positions;
 *   (ii)  only references in CallExpression / NewExpression callee position
 *         become `call` edges; values passed as callbacks become `reference`
 *         edges (excluded from the B-class main ground truth);
 *   (iii) edge source = nearest enclosing *named* function/method declaration;
 *         module top-level calls are attributed to `<module-top>`;
 *   (iv)  calls through interface-typed receivers resolve to the interface
 *         member: emitted once as an "→ interface member" edge (view
 *         `interface-member`) and expanded to every in-scope implementation
 *         (view `expanded`), all marked `viaInterface: true`.
 *
 * Both views coexist in one output file; `selectView()` / `--view` switches.
 * ArchGuard core (`src/`) is untouched — this is experiment harness code.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Node,
  Project,
  type ClassDeclaration,
  type InterfaceDeclaration,
  type ReferencedSymbolEntry,
  type SourceFile,
} from 'ts-morph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeKind = 'call' | 'reference';
export type EdgeView = 'both' | 'interface-member' | 'expanded';
export type ViewName = 'interface-member' | 'expanded';

export interface CallEdge {
  kind: EdgeKind;
  /** Fully-qualified source: `<relative file>#<Owner.member|fn|<module-top>>`. */
  source: string;
  /** Fully-qualified target: `<relative file>#<Owner.member|fn>`. */
  target: string;
  viaInterface: boolean;
  /** Which dual-view(s) this edge belongs to (criterion (iv)). */
  view: EdgeView;
  /** Reference site (1-based line/column). */
  location: { file: string; line: number; column: number };
}

export interface CallGraphOutput {
  scope: string[];
  basePath: string;
  criteria: string;
  stats: { call: number; reference: number; viaInterface: number };
  edges: CallEdge[];
}

export interface CallGraphOptions {
  /** Directories containing the scope source files. */
  sourcePaths: string[];
  /** Base path used to relativize file paths in qualified names. */
  basePath: string;
  /** Optional tsconfig for module/path-alias resolution (files NOT auto-added). */
  tsConfigFilePath?: string;
}

interface TargetDecl {
  /** Node passed to findReferences(). */
  node: Node;
  /** Qualified member name (without file prefix), e.g. `Greeter.greet`. */
  name: string;
  file: SourceFile;
  kind: 'function' | 'class' | 'method' | 'var' | 'iface-member';
  /** For iface-member: in-scope implementation targets (already qualified). */
  implementations?: string[];
}

// ---------------------------------------------------------------------------
// View selection (criterion (iv) dual views)
// ---------------------------------------------------------------------------

export function selectView(output: CallGraphOutput, view: ViewName): CallEdge[] {
  return output.edges.filter((e) => e.view === 'both' || e.view === view);
}

// ---------------------------------------------------------------------------
// Criterion helpers
// ---------------------------------------------------------------------------

/** (i): reference inside an import/export statement. */
function isImportPosition(node: Node): boolean {
  return (
    node.getFirstAncestor(
      (a) =>
        Node.isImportDeclaration(a) ||
        Node.isExportDeclaration(a) ||
        Node.isImportEqualsDeclaration(a)
    ) !== undefined
  );
}

/** (i): reference in a pure type position (annotations, typeof, heritage, aliases). */
function isTypeOnlyPosition(node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur && !Node.isSourceFile(cur)) {
    if (Node.isTypeNode(cur)) return true; // TypeReference, TypeQuery (typeof), …
    if (Node.isTypeAliasDeclaration(cur)) return true;
    if (Node.isInterfaceDeclaration(cur)) return true;
    if (Node.isHeritageClause(cur)) return true;
    cur = cur.getParent();
  }
  return false;
}

/** (i): the reference node IS the name of a declaration (declaration self). */
function isDeclarationName(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  const namedKinds = [
    Node.isFunctionDeclaration,
    Node.isClassDeclaration,
    Node.isMethodDeclaration,
    Node.isMethodSignature,
    Node.isPropertyDeclaration,
    Node.isPropertySignature,
    Node.isVariableDeclaration,
    Node.isInterfaceDeclaration,
    Node.isParameterDeclaration,
  ];
  if (!namedKinds.some((guard) => guard(parent))) return false;
  const nameNode = (parent as unknown as { getNameNode?: () => Node | undefined }).getNameNode?.();
  return nameNode === node;
}

/**
 * (ii): is the reference in callee position of a CallExpression/NewExpression?
 * Climbs property-access chains (`this.g.greet` → name side) and wrappers.
 */
function getCalleeKind(node: Node): 'call' | 'new' | null {
  let expr: Node = node;
  for (;;) {
    const parent = expr.getParent();
    if (!parent) return null;
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === expr) {
      expr = parent;
      continue;
    }
    if (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent)) {
      expr = parent;
      continue;
    }
    if (Node.isCallExpression(parent) && parent.getExpression() === expr) return 'call';
    if (Node.isNewExpression(parent) && parent.getExpression() === expr) return 'new';
    return null;
  }
}

function ownerClassName(node: Node): string {
  const parent = node.getParent();
  if (Node.isClassDeclaration(parent) || Node.isClassExpression(parent)) {
    return parent.getName() ?? '<anonymous-class>';
  }
  return '<anonymous-class>';
}

/**
 * (iii): nearest enclosing *named* function/method declaration, joined
 * outermost-first (`Caller.run.inner`); `<module-top>` when none.
 * Property initializers are attributed to `Class.prop`.
 */
function enclosingQualifiedName(node: Node): string {
  const names: string[] = [];
  let cur: Node | undefined = node.getParent();
  while (cur && !Node.isSourceFile(cur)) {
    if (Node.isFunctionDeclaration(cur)) {
      names.push(cur.getName() ?? '<anonymous>');
    } else if (Node.isMethodDeclaration(cur)) {
      names.push(cur.getName());
      names.push(ownerClassName(cur));
    } else if (Node.isConstructorDeclaration(cur)) {
      names.push('constructor');
      names.push(ownerClassName(cur));
    } else if (Node.isGetAccessorDeclaration(cur) || Node.isSetAccessorDeclaration(cur)) {
      names.push(cur.getName());
      names.push(ownerClassName(cur));
    } else if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      const p = cur.getParent();
      if (Node.isVariableDeclaration(p)) {
        names.push(p.getName());
      } else if (Node.isPropertyDeclaration(p)) {
        names.push(p.getName());
        names.push(ownerClassName(p));
      } else if (Node.isPropertyAssignment(p)) {
        names.push(p.getName());
      }
      // anonymous inline callbacks: fall through to the nearest named scope
    } else if (Node.isPropertyDeclaration(cur)) {
      names.push(cur.getName());
      names.push(ownerClassName(cur));
    }
    cur = cur.getParent();
  }
  if (names.length === 0) return '<module-top>';
  return names.reverse().join('.');
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

function relPath(basePath: string, file: SourceFile): string {
  return path.relative(basePath, file.getFilePath()).split(path.sep).join('/');
}

function qualify(basePath: string, file: SourceFile, name: string): string {
  return `${relPath(basePath, file)}#${name}`;
}

function findImplementations(
  iface: InterfaceDeclaration,
  memberName: string,
  classes: readonly ClassDeclaration[],
  basePath: string
): string[] {
  const targets: string[] = [];
  for (const cls of classes) {
    const implementsIface = cls.getImplements().some((impl) => {
      const sym = impl.getExpression().getSymbol();
      const resolved = sym?.getAliasedSymbol() ?? sym;
      return (resolved?.getDeclarations() ?? []).includes(iface);
    });
    if (!implementsIface) continue;
    const member = cls.getMethod(memberName) ?? cls.getProperty(memberName);
    if (!member) continue;
    const clsName = cls.getName() ?? '<anonymous-class>';
    targets.push(qualify(basePath, cls.getSourceFile(), `${clsName}.${memberName}`));
  }
  return targets.sort();
}

function enumerateTargets(scopeFiles: readonly SourceFile[], basePath: string): TargetDecl[] {
  const targets: TargetDecl[] = [];
  const allClasses = scopeFiles.flatMap((f) => f.getClasses());

  for (const file of scopeFiles) {
    for (const fn of file.getFunctions()) {
      const name = fn.getName();
      if (!name || !fn.isImplementation()) continue;
      targets.push({ node: fn, name, file, kind: 'function' });
    }
    for (const cls of file.getClasses()) {
      const clsName = cls.getName();
      if (!clsName) continue;
      targets.push({ node: cls, name: clsName, file, kind: 'class' });
      for (const method of cls.getMethods()) {
        if (!method.isImplementation()) continue;
        targets.push({ node: method, name: `${clsName}.${method.getName()}`, file, kind: 'method' });
      }
      for (const prop of cls.getProperties()) {
        const init = prop.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          targets.push({ node: prop, name: `${clsName}.${prop.getName()}`, file, kind: 'method' });
        }
      }
    }
    for (const stmt of file.getVariableStatements()) {
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          targets.push({ node: decl, name: decl.getName(), file, kind: 'var' });
        }
      }
    }
    for (const iface of file.getInterfaces()) {
      const ifaceName = iface.getName();
      for (const member of iface.getMethods()) {
        targets.push({
          node: member,
          name: `${ifaceName}.${member.getName()}`,
          file,
          kind: 'iface-member',
          implementations: findImplementations(iface, member.getName(), allClasses, basePath),
        });
      }
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Core build
// ---------------------------------------------------------------------------

/**
 * A reference group "belongs" to a declaration when its definition node is the
 * declaration itself, or an import/export alias that resolves to it. The TS
 * language service groups usages of imported symbols under the import
 * specifier, so a strict identity check would drop every cross-file direct
 * identifier usage (functions, classes, consts) while keeping property-access
 * member usages — exactly the asymmetry criterion (iii) tests caught.
 */
function definitionMatches(defNode: Node | undefined, declNode: Node): boolean {
  if (!defNode) return false;
  if (defNode === declNode) return true;
  if (
    Node.isImportSpecifier(defNode) ||
    Node.isImportClause(defNode) ||
    Node.isNamespaceImport(defNode) ||
    Node.isExportSpecifier(defNode)
  ) {
    const sym = defNode.getSymbol();
    const aliased = sym?.getAliasedSymbol() ?? sym;
    return (aliased?.getDeclarations() ?? []).some((d) => d === declNode);
  }
  return false;
}

function classifyReference(ref: ReferencedSymbolEntry, scopePaths: ReadonlySet<string>): Node | null {
  const node = ref.getNode();
  if (!scopePaths.has(node.getSourceFile().getFilePath())) return null;
  if (ref.isDefinition() === true) return null; // (i) declaration self
  if (isDeclarationName(node)) return null; // (i) declaration self (fallback)
  if (isImportPosition(node)) return null; // (i) import statement
  if (isTypeOnlyPosition(node)) return null; // (i) pure type position
  return node;
}

export function buildCallGraph(options: CallGraphOptions): CallGraphOutput {
  const basePath = path.resolve(options.basePath);
  const project = options.tsConfigFilePath
    ? new Project({
        tsConfigFilePath: options.tsConfigFilePath,
        skipAddingFilesFromTsConfig: true,
      })
    : new Project({ compilerOptions: { skipLibCheck: true } });

  for (const dir of options.sourcePaths) {
    project.addSourceFilesAtPaths([
      `${path.resolve(dir)}/**/*.ts`,
      `!${path.resolve(dir)}/**/*.d.ts`,
    ]);
  }
  project.resolveSourceFileDependencies();

  const scopeFiles = options.sourcePaths
    .map((dir) => path.resolve(dir))
    .flatMap((dir) =>
      project.getSourceFiles().filter((f) => f.getFilePath().startsWith(`${dir}/`) || f.getFilePath().startsWith(`${dir}${path.sep}`))
    )
    .filter((f, i, arr) => arr.indexOf(f) === i && !f.getFilePath().endsWith('.d.ts'));

  const scopePathSet = new Set(scopeFiles.map((f) => f.getFilePath() as string));
  const targets = enumerateTargets(scopeFiles, basePath);

  const edges: CallEdge[] = [];
  const seen = new Set<string>();
  const claimedByInterface = new Set<string>(); // `${file}:${start}` claimed by pass 1

  const pushEdge = (edge: CallEdge): void => {
    const key = [
      edge.kind,
      edge.source,
      edge.target,
      edge.view,
      edge.location.file,
      edge.location.line,
      edge.location.column,
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  const makeLocation = (node: Node): CallEdge['location'] => {
    const file = node.getSourceFile();
    const { line, column } = file.getLineAndColumnAtPos(node.getStart());
    return { file: relPath(basePath, file), line, column };
  };

  const processTarget = (target: TargetDecl, interfacePass: boolean): void => {
    const declNode = target.node;
    let refSymbols;
    try {
      refSymbols = (declNode as unknown as { findReferences: () => import('ts-morph').ReferencedSymbol[] }).findReferences();
    } catch {
      return;
    }
    for (const refSym of refSymbols) {
      // Only groups whose definition is this declaration (or an import alias
      // of it): prevents interface-vs-implementation cross-counting while
      // keeping cross-file usages of imported symbols.
      const defNode = refSym.getDefinition().getDeclarationNode();
      if (!definitionMatches(defNode, declNode)) continue;
      for (const ref of refSym.getReferences()) {
        const node = classifyReference(ref, scopePathSet);
        if (!node) continue;
        const locKey = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
        if (!interfacePass && claimedByInterface.has(locKey)) continue;

        const calleeKind = getCalleeKind(node);
        const source = `${relPath(basePath, node.getSourceFile())}#${enclosingQualifiedName(node)}`;
        const location = makeLocation(node);

        if (target.kind === 'class') {
          // (ii): only `new C()` is a call (to the constructor); other value
          // uses of the class are plain references.
          if (calleeKind === 'new') {
            pushEdge({
              kind: 'call',
              source,
              target: qualify(basePath, target.file, `${target.name}.constructor`),
              viaInterface: false,
              view: 'both',
              location,
            });
          } else if (calleeKind === null) {
            pushEdge({
              kind: 'reference',
              source,
              target: qualify(basePath, target.file, target.name),
              viaInterface: false,
              view: 'both',
              location,
            });
          }
          continue;
        }

        const qualifiedTarget = qualify(basePath, target.file, target.name);
        const kind: EdgeKind = calleeKind !== null ? 'call' : 'reference';

        if (target.kind === 'iface-member') {
          claimedByInterface.add(locKey);
          if (kind === 'call') {
            // (iv) view 1: → interface member
            pushEdge({
              kind,
              source,
              target: qualifiedTarget,
              viaInterface: true,
              view: 'interface-member',
              location,
            });
            // (iv) view 2: expanded to all in-scope implementations
            for (const implTarget of target.implementations ?? []) {
              pushEdge({
                kind,
                source,
                target: implTarget,
                viaInterface: true,
                view: 'expanded',
                location,
              });
            }
          } else {
            pushEdge({
              kind,
              source,
              target: qualifiedTarget,
              viaInterface: true,
              view: 'both',
              location,
            });
          }
          continue;
        }

        pushEdge({
          kind,
          source,
          target: qualifiedTarget,
          viaInterface: false,
          view: 'both',
          location,
        });
      }
    }
  };

  // Pass 1: interface members (claims call sites that resolve to interfaces).
  for (const target of targets) {
    if (target.kind === 'iface-member') processTarget(target, true);
  }
  // Pass 2: concrete declarations.
  for (const target of targets) {
    if (target.kind !== 'iface-member') processTarget(target, false);
  }

  edges.sort(
    (a, b) =>
      a.location.file.localeCompare(b.location.file) ||
      a.location.line - b.location.line ||
      a.location.column - b.location.column ||
      a.view.localeCompare(b.view) ||
      a.target.localeCompare(b.target)
  );

  return {
    scope: options.sourcePaths,
    basePath,
    criteria: 'proposal-§1-R1 (i)-(iv) v2.1',
    stats: {
      call: edges.filter((e) => e.kind === 'call').length,
      reference: edges.filter((e) => e.kind === 'reference').length,
      viaInterface: edges.filter((e) => e.viaInterface).length,
    },
    edges,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Deterministic LCG for reproducible edge sampling (Phase 64 spot checks). */
function* lcg(seed: number): Generator<number> {
  let s = seed >>> 0;
  for (;;) {
    s = (s * 1664525 + 1013904223) >>> 0;
    yield s / 0x100000000;
  }
}

export function sampleEdges(edges: readonly CallEdge[], n: number, seed = 42): CallEdge[] {
  const pool = [...edges];
  const rng = lcg(seed);
  const out: CallEdge[] = [];
  while (out.length < n && pool.length > 0) {
    const idx = Math.floor(rng.next().value * pool.length);
    out.push(...pool.splice(idx, 1));
  }
  return out;
}

function parseArgs(argv: string[]): {
  sources: string[];
  base?: string;
  tsconfig?: string;
  out?: string;
  view?: ViewName;
  sample: number;
  seed: number;
} {
  const result: ReturnType<typeof parseArgs> = { sources: [], sample: 0, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--sources') {
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) result.sources.push(argv[++i]!);
    } else if (arg === '--base') result.base = argv[++i];
    else if (arg === '--tsconfig') result.tsconfig = argv[++i];
    else if (arg === '--out') result.out = argv[++i];
    else if (arg === '--view') result.view = argv[++i] as ViewName;
    else if (arg === '--sample') result.sample = Number(argv[++i]);
    else if (arg === '--seed') result.seed = Number(argv[++i]);
  }
  return result;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.sources.length === 0) {
    console.error(
      'Usage: tsx callgraph.ts --sources <dir...> [--base <dir>] [--tsconfig <path>] ' +
        '[--out <file>] [--view interface-member|expanded] [--sample <n>] [--seed <n>]'
    );
    process.exit(2);
  }
  const output = buildCallGraph({
    sourcePaths: args.sources,
    basePath: args.base ?? process.cwd(),
    tsConfigFilePath: args.tsconfig,
  });
  if (args.out) {
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`wrote ${args.out}`);
  }
  console.log(
    `edges: total=${output.edges.length} call=${output.stats.call} ` +
      `reference=${output.stats.reference} viaInterface=${output.stats.viaInterface}`
  );
  if (args.view) {
    console.log(`view=${args.view}: ${selectView(output, args.view).length} edges`);
  }
  if (args.sample > 0) {
    const calls = output.edges.filter((e) => e.kind === 'call' && e.view !== 'expanded');
    console.log(`\nrandom sample of ${args.sample} call edges (seed=${args.seed}):`);
    for (const e of sampleEdges(calls, args.sample, args.seed)) {
      const via = e.viaInterface ? ' [viaInterface]' : '';
      console.log(
        `  ${e.source} -> ${e.target}${via} @ ${e.location.file}:${e.location.line}:${e.location.column}`
      );
    }
  }
}

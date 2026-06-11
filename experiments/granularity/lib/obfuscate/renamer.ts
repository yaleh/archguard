/**
 * Stage 59.2 — semantic renaming via the TypeScript language service.
 *
 * Strategy: instead of node.rename() per declaration (measured ~150 ms each on
 * the real tree — program invalidation dominates), we batch: collect all
 * targets, query `findRenameLocations` for each against ONE program, then
 * apply all text edits per file in a single pass. Interface-member renames
 * propagate to implementing classes via shared rename locations; the second
 * declaration sees its name-span already claimed, reuses the assigned name and
 * is still recorded in the mapping (完整性).
 *
 * Passes (order is fixed → byte determinism):
 *  1. entities + class/interface/enum members
 *  2a. external named-import aliasing (mutating, small count)
 *  2b. object-literal property names (post-propagation, fresh collection)
 *  2c. locals: params, vars, binding elements, type params, import bindings
 */
import path from 'node:path';
import {
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  type LanguageService,
} from 'ts-morph';
import { NameGenerator } from './name-generator.js';
import { MappingBuilder } from './mapping.js';

export interface LoadOptions {
  tsConfigFilePath: string;
  entryGlobs: string[];
  /** BFS bound for the import closure (e.g. `<repo>/src`). */
  closureDir: string;
}

type TargetKind = 'entity' | 'method' | 'property' | 'local' | 'typeParam' | 'objProp';

interface RenameTarget {
  nameNode: Node;
  original: string;
  kind: TargetKind;
  relFile: string;
  ownerOriginal?: string;
  /** Claim-key of the owner's name node (resolves owner's obf name). */
  ownerKey?: string;
}

export function posixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

/** Load entry modules plus their repo-internal import closure (sorted). */
export function loadProject(opts: LoadOptions): { project: Project; files: SourceFile[] } {
  const project = new Project({
    tsConfigFilePath: opts.tsConfigFilePath,
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(opts.entryGlobs);
  const bound = path.resolve(opts.closureDir) + path.sep;
  const seen = new Set<string>(project.getSourceFiles().map((f) => f.getFilePath() as string));
  const queue = [...seen];
  while (queue.length > 0) {
    const fp = queue.shift()!;
    const sf = project.addSourceFileAtPath(fp);
    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const target = decl.getModuleSpecifierSourceFile();
      if (!target || target.isInNodeModules()) continue;
      const tp = target.getFilePath() as string;
      if (seen.has(tp) || !path.resolve(tp).startsWith(bound)) continue;
      seen.add(tp);
      queue.push(tp);
    }
  }
  for (const fp of seen) project.addSourceFileAtPath(fp);
  const files = project
    .getSourceFiles()
    .filter((f) => seen.has(f.getFilePath() as string))
    .sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1));
  return { project, files };
}

function nodeKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

function ownerAncestor(node: Node): Node | undefined {
  return node.getFirstAncestor(
    (a) =>
      Node.isClassDeclaration(a) ||
      Node.isInterfaceDeclaration(a) ||
      Node.isEnumDeclaration(a) ||
      Node.isClassExpression(a)
  );
}

function isTopLevelVariable(decl: Node): boolean {
  const stmt = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  return stmt !== undefined && Node.isSourceFile(stmt.getParent()!);
}

function identifierNameNode(node: Node): Node | undefined {
  const nn = (node as unknown as { getNameNode?: () => Node | undefined }).getNameNode?.();
  if (nn && (Node.isIdentifier(nn) || Node.isPrivateIdentifier(nn))) return nn;
  return undefined;
}

/** Pass 1: entities + class/interface/enum members. */
function collectPass1(files: SourceFile[], repoRoot: string): RenameTarget[] {
  const targets: RenameTarget[] = [];
  for (const sf of files) {
    const relFile = posixRel(repoRoot, sf.getFilePath());
    sf.forEachDescendant((node) => {
      const k = node.getKind();
      const pushMember = (kind: 'method' | 'property'): void => {
        if (node.getParent() !== undefined && Node.isObjectLiteralExpression(node.getParent()!)) return;
        const nn = identifierNameNode(node);
        if (!nn) return;
        const owner = ownerAncestor(node);
        const ownerName = owner ? identifierNameNode(owner) : undefined;
        targets.push({
          nameNode: nn,
          original: nn.getText(),
          kind,
          relFile,
          ownerOriginal: ownerName?.getText() ?? '<anonymous>',
          ownerKey: ownerName ? nodeKey(ownerName) : undefined,
        });
      };
      switch (k) {
        case SyntaxKind.ClassDeclaration:
        case SyntaxKind.InterfaceDeclaration:
        case SyntaxKind.EnumDeclaration:
        case SyntaxKind.TypeAliasDeclaration:
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.ModuleDeclaration: {
          const nn = identifierNameNode(node);
          if (nn) targets.push({ nameNode: nn, original: nn.getText(), kind: 'entity', relFile });
          break;
        }
        case SyntaxKind.MethodDeclaration:
        case SyntaxKind.MethodSignature:
          pushMember('method');
          break;
        case SyntaxKind.PropertyDeclaration:
        case SyntaxKind.PropertySignature:
        case SyntaxKind.EnumMember:
        case SyntaxKind.GetAccessor:
        case SyntaxKind.SetAccessor:
          pushMember('property');
          break;
        case SyntaxKind.Parameter: {
          // Constructor parameter properties are class members.
          const param = node.asKind(SyntaxKind.Parameter)!;
          if (param.getModifiers().length > 0 && Node.isConstructorDeclaration(param.getParent()!)) {
            pushMember('property');
          }
          break;
        }
        case SyntaxKind.VariableDeclaration: {
          if (!isTopLevelVariable(node)) break;
          const nn = (node.asKind(SyntaxKind.VariableDeclaration)!).getNameNode();
          if (Node.isIdentifier(nn)) {
            targets.push({ nameNode: nn, original: nn.getText(), kind: 'entity', relFile });
          } else {
            for (const be of nn.getDescendantsOfKind(SyntaxKind.BindingElement)) {
              const bn = be.getNameNode();
              if (Node.isIdentifier(bn)) {
                targets.push({ nameNode: bn, original: bn.getText(), kind: 'entity', relFile });
              }
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }
  return targets;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(editsByFile: Map<SourceFile, TextEdit[]>): void {
  for (const [sf, edits] of editsByFile) {
    const unique = new Map<string, TextEdit>();
    for (const e of edits) {
      const key = `${e.start}:${e.end}`;
      const prev = unique.get(key);
      if (prev && prev.text !== e.text) {
        throw new Error(
          `conflicting rename edits in ${sf.getFilePath()} at ${e.start}: '${prev.text}' vs '${e.text}'`
        );
      }
      unique.set(key, e);
    }
    const sorted = [...unique.values()].sort((a, b) => b.start - a.start);
    let prevStart = Number.POSITIVE_INFINITY;
    let text = sf.getFullText();
    for (const e of sorted) {
      if (e.end > prevStart) {
        throw new Error(`overlapping rename edits in ${sf.getFilePath()} at ${e.start}`);
      }
      prevStart = e.start;
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    }
    sf.replaceWithText(text);
  }
}

export interface RenameContext {
  gen: NameGenerator;
  builder: MappingBuilder;
  /** Every obfuscated name assigned so far (skip rule for later passes). */
  assignedNames: Set<string>;
  /**
   * Global member-name equivalence table: same original property/method name
   * -> same obfuscated name everywhere (terser-style property mangling).
   * TypeScript's typing is structural; renaming same-named properties of
   * unrelated-but-compatible shapes independently would break assignability
   * in the obfuscated tree. A single global table preserves all structural
   * relations by construction.
   */
  memberNameTable: Map<string, string>;
  warnings: string[];
}

export interface RenameResult {
  warnings: string[];
  memberNameTable: Map<string, string>;
}

function runBatch(
  ls: LanguageService,
  targets: RenameTarget[],
  ctx: RenameContext,
  nameFor: (t: RenameTarget) => string
): void {
  const claimed = new Map<string, string>();
  const editsByFile = new Map<SourceFile, TextEdit[]>();
  const records: Array<{ t: RenameTarget; newName: string }> = [];

  for (const t of targets) {
    if (t.nameNode.wasForgotten()) continue;
    const selfKey = nodeKey(t.nameNode);
    let newName = claimed.get(selfKey);
    if (newName === undefined) {
      let locations;
      try {
        locations = ls.findRenameLocations(t.nameNode, { usePrefixAndSuffixText: true });
      } catch (err) {
        ctx.warnings.push(`findRenameLocations failed for ${t.original} (${t.relFile}): ${String(err)}`);
        continue;
      }
      const usable = locations.filter((l) => !l.getSourceFile().isInNodeModules());
      if (usable.length === 0) continue;
      const base = nameFor(t);
      newName = t.original.startsWith('#') ? `#${base}` : base;
      // Overlap with an earlier symbol's claim (e.g. same-named properties of
      // sibling types linked through one object literal): adopt the already
      // assigned name so every location stays consistent.
      const existingNames = new Set<string>();
      for (const l of usable) {
        const k = `${l.getSourceFile().getFilePath()}:${l.getTextSpan().getStart()}`;
        const existing = claimed.get(k);
        if (existing !== undefined && existing !== newName) existingNames.add(existing);
      }
      if (existingNames.size === 1) {
        newName = [...existingNames][0]!;
      } else if (existingNames.size > 1) {
        ctx.warnings.push(`skipped ${t.original} (${t.relFile}): ambiguous overlapping rename claims`);
        continue;
      }
      for (const l of usable) {
        const sf = l.getSourceFile();
        const span = l.getTextSpan();
        const k = `${sf.getFilePath()}:${span.getStart()}`;
        if (claimed.has(k)) continue;
        claimed.set(k, newName);
        const text = `${l.getPrefixText() ?? ''}${newName}${l.getSuffixText() ?? ''}`;
        let list = editsByFile.get(sf);
        if (!list) {
          list = [];
          editsByFile.set(sf, list);
        }
        list.push({ start: span.getStart(), end: span.getEnd(), text });
      }
      ctx.assignedNames.add(newName);
    }
    records.push({ t, newName });
  }

  for (const { t, newName } of records) {
    switch (t.kind) {
      case 'entity':
        ctx.builder.addEntity(t.original, newName, t.relFile);
        break;
      case 'method':
      case 'property': {
        const ownerObf =
          (t.ownerKey !== undefined ? claimed.get(t.ownerKey) : undefined) ?? t.ownerOriginal ?? '<anonymous>';
        ctx.builder.addMember(t.ownerOriginal ?? '<anonymous>', ownerObf, t.original, newName, t.relFile);
        break;
      }
      default:
        ctx.builder.addLocal(newName, t.original);
        break;
    }
  }

  applyEdits(editsByFile);
}

/** Pass 2a: ensure every external named import has an obfuscated alias. */
function aliasExternalImports(files: SourceFile[], ctx: RenameContext): void {
  for (const sf of files) {
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (target && !target.isInNodeModules()) continue;
      for (const spec of imp.getNamedImports()) {
        if (spec.getAliasNode()) continue;
        const original = spec.getName();
        const alias = ctx.gen.local();
        spec.renameAlias(alias);
        ctx.assignedNames.add(alias);
        ctx.builder.addLocal(alias, original);
      }
    }
  }
}

/** Pass 2b: object-literal property names (fresh collection, post-propagation). */
function collectObjectLiteralProps(files: SourceFile[], repoRoot: string, ctx: RenameContext): RenameTarget[] {
  const targets: RenameTarget[] = [];
  for (const sf of files) {
    const relFile = posixRel(repoRoot, sf.getFilePath());
    sf.forEachDescendant((node) => {
      const k = node.getKind();
      if (
        k !== SyntaxKind.PropertyAssignment &&
        k !== SyntaxKind.ShorthandPropertyAssignment &&
        k !== SyntaxKind.MethodDeclaration &&
        k !== SyntaxKind.GetAccessor &&
        k !== SyntaxKind.SetAccessor
      ) {
        return;
      }
      // Shorthands are handled by expandShorthandProps (an LS rename at a
      // shorthand renames the VALUE symbol and preserves the property key).
      if (k === SyntaxKind.ShorthandPropertyAssignment) return;
      const parent = node.getParent();
      if (!parent || !Node.isObjectLiteralExpression(parent)) return;
      const nn = identifierNameNode(node);
      if (!nn) return;
      const name = nn.getText();
      if (ctx.assignedNames.has(name)) return;
      // Skip properties whose contract lives in node_modules (e.g. options
      // objects for external libraries) — renaming those would desync typing.
      const ctxProp = parent.getContextualType()?.getProperty(name);
      const decls = ctxProp?.getDeclarations() ?? [];
      if (decls.some((d) => d.getSourceFile().isInNodeModules())) return;
      targets.push({ nameNode: nn, original: name, kind: 'objProp', relFile });
    });
  }
  return targets;
}

/**
 * Pass 2b': expand shorthand properties `{ name }` -> `{ pN: name }`.
 *
 * A language-service rename at a shorthand renames the VALUE symbol (the
 * local) and preserves the property key — backwards for obfuscation. Instead
 * we expand the shorthand textually: the property side gets the global member
 * table name (matching any same-named property renamed in pass 1, which keeps
 * structural assignability), the value side stays a local reference that pass
 * 2c renames.
 */
function expandShorthandProps(files: SourceFile[], ctx: RenameContext): void {
  const editsByFile = new Map<SourceFile, TextEdit[]>();
  for (const sf of files) {
    for (const sp of sf.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)) {
      const nn = sp.getNameNode();
      const name = nn.getText();
      if (ctx.assignedNames.has(name)) continue;
      const parent = sp.getParent();
      if (!parent || !Node.isObjectLiteralExpression(parent)) continue;
      const ctxProp = parent.getContextualType()?.getProperty(name);
      const decls = ctxProp?.getDeclarations() ?? [];
      if (decls.some((d) => d.getSourceFile().isInNodeModules())) continue;
      let propName = ctx.memberNameTable.get(name);
      if (propName === undefined) {
        propName = ctx.gen.property();
        ctx.memberNameTable.set(name, propName);
        ctx.assignedNames.add(propName);
        ctx.builder.addLocal(propName, name);
      }
      let list = editsByFile.get(sf);
      if (!list) {
        list = [];
        editsByFile.set(sf, list);
      }
      list.push({ start: nn.getStart(), end: nn.getEnd(), text: `${propName}: ${name}` });
    }
  }
  applyEdits(editsByFile);
}

/** Pass 2c: locals — params, non-top-level vars, binding elements, type params, import bindings. */
function collectLocals(files: SourceFile[], repoRoot: string, ctx: RenameContext): RenameTarget[] {
  const targets: RenameTarget[] = [];
  const push = (nn: Node | undefined, relFile: string, kind: TargetKind): void => {
    if (!nn || !Node.isIdentifier(nn)) return;
    const name = nn.getText();
    if (ctx.assignedNames.has(name)) return;
    targets.push({ nameNode: nn, original: name, kind, relFile });
  };
  for (const sf of files) {
    const relFile = posixRel(repoRoot, sf.getFilePath());
    sf.forEachDescendant((node) => {
      switch (node.getKind()) {
        case SyntaxKind.Parameter: {
          const param = node.asKind(SyntaxKind.Parameter)!;
          push(param.getNameNode(), relFile, 'local');
          break;
        }
        case SyntaxKind.VariableDeclaration: {
          if (isTopLevelVariable(node)) break;
          push(node.asKind(SyntaxKind.VariableDeclaration)!.getNameNode(), relFile, 'local');
          break;
        }
        case SyntaxKind.BindingElement:
          push(node.asKind(SyntaxKind.BindingElement)!.getNameNode(), relFile, 'local');
          break;
        case SyntaxKind.TypeParameter:
          push(node.asKind(SyntaxKind.TypeParameter)!.getNameNode(), relFile, 'typeParam');
          break;
        case SyntaxKind.FunctionExpression:
        case SyntaxKind.ClassExpression:
          push(identifierNameNode(node), relFile, 'local');
          break;
        case SyntaxKind.ImportDeclaration: {
          const imp = node.asKind(SyntaxKind.ImportDeclaration)!;
          push(imp.getDefaultImport(), relFile, 'local');
          const nsImport = imp.getImportClause()?.getNamedBindings();
          if (nsImport && Node.isNamespaceImport(nsImport)) {
            push(nsImport.getNameNode(), relFile, 'local');
          }
          for (const spec of imp.getNamedImports()) {
            push(spec.getAliasNode(), relFile, 'local');
          }
          break;
        }
        default:
          break;
      }
    });
  }
  return targets;
}

/** Run all rename passes. Mutates the in-memory project only (never saves). */
export function runRenamePasses(
  project: Project,
  files: SourceFile[],
  repoRoot: string,
  gen: NameGenerator,
  builder: MappingBuilder
): RenameResult {
  const ctx: RenameContext = {
    gen,
    builder,
    assignedNames: new Set(),
    memberNameTable: new Map(),
    warnings: [],
  };
  const ls = project.getLanguageService();

  const memberName = (original: string, fresh: () => string): string => {
    let name = ctx.memberNameTable.get(original);
    if (name === undefined) {
      name = fresh();
      ctx.memberNameTable.set(original, name);
    }
    return name;
  };

  const nameFor = (t: RenameTarget): string => {
    switch (t.kind) {
      case 'entity':
        return gen.entity();
      case 'method':
        return memberName(t.original, () => gen.method());
      case 'property':
      case 'objProp':
        return memberName(t.original, () => gen.property());
      case 'typeParam':
        return gen.typeParam();
      default:
        return gen.local();
    }
  };

  runBatch(ls, collectPass1(files, repoRoot), ctx, nameFor); // pass 1
  aliasExternalImports(files, ctx); // pass 2a
  expandShorthandProps(files, ctx); // pass 2b'
  runBatch(ls, collectObjectLiteralProps(files, repoRoot, ctx), ctx, nameFor); // pass 2b
  runBatch(ls, collectLocals(files, repoRoot, ctx), ctx, nameFor); // pass 2c
  return { warnings: ctx.warnings, memberNameTable: ctx.memberNameTable };
}

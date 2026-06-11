/**
 * Stage 59.3 — emit the obfuscated tree.
 *
 * Instead of SourceFile#move() (slow and surprise-prone on large projects,
 * per plan 59.3 implementation note) we compute target paths from a
 * deterministic dir/file map, rewrite import specifiers as text edits, replace
 * string/template/regex literals and external member accesses, then strip
 * comments with the compiler printer (`removeComments: true`) and write each
 * file to its target location. The original tree on disk is never touched.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Node, Project, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { NameGenerator } from './name-generator.js';
import { MappingBuilder } from './mapping.js';
import { posixRel } from './renamer.js';

export interface EmitOptions {
  outDir: string;
  repoRoot: string;
}

export interface EmittedFile {
  originalRel: string;
  obfRel: string;
  bytes: number;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Static tsconfig template for the standalone obfuscated tree. */
const OBF_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "downlevelIteration": true,
    "strict": false,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"]
}
`;

function applyTextEdits(text: string, edits: TextEdit[]): string {
  const unique = new Map<string, TextEdit>();
  for (const e of edits) unique.set(`${e.start}:${e.end}`, e);
  const sorted = [...unique.values()].sort((a, b) => b.start - a.start);
  let prevStart = Number.POSITIVE_INFINITY;
  let out = text;
  for (const e of sorted) {
    if (e.end > prevStart) throw new Error(`overlapping emit edits at ${e.start}`);
    prevStart = e.start;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Assign obfuscated paths: every directory segment dN, every file fN.ts. */
function buildFileMap(
  files: SourceFile[],
  repoRoot: string,
  gen: NameGenerator,
  builder: MappingBuilder
): Map<SourceFile, string> {
  const dirMap = new Map<string, string>();
  const fileMap = new Map<SourceFile, string>();
  for (const sf of files) {
    const rel = posixRel(repoRoot, sf.getFilePath());
    const parts = rel.split('/');
    parts.pop();
    const obfDirs: string[] = [];
    let acc = '';
    for (const p of parts) {
      acc = acc === '' ? p : `${acc}/${p}`;
      let d = dirMap.get(acc);
      if (d === undefined) {
        d = gen.dir();
        dirMap.set(acc, d);
      }
      obfDirs.push(d);
    }
    const obfRel = [...obfDirs, `${gen.file()}.ts`].join('/');
    fileMap.set(sf, obfRel);
    builder.addFile(rel, obfRel);
  }
  return fileMap;
}

function relativeSpecifier(fromObfRel: string, toObfRel: string): string {
  const rel = path.posix
    .relative(path.posix.dirname(fromObfRel), toObfRel)
    .replace(/\.ts$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Is this symbol's declaration safe to keep in the obfuscated tree? */
function keepExternalName(decls: Node[]): boolean {
  // Default TS libs and @types stay resolvable in the obf tree (globals,
  // primitives, @types/node); every other package import collapses to `any`
  // via shorthand ambient modules, so its member names are free to replace.
  return decls.every((d) => {
    const fp = d.getSourceFile().getFilePath() as string;
    return fp.includes('/typescript/lib/') || fp.includes('/@types/');
  });
}

/** `typeof x` result literals — replacing them breaks narrowing and TS2367. */
const TYPEOF_RESULTS = new Set([
  'string',
  'number',
  'bigint',
  'boolean',
  'symbol',
  'undefined',
  'object',
  'function',
]);

export function emitTree(
  project: Project,
  files: SourceFile[],
  opts: EmitOptions,
  gen: NameGenerator,
  builder: MappingBuilder,
  memberNameTable: ReadonlyMap<string, string> = new Map()
): EmittedFile[] {
  const fileMap = buildFileMap(files, opts.repoRoot, gen, builder);
  const memberObfNames = new Set(memberNameTable.values());

  const pkgMap = new Map<string, string>();
  const pkgFor = (spec: string): string => {
    let p = pkgMap.get(spec);
    if (p === undefined) {
      p = gen.pkg();
      pkgMap.set(spec, p);
      builder.addPackage(spec, p);
    }
    return p;
  };

  const strMap = new Map<string, string>();
  const strFor = (value: string): string => {
    let s = strMap.get(value);
    if (s === undefined) {
      // Strings equal to a renamed member name map to that member's
      // obfuscated name so element accesses (`obj['theme']`), string-keyed
      // object literals and keyof-typed comparisons stay type-consistent.
      s = memberNameTable.get(value) ?? gen.str();
      strMap.set(value, s);
      builder.addString(value, s);
    }
    return s;
  };

  const regexMap = new Map<string, string>();
  const regexFor = (raw: string): string => {
    let r = regexMap.get(raw);
    if (r === undefined) {
      r = gen.regex();
      regexMap.set(raw, r);
      builder.addString(raw, r);
    }
    return r;
  };

  const extMemberMap = new Map<string, string>();
  const extMemberFor = (name: string): string => {
    let x = extMemberMap.get(name);
    if (x === undefined) {
      x = gen.externalMember();
      extMemberMap.set(name, x);
      builder.addLocal(x, name);
    }
    return x;
  };

  /** Leftmost identifier of a type name (Identifier or QualifiedName chain). */
  const typeRoot = (typeName: Node): Node => {
    let cur = typeName;
    while (Node.isQualifiedName(cur)) cur = cur.getLeft();
    return cur;
  };

  /** Is this identifier an import binding from a module replaced by pkgN? */
  const isExternalImportBinding = (root: Node): boolean => {
    const sym = root.getSymbol();
    if (!sym) return false;
    for (const d of sym.getDeclarations()) {
      if (Node.isImportSpecifier(d) || Node.isImportClause(d) || Node.isNamespaceImport(d)) {
        const idecl = d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        const target = idecl?.getModuleSpecifierSourceFile();
        if (!target || !fileMap.has(target)) return true;
      }
    }
    return false;
  };

  const resolveRelativeModule = (sf: SourceFile, value: string): SourceFile | undefined => {
    if (!value.startsWith('.')) return undefined;
    const base = path.resolve(path.dirname(sf.getFilePath()), value);
    return (
      project.getSourceFile(base) ??
      project.getSourceFile(`${base}.ts`) ??
      project.getSourceFile(base.replace(/\.js$/, '.ts'))
    );
  };

  // Phase 1 (program intact): per-file specifier + external-member edits.
  const preEdits = new Map<SourceFile, TextEdit[]>();
  const specifierSpans = new Map<SourceFile, Set<number>>();
  const anySpansByFile = new Map<SourceFile, Array<[number, number]>>();
  for (const sf of files) {
    const edits: TextEdit[] = [];
    const spans = new Set<number>();
    const fromObfRel = fileMap.get(sf)!;

    // Type references rooted at external import bindings cannot survive in
    // the obfuscated tree: shorthand ambient modules (`declare module 'pkgN'`)
    // provide `any` values but no type meanings (TS2709). Collapse the whole
    // type reference to `any`; suppress any other edit inside those spans.
    const anySpans: Array<[number, number]> = [];
    const inAnySpan = (start: number, end: number): boolean =>
      anySpans.some(([s, e]) => start >= s && end <= e);
    const addAnySpan = (node: Node): void => {
      if (inAnySpan(node.getStart(), node.getEnd())) return; // keep outermost only
      anySpans.push([node.getStart(), node.getEnd()]);
      edits.push({ start: node.getStart(), end: node.getEnd(), text: 'any' });
    };
    for (const tr of sf.getDescendantsOfKind(SyntaxKind.TypeReference)) {
      if (isExternalImportBinding(typeRoot(tr.getTypeName()))) addAnySpan(tr);
    }
    // import('...').T type nodes: internal -> rewrite specifier; external -> any.
    for (const it of sf.getDescendantsOfKind(SyntaxKind.ImportType)) {
      const lit = it.getArgument().getFirstDescendantByKind(SyntaxKind.StringLiteral);
      if (!lit) continue;
      if (inAnySpan(it.getStart(), it.getEnd())) continue;
      const resolved = resolveRelativeModule(sf, lit.getLiteralValue());
      if (resolved && fileMap.has(resolved)) {
        spans.add(lit.getStart());
        edits.push({
          start: lit.getStart(),
          end: lit.getEnd(),
          text: `'${relativeSpecifier(fromObfRel, fileMap.get(resolved)!)}'`,
        });
      } else {
        addAnySpan(it);
      }
    }

    const rewriteSpecifier = (lit: Node, resolved: SourceFile | undefined): void => {
      spans.add(lit.getStart());
      const resolvedObf = resolved ? fileMap.get(resolved) : undefined;
      const newSpec = resolvedObf
        ? relativeSpecifier(fromObfRel, resolvedObf)
        : pkgFor((lit as unknown as { getLiteralValue: () => string }).getLiteralValue());
      edits.push({ start: lit.getStart(), end: lit.getEnd(), text: `'${newSpec}'` });
    };

    for (const decl of sf.getImportDeclarations()) {
      const lit = decl.getModuleSpecifier();
      const resolved = decl.getModuleSpecifierSourceFile();
      const internal = resolved && !resolved.isInNodeModules() ? resolved : undefined;
      rewriteSpecifier(lit, internal);
      if (!internal) {
        // External: drop original imported names, keep only obfuscated aliases
        // (`{ EventEmitter as v7 }` -> `{ v7 }`); valid against ambient any-modules.
        for (const spec of decl.getNamedImports()) {
          const alias = spec.getAliasNode();
          if (alias) edits.push({ start: spec.getStart(), end: spec.getEnd(), text: alias.getText() });
        }
      }
    }
    for (const decl of sf.getExportDeclarations()) {
      const lit = decl.getModuleSpecifier();
      if (lit) {
        const resolved = decl.getModuleSpecifierSourceFile();
        rewriteSpecifier(lit, resolved && !resolved.isInNodeModules() ? resolved : undefined);
      }
      // The language-service rename preserves public re-export names via
      // aliases (`export { Xq7 as OriginalName }`) — that alias is exactly the
      // leak surface. No in-tree import uses the original public name (all
      // were renamed at their use sites), so drop the alias.
      for (const spec of decl.getNamedExports()) {
        const alias = spec.getAliasNode();
        if (!alias) continue;
        const name = spec.getNameNode().getText();
        if (name === 'default' || alias.getText() === 'default') continue;
        edits.push({ start: spec.getStart(), end: spec.getEnd(), text: name });
      }
    }
    // Dynamic import('...') calls.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const arg = call.getArguments()[0];
      if (!arg || !Node.isStringLiteral(arg)) continue;
      const resolved = resolveRelativeModule(sf, arg.getLiteralValue());
      rewriteSpecifier(arg, resolved && fileMap.has(resolved) ? resolved : undefined);
    }
    // External member accesses (e.g. `mermaid.render(...)`): no in-project
    // declaration, target collapses to `any` in the obf tree — replace name.
    const handleAccessName = (nameNode: Node): void => {
      if (inAnySpan(nameNode.getStart(), nameNode.getEnd())) return;
      const symbol = nameNode.getSymbol();
      if (symbol) {
        const decls = symbol.getDeclarations();
        const inProject = decls.some((d) => fileMap.has(d.getSourceFile()));
        if (inProject || keepExternalName(decls)) return;
      }
      edits.push({
        start: nameNode.getStart(),
        end: nameNode.getEnd(),
        text: extMemberFor(nameNode.getText()),
      });
    };
    for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const nn = pa.getNameNode();
      if (Node.isIdentifier(nn)) handleAccessName(nn);
    }
    for (const qn of sf.getDescendantsOfKind(SyntaxKind.QualifiedName)) {
      handleAccessName(qn.getRight());
    }

    preEdits.set(sf, edits);
    specifierSpans.set(sf, spans);
    anySpansByFile.set(sf, anySpans);
  }

  // Phase 2: literal replacement edits (no type info needed), then print+write.
  mkdirSync(opts.outDir, { recursive: true });
  const written: EmittedFile[] = [];
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

  for (const sf of files) {
    const edits = [...(preEdits.get(sf) ?? [])];
    const spans = specifierSpans.get(sf)!;
    const anySpans = anySpansByFile.get(sf) ?? [];
    const inAnySpan = (start: number, end: number): boolean =>
      anySpans.some(([s, e]) => start >= s && end <= e);

    for (const node of sf.getDescendants()) {
      if (inAnySpan(node.getStart(), node.getEnd())) continue;
      switch (node.getKind()) {
        case SyntaxKind.StringLiteral: {
          if (spans.has(node.getStart())) break;
          const v = node.asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
          if (v === '') break;
          // `typeof x === 'object'` literals must keep their value or
          // narrowing breaks (TS2367); they carry no domain information.
          if (TYPEOF_RESULTS.has(v)) break;
          // String property references (indexed-access types, element access)
          // were already renamed by the language service to obf member names;
          // replacing them again would desync them from the renamed members.
          if (memberObfNames.has(v)) break;
          edits.push({ start: node.getStart(), end: node.getEnd(), text: `'${strFor(v)}'` });
          break;
        }
        case SyntaxKind.NoSubstitutionTemplateLiteral: {
          const v = node.asKind(SyntaxKind.NoSubstitutionTemplateLiteral)!.getLiteralValue();
          if (v === '') break;
          edits.push({ start: node.getStart(), end: node.getEnd(), text: `\`${strFor(v)}\`` });
          break;
        }
        case SyntaxKind.TemplateHead:
        case SyntaxKind.TemplateMiddle:
        case SyntaxKind.TemplateTail: {
          const raw = node.getText();
          const tailLen = node.getKind() === SyntaxKind.TemplateTail ? 1 : 2;
          const inner = raw.slice(1, raw.length - tailLen);
          if (inner === '') break;
          edits.push({
            start: node.getStart() + 1,
            end: node.getEnd() - tailLen,
            text: strFor(inner),
          });
          break;
        }
        case SyntaxKind.RegularExpressionLiteral: {
          const raw = node.getText();
          edits.push({ start: node.getStart(), end: node.getEnd(), text: `/${regexFor(raw)}/` });
          break;
        }
        default:
          break;
      }
    }

    const replaced = applyTextEdits(sf.getFullText(), edits);
    const obfRel = fileMap.get(sf)!;
    const parsed = ts.createSourceFile(
      path.posix.basename(obfRel),
      replaced,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS
    );
    const finalText = printer.printFile(parsed);
    const target = path.join(opts.outDir, ...obfRel.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, finalText, 'utf8');
    written.push({
      originalRel: posixRel(opts.repoRoot, sf.getFilePath()),
      obfRel,
      bytes: Buffer.byteLength(finalText, 'utf8'),
    });
  }

  // Standalone tsconfig + ambient module declarations for replaced packages.
  writeFileSync(path.join(opts.outDir, 'tsconfig.json'), OBF_TSCONFIG, 'utf8');
  const ambient = [...pkgMap.values()].map((p) => `declare module '${p}';`).join('\n');
  writeFileSync(path.join(opts.outDir, 'externals.d.ts'), `${ambient}\n`, 'utf8');

  return written;
}

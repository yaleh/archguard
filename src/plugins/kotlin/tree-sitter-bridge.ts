/**
 * TreeSitterBridge — parses Kotlin source files via tree-sitter and produces
 * RawKotlinFile structures consumed by the rest of the plugin pipeline.
 *
 * Verified AST facts (from AST_NODES.md + probe script):
 *   - Package name: `package_header` → `qualified_identifier` text
 *   - Imports: each is a direct `import` child of `source_file`
 *       import text → `qualified_identifier` namedChild (index 0)
 *       import alias → `identifier` namedChild (index 1, optional)
 *       wildcard .*  → no extra namedChild; the `*` is NOT a namedChild
 *   - Classes/objects: delegated to ClassBuilder
 *   - Top-level functions: delegated to FunctionBuilder
 */

import type { ParserSession, SyntaxNodeLike } from '../shared/syntax-tree.js';
import { ClassBuilder } from './builders/class-builder.js';
import { FunctionBuilder } from './builders/function-builder.js';
import type { RawKotlinFile, RawKotlinImport } from './types.js';

export class TreeSitterBridge {
  private readonly parser: ParserSession;
  private classBuilder: ClassBuilder;
  private functionBuilder: FunctionBuilder;

  constructor(parser: ParserSession) {
    this.parser = parser;
    this.classBuilder = new ClassBuilder();
    this.functionBuilder = new FunctionBuilder();
  }

  /**
   * Parse Kotlin source text and return a RawKotlinFile.
   * On parse failure returns an empty stub so the pipeline can continue.
   */
  parseCode(code: string, filePath: string): RawKotlinFile {
    const tree = this.parser.parse(code);
    try {
      return this.extractFile(tree.rootNode, filePath);
    } catch (e) {
      console.warn(`[kotlin] Failed to parse ${filePath}:`, e);
      return { filePath, packageName: '', imports: [], classes: [], functions: [] };
    } finally {
      tree.dispose();
    }
  }

  // ─── private extraction ────────────────────────────────────────────────────

  private extractFile(rootNode: SyntaxNodeLike, filePath: string): RawKotlinFile {
    const packageName = this.extractPackageName(rootNode);
    const imports = this.extractImports(rootNode);
    const classes = this.classBuilder.extractClasses(rootNode, packageName, filePath);
    const functions = this.functionBuilder.extractTopLevelFunctions(
      rootNode,
      packageName,
      filePath
    );
    return { filePath, packageName, imports, classes, functions };
  }

  // ─── package_header ────────────────────────────────────────────────────────

  private extractPackageName(rootNode: SyntaxNodeLike): string {
    for (const child of rootNode.namedChildren) {
      if (child.type === 'package_header') {
        // Verified: package_header → qualified_identifier (not `identifier`)
        for (const c of child.namedChildren) {
          if (c.type === 'qualified_identifier') return c.text;
        }
        // Fallback: strip keyword prefix from raw text
        return child.text.replace(/^package\s+/, '').trim();
      }
    }
    return '';
  }

  // ─── import nodes ──────────────────────────────────────────────────────────

  private extractImports(rootNode: SyntaxNodeLike): RawKotlinImport[] {
    const imports: RawKotlinImport[] = [];

    for (const child of rootNode.namedChildren) {
      // Verified: node type is 'import' (not 'import_header')
      if (child.type !== 'import') continue;

      const path = this.extractImportPath(child);
      if (!path) continue;

      const alias = this.extractImportAlias(child);
      imports.push({ path, alias });
    }

    return imports;
  }

  /**
   * Import path lives in the `qualified_identifier` namedChild (index 0).
   * Wildcard imports end with `.*` which is NOT reflected in namedChildren —
   * the `*` is an anonymous token.  We append `.*` when the raw text ends with
   * `.*` to preserve the wildcard information.
   */
  private extractImportPath(importNode: SyntaxNodeLike): string | undefined {
    // Verified: namedChildren[0] is qualified_identifier
    const qid = importNode.namedChildren.find(
      (c: SyntaxNodeLike) => c.type === 'qualified_identifier'
    );
    if (qid) {
      const base = qid.text;
      // Preserve wildcard: raw import text ends with '.*' but namedChildren don't include '*'
      const raw = importNode.text.trim();
      return raw.endsWith('.*') ? base + '.*' : base;
    }

    // Fallback: strip 'import ' keyword from raw text
    const raw = importNode.text.replace(/^import\s+/, '').trim();
    return raw || undefined;
  }

  /**
   * Import alias: `import Foo as Bar`
   * Verified: when an alias exists, namedChildren[1] has type 'identifier'.
   */
  private extractImportAlias(importNode: SyntaxNodeLike): string | undefined {
    const named = importNode.namedChildren;
    // namedChildren[1] (if present) is the alias identifier
    if (named.length >= 2) {
      const aliasNode = named[1];
      if (aliasNode.type === 'identifier') {
        return aliasNode.text;
      }
    }
    return undefined;
  }
}

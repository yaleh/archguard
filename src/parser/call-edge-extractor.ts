/**
 * CallEdgeExtractor - Extracts method- and function-level call edges using ts-morph TypeChecker
 *
 * This class operates on a real (filesystem-backed) ts-morph Project that has
 * a full TypeChecker, enabling accurate cross-file type resolution. It should NOT
 * be used with in-memory-only projects (useInMemoryFileSystem: true) as the
 * TypeChecker cannot resolve cross-file types in that mode.
 *
 * Coverage
 *  - class instance/static methods (source entity = the class)
 *  - exported standalone function declarations (source entity = the function)
 *  - exported arrow / function-expression consts, including HOC-wrapped forms
 *    (source entity = the function, enumerated by FunctionExtractor so the call
 *    graph can never drift from the entity surface)
 *
 * Callee resolution
 *  - property access (`a.save()`, `console.log()`) resolves the receiver's
 *    declaration and requires the called member to exist on it
 *  - bare identifiers (`helper()`) resolve through the TypeChecker symbol and
 *    its *declaration* (file + declared name) — never through a bare-name map,
 *    which would cross-link same-named functions in different files
 *
 * Explicitly NOT covered (counted in CallEdgeStats, see getStats())
 *  - non-exported top-level functions: they have no entity in ArchJSON, so
 *    their call sites are skipped and counted rather than silently dropped
 *  - module top-level call sites (no source entity)
 *  - constructor bodies
 *  - object-literal methods
 *  - class-property arrow functions
 *  - class member initializers / accessors / decorators
 *
 * Calls lexically nested in an inline callback are attributed to the enclosing
 * entity-backed function — the same behaviour the previous class-method scanner
 * had, since it walked every descendant CallExpression of the method body.
 */

import path from 'path';
import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
  type CallExpression,
  type PropertyAccessExpression,
  type Identifier,
  type TypeChecker,
  type Symbol as TsSymbol,
} from 'ts-morph';
import type { Relation, Entity } from '@/types/index.js';
import { FunctionExtractor, type FunctionEntitySource } from './function-extractor.js';

/** Diagnostics for the call-site walk. Exposed for verbose output and tests. */
export interface CallEdgeStats {
  /** Every CallExpression visited in the analyzed files. */
  callSitesTotal: number;
  /** Call sites whose nearest entity-backed source function was found. */
  callSitesInSourceEntities: number;
  /** Unique call edges emitted. */
  edgesEmitted: number;
  /** Call sites inside a non-exported top-level function (no entity). */
  skippedNonExportedFunction: number;
  /** Call sites at module top level (outside every function). */
  skippedModuleTopLevel: number;
  /** Call sites in a context this extractor explicitly does not support. */
  skippedUnsupportedContext: number;
  /** ... broken down by context (each also increments skippedUnsupportedContext). */
  skippedConstructor: number;
  skippedObjectLiteralMethod: number;
  skippedClassPropertyArrow: number;
  skippedClassMemberContext: number;
  /** Nested standalone function declarations used as a source boundary. */
  skippedNestedFunction: number;
  /** Callee did not resolve to a project entity (external API, callback, etc.). */
  skippedUnresolvedTarget: number;
  /** Receiver resolved to a project entity but the called member does not exist. */
  skippedMissingTargetMethod: number;
  /** TypeChecker queries that threw and were caught per call site. */
  checkerErrors: number;
}

export interface CallEdgeExtractorOptions {
  /** Print the CallEdgeStats summary after extraction (stderr only). */
  verbose?: boolean;
}

interface CallSource {
  /** Entity ID of the calling class/function. */
  entityId: string;
  /** Method/function name on that entity. */
  sourceMethod: string;
}

const EMPTY_STATS = (): CallEdgeStats => ({
  callSitesTotal: 0,
  callSitesInSourceEntities: 0,
  edgesEmitted: 0,
  skippedNonExportedFunction: 0,
  skippedModuleTopLevel: 0,
  skippedUnsupportedContext: 0,
  skippedConstructor: 0,
  skippedObjectLiteralMethod: 0,
  skippedClassPropertyArrow: 0,
  skippedClassMemberContext: 0,
  skippedNestedFunction: 0,
  skippedUnresolvedTarget: 0,
  skippedMissingTargetMethod: 0,
  checkerErrors: 0,
});

export class CallEdgeExtractor {
  /** All project entity IDs (for membership testing). */
  private readonly entityIds: Set<string>;
  /** Entity IDs that represent standalone functions. */
  private readonly functionEntityIds: Set<string>;
  /** Enumerates function entities with exactly the same criteria as extraction. */
  private readonly functionExtractor = new FunctionExtractor();
  private readonly stats: CallEdgeStats = EMPTY_STATS();
  private readonly verbose: boolean;

  constructor(
    private readonly project: Project,
    entities: Entity[],
    private readonly workspaceRoot: string,
    options: CallEdgeExtractorOptions = {}
  ) {
    this.entityIds = new Set(entities.map((e) => e.id));
    this.functionEntityIds = new Set(
      entities.filter((e) => e.type === 'function').map((e) => e.id)
    );
    this.verbose = options.verbose === true;
  }

  /** Diagnostics gathered during the last extractAll() call. */
  getStats(): Readonly<CallEdgeStats> {
    return this.stats;
  }

  extractAll(): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const sourceFile of this.project.getSourceFiles()) {
      try {
        this.extractFromFile(sourceFile, seen, relations);
      } catch {
        // A file-level failure must not abort the whole call graph; per-call
        // TypeChecker failures are caught separately below and counted too.
        this.stats.checkerErrors++;
      }
    }

    this.stats.edgesEmitted = relations.length;
    if (this.verbose) this.logStats();
    return relations;
  }

  private toRelPath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }

  private extractFromFile(sourceFile: SourceFile, seen: Set<string>, relations: Relation[]): void {
    const checker = this.project.getTypeChecker();
    const relPath = this.toRelPath(sourceFile.getFilePath());

    // Build the map of nodes that legitimately own call sites: class methods
    // plus the bodies of exported function entities.
    const sources = new Map<Node, CallSource>();
    this.collectClassMethodSources(sourceFile, relPath, sources);
    this.collectFunctionSources(sourceFile, relPath, sources);

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      this.stats.callSitesTotal++;

      try {
        const source = this.resolveCallSource(call, sources);
        if (!source) continue;
        this.stats.callSitesInSourceEntities++;

        const edge = this.resolveCallTarget(call, source, checker);
        if (!edge) continue;
        if (seen.has(edge.id)) continue;

        seen.add(edge.id);
        relations.push(edge);
      } catch {
        // ts-morph's TypeChecker throws internal TypeErrors on a small subset of
        // (mostly codebase-dependent) call sites. This must stay per-call so one
        // bad site cannot abort the analysis of the remaining thousands.
        this.stats.checkerErrors++;
      }
    }
  }

  private collectClassMethodSources(
    sourceFile: SourceFile,
    relPath: string,
    sources: Map<Node, CallSource>
  ): void {
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className) continue;

      const sourceEntityId = `${relPath}.${className}`;
      if (!this.entityIds.has(sourceEntityId)) continue;

      for (const method of cls.getMethods()) {
        if (!method.getBody()) continue;
        sources.set(method, { entityId: sourceEntityId, sourceMethod: method.getName() });
      }
    }
  }

  private collectFunctionSources(
    sourceFile: SourceFile,
    relPath: string,
    sources: Map<Node, CallSource>
  ): void {
    for (const source of this.functionExtractor.collectEntitySources(sourceFile, relPath)) {
      if (!this.functionEntityIds.has(source.id)) continue;
      const body = this.resolveFunctionBodyNode(source.functionNode);
      if (!body) continue;
      // A declaration that is itself an entity (e.g. an exported function also
      // referenced by memo(...)) keeps its own identity.
      if (!sources.has(body)) {
        sources.set(body, { entityId: source.id, sourceMethod: source.name });
      }
    }
  }

  /**
   * Resolve the node whose descendants carry the function's calls. HOC-wrapped
   * named references (`export const X = memo(NamedFn)`) point at the referenced
   * declaration, which may be in the same file.
   */
  private resolveFunctionBodyNode(
    functionNode: FunctionEntitySource['functionNode']
  ): Node | undefined {
    if (!Node.isIdentifier(functionNode)) return functionNode;
    for (const declaration of functionNode.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isFunctionDeclaration(declaration) && declaration.getBody()) {
        return declaration;
      }
    }
    return undefined;
  }

  /**
   * Walk up from a call site to the nearest node that can own it.
   *
   * Inline callbacks are transparent: a call inside `items.map(x => helper(x))`
   * belongs to the enclosing method/function, matching the previous
   * `body.getDescendantsOfKind(CallExpression)` behaviour. Hard boundaries stop
   * the walk and are counted in stats.
   */
  private resolveCallSource(
    call: CallExpression,
    sources: Map<Node, CallSource>
  ): CallSource | undefined {
    let current = call.getParent();

    while (current) {
      if (Node.isMethodDeclaration(current)) {
        const source = sources.get(current);
        if (source) return source;

        if (Node.isObjectLiteralExpression(current.getParent())) {
          this.stats.skippedObjectLiteralMethod++;
        } else {
          this.stats.skippedClassMemberContext++;
        }
        this.stats.skippedUnsupportedContext++;
        return undefined;
      }

      if (Node.isConstructorDeclaration(current)) {
        this.stats.skippedConstructor++;
        this.stats.skippedUnsupportedContext++;
        return undefined;
      }

      if (Node.isFunctionDeclaration(current)) {
        const source = sources.get(current);
        if (source) return source;

        if (Node.isSourceFile(current.getParent())) {
          this.stats.skippedNonExportedFunction++;
        } else {
          this.stats.skippedNestedFunction++;
          this.stats.skippedUnsupportedContext++;
        }
        return undefined;
      }

      if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
        const source = sources.get(current);
        if (source) return source;

        const parent = current.getParent();
        if (Node.isPropertyDeclaration(parent)) {
          this.stats.skippedClassPropertyArrow++;
          this.stats.skippedUnsupportedContext++;
          return undefined;
        }
        if (this.isTopLevelVariableInitializer(current)) {
          this.stats.skippedNonExportedFunction++;
          return undefined;
        }

        // Inline callback / nested function expression: transparent.
        current = current.getParent();
        continue;
      }

      if (
        Node.isGetAccessorDeclaration(current) ||
        Node.isSetAccessorDeclaration(current) ||
        Node.isPropertyDeclaration(current) ||
        Node.isDecorator(current)
      ) {
        this.stats.skippedClassMemberContext++;
        this.stats.skippedUnsupportedContext++;
        return undefined;
      }

      if (Node.isClassDeclaration(current)) {
        // A call in a class property initializer / static block that never
        // passed through a supported method.
        this.stats.skippedClassMemberContext++;
        this.stats.skippedUnsupportedContext++;
        return undefined;
      }

      if (Node.isSourceFile(current)) {
        this.stats.skippedModuleTopLevel++;
        return undefined;
      }

      current = current.getParent();
    }

    this.stats.skippedModuleTopLevel++;
    return undefined;
  }

  /** True when `node` is the initializer of a top-level `const`/`let` declaration. */
  private isTopLevelVariableInitializer(node: Node): boolean {
    const parent = node.getParent();
    if (!parent) return false;

    if (Node.isParenthesizedExpression(parent)) {
      return this.isTopLevelVariableInitializer(parent);
    }

    if (Node.isCallExpression(parent)) {
      // HOC wrapper: const f = memo(() => ...). Walk the wrapper chain to see
      // whether the whole expression is a top-level variable initializer.
      let expression: Node = parent;
      let up = expression.getParent();
      while (up && Node.isParenthesizedExpression(up)) {
        expression = up;
        up = expression.getParent();
      }
      if (up && Node.isVariableDeclaration(up)) {
        const statement = up.getVariableStatement();
        return statement !== undefined && Node.isSourceFile(statement.getParent());
      }
      return false;
    }

    if (Node.isVariableDeclaration(parent)) {
      const statement = parent.getVariableStatement();
      return statement !== undefined && Node.isSourceFile(statement.getParent());
    }

    return false;
  }

  private resolveCallTarget(
    call: CallExpression,
    source: CallSource,
    checker: TypeChecker
  ): Relation | undefined {
    const callee = call.getExpression();

    if (Node.isPropertyAccessExpression(callee)) {
      return this.resolvePropertyAccessTarget(callee, source, checker);
    }

    if (Node.isIdentifier(callee)) {
      return this.resolveIdentifierTarget(callee, source, checker);
    }

    // Element access (`obj['m']()`), dynamically computed callees, etc.
    this.stats.skippedUnresolvedTarget++;
    return undefined;
  }

  private resolvePropertyAccessTarget(
    callee: PropertyAccessExpression,
    source: CallSource,
    checker: TypeChecker
  ): Relation | undefined {
    const receiverType = checker.getTypeAtLocation(callee.getExpression());
    const receiverSymbol = receiverType.getSymbol() ?? receiverType.getAliasSymbol();
    const targetEntityId = this.resolveEntityIdFromSymbol(receiverSymbol);

    if (!targetEntityId) {
      this.stats.skippedUnresolvedTarget++;
      return undefined;
    }

    const targetMethod = callee.getName();

    // Target-method existence check: a property that is not declared on the
    // receiver (e.g. `new A().s()` when A has no `s`) has no symbol. This also
    // handles inherited members, which a member-name snapshot would miss.
    const methodSymbol = checker.getSymbolAtLocation(callee.getNameNode());
    if (!methodSymbol) {
      this.stats.skippedMissingTargetMethod++;
      return undefined;
    }

    const isInterface = (receiverSymbol?.getDeclarations() ?? []).some((d) =>
      Node.isInterfaceDeclaration(d)
    );
    return this.buildEdge(source, targetEntityId, targetMethod, isInterface);
  }

  private resolveIdentifierTarget(
    callee: Identifier,
    source: CallSource,
    checker: TypeChecker
  ): Relation | undefined {
    const symbol = checker.getSymbolAtLocation(callee);
    if (!symbol) {
      this.stats.skippedUnresolvedTarget++;
      return undefined;
    }

    const resolved = symbol.isAlias() ? symbol.getAliasedSymbol() : symbol;
    if (!resolved) {
      this.stats.skippedUnresolvedTarget++;
      return undefined;
    }

    const target = this.resolveFunctionEntityFromSymbol(resolved);
    if (!target) {
      this.stats.skippedUnresolvedTarget++;
      return undefined;
    }

    return this.buildEdge(source, target.id, target.name, false);
  }

  /**
   * Map a symbol to an entity ID through its **declarations** (file + declared
   * name). Deliberately not a `simpleName → entityId` map: the quay codebase has
   * hundreds of same-named declarations, and a bare-name map silently crosses
   * them.
   */
  private resolveEntityIdFromSymbol(symbol: TsSymbol | undefined): string | undefined {
    if (!symbol) return undefined;

    for (const declaration of symbol.getDeclarations()) {
      const sourceFile = declaration.getSourceFile();
      if (!sourceFile) continue;
      const name = this.declaredEntityName(declaration);
      if (!name) continue;
      const id = `${this.toRelPath(sourceFile.getFilePath())}.${name}`;
      if (this.entityIds.has(id)) return id;
    }

    return undefined;
  }

  private declaredEntityName(declaration: Node): string | undefined {
    if (
      Node.isClassDeclaration(declaration) ||
      Node.isInterfaceDeclaration(declaration) ||
      Node.isEnumDeclaration(declaration)
    ) {
      return declaration.getName();
    }
    return undefined;
  }

  private resolveFunctionEntityFromSymbol(
    symbol: TsSymbol
  ): { id: string; name: string } | undefined {
    for (const declaration of symbol.getDeclarations()) {
      const sourceFile = declaration.getSourceFile();
      if (!sourceFile) continue;

      let name: string | undefined;
      if (Node.isFunctionDeclaration(declaration)) {
        name = declaration.getName();
      } else if (Node.isVariableDeclaration(declaration)) {
        name = declaration.getName();
      }
      if (!name) continue;

      const id = `${this.toRelPath(sourceFile.getFilePath())}.${name}`;
      if (this.functionEntityIds.has(id)) return { id, name };
    }

    return undefined;
  }

  private buildEdge(
    source: CallSource,
    targetEntityId: string,
    targetMethod: string,
    isInterface: boolean
  ): Relation {
    return {
      id: `call:${source.entityId}.${source.sourceMethod}:${targetEntityId}.${targetMethod}`,
      type: 'call',
      source: source.entityId,
      target: targetEntityId,
      sourceMethod: source.sourceMethod,
      targetMethod,
      callType: isInterface ? 'interface' : 'direct',
      confidence: isInterface ? 0.6 : 0.85,
      inferenceSource: 'explicit',
    };
  }

  private logStats(): void {
    const s = this.stats;
    const unsupported =
      s.skippedConstructor +
      s.skippedObjectLiteralMethod +
      s.skippedClassPropertyArrow +
      s.skippedClassMemberContext +
      s.skippedNestedFunction;

    console.warn(
      `[CallEdgeExtractor] call sites: total=${s.callSitesTotal}, ` +
        `in source entities=${s.callSitesInSourceEntities}, edges=${s.edgesEmitted}`
    );
    console.warn(
      `[CallEdgeExtractor] skipped: non-exported function call sites=${s.skippedNonExportedFunction}, ` +
        `module top-level=${s.skippedModuleTopLevel}, ` +
        `unsupported contexts=${unsupported} ` +
        `(constructor=${s.skippedConstructor}, object-literal method=${s.skippedObjectLiteralMethod}, ` +
        `class-property arrow=${s.skippedClassPropertyArrow}, ` +
        `class member/accessor/decorator=${s.skippedClassMemberContext}, ` +
        `nested function=${s.skippedNestedFunction}), ` +
        `unresolved target=${s.skippedUnresolvedTarget}, ` +
        `missing target method=${s.skippedMissingTargetMethod}`
    );
    console.warn(`[CallEdgeExtractor] TypeChecker errors caught per call site=${s.checkerErrors}`);
  }
}

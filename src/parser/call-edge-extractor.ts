/**
 * CallEdgeExtractor - Extracts method-level call edges using ts-morph TypeChecker
 *
 * This class operates on a real (filesystem-backed) ts-morph Project that has
 * a full TypeChecker, enabling accurate cross-file type resolution. It should NOT
 * be used with in-memory-only projects (useInMemoryFileSystem: true) as the
 * TypeChecker cannot resolve cross-file types in that mode.
 *
 * Only class methods are analyzed — standalone functions are intentionally excluded
 * to avoid excessive noise in the call graph.
 */

import path from 'path';
import { Project, Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Relation, Entity } from '@/types/index.js';

export class CallEdgeExtractor {
  /** Set of all project entity names (for fast membership testing) */
  private readonly projectEntityNames: Set<string>;
  /** Map from entity name → entity ID (for target resolution) */
  private readonly nameToEntityId: Map<string, string>;

  constructor(
    private readonly project: Project,
    entities: Entity[],
    private readonly workspaceRoot: string
  ) {
    this.projectEntityNames = new Set(entities.map((e) => e.name));
    this.nameToEntityId = new Map(entities.map((e) => [e.name, e.id]));
  }

  extractAll(): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();
    for (const sourceFile of this.project.getSourceFiles()) {
      this.extractFromFile(sourceFile, seen, relations);
    }
    return relations;
  }

  private toRelPath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }

  private extractFromFile(sourceFile: SourceFile, seen: Set<string>, relations: Relation[]): void {
    const checker = this.project.getTypeChecker();
    const relPath = this.toRelPath(sourceFile.getFilePath());

    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className) continue;

      const sourceEntityId = `${relPath}.${className}`;

      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const body = method.getBody();
        if (!body) continue;

        body.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
          const access = call.getExpression();
          if (!Node.isPropertyAccessExpression(access)) return;

          const receiverType = checker.getTypeAtLocation(access.getExpression());
          const targetClass = receiverType.getSymbol()?.getName();
          if (!targetClass || !this.projectEntityNames.has(targetClass)) return;

          const targetMethod = access.getName();
          const id = `call:${relPath}.${className}.${methodName}:${targetClass}.${targetMethod}`;
          if (seen.has(id)) return;
          seen.add(id);

          const sym = receiverType.getSymbol();
          const isInterface =
            sym?.getDeclarations().some((d) => Node.isInterfaceDeclaration(d)) ?? false;

          // Resolve target entity ID (prefer fully qualified ID if available)
          const targetEntityId = this.nameToEntityId.get(targetClass) ?? targetClass;

          relations.push({
            id,
            type: 'call',
            source: sourceEntityId,
            target: targetEntityId,
            sourceMethod: methodName,
            targetMethod,
            callType: isInterface ? 'interface' : 'direct',
            confidence: isInterface ? 0.6 : 0.85,
            inferenceSource: 'explicit',
          });
        });
      }
    }
  }
}

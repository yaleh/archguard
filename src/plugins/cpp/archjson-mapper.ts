import path from 'path';
import { generateEntityId, createRelation } from '@/plugins/shared/mapper-utils.js';
import type { Entity, EntityType, Member, MemberType, Relation } from '@/types/index.js';
import type { MergedCppEntity, RawEnum, RawFunction, RawMethod, RawField } from './types.js';
import { CppTypeExtractor } from './cpp-type-extractor.js';

export class ArchJsonMapper {
  mapEntities(
    classes: MergedCppEntity[],
    enums: RawEnum[],
    functions: RawFunction[],
    workspaceRoot: string
  ): Entity[] {
    const entities: Entity[] = [];

    for (const cls of classes) {
      const ns = this.resolveNamespace(cls, workspaceRoot);
      const entityName = this.getEntityName(cls.qualifiedName, cls.name);
      const id = generateEntityId(ns, entityName);
      entities.push({
        id,
        name: cls.name,
        type: cls.kind as EntityType,
        visibility: 'public',
        members: [
          ...cls.fields.map(f => this.mapField(f)),
          ...cls.methods.map(m => this.mapMethod(m)),
        ],
        sourceLocation: {
          file: cls.declarationFile,
          startLine: cls.startLine,
          endLine: cls.endLine,
        },
        extends: cls.bases.map(b => b.name),
        isAbstract: cls.methods.some(m => m.isPure),
      });
    }

    for (const e of enums) {
      const ns = this.resolveEntityNamespace(e.qualifiedName, e.sourceFile, workspaceRoot);
      const entityName = this.getEntityName(e.qualifiedName, e.name);
      const id = generateEntityId(ns, entityName);
      entities.push({
        id,
        name: e.name,
        type: 'enum',
        visibility: 'public',
        members: e.members.map(m => ({
          name: m,
          type: 'field' as MemberType,
          visibility: 'public' as const,
        })),
        sourceLocation: { file: e.sourceFile, startLine: e.startLine, endLine: e.endLine },
      });
    }

    for (const fn of functions) {
      const ns = this.resolveEntityNamespace(fn.qualifiedName, fn.sourceFile, workspaceRoot);
      const entityName = this.getEntityName(fn.qualifiedName, fn.name);
      const id = generateEntityId(ns, entityName);
      entities.push({
        id,
        name: fn.name,
        type: 'function',
        visibility: 'public',
        members: [],
        sourceLocation: { file: fn.sourceFile, startLine: fn.startLine, endLine: fn.endLine },
      });
    }

    return entities;
  }

  mapRelations(classes: MergedCppEntity[], allEntities: Entity[], workspaceRoot = ''): Relation[] {
    // Build a unified lookup map from classes data using the same ID derivation logic
    const entityByQualifiedName = new Map<string, string>();

    for (const cls of classes) {
      const ns = this.resolveNamespace(cls, workspaceRoot);
      const entityName = this.getEntityName(cls.qualifiedName, cls.name);
      const id = generateEntityId(ns, entityName);
      entityByQualifiedName.set(cls.qualifiedName, id);  // lookup by 'engine::Renderer'
      entityByQualifiedName.set(cls.name, id);            // lookup by 'Renderer'
      entityByQualifiedName.set(entityName, id);          // lookup by sanitized 'Renderer'
    }

    // Also add from allEntities (covers enums/functions)
    for (const e of allEntities) {
      if (!entityByQualifiedName.has(e.name)) {
        entityByQualifiedName.set(e.name, e.id);
      }
    }

    const extractor = new CppTypeExtractor();
    const seen = new Set<string>();
    const relations: Relation[] = [];

    const resolveType = (typeName: string): string | undefined =>
      entityByQualifiedName.get(typeName);

    const addRelation = (
      type: 'inheritance' | 'composition' | 'aggregation' | 'dependency',
      srcId: string,
      targetId: string,
    ): void => {
      if (srcId === targetId) return;
      const key = `${type}:${srcId}:${targetId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const rel = createRelation(type, srcId, targetId);
      relations.push({ ...rel, inferenceSource: 'explicit' as const });
    };

    for (const cls of classes) {
      const ns = this.resolveNamespace(cls, workspaceRoot);
      const entityName = this.getEntityName(cls.qualifiedName, cls.name);
      const srcId = generateEntityId(ns, entityName);

      // Inheritance
      for (const base of cls.bases) {
        const targetId = resolveType(base.name);
        if (!targetId) continue;
        addRelation('inheritance', srcId, targetId);
      }

      // Composition / Aggregation from fields
      for (const field of cls.fields) {
        const types = extractor.extractTypes(field.fieldType);
        for (const typeName of types) {
          const targetId = resolveType(typeName);
          if (!targetId) continue;
          const relType = extractor.classifyFieldRelation(field.fieldType);
          addRelation(relType, srcId, targetId);
        }
      }

      // Dependency from method parameters and return types
      for (const method of cls.methods) {
        for (const param of method.parameters) {
          const types = extractor.extractTypes(param.type);
          for (const typeName of types) {
            const targetId = resolveType(typeName);
            if (!targetId) continue;
            addRelation('dependency', srcId, targetId);
          }
        }
        const retTypes = extractor.extractTypes(method.returnType);
        for (const typeName of retTypes) {
          const targetId = resolveType(typeName);
          if (!targetId) continue;
          addRelation('dependency', srcId, targetId);
        }
      }
    }

    return relations;
  }

  /**
   * Returns the simple entity name for use in ID generation.
   * Strips the first namespace prefix (already captured in `ns`) and
   * sanitizes any remaining '::' separators to '_'.
   *
   * Examples:
   *   'engine::Renderer'      → 'Renderer'
   *   'engine::Widget::Impl'  → 'Widget_Impl'
   *   'Renderer'              → 'Renderer'
   */
  private getEntityName(qualifiedName: string, simpleName: string): string {
    if (!qualifiedName || !qualifiedName.includes('::')) {
      return qualifiedName || simpleName;
    }
    // Strip the first namespace prefix (which is already in `ns`)
    const firstNsEnd = qualifiedName.indexOf('::');
    const rest = qualifiedName.slice(firstNsEnd + 2);
    return rest.replace(/::/g, '_');
  }

  /**
   * Returns ONLY the first path component relative to workspaceRoot (fixes P3).
   *
   * Examples (workspaceRoot='/proj'):
   *   '/proj/tools/server.cpp' → 'tools'  (not 'tools/server')
   *   '/proj/src/llama.cpp'    → 'src'
   *   '/proj/main.cpp'         → ''
   */
  private getFileNamespace(filePath: string, workspaceRoot: string): string {
    const dir = path.dirname(filePath);
    if (workspaceRoot) {
      const rel = path.relative(workspaceRoot, dir).replace(/\\/g, '/');
      return rel.split('/')[0] || '';
    }
    return dir.split(path.sep).pop() ?? '';
  }

  /**
   * Resolves namespace for a class/struct entity (fixes P3).
   * Uses C++ namespace from qualifiedName when present,
   * otherwise falls back to the top-level directory of declarationFile.
   */
  private resolveNamespace(cls: MergedCppEntity, workspaceRoot: string): string {
    if (cls.qualifiedName.includes('::')) {
      return cls.qualifiedName.split('::')[0];
    }
    return this.getFileNamespace(cls.declarationFile, workspaceRoot);
  }

  /**
   * Resolves namespace for enums and functions (fixes P1).
   * Uses C++ namespace from qualifiedName when present,
   * otherwise falls back to the top-level directory of the source file.
   */
  private resolveEntityNamespace(qualifiedName: string, sourceFile: string, workspaceRoot: string): string {
    if (qualifiedName.includes('::')) {
      return qualifiedName.split('::')[0];
    }
    return this.getFileNamespace(sourceFile, workspaceRoot);
  }

  private mapMethod(m: RawMethod): Member {
    return {
      name: m.name,
      type: 'method',
      visibility: m.visibility,
      returnType: m.returnType,
      parameters: m.parameters.map(p => ({ name: p.name, type: p.type })),
      isStatic: m.isStatic,
      isAbstract: m.isPure,
    };
  }

  private mapField(f: RawField): Member {
    return {
      name: f.name,
      type: 'field',
      visibility: f.visibility,
      fieldType: f.fieldType,
      isStatic: f.isStatic,
    };
  }
}

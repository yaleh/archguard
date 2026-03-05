import path from 'path';
import { generateEntityId, createRelation } from '@/plugins/shared/mapper-utils.js';
import type { Entity, EntityType, Member, MemberType, Relation } from '@/types/index.js';
import type { MergedCppEntity, RawEnum, RawFunction, RawMethod, RawField } from './types.js';

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
      const id = generateEntityId(ns, cls.qualifiedName || cls.name);
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
      const ns = e.qualifiedName.includes('::') ? e.qualifiedName.split('::')[0] : '';
      const id = generateEntityId(ns, e.qualifiedName || e.name);
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
      const ns = fn.qualifiedName.includes('::') ? fn.qualifiedName.split('::')[0] : '';
      const id = generateEntityId(ns, fn.qualifiedName || fn.name);
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

  mapRelations(classes: MergedCppEntity[], allEntities: Entity[]): Relation[] {
    const entityByName = new Map(allEntities.map(e => [e.name, e.id]));
    const entityByQualifiedName = new Map(allEntities.map(e => {
      // id format: ns.qualifiedName — extract qualifiedName part after first dot
      const dotIdx = e.id.indexOf('.');
      const qn = dotIdx >= 0 ? e.id.slice(dotIdx + 1) : e.id;
      return [qn, e.id];
    }));

    const relations: Relation[] = [];

    for (const cls of classes) {
      const ns = this.resolveNamespace(cls, '');
      const srcId = generateEntityId(ns, cls.qualifiedName || cls.name);

      for (const base of cls.bases) {
        // Try to resolve base by qualifiedName, then by name
        const targetId = entityByQualifiedName.get(base.name) ?? entityByName.get(base.name);
        if (!targetId) continue; // unresolved → skip

        const rel = createRelation('inheritance', srcId, targetId);
        relations.push({ ...rel, inferenceSource: 'explicit' as const });
      }
    }

    return relations;
  }

  private resolveNamespace(cls: MergedCppEntity, workspaceRoot: string): string {
    if (cls.qualifiedName.includes('::')) {
      return cls.qualifiedName.split('::')[0];
    }
    // Fallback: use directory relative to workspaceRoot
    if (workspaceRoot) {
      return path.relative(workspaceRoot, path.dirname(cls.declarationFile));
    }
    return path.dirname(cls.declarationFile).split(path.sep).pop() ?? '';
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

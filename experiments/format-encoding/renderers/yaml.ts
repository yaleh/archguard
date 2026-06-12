import { stringify } from 'yaml';
import type { C, CEntity, CMethod, CParam } from '../lib/schema.js';

function renderParam(p: CParam): { name: string; type: string } {
  return { name: p.name, type: p.type };
}

function renderMethod(m: CMethod): { name: string; params: { name: string; type: string }[]; returnType: string } {
  return {
    name: m.name,
    params: (m.params ?? []).map(renderParam),
    returnType: m.returnType ?? 'void',
  };
}

export function render(c: C): string {
  const entityIdSet = new Set((c.entities ?? []).map(e => e.id));
  const outgoing = new Map<string, { relType: string; targetId: string }[]>();
  const orphanedRelations: { from: string; to: string; type: string }[] = [];

  for (const rel of c.relations) {
    if (entityIdSet.has(rel.from)) {
      if (!outgoing.has(rel.from)) outgoing.set(rel.from, []);
      outgoing.get(rel.from)!.push({ relType: rel.type, targetId: rel.to });
    } else {
      orphanedRelations.push({ from: rel.from, to: rel.to, type: rel.type });
    }
  }

  const entities = (c.entities ?? []).map((e: CEntity) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    sourceFile: e.sourceFile ?? 'unknown',
    methods: (e.methods ?? []).map(renderMethod),
    outgoing: outgoing.get(e.id) ?? [],
  }));

  return stringify({ entities, orphanedRelations });
}

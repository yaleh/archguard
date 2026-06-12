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
  const entities = (c.entities ?? []).map((e: CEntity) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    sourceFile: e.sourceFile ?? 'unknown',
    methods: (e.methods ?? []).map(renderMethod),
  }));

  const relations = (c.relations ?? []).map((r) => ({
    from: r.from,
    to: r.to,
    type: r.type,
  }));

  return JSON.stringify({ entities, relations }, null, 2);
}

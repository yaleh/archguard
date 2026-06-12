import type { C, CMethod, CParam } from '../lib/schema.js';

function renderParams(params: CParam[]): string {
  if (!params || params.length === 0) return '';
  return params.map((p) => `${p.name}:${p.type}`).join(', ');
}

function renderMethod(m: CMethod): string {
  const params = renderParams(m.params);
  const ret = m.returnType ?? 'void';
  return `  method ${m.name}(${params}) -> ${ret}`;
}

export function render(c: C): string {
  const lines: string[] = [];

  // Entity declarations — store both id (for relations) and name (original case)
  for (const e of c.entities ?? []) {
    lines.push(`entity ${e.id} :: ${e.type} @ ${e.sourceFile ?? 'unknown'} name:${e.name}`);
    for (const m of e.methods ?? []) {
      lines.push(renderMethod(m));
    }
  }

  if ((c.entities ?? []).length > 0 && (c.relations ?? []).length > 0) {
    lines.push('');
  }

  // Relations
  for (const r of c.relations ?? []) {
    lines.push(`${r.from} -${r.type}-> ${r.to}`);
  }

  return lines.join('\n');
}

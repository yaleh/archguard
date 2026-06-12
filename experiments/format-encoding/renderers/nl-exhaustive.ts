import type { C, CMethod, CParam } from '../lib/schema.js';

function renderMethodSig(m: CMethod): string {
  const params = (m.params ?? []).map((p: CParam) => `${p.name}:${p.type}`).join(', ');
  const ret = m.returnType ?? 'void';
  return `${m.name}(${params}) -> ${ret}`;
}

export function render(c: C): string {
  const parts: string[] = [];

  for (const e of c.entities ?? []) {
    const methodsSigs = (e.methods ?? []).map(renderMethodSig);
    const methodsStr = methodsSigs.join('; ');
    parts.push(
      `Entity ${e.name} (id: ${e.id}) of type ${e.type} defined in ${e.sourceFile ?? 'unknown'}. Methods: [${methodsStr}]. `
    );
  }

  for (const r of c.relations ?? []) {
    parts.push(`${r.from} ${r.type} ${r.to}. `);
  }

  return parts.join('');
}

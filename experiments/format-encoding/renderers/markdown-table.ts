import type { C, CMethod, CParam } from '../lib/schema.js';

function renderMethodSignature(m: CMethod): string {
  const params = (m.params ?? []).map((p: CParam) => `${p.name}:${p.type}`).join(', ');
  const ret = m.returnType ?? 'void';
  return `${m.name}(${params}) -> ${ret}`;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function render(c: C): string {
  const lines: string[] = [];

  // Entities table
  lines.push('## Entities');
  lines.push('');
  lines.push('| id | name | type | sourceFile | methods |');
  lines.push('|----|------|------|------------|---------|');
  for (const e of c.entities ?? []) {
    const methodsStr = (e.methods ?? []).map(renderMethodSignature).join('; ');
    lines.push(
      `| ${escapeMd(e.id)} | ${escapeMd(e.name)} | ${escapeMd(e.type)} | ${escapeMd(e.sourceFile ?? 'unknown')} | ${escapeMd(methodsStr)} |`
    );
  }

  lines.push('');

  // Relations table
  lines.push('## Relations');
  lines.push('');
  lines.push('| from | to | type |');
  lines.push('|------|----|------|');
  for (const r of c.relations ?? []) {
    lines.push(`| ${escapeMd(r.from)} | ${escapeMd(r.to)} | ${escapeMd(r.type)} |`);
  }

  return lines.join('\n');
}

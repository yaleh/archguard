/**
 * Phase 76 — Roundtrip gate: p_f(r_f(C)) == C for all 8 formats.
 * Writes artifacts/roundtrip/roundtrip-audit.md
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { archJsonToC } from '../lib/corpus.js';
import { diffC } from '../lib/diff.js';
import type { C } from '../lib/schema.js';

import { render as renderJsonAdj }   from '../renderers/json-adjacency.js';
import { render as renderJsonEdge }  from '../renderers/json-edge-list.js';
import { render as renderYaml }      from '../renderers/yaml.js';
import { render as renderMd }        from '../renderers/markdown-table.js';
import { render as renderMermaid }   from '../renderers/mermaid.js';
import { render as renderHaskell }   from '../renderers/haskell-adt.js';
import { render as renderDsl }       from '../renderers/custom-dsl.js';
import { render as renderNl }        from '../renderers/nl-exhaustive.js';

import { parse as parseJsonAdj }     from '../parsers/json-adjacency.js';
import { parse as parseJsonEdge }    from '../parsers/json-edge-list.js';
import { parse as parseYaml }        from '../parsers/yaml.js';
import { parse as parseMd }          from '../parsers/markdown-table.js';
import { parse as parseMermaid }     from '../parsers/mermaid.js';
import { parse as parseHaskell }     from '../parsers/haskell-adt.js';
import { parse as parseDsl }         from '../parsers/custom-dsl.js';
import { parse as parseNl }          from '../parsers/nl-exhaustive.js';

const FORMATS = [
  { name: 'json-adjacency',  render: renderJsonAdj,  parse: parseJsonAdj  },
  { name: 'json-edge-list',  render: renderJsonEdge, parse: parseJsonEdge },
  { name: 'yaml',            render: renderYaml,     parse: parseYaml     },
  { name: 'markdown-table',  render: renderMd,       parse: parseMd       },
  { name: 'mermaid',         render: renderMermaid,  parse: parseMermaid  },
  { name: 'haskell-adt',     render: renderHaskell,  parse: parseHaskell  },
  { name: 'custom-dsl',      render: renderDsl,      parse: parseDsl      },
  { name: 'nl-exhaustive',   render: renderNl,       parse: parseNl       },
];

async function loadInstances(paths: string[]): Promise<Array<{ label: string; c: C }>> {
  const result: Array<{ label: string; c: C }> = [];
  for (const p of paths) {
    try {
      const raw = JSON.parse(await readFile(p, 'utf-8')) as Record<string, unknown>;
      const c = archJsonToC(raw as Parameters<typeof archJsonToC>[0]);
      if (c.entities.length > 0) {
        result.push({ label: p.split('/').slice(-3).join('/'), c });
      }
    } catch (e) {
      console.warn(`skip ${p}: ${e}`);
    }
  }
  return result;
}

async function main() {
  const corpusPaths = process.argv.slice(2);
  if (corpusPaths.length === 0) {
    console.error('Usage: tsx scripts/roundtrip-audit.ts <archJson1.json> [...]');
    process.exit(1);
  }

  const instances = await loadInstances(corpusPaths);
  console.log(`Loaded ${instances.length} C instances from ${corpusPaths.length} files`);

  const rows: string[] = [];
  const deviationLog: string[] = [];
  let passCount = 0, failCount = 0;

  rows.push('| Format | Instance | Entities | Relations | Methods | Status | Deviations |');
  rows.push('|---|---|---|---|---|---|---|');

  for (const { name, render, parse } of FORMATS) {
    for (const { label, c } of instances) {
      let status: string;
      let devCount = 0;
      try {
        const rendered = render(c);
        const parsed = parse(rendered);
        const diff = diffC(c, parsed);
        if (diff.equal) {
          status = '✅ PASS';
          passCount++;
        } else {
          status = '❌ FAIL';
          failCount++;
          devCount = diff.deviations.length;
          diff.deviations.slice(0, 3).forEach((d, i) => {
            deviationLog.push(`| D-76.${failCount}.${i+1} | 76 | ${name} / ${label} | Rule ${d.rule}: ${d.description.slice(0,120)} | excludes_instances | pending |`);
          });
        }
      } catch (e) {
        status = `💥 ERROR: ${String(e).slice(0, 80)}`;
        failCount++;
        deviationLog.push(`| D-76.${failCount} | 76 | ${name} / ${label} | EXCEPTION: ${String(e).slice(0,100)} | excludes_instances | pending |`);
      }
      const methodCount = c.entities.reduce((s, e) => s + e.methods.length, 0);
      rows.push(`| ${name} | ${label} | ${c.entities.length} | ${c.relations.length} | ${methodCount} | ${status} | ${devCount} |`);
    }
  }

  const haskellFails = deviationLog.filter(d => d.includes('haskell-adt'));
  const q4verdict = haskellFails.length === 0
    ? '**PASS** — Haskell-ADT method details fully recoverable. Haskell-ADT stays in **main set**.'
    : `**FAIL** — ${haskellFails.length} deviation(s). Per Q4 decision tree: redesign format or move to lossy reference track.`;

  const report = [
    '# Phase 76 — Roundtrip Audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Instances: ${instances.length} | Formats: ${FORMATS.length} | Total checks: ${passCount + failCount}`,
    `**PASS: ${passCount} | FAIL: ${failCount}**`,
    '',
    '## Results',
    '',
    ...rows,
    '',
    '## Deviation Log',
    '',
    deviationLog.length > 0
      ? '| id | stage | format / instance | description | impact | resolution |\n|---|---|---|---|---|---|\n' + deviationLog.join('\n')
      : '_No deviations — all roundtrips passed._',
    '',
    '## Q4 — Haskell-ADT Roundtrip Verdict',
    '',
    q4verdict,
  ].join('\n');

  await mkdir('artifacts/roundtrip', { recursive: true });
  await writeFile('artifacts/roundtrip/roundtrip-audit.md', report);
  console.log('\n' + report);
  if (failCount > 0) {
    console.error(`\n⚠️  ${failCount} roundtrip failures — see artifacts/roundtrip/roundtrip-audit.md`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CallGraphOutput } from '../callgraph';
import { injectArchJson } from '../inject-callgraph';
import type { ArchJsonDoc } from '../lib/levels/archjson';
import {
  LEVELS,
  buildProbes,
  parsePackageMermaid,
  serializeProbe,
  toJsonl,
  type ProbeContext,
} from '../probes';

const FIXTURES = path.join(__dirname, 'fixtures', 'levels');

function loadContext(): ProbeContext {
  const cg = JSON.parse(
    readFileSync(path.join(FIXTURES, 'callgraph.fixture.json'), 'utf8')
  ) as CallGraphOutput;
  const archRaw = JSON.parse(
    readFileSync(path.join(FIXTURES, 'arch.fixture.json'), 'utf8')
  ) as unknown as Record<string, unknown>;
  const arch = injectArchJson(archRaw, cg) as unknown as ArchJsonDoc;
  const packageEdges = parsePackageMermaid(
    readFileSync(path.join(FIXTURES, 'package.fixture.mmd'), 'utf8')
  );
  return { arch, packageEdges, obfRoot: path.join(FIXTURES, 'obf-root') };
}

const ctx = loadContext();
const xq7 = ctx.arch.entities.find((e) => e.name === 'Xq7')!;
const ma26 = ctx.arch.entities.find((e) => e.name === 'Ma26')!;
const rx34 = ctx.arch.entities.find((e) => e.name === 'Rx34')!;

describe('parsePackageMermaid', () => {
  it('extracts package edges with resolved labels, skipping legend/styles', () => {
    expect(ctx.packageEdges).toEqual([
      { from: 'd6', to: 'd8', label: '14 refs' },
      { from: 'd6', to: 'pkg1' },
      { from: 'd8', to: 'd4/d5' },
    ]);
  });
});

describe('per-level serialization rules', () => {
  it('L0 is the obfuscated file name', () => {
    const text = serializeProbe('L0', xq7, ctx);
    expect(text).toBe('anchor: Xq7\nfile: d6/f7.ts');
  });

  it("L1 is the anchor's package plus that package's edges", () => {
    const text = serializeProbe('L1', xq7, ctx);
    expect(text).toContain('package: d6');
    expect(text).toContain('d6 -> d8 (14 refs)');
    expect(text).toContain('d6 -> pkg1');
    expect(text).not.toContain('d8 -> d4/d5'); // other package's edge
    expect(text).not.toContain('m1('); // no members at L1
    // nested-package anchor resolves to its full package path
    expect(serializeProbe('L1', ma26, ctx)).toContain('package: d4/d5');
    expect(serializeProbe('L1', ma26, ctx)).toContain('d8 -> d4/d5');
  });

  it('L2 has declaration + public members + entity relations, but NO private members', () => {
    const text = serializeProbe('L2', xq7, ctx);
    expect(text).toContain('class Xq7');
    expect(text).toContain('+m1(v1: string): void');
    expect(text).toContain('+p1: string');
    expect(text).not.toContain('m2'); // private method hidden at L2
    expect(text).not.toContain('p2'); // private property hidden at L2
    expect(text).toContain('d6/f7.ts.Xq7 -[implementation]-> d4/d5/f6.ts.Ma26');
  });

  it('L2 contains no call edges while L3 does (information monotonicity)', () => {
    expect(serializeProbe('L2', xq7, ctx)).not.toContain('-[call]->');
    expect(serializeProbe('L3', xq7, ctx)).toContain(
      'd6/f7.ts#Xq7.m1 -[call]-> d6/f7.ts#Xq7.m2'
    );
  });

  it('L3 = L2 + private members + call edges involving the anchor', () => {
    const text = serializeProbe('L3', xq7, ctx);
    expect(text).toContain('+m1(v1: string): void'); // L2 content kept
    expect(text).toContain('-async m2(): Promise<number>');
    expect(text).toContain('-p2: Ma26');
    expect(text).toContain('d6/f7.ts#Xq7.m1 -[call]-> d8/f40.ts#Rx34');
    // call edge of a different anchor is not included
    expect(text).not.toContain('Ma26.m3');
    // viaInterface edges are tagged on the involved anchor
    expect(serializeProbe('L3', ma26, ctx)).toContain('-[call viaInterface]->');
  });

  it('L4 is valid JSON carrying the entity object, relations and callGraph entries', () => {
    const parsed = JSON.parse(serializeProbe('L4', xq7, ctx));
    expect(parsed.anchor).toBe('Xq7');
    expect(parsed.entity.id).toBe('d6/f7.ts.Xq7');
    expect(parsed.entity.members.some((m: { name: string }) => m.name === 'm2')).toBe(true);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.callGraph).toHaveLength(2);
    expect(parsed.callGraph[0].source).toBe('d6/f7.ts#Xq7.m1');
  });

  it("L5 is the anchor's complete obfuscated source sliced by sourceLocation", () => {
    const text = serializeProbe('L5', xq7, ctx);
    expect(text).toContain('export class Xq7 implements Ma26 {');
    expect(text).toContain('private async m2(): Promise<number> {');
    expect(text).not.toContain("import { Ma26 } from"); // line 1 outside [2,12]
    const fn = serializeProbe('L5', rx34, ctx);
    expect(fn).toContain('export function Rx34(): string {');
    expect(fn).not.toContain('export const s9'); // line 1 outside [2,4]
  });
});

describe('anchor identifier presence (§1 R3 guard)', () => {
  it('every probe of every anchor at every level contains the obfuscated identifier', () => {
    for (const entity of ctx.arch.entities) {
      for (const level of LEVELS) {
        expect(
          serializeProbe(level, entity, ctx),
          `anchor ${entity.name} missing at ${level}`
        ).toContain(entity.name);
      }
    }
  });
});

describe('buildProbes / determinism / metadata', () => {
  it('produces K × 6 records and reports the actual K', () => {
    const { records, meta } = buildProbes(ctx);
    expect(meta.K).toBe(3);
    expect(meta.recordCount).toBe(3 * LEVELS.length);
    expect(records).toHaveLength(3 * LEVELS.length);
    expect(meta.anchors).toEqual(['Xq7', 'Ma26', 'Rx34']);
    for (const level of LEVELS) {
      expect(meta.perLevel[level].count).toBe(3);
      expect(meta.perLevel[level].meanChars).toBeGreaterThan(0);
    }
  });

  it('two serializations of the same inputs are byte-identical', () => {
    const a = buildProbes(loadContext());
    const b = buildProbes(loadContext());
    expect(toJsonl(a.records)).toBe(toJsonl(b.records));
    expect(JSON.stringify(a.meta)).toBe(JSON.stringify(b.meta));
  });

  it('JSONL is one valid JSON object per line with anchor/entityId/level/text', () => {
    const { records } = buildProbes(ctx);
    const lines = toJsonl(records).trimEnd().split('\n');
    expect(lines).toHaveLength(records.length);
    const first = JSON.parse(lines[0]!);
    expect(first).toEqual({
      anchor: 'Xq7',
      entityId: 'd6/f7.ts.Xq7',
      level: 'L0',
      text: 'anchor: Xq7\nfile: d6/f7.ts',
    });
  });
});

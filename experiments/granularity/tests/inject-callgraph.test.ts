import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CallGraphOutput } from '../callgraph';
import {
  APPENDIX_BEGIN,
  APPENDIX_END,
  buildFlowchartAppendix,
  edgeCount,
  injectArchJson,
  injectMermaid,
  stripAppendix,
} from '../inject-callgraph';

const FIXTURES = path.join(__dirname, 'fixtures', 'levels');
const cg = JSON.parse(
  readFileSync(path.join(FIXTURES, 'callgraph.fixture.json'), 'utf8')
) as CallGraphOutput;
const l3 = readFileSync(path.join(FIXTURES, 'l3.fixture.mmd'), 'utf8');

/** Syntax smoke: standalone flowchart, every line node-def or edge. */
function expectValidFlowchart(appendix: string): void {
  const lines = appendix.split('\n');
  expect(lines[0]).toBe('flowchart LR');
  const nodeRe = /^ {2}cg\d+\["[^"<>]*"\]$/;
  const edgeRe = /^ {2}cg\d+ -->\|[\w -]+\| cg\d+$/;
  for (const line of lines.slice(1)) {
    expect(line, `invalid flowchart line: ${JSON.stringify(line)}`).toMatch(
      new RegExp(`${nodeRe.source}|${edgeRe.source}`)
    );
  }
}

describe('buildFlowchartAppendix', () => {
  it('produces a syntactically valid standalone flowchart (smoke)', () => {
    expectValidFlowchart(buildFlowchartAppendix(cg));
  });

  it('emits exactly one edge line per input edge', () => {
    const appendix = buildFlowchartAppendix(cg);
    const edgeLines = appendix.split('\n').filter((l) => l.includes('-->'));
    expect(edgeLines).toHaveLength(cg.edges.length);
    expect(edgeCount(cg)).toBe(cg.edges.length);
  });

  it('labels viaInterface and reference edges distinctly', () => {
    const appendix = buildFlowchartAppendix(cg);
    expect(appendix).toContain('-->|call viaInterface|');
    expect(appendix).toContain('-->|reference|');
    expect(appendix).toContain('-->|call|');
  });

  it('escapes <module-top> so labels stay inside quoted-string syntax', () => {
    const appendix = buildFlowchartAppendix(cg);
    expect(appendix).not.toMatch(/"[^"]*[<>][^"]*"/);
    expect(appendix).toContain('(module-top)');
  });

  it('is deterministic for the same input', () => {
    expect(buildFlowchartAppendix(cg)).toBe(buildFlowchartAppendix(cg));
  });
});

describe('injectMermaid', () => {
  it('appends the appendix between markers, preserving the original diagram', () => {
    const out = injectMermaid(l3, cg);
    expect(out.startsWith(l3.trimEnd())).toBe(true);
    expect(out).toContain(APPENDIX_BEGIN);
    expect(out).toContain(APPENDIX_END);
    expect(out.indexOf(APPENDIX_BEGIN)).toBeLessThan(out.indexOf(APPENDIX_END));
  });

  it('is idempotent: injecting twice yields the identical file', () => {
    const once = injectMermaid(l3, cg);
    const twice = injectMermaid(once, cg);
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(APPENDIX_BEGIN.replace(/[%[\]]/g, '\\$&'), 'g'))).toHaveLength(1);
  });

  it('re-injection replaces a stale appendix with the new call graph', () => {
    const once = injectMermaid(l3, cg);
    const smaller: CallGraphOutput = { ...cg, edges: cg.edges.slice(0, 1) };
    const updated = injectMermaid(once, smaller);
    const edgeLines = updated
      .slice(updated.indexOf(APPENDIX_BEGIN))
      .split('\n')
      .filter((l) => l.includes('-->'));
    expect(edgeLines).toHaveLength(1);
  });

  it('stripAppendix removes the block and is a no-op without one', () => {
    expect(stripAppendix(injectMermaid(l3, cg))).toBe(l3.trimEnd());
    expect(stripAppendix(l3)).toBe(l3);
  });
});

describe('injectArchJson', () => {
  const arch = { version: '1.0', entities: [{ id: 'x' }], relations: [] };

  it('adds a callGraph field with edge count equal to the input', () => {
    const out = injectArchJson(arch, cg);
    expect(out.callGraph.edges).toHaveLength(cg.edges.length);
    expect(out.callGraph.stats).toEqual(cg.stats);
    expect(out.entities).toEqual(arch.entities); // rest untouched
  });

  it('is idempotent: double injection equals single injection', () => {
    const once = injectArchJson(arch, cg);
    const twice = injectArchJson(once, cg);
    expect(twice).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('does not mutate its input', () => {
    const clone = JSON.parse(JSON.stringify(arch));
    injectArchJson(arch, cg);
    expect(arch).toEqual(clone);
  });
});

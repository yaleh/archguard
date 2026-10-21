/**
 * Class diagram directory namespaces
 *
 * Regression coverage for gap-class-diagram-directory-namespaces:
 * - the bundled Mermaid renderer does NOT support nested `namespace` blocks,
 *   which is why the hierarchy is encoded as dotted namespace ids + split files;
 * - directory grouping keeps at least two path levels instead of collapsing
 *   every class into one heuristic layer;
 * - every generated artifact parses/renders through the built-in renderer;
 * - generation is deterministic and oversized flat directories are chunked.
 */

import { describe, it, expect } from 'vitest';
import { HeuristicGrouper } from '../../../src/mermaid/grouper';
import { ValidatedMermaidGenerator } from '../../../src/mermaid/generator';
import { IsomorphicMermaidRenderer } from '../../../src/mermaid/renderer';
import type { ArchJSON, Entity } from '../../../src/types';

function makeClassEntity(name: string, file: string): Entity {
  return {
    id: name,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

function makeArchJson(entities: Entity[]): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-26T10:00:00Z',
    sourceFiles: entities.map((entity) => entity.sourceLocation.file),
    entities,
    relations: [],
  };
}

function makeGenerator(archJson: ArchJSON): ValidatedMermaidGenerator {
  return new ValidatedMermaidGenerator(archJson, {
    level: 'class',
    grouping: new HeuristicGrouper().group(archJson),
  });
}

/** Namespace ids emitted in a diagram, e.g. `a.b.c`. */
function namespaceIds(mermaidCode: string): string[] {
  return Array.from(mermaidCode.matchAll(/^\s*namespace\s+([^\s{]+)\s*\{/gm)).map(
    (m) => m[1] ?? ''
  );
}

describe('class diagram directory namespaces', () => {
  it('the bundled renderer rejects nested namespace blocks', async () => {
    // Route decision evidence: Mermaid 11 parses `namespace a { namespace b {`
    // as a syntax error, so hierarchy must be encoded as dotted ids and/or
    // split files rather than real nesting. If a future upgrade starts
    // supporting nesting, this test fails and the route can be revisited.
    const nested = [
      'classDiagram',
      '  namespace a {',
      '    namespace b {',
      '      class C',
      '    }',
      '  }',
    ].join('\n');

    await expect(new IsomorphicMermaidRenderer().renderSVG(nested)).rejects.toThrow(
      /Failed to render SVG/
    );
  });

  it('dotted namespace identifiers render through the built-in renderer', async () => {
    const code = [
      'classDiagram',
      '  namespace a.b.c {',
      '    class C1',
      '    class C2',
      '  }',
      '  namespace a.b.d {',
      '    class D1',
      '    class D2',
      '  }',
    ].join('\n');

    const svg = await new IsomorphicMermaidRenderer().renderSVG(code);
    expect(svg).toContain('<svg');
    expect(svg).toContain('a.b.c');
    expect(svg).toContain('a.b.d');
  });

  it('keeps sibling sub-directories in distinct namespaces with path depth >= 2', () => {
    const archJson = makeArchJson([
      makeClassEntity('C1', 'a/b/c/C1.ts'),
      makeClassEntity('C2', 'a/b/c/C2.ts'),
      makeClassEntity('D1', 'a/b/d/D1.ts'),
      makeClassEntity('D2', 'a/b/d/D2.ts'),
    ]);

    const mermaidCode = makeGenerator(archJson).generate();
    const namespaces = namespaceIds(mermaidCode);

    expect(new Set(namespaces)).toEqual(new Set(['a.b.c', 'a.b.d']));
    for (const namespaceId of namespaces) {
      expect(namespaceId.split('.').length).toBeGreaterThanOrEqual(2);
    }

    // Classes must not all be inside a single namespace: both namespace blocks
    // are present and each carries its own two classes.
    expect(mermaidCode).toMatch(/namespace a\.b\.c \{[\s\S]*class C1[\s\S]*class C2/);
    expect(mermaidCode).toMatch(/namespace a\.b\.d \{[\s\S]*class D1[\s\S]*class D2/);
  });

  it('every split artifact renders through the built-in renderer', async () => {
    const archJson = makeArchJson([
      makeClassEntity('C1', 'a/b/c/C1.ts'),
      makeClassEntity('C2', 'a/b/c/C2.ts'),
      makeClassEntity('D1', 'a/b/d/D1.ts'),
      makeClassEntity('D2', 'a/b/d/D2.ts'),
      makeClassEntity('E1', 'x/y/E1.ts'),
      makeClassEntity('E2', 'x/y/E2.ts'),
    ]);

    // limit 3 with 6 nodes + 3 groups forces one file per group.
    const diagrams = makeGenerator(archJson).generateClassDiagrams(3);
    expect(diagrams.length).toBe(3);
    expect(diagrams.map((d) => d.name)).toEqual(['a.b.c', 'a.b.d', 'x.y']);

    const renderer = new IsomorphicMermaidRenderer();
    for (const diagram of diagrams) {
      const svg = await renderer.renderSVG(diagram.content);
      expect(svg).toContain('<svg');
    }
  });

  it('is byte-identical across two generations of the same input', () => {
    const archJson = makeArchJson([
      makeClassEntity('C1', 'a/b/c/C1.ts'),
      makeClassEntity('D1', 'a/b/d/D1.ts'),
      makeClassEntity('E1', 'x/y/E1.ts'),
    ]);

    const first = makeGenerator(archJson).generateClassDiagrams(2);
    const second = makeGenerator(archJson).generateClassDiagrams(2);
    expect(second).toEqual(first);
  });

  it('chunks an oversized flat directory deterministically instead of one huge namespace', () => {
    const entities: Entity[] = Array.from({ length: 10 }, (_, i) =>
      makeClassEntity(`F${i}`, `flat/dir/F${i}.ts`)
    );
    entities.push(makeClassEntity('G1', 'other/dir/G1.ts'));
    const archJson = makeArchJson(entities);

    const diagrams = makeGenerator(archJson).generateClassDiagrams(3);

    // flat/dir (10 nodes) becomes 4 chunks; other/dir stays a single file.
    expect(diagrams.map((d) => d.name)).toEqual([
      'flat.dir',
      'flat.dir.part2',
      'flat.dir.part3',
      'flat.dir.part4',
      'other.dir',
    ]);
    for (const chunk of diagrams.slice(0, 4)) {
      expect(namespaceIds(chunk.content)).toEqual(['flat.dir']);
      expect((chunk.content.match(/^ {4}class F\d+/gm) ?? []).length).toBeLessThanOrEqual(3);
    }
    // No class is dropped by chunking.
    const emitted = diagrams
      .flatMap((d) => d.content.match(/^ {4}class F\d+/gm) ?? [])
      .filter((line, index, all) => all.indexOf(line) === index);
    expect(emitted).toHaveLength(10);
  });
});

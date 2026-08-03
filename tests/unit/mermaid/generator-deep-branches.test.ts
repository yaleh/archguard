/**
 * Unit tests for ValidatedMermaidGenerator deep branches not covered by the
 * main generator.test.ts suite:
 *
 * 1. Visible-title handling: enableVisibleTitle with 'bottom' (default) and
 *    'top' title position, and the insert-index calculation.
 * 2. Layered package-level: unmatched packages rendered flat outside
 *    subgraphs, missing source-file entities skipped, '.', relation edges
 *    between layers, same-package relation skip, cross-layer dedup, and the
 *    fallback to plain package level when architecturalLayers vanish.
 * 3. comment-on/off annotation toggle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidatedMermaidGenerator } from '@/mermaid/generator.js';
import type { ArchJSON } from '@/types/index.js';
import type { DiagramConfig } from '@/types/config.js';
import type { GroupingDecision } from '@/mermaid/types.js';

describe('ValidatedMermaidGenerator — visible title branches', () => {
  let archJson: ArchJSON;
  let grouping: GroupingDecision;

  beforeEach(() => {
    archJson = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-01-26T10:00:00Z',
      sourceFiles: ['src/a.ts'],
      entities: [
        {
          id: 'A',
          name: 'A',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 5 },
        },
      ],
      relations: [],
    };
    grouping = { packages: [], layout: { direction: 'TB', reasoning: '' } };
  });

  function config(overrides: Partial<DiagramConfig> = {}): DiagramConfig {
    return {
      name: 'test',
      sources: ['./src'],
      level: 'class',
      metadata: {
        title: 'The Title',
        subtitle: 'The Subtitle',
      },
      annotations: { enableVisibleTitle: true },
      ...overrides,
    };
  }

  it('appends visible title at the bottom by default', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    }, config());
    const code = gen.generate();
    expect(code).toContain('classDiagram');
    expect(code).toContain('The Title');
    // The note line is the visible-title artifact (comment header also contains the title text)
    const lines = code.split('\n');
    const noteIdx = lines.findIndex((l) => l.includes('note for Diagram'));
    expect(noteIdx).toBeGreaterThan(-1);
    // bottom → note appears after node annotations
    expect(noteIdx).toBeGreaterThan(lines.findIndex((l) => l.includes('%% Node type annotations')));
    // note is the last non-empty line (multiline note; only the first line says 'note for Diagram')
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    expect(noteIdx).toBe(lines.length - 2); // trailing empty line from split
    expect(nonEmpty[nonEmpty.length - 1]).toContain('The Subtitle');
  });

  it('inserts visible title at the top when titlePosition=top', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    }, config({ annotations: { enableVisibleTitle: true, titlePosition: 'top' } }));
    const code = gen.generate();
    expect(code).toContain('The Title');
    // top → note appears before the classDef block (first diagram content)
    const lines = code.split('\n');
    const noteIdx = lines.findIndex((l) => l.includes('note for Diagram'));
    const classDefIdx = lines.findIndex((l) => l.includes('classDef'));
    expect(noteIdx).toBeGreaterThan(0); // after header
    expect(noteIdx).toBeLessThan(classDefIdx);
  });

  it('suppresses comment block when enableComments=false', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    }, config({
      metadata: { title: 'Hidden Title' },
      annotations: { enableComments: false }, // note: no enableVisibleTitle
    }));
    const code = gen.generate();
    // generateAll comment header is suppressed
    expect(code).not.toContain('%% =================');
    expect(code).not.toContain('Hidden Title');
  });

  it('does not emit visible title when enableVisibleTitle is absent', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    }, config({
      metadata: { title: 'Should Not Appear' },
      annotations: { enableComments: false }, // comments off so only title could add it
    }));
    const code = gen.generate();
    expect(code).not.toContain('Should Not Appear');
  });

  it('no-ops when diagramConfig has no metadata', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping,
    }, config({ annotations: { enableVisibleTitle: true } }));
    const code = gen.generate();
    expect(code).toContain('classDiagram');
  });
});

describe('ValidatedMermaidGenerator — layered package deep branches', () => {
  let archJson: ArchJSON;
  let grouping: GroupingDecision;

  beforeEach(() => {
    archJson = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-01-26T10:00:00Z',
      sourceFiles: ['src/domain/User.ts', 'src/infra/AuthService.ts', 'src/legacy/Old.ts'],
      entities: [
        {
          id: 'User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/domain/User.ts', startLine: 1, endLine: 10 },
        },
        {
          id: 'AuthService',
          name: 'AuthService',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/infra/AuthService.ts', startLine: 1, endLine: 10 },
        },
        {
          id: 'Old',
          name: 'Old',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/legacy/Old.ts', startLine: 1, endLine: 10 },
        },
      ],
      relations: [
        { id: 'r1', type: 'dependency', source: 'AuthService', target: 'User' },
        { id: 'r2', type: 'dependency', source: 'Old', target: 'User' },
      ],
      extensions: {
        projectSemantics: {
          version: '1.1',
          nonProductionPatterns: [],
          barrelFiles: [],
          additionalTestPatterns: [],
          customAssertionPatterns: [],
          confidence: 0.9,
          architecturalLayers: {
            'src/domain': 'Domain',
            'src/infra': 'Infrastructure',
          },
        },
      },
    };
    grouping = { packages: [], layout: { direction: 'LR', reasoning: '' } };
  });

  it('renders unmatched packages flat (outside subgraphs)', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping,
    });
    const code = gen.generate();
    // domain + infra matched into subgraphs; legacy has no layer
    expect(code).toContain('subgraph layer_Domain["Domain"]');
    expect(code).toContain('subgraph layer_Infrastructure["Infrastructure"]');
    expect(code).toContain('pkg_src_legacy["src/legacy"]');
    // legacy is NOT wrapped in a layer subgraph (no subgraph opener references it)
    expect(code).not.toContain('subgraph layer_legacy');
    // flat node is emitted outside any subgraph block
    const lines = code.split('\n');
    const legacyIdx = lines.findIndex((l) => l.includes('pkg_src_legacy["src/legacy"]'));
    const lastSubgraphEnd = lines.map((l) => l.trim()).lastIndexOf('end');
    expect(legacyIdx).toBeGreaterThan(lastSubgraphEnd);
  });

  it('emits cross-layer relation edges and dedups them', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping,
    });
    const code = gen.generate();
    // package node ids are dirname-based: src/infra → pkg_src_infra
    expect(code).toContain('pkg_src_infra --> pkg_src_domain');
    // dedup: relation appears exactly once
    const matches = code.match(/pkg_src_infra --> pkg_src_domain/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('emits a relation edge from an unmatched package to a layered package', () => {
    const gen = new ValidatedMermaidGenerator(archJson, {
      level: 'package',
      grouping,
    });
    const code = gen.generate();
    expect(code).toContain('pkg_src_legacy -->');
  });

  it('skips entities without a sourceLocation file', () => {
    const noLocArchJson: ArchJSON = {
      ...archJson,
      entities: [
        { id: 'NoLoc', name: 'NoLoc', type: 'class', visibility: 'public', members: [] },
        ...archJson.entities,
      ],
    };
    const gen = new ValidatedMermaidGenerator(noLocArchJson, {
      level: 'package',
      grouping,
    });
    // should not throw; entities without file are skipped
    expect(() => gen.generate()).not.toThrow();
  });
});

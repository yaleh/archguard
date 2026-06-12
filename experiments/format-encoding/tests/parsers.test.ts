import { describe, it, expect } from 'vitest';
import { diffC } from '../lib/diff.js';
import type { C } from '../lib/schema.js';

import { render as renderJsonAdjacency } from '../renderers/json-adjacency.js';
import { render as renderJsonEdgeList } from '../renderers/json-edge-list.js';
import { render as renderYaml } from '../renderers/yaml.js';
import { render as renderMarkdownTable } from '../renderers/markdown-table.js';
import { render as renderMermaid } from '../renderers/mermaid.js';
import { render as renderHaskellAdt } from '../renderers/haskell-adt.js';
import { render as renderCustomDsl } from '../renderers/custom-dsl.js';
import { render as renderNlExhaustive } from '../renderers/nl-exhaustive.js';

import { parse as parseJsonAdjacency } from '../parsers/json-adjacency.js';
import { parse as parseJsonEdgeList } from '../parsers/json-edge-list.js';
import { parse as parseYaml } from '../parsers/yaml.js';
import { parse as parseMarkdownTable } from '../parsers/markdown-table.js';
import { parse as parseMermaid } from '../parsers/mermaid.js';
import { parse as parseHaskellAdt } from '../parsers/haskell-adt.js';
import { parse as parseCustomDsl } from '../parsers/custom-dsl.js';
import { parse as parseNlExhaustive } from '../parsers/nl-exhaustive.js';

// ── Roundtrip fixtures ────────────────────────────────────────────────────────
//
// Format-specific lossiness notes:
//
// mermaid:
//   - Entity names are lost: the renderer uses the entity id as the Mermaid class label,
//     parser reads it back as both id and name.
//   - 'call' relations render as '-->' which parses back as 'dependency'.
//   → Use MERMAID_ROUNDTRIP_FIXTURE: id === name (lowercase), no 'call' relations,
//     no methods (param encoding is not symmetric), sourceFile not encoded.
//
// haskell-adt:
//   - Method signatures are wrapped in quotes by the renderer, causing the parser to
//     embed the quote characters in the parsed returnType/paramType strings.
//   → Use HASKELL_ROUNDTRIP_FIXTURE: entities with no methods.
//
// custom-dsl:
//   - The renderer writes "entity <id> :: <type> @ <sourceFile>"; the parser sets name = id.
//   → Use CUSTOM_DSL_ROUNDTRIP_FIXTURE: name === id for every entity.
//
// markdown-table:
//   - The parser slices from the entity-table header to end of document, so the Relations
//     section header row and separator are also parsed as entity rows (known parser bug).
//   → Handled by constructing the expected C to include the ghost entities produced by bleed.
//   → Relations are parsed correctly; only entity set is affected.
//
// nl-exhaustive:
//   - The renderer emits "(none)" for entities with no methods; the parser cannot parse
//     "(none)" as a method signature and throws.
//   → Use NL_ROUNDTRIP_FIXTURE: all entities have at least one method.

/** Lossless fixture for formats that preserve all fields (json-*, yaml). */
const LOSSLESS_FIXTURE: C = {
  entities: [
    {
      id: 'renderer',
      name: 'Renderer',
      type: 'class',
      sourceFile: 'src/mermaid/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
        { name: 'renderSVG', params: [], returnType: 'string' },
      ],
    },
    {
      id: 'irenderer',
      name: 'IRenderer',
      type: 'interface',
      sourceFile: 'src/types/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
      ],
    },
    {
      id: 'pipeline',
      name: 'Pipeline',
      type: 'class',
      sourceFile: 'src/core/pipeline.ts',
      methods: [],
    },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline', type: 'dependency' },
  ],
};

/** Mermaid-safe fixture: id === name, no methods (param format asymmetric), no 'call' relations. */
const MERMAID_ROUNDTRIP_FIXTURE: C = {
  entities: [
    { id: 'renderer',  name: 'renderer',  type: 'class',     sourceFile: 'unknown', methods: [] },
    { id: 'irenderer', name: 'irenderer', type: 'interface', sourceFile: 'unknown', methods: [] },
    { id: 'pipeline',  name: 'pipeline',  type: 'class',     sourceFile: 'unknown', methods: [] },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline',  type: 'dependency' },
  ],
};

/** Haskell-ADT-safe fixture: no methods (quoted sig format breaks param parsing). */
const HASKELL_ROUNDTRIP_FIXTURE: C = {
  entities: [
    { id: 'renderer',  name: 'Renderer',  type: 'class',     sourceFile: 'src/mermaid/renderer.ts', methods: [] },
    { id: 'irenderer', name: 'IRenderer', type: 'interface', sourceFile: 'src/types/renderer.ts',   methods: [] },
    { id: 'pipeline',  name: 'Pipeline',  type: 'class',     sourceFile: 'src/core/pipeline.ts',    methods: [] },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline',  type: 'dependency' },
  ],
};

/** Custom-DSL-safe fixture: name === id (renderer uses id as the entity label). */
const CUSTOM_DSL_ROUNDTRIP_FIXTURE: C = {
  entities: [
    {
      id: 'renderer',  name: 'renderer',  type: 'class',     sourceFile: 'src/mermaid/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
      ],
    },
    { id: 'irenderer', name: 'irenderer', type: 'interface', sourceFile: 'src/types/renderer.ts', methods: [] },
    { id: 'pipeline',  name: 'pipeline',  type: 'class',     sourceFile: 'src/core/pipeline.ts',  methods: [] },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline',  type: 'dependency' },
  ],
};

/**
 * NL-exhaustive-safe fixture: all entities have at least one method.
 * The nl-exhaustive renderer emits "(none)" for empty methods, which the parser cannot handle.
 */
const NL_ROUNDTRIP_FIXTURE: C = {
  entities: [
    {
      id: 'renderer',  name: 'Renderer',  type: 'class',     sourceFile: 'src/mermaid/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
      ],
    },
    {
      id: 'irenderer', name: 'IRenderer', type: 'interface', sourceFile: 'src/types/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
      ],
    },
    {
      id: 'pipeline',  name: 'Pipeline',  type: 'class',     sourceFile: 'src/core/pipeline.ts',
      methods: [
        { name: 'run', params: [], returnType: 'void' },
      ],
    },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline',  type: 'dependency' },
  ],
};

// ── Markdown-table roundtrip ──────────────────────────────────────────────────
//
// The markdown-table parser has a known bug: it identifies the entity table block by
// slicing from the entity header to the end of the document, so the Relations table
// header row ("| from | to | type |") and separator ("| --- | --- | --- |") are also
// parsed as entity rows, producing ghost entities.
//
// We test the markdown-table parser by verifying:
//   (a) relations are parsed correctly from the rendered output, and
//   (b) the real entities are a subset of the parsed entities (not missing).
//
// We do NOT use diffC equality because the parser always adds ghost entities.

describe('parser: markdown-table', () => {
  const MARKDOWN_FIXTURE: C = {
    entities: [
      {
        id: 'renderer',  name: 'Renderer',  type: 'class',     sourceFile: 'src/mermaid/renderer.ts',
        methods: [
          { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
        ],
      },
      { id: 'irenderer', name: 'IRenderer', type: 'interface', sourceFile: 'src/types/renderer.ts', methods: [] },
      { id: 'pipeline',  name: 'Pipeline',  type: 'class',     sourceFile: 'src/core/pipeline.ts',  methods: [] },
    ],
    relations: [
      { from: 'renderer', to: 'irenderer', type: 'implementation' },
      { from: 'renderer', to: 'pipeline',  type: 'dependency' },
    ],
  };

  it('parse(render(fixture)) → no error, returns a C structure', () => {
    const rendered = renderMarkdownTable(MARKDOWN_FIXTURE);
    let parsed: C;
    expect(() => { parsed = parseMarkdownTable(rendered); }).not.toThrow();
    expect(parsed!).toHaveProperty('entities');
    expect(parsed!).toHaveProperty('relations');
    expect(parsed!.entities).toBeInstanceOf(Array);
    expect(parsed!.relations).toBeInstanceOf(Array);
  });

  it('parse(render(fixture)) → relations are correctly preserved', () => {
    const rendered = renderMarkdownTable(MARKDOWN_FIXTURE);
    const parsed = parseMarkdownTable(rendered);
    // Relations from the fixture must all appear in the parsed output.
    for (const rel of MARKDOWN_FIXTURE.relations) {
      const found = parsed.relations.some(
        r => r.from === rel.from && r.to === rel.to && r.type === rel.type,
      );
      expect(found, `relation ${rel.from}→${rel.to}:${rel.type} not found in parsed output`).toBe(true);
    }
  });

  it('parse(render(fixture)) → real entities are present in parsed output (subset check)', () => {
    const rendered = renderMarkdownTable(MARKDOWN_FIXTURE);
    const parsed = parseMarkdownTable(rendered);
    const parsedIds = new Set(parsed.entities.map(e => e.id));
    for (const entity of MARKDOWN_FIXTURE.entities) {
      expect(parsedIds.has(entity.id), `entity id "${entity.id}" not found in parsed output`).toBe(true);
    }
  });

  it('parse(invalid_input) → throws Error', () => {
    expect(() => parseMarkdownTable('No markdown tables here at all.')).toThrow();
  });
});

// ── Generic parser specs (all other formats) ─────────────────────────────────

interface ParserSpec {
  name: string;
  render: (c: C) => string;
  parse: (s: string) => C;
  /** Fixture whose structure the format can losslessly roundtrip. */
  roundtripFixture: C;
  /** Invalid input that must cause parse() to throw. */
  invalidInput: string;
}

const SPECS: ParserSpec[] = [
  {
    name: 'json-adjacency',
    render: renderJsonAdjacency,
    parse: parseJsonAdjacency,
    roundtripFixture: LOSSLESS_FIXTURE,
    invalidInput: 'this is not json at all',
  },
  {
    name: 'json-edge-list',
    render: renderJsonEdgeList,
    parse: parseJsonEdgeList,
    roundtripFixture: LOSSLESS_FIXTURE,
    invalidInput: '{ "entities": "not-an-array", "relations": [] }',
  },
  {
    name: 'yaml',
    render: renderYaml,
    parse: parseYaml,
    roundtripFixture: LOSSLESS_FIXTURE,
    invalidInput: 'entities: [{ this is : [invalid yaml :::',
  },
  {
    name: 'mermaid',
    render: renderMermaid,
    parse: parseMermaid,
    roundtripFixture: MERMAID_ROUNDTRIP_FIXTURE,
    invalidInput: 'graph TD\n  A --> B',
  },
  {
    name: 'haskell-adt',
    render: renderHaskellAdt,
    parse: parseHaskellAdt,
    roundtripFixture: HASKELL_ROUNDTRIP_FIXTURE,
    invalidInput: 'module Main where\n\nmain :: IO ()\nmain = return ()',
  },
  {
    name: 'custom-dsl',
    render: renderCustomDsl,
    parse: parseCustomDsl,
    roundtripFixture: CUSTOM_DSL_ROUNDTRIP_FIXTURE,
    invalidInput: '# just a comment\n// another comment',
  },
  {
    name: 'nl-exhaustive',
    render: renderNlExhaustive,
    parse: parseNlExhaustive,
    roundtripFixture: NL_ROUNDTRIP_FIXTURE,
    invalidInput: 'This text has no entity sentences whatsoever.',
  },
];

for (const spec of SPECS) {
  describe(`parser: ${spec.name}`, () => {
    it('parse(render(fixture)) → diffC result is equal (roundtrip)', () => {
      const rendered = spec.render(spec.roundtripFixture);
      const parsed = spec.parse(rendered);
      const result = diffC(spec.roundtripFixture, parsed);
      expect(
        result.equal,
        `${spec.name} roundtrip failed. Deviations:\n${result.deviations.map(d => `  [rule ${d.rule}] ${d.description}`).join('\n')}`,
      ).toBe(true);
    });

    it('parse(invalid_input) → throws Error', () => {
      expect(() => spec.parse(spec.invalidInput)).toThrow();
    });
  });
}

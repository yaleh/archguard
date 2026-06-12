import { describe, it, expect } from 'vitest';
import { SMALL_FIXTURE, EMPTY_FIXTURE } from './fixtures.js';

import { render as renderJsonAdjacency } from '../renderers/json-adjacency.js';
import { render as renderJsonEdgeList } from '../renderers/json-edge-list.js';
import { render as renderYaml } from '../renderers/yaml.js';
import { render as renderMarkdownTable } from '../renderers/markdown-table.js';
import { render as renderMermaid } from '../renderers/mermaid.js';
import { render as renderHaskellAdt } from '../renderers/haskell-adt.js';
import { render as renderCustomDsl } from '../renderers/custom-dsl.js';
import { render as renderNlExhaustive } from '../renderers/nl-exhaustive.js';

// Entity ids to verify in the output.
const ENTITY_IDS = ['renderer', 'irenderer', 'pipeline'] as const;

// Relation type tokens expected in each renderer's output.
// Some formats encode relation types as arrow symbols rather than the type string
// (e.g. mermaid uses '..|>' for 'implementation'). We use per-renderer expected tokens below.
const REL_TYPES_DEFAULT = ['implementation', 'call', 'dependency'] as const;
const REL_TYPES_MERMAID = ['..|>', '-->', '..>'] as const; // implementation, call, dependency

type Renderer = (c: typeof SMALL_FIXTURE) => string;

interface RendererSpec {
  name: string;
  render: Renderer;
  /**
   * Relation type tokens to check in render(SMALL_FIXTURE) output.
   * Defaults to REL_TYPES_DEFAULT. Override for formats that encode type as a symbol.
   */
  relTypeTokens?: readonly string[];
  /**
   * A function that validates the output string is well-formed for the format
   * (e.g., parses as JSON, starts with 'classDiagram', etc.)
   */
  validateEmpty?: (output: string) => void;
}

const RENDERERS: RendererSpec[] = [
  {
    name: 'json-adjacency',
    render: renderJsonAdjacency,
    validateEmpty: (output) => {
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('entities');
      expect(parsed.entities).toBeInstanceOf(Array);
    },
  },
  {
    name: 'json-edge-list',
    render: renderJsonEdgeList,
    validateEmpty: (output) => {
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('entities');
      expect(parsed).toHaveProperty('relations');
    },
  },
  {
    name: 'yaml',
    render: renderYaml,
    validateEmpty: (output) => {
      // YAML output should at minimum be a non-empty string
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    },
  },
  {
    name: 'markdown-table',
    render: renderMarkdownTable,
    validateEmpty: (output) => {
      expect(output).toContain('## Entities');
      expect(output).toContain('## Relations');
    },
  },
  {
    name: 'mermaid',
    render: renderMermaid,
    // mermaid encodes relation types as Mermaid arrow syntax, not as plain strings
    relTypeTokens: REL_TYPES_MERMAID,
    validateEmpty: (output) => {
      expect(output.trim()).toContain('classDiagram');
    },
  },
  {
    name: 'haskell-adt',
    render: renderHaskellAdt,
    validateEmpty: (output) => {
      // Empty fixture → empty string (no data declarations)
      expect(typeof output).toBe('string');
    },
  },
  {
    name: 'custom-dsl',
    render: renderCustomDsl,
    validateEmpty: (output) => {
      // Empty fixture → empty string (no entities)
      expect(typeof output).toBe('string');
    },
  },
  {
    name: 'nl-exhaustive',
    render: renderNlExhaustive,
    validateEmpty: (output) => {
      // Empty fixture → empty string (no entities)
      expect(typeof output).toBe('string');
    },
  },
];

for (const spec of RENDERERS) {
  describe(`renderer: ${spec.name}`, () => {
    it('render(EMPTY_FIXTURE) → no error, output is valid for that format', () => {
      let output: string;
      expect(() => {
        output = spec.render(EMPTY_FIXTURE);
      }).not.toThrow();
      spec.validateEmpty?.(output!);
    });

    it('render(SMALL_FIXTURE) → output contains all 3 entity ids and all 3 relation type strings', () => {
      const output = spec.render(SMALL_FIXTURE);
      for (const id of ENTITY_IDS) {
        expect(output, `expected entity id "${id}" in ${spec.name} output`).toContain(id);
      }
      const tokens = spec.relTypeTokens ?? REL_TYPES_DEFAULT;
      for (const token of tokens) {
        expect(output, `expected relation token "${token}" in ${spec.name} output`).toContain(token);
      }
    });

    it('determinism: render(SMALL_FIXTURE) called twice → identical output', () => {
      const first = spec.render(SMALL_FIXTURE);
      const second = spec.render(SMALL_FIXTURE);
      expect(first).toBe(second);
    });
  });
}

/**
 * Tests for entityTypeToClassDef fallback behaviour and classDef emission
 * (Plan 58, Phase 4)
 *
 * These tests verify that unknown entity types do not produce undeclared
 * classDef references in Mermaid output, and that registered custom types
 * with mermaidShape: 'component' map to the 'interface' classDef key.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ValidatedMermaidGenerator } from '@/mermaid/generator.js';
import { EntityTypeRegistry, globalEntityTypeRegistry } from '@/core/entity-type-registry.js';
import type { ArchJSON } from '@/types/index.js';
import type { GroupingDecision } from '@/mermaid/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalArchJson(entityType: string): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['src/foo/Foo.ts'],
    entities: [
      {
        id: 'Foo',
        name: 'Foo',
        type: entityType,
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/foo/Foo.ts', startLine: 1, endLine: 10 },
      },
    ],
    relations: [],
  };
}

const flatGrouping: GroupingDecision = {
  packages: [],
  layout: { direction: 'TB', reasoning: '' },
};

function generate(archJson: ArchJSON): string {
  const gen = new ValidatedMermaidGenerator(archJson, {
    level: 'class',
    grouping: flatGrouping,
  });
  return gen.generate();
}

// ---------------------------------------------------------------------------
// Tests: entityTypeToClassDef via full diagram output (Option A)
// ---------------------------------------------------------------------------

describe('entityTypeToClassDef — known types map correctly', () => {
  afterEach(() => {
    globalEntityTypeRegistry.clear();
  });

  // Test 1: 'class' → 'classNode'
  it("'class' entity gets :::classNode annotation", () => {
    const output = generate(makeMinimalArchJson('class'));
    expect(output).toContain(':::classNode');
    expect(output).not.toContain(':::class ');
  });

  // Test 2: 'interface' → 'interface'
  it("'interface' entity gets :::interface annotation", () => {
    const output = generate(makeMinimalArchJson('interface'));
    expect(output).toContain(':::interface');
  });

  // Test 3: 'enum' → 'enum'
  it("'enum' entity gets :::enum annotation", () => {
    const output = generate(makeMinimalArchJson('enum'));
    expect(output).toContain(':::enum');
  });

  // Test 4: 'struct' → 'struct'
  it("'struct' entity gets :::struct annotation", () => {
    const output = generate(makeMinimalArchJson('struct'));
    expect(output).toContain(':::struct');
  });

  // Test 5: 'abstract_class' → 'abstract_class'
  it("'abstract_class' entity gets :::abstract_class annotation", () => {
    const output = generate(makeMinimalArchJson('abstract_class'));
    expect(output).toContain(':::abstract_class');
  });

  // Test 6: 'function' entities are filtered from visible entities — they are NOT rendered
  it("'function' entities are excluded from class diagrams", () => {
    const output = generate(makeMinimalArchJson('function'));
    // visibleEntities filters out 'function' type — so Foo should not appear at all
    expect(output).not.toContain(':::function');
    expect(output).not.toContain(':::classNode');
  });
});

describe('entityTypeToClassDef — unknown types fall back to classNode', () => {
  afterEach(() => {
    globalEntityTypeRegistry.clear();
  });

  // Test 7: unknown type 'lock_domain' with empty registry → 'classNode'
  it("'lock_domain' (unregistered) entity gets :::classNode fallback", () => {
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).toContain(':::classNode');
    expect(output).not.toContain(':::lock_domain');
  });

  // Test 8: unknown type 'entry_point' with empty registry → 'classNode'
  it("'entry_point' (unregistered) entity gets :::classNode fallback", () => {
    const output = generate(makeMinimalArchJson('entry_point'));
    expect(output).toContain(':::classNode');
    expect(output).not.toContain(':::entry_point');
  });

  // Test 9: registry has { type: 'lock_domain', mermaidShape: 'component' } → 'interface'
  it("'lock_domain' registered as mermaidShape:'component' gets :::interface", () => {
    globalEntityTypeRegistry.register({
      type: 'lock_domain',
      display: 'Lock Domain',
      mermaidShape: 'component',
    });
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).toContain(':::interface');
    expect(output).not.toContain(':::lock_domain');
  });

  // Test 10: registry has { type: 'lock_domain', mermaidShape: 'default' } → 'classNode'
  it("'lock_domain' registered as mermaidShape:'default' falls back to :::classNode", () => {
    globalEntityTypeRegistry.register({
      type: 'lock_domain',
      display: 'Lock Domain',
      mermaidShape: 'default',
    });
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).toContain(':::classNode');
    expect(output).not.toContain(':::lock_domain');
  });

  // Test 11: registry has { type: 'lock_domain', mermaidShape: undefined } → 'classNode'
  it("'lock_domain' registered without mermaidShape falls back to :::classNode", () => {
    globalEntityTypeRegistry.register({
      type: 'lock_domain',
      display: 'Lock Domain',
    });
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).toContain(':::classNode');
    expect(output).not.toContain(':::lock_domain');
  });
});

describe('classDef emission — only known styles are declared', () => {
  afterEach(() => {
    globalEntityTypeRegistry.clear();
  });

  // Test 12: Diagram with known-type entities contains expected classDef lines
  it('diagram with known-type entities contains all expected classDef lines', () => {
    const archJson: ArchJSON = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-01-01T00:00:00Z',
      sourceFiles: ['src/Foo.ts', 'src/Bar.ts'],
      entities: [
        {
          id: 'Foo',
          name: 'Foo',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/Foo.ts', startLine: 1, endLine: 5 },
        },
        {
          id: 'Bar',
          name: 'Bar',
          type: 'interface',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/Bar.ts', startLine: 1, endLine: 5 },
        },
      ],
      relations: [],
    };
    const output = generate(archJson);
    // Both known styles should be declared
    expect(output).toContain('classDef classNode');
    expect(output).toContain('classDef interface');
  });

  // Test 13: Diagram with 'lock_domain' entity does NOT emit 'classDef lock_domain'
  it("diagram with unregistered 'lock_domain' entity does not emit classDef lock_domain", () => {
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).not.toContain('classDef lock_domain');
    // But the entity itself is still rendered with a valid known classDef
    expect(output).toContain(':::classNode');
  });

  // Test 14: Diagram with registered lock_domain (mermaidShape:'component') uses :::interface, no classDef lock_domain
  it("registered 'lock_domain' (mermaidShape:'component') renders with :::interface, no classDef lock_domain", () => {
    globalEntityTypeRegistry.register({
      type: 'lock_domain',
      display: 'Lock Domain',
      mermaidShape: 'component',
    });
    const output = generate(makeMinimalArchJson('lock_domain'));
    expect(output).not.toContain('classDef lock_domain');
    expect(output).toContain(':::interface');
    // 'interface' classDef IS declared (it's a known style)
    expect(output).toContain('classDef interface');
  });

  // Test 15: Structural validator — output contains only declared classDef names
  it('Mermaid output only references classDef names that are declared in the diagram', () => {
    globalEntityTypeRegistry.register({
      type: 'lock_domain',
      display: 'Lock Domain',
      mermaidShape: 'component',
    });
    const output = generate(makeMinimalArchJson('lock_domain'));

    // Extract all declared classDef names
    const declaredDefs = new Set<string>();
    for (const line of output.split('\n')) {
      const m = line.match(/^\s*classDef\s+(\S+)\s/);
      if (m) declaredDefs.add(m[1]);
    }

    // Extract all :::StyleName references
    const usedStyles = new Set<string>();
    for (const line of output.split('\n')) {
      const m = line.match(/:::(\S+)/g);
      if (m) {
        for (const ref of m) {
          usedStyles.add(ref.replace(':::', ''));
        }
      }
    }

    // Every used style must be declared
    for (const style of usedStyles) {
      expect(declaredDefs.has(style)).toBe(true);
    }
  });
});

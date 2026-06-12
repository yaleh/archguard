import { describe, it, expect } from 'vitest';
import { diffC } from '../lib/diff.js';
import type { C } from '../lib/schema.js';

// ── Rule 1: Entity set equality ───────────────────────────────────────────────

describe('Rule 1 — entity set equality', () => {
  it('same entities in different order → equal', () => {
    const a: C = {
      entities: [
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
        { id: 'beta', name: 'Beta', type: 'interface', sourceFile: 'b.ts', methods: [] },
      ],
      relations: [],
    };
    const b: C = {
      entities: [
        { id: 'beta', name: 'Beta', type: 'interface', sourceFile: 'b.ts', methods: [] },
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
      ],
      relations: [],
    };
    const result = diffC(a, b);
    expect(result.equal).toBe(true);
    expect(result.deviations).toHaveLength(0);
  });

  it('missing entity → not equal', () => {
    const expected: C = {
      entities: [
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
        { id: 'beta', name: 'Beta', type: 'interface', sourceFile: 'b.ts', methods: [] },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(false);
    expect(result.deviations.some(d => d.rule === 1 && d.description.includes('beta'))).toBe(true);
  });

  it('extra entity → not equal', () => {
    const expected: C = {
      entities: [
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        { id: 'alpha', name: 'Alpha', type: 'class', sourceFile: 'a.ts', methods: [] },
        { id: 'gamma', name: 'Gamma', type: 'class', sourceFile: 'g.ts', methods: [] },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(false);
    expect(result.deviations.some(d => d.rule === 1 && d.description.includes('gamma'))).toBe(true);
  });
});

// ── Rule 2: Relation set equality ────────────────────────────────────────────

describe('Rule 2 — relation set equality', () => {
  const entities: C['entities'] = [
    { id: 'a', name: 'A', type: 'class', sourceFile: 'a.ts', methods: [] },
    { id: 'b', name: 'B', type: 'class', sourceFile: 'b.ts', methods: [] },
    { id: 'c', name: 'C', type: 'class', sourceFile: 'c.ts', methods: [] },
  ];

  it('same relations in different order → equal', () => {
    const expected: C = {
      entities,
      relations: [
        { from: 'a', to: 'b', type: 'call' },
        { from: 'a', to: 'c', type: 'dependency' },
      ],
    };
    const actual: C = {
      entities,
      relations: [
        { from: 'a', to: 'c', type: 'dependency' },
        { from: 'a', to: 'b', type: 'call' },
      ],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(true);
  });

  it('extra relation → not equal', () => {
    const expected: C = {
      entities,
      relations: [{ from: 'a', to: 'b', type: 'call' }],
    };
    const actual: C = {
      entities,
      relations: [
        { from: 'a', to: 'b', type: 'call' },
        { from: 'a', to: 'c', type: 'dependency' },
      ],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(false);
    expect(result.deviations.some(d => d.rule === 2)).toBe(true);
  });

  it('same (from, to) but different type → both must be present to be equal', () => {
    const withCall: C = {
      entities,
      relations: [{ from: 'a', to: 'b', type: 'call' }],
    };
    const withDep: C = {
      entities,
      relations: [{ from: 'a', to: 'b', type: 'dependency' }],
    };
    // call ≠ dependency: they are different triples
    const result = diffC(withCall, withDep);
    expect(result.equal).toBe(false);
    expect(result.deviations.some(d => d.rule === 2)).toBe(true);
  });

  it('both call and dependency present in both → equal', () => {
    const withBoth: C = {
      entities,
      relations: [
        { from: 'a', to: 'b', type: 'call' },
        { from: 'a', to: 'b', type: 'dependency' },
      ],
    };
    const result = diffC(withBoth, withBoth);
    expect(result.equal).toBe(true);
  });
});

// ── Rule 3: Nullable fields ───────────────────────────────────────────────────

describe('Rule 3 — nullable fields', () => {
  it('params: null vs params: [] → equal', () => {
    const expected: C = {
      entities: [
        {
          id: 'a', name: 'A', type: 'class', sourceFile: 'a.ts',
          methods: [{ name: 'foo', params: null as unknown as [], returnType: 'void' }],
        },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        {
          id: 'a', name: 'A', type: 'class', sourceFile: 'a.ts',
          methods: [{ name: 'foo', params: [], returnType: 'void' }],
        },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(true);
  });

  it('returnType: null vs "void" → equal', () => {
    const expected: C = {
      entities: [
        {
          id: 'a', name: 'A', type: 'class', sourceFile: 'a.ts',
          methods: [{ name: 'foo', params: [], returnType: null as unknown as string }],
        },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        {
          id: 'a', name: 'A', type: 'class', sourceFile: 'a.ts',
          methods: [{ name: 'foo', params: [], returnType: 'void' }],
        },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(true);
  });

  it('unknown null field (sourceFile) treated conservatively → not equal when mismatched', () => {
    // A real sourceFile vs a completely different value should be flagged
    const expected: C = {
      entities: [
        { id: 'a', name: 'A', type: 'class', sourceFile: 'real/path.ts', methods: [] },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        { id: 'a', name: 'A', type: 'class', sourceFile: 'different/path.ts', methods: [] },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(false);
    expect(result.deviations.some(d => d.rule === 3)).toBe(true);
  });
});

// ── Rule 4: ID normalisation ──────────────────────────────────────────────────

describe('Rule 4 — ID normalisation', () => {
  it('"MyClass" vs "myclass" after normalisation → equal', () => {
    const expected: C = {
      entities: [
        { id: 'MyClass', name: 'MyClass', type: 'class', sourceFile: 'a.ts', methods: [] },
      ],
      relations: [],
    };
    const actual: C = {
      entities: [
        { id: 'myclass', name: 'MyClass', type: 'class', sourceFile: 'a.ts', methods: [] },
      ],
      relations: [],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(true);
  });

  it('relation IDs are also normalised before comparison', () => {
    const entities: C['entities'] = [
      { id: 'myclass', name: 'MyClass', type: 'class', sourceFile: 'a.ts', methods: [] },
      { id: 'otherclass', name: 'OtherClass', type: 'class', sourceFile: 'b.ts', methods: [] },
    ];
    const expected: C = {
      entities,
      relations: [{ from: 'MyClass', to: 'OtherClass', type: 'dependency' }],
    };
    const actual: C = {
      entities,
      relations: [{ from: 'myclass', to: 'otherclass', type: 'dependency' }],
    };
    const result = diffC(expected, actual);
    expect(result.equal).toBe(true);
  });
});

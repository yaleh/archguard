/**
 * TDD tests for OutputScopeFilter — written before implementation.
 */
import { describe, it, expect } from 'vitest';
import { narrowEntity, narrowEntities } from '@/core/query/output-scope-filter.js';
import type { Entity } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'src/foo.ts.Foo',
    name: 'Foo',
    type: 'class',
    visibility: 'public',
    members: [
      {
        name: 'doSomething',
        type: 'method',
        visibility: 'public',
        returnType: 'void',
        parameters: [{ name: 'x', type: 'string' }],
      },
    ],
    sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 20 },
    attributes: { loc: 20 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('narrowEntity', () => {
  describe("scope = 'package'", () => {
    it('result has id, name, type, sourceLocation with file', () => {
      const entity = makeEntity();
      const result = narrowEntity(entity, 'package');

      expect(result).toHaveProperty('id', 'src/foo.ts.Foo');
      expect(result).toHaveProperty('name', 'Foo');
      expect(result).toHaveProperty('type', 'class');
      expect(result).toHaveProperty('sourceLocation');
      expect((result.sourceLocation as { file: string }).file).toBe('src/foo.ts');
    });

    it('result does NOT have members key', () => {
      const result = narrowEntity(makeEntity(), 'package');
      expect(result).not.toHaveProperty('members');
    });

    it('result does NOT have visibility key', () => {
      const result = narrowEntity(makeEntity(), 'package');
      expect(result).not.toHaveProperty('visibility');
    });

    it("does not throw when entity has no 'attributes'", () => {
      const entity = makeEntity();
      delete (entity as Partial<Entity>).attributes;
      expect(() => narrowEntity(entity, 'package')).not.toThrow();
    });
  });

  describe("scope = 'class'", () => {
    it('result has visibility, id, name, type, sourceLocation', () => {
      const result = narrowEntity(makeEntity(), 'class');

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('visibility');
      expect(result).toHaveProperty('sourceLocation');
    });

    it('result does NOT have members key', () => {
      const result = narrowEntity(makeEntity(), 'class');
      expect(result).not.toHaveProperty('members');
    });

    it('omits members even when entity has empty members array', () => {
      const entity = makeEntity({ members: [] });
      const result = narrowEntity(entity, 'class');
      expect(result).not.toHaveProperty('members');
    });
  });

  describe("scope = 'method'", () => {
    it('result has members', () => {
      const entity = makeEntity();
      const result = narrowEntity(entity, 'method');
      expect(result).toHaveProperty('members');
    });

    it('result deeply equals original entity', () => {
      const entity = makeEntity();
      const result = narrowEntity(entity, 'method');
      expect(result).toEqual(entity);
    });
  });
});

describe('narrowEntities', () => {
  it('returns array of narrowed entities with correct length', () => {
    const e1 = makeEntity({ id: 'src/a.ts.A', name: 'A' });
    const e2 = makeEntity({ id: 'src/b.ts.B', name: 'B' });
    const results = narrowEntities([e1, e2], 'package');

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('id', 'src/a.ts.A');
    expect(results[1]).toHaveProperty('id', 'src/b.ts.B');
    // Neither should have members
    expect(results[0]).not.toHaveProperty('members');
    expect(results[1]).not.toHaveProperty('members');
  });
});

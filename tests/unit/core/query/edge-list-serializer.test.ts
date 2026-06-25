/**
 * TDD tests for EdgeListSerializer — written before implementation.
 */
import { describe, it, expect } from 'vitest';
import { serialize } from '@/core/query/edge-list-serializer.js';
import type { Entity, Relation } from '@/types/index.js';

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
        name: 'compute',
        type: 'method',
        visibility: 'public',
        returnType: 'number',
        parameters: [
          { name: 'x', type: 'string' },
          { name: 'y', type: 'number' },
        ],
      },
      {
        name: 'label',
        type: 'property',
        visibility: 'public',
        fieldType: 'string',
      },
    ],
    sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 30 },
    ...overrides,
  };
}

function makeRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    id: 'rel-1',
    type: 'dependency',
    source: 'src/foo.ts.Foo',
    target: 'src/bar.ts.Bar',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serialize', () => {
  describe('top-level output structure', () => {
    it('returns an object with entities and relations arrays', () => {
      const output = serialize([makeEntity()], [makeRelation()], 'method');
      expect(output).toHaveProperty('entities');
      expect(output).toHaveProperty('relations');
      expect(Array.isArray(output.entities)).toBe(true);
      expect(Array.isArray(output.relations)).toBe(true);
    });
  });

  describe("scope = 'class'", () => {
    it('all methods fields are empty arrays', () => {
      const entities: Partial<Entity>[] = [makeEntity()];
      const output = serialize(entities, [], 'class');
      expect(output.entities[0].methods).toEqual([]);
    });
  });

  describe("scope = 'package'", () => {
    it('all methods fields are empty arrays', () => {
      const entities: Partial<Entity>[] = [makeEntity()];
      const output = serialize(entities, [], 'package');
      expect(output.entities[0].methods).toEqual([]);
    });
  });

  describe("scope = 'method'", () => {
    it('methods contains correct signatures mapped from members', () => {
      const entities: Partial<Entity>[] = [makeEntity()];
      const output = serialize(entities, [], 'method');

      // Only method-type members are included (not property)
      expect(output.entities[0].methods).toHaveLength(1);
      expect(output.entities[0].methods[0].name).toBe('compute');
      expect(output.entities[0].methods[0].returnType).toBe('number');
    });

    it('params properly maps parameters to {name, type}', () => {
      const output = serialize([makeEntity()], [], 'method');
      const params = output.entities[0].methods[0].params;

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({ name: 'x', type: 'string' });
      expect(params[1]).toEqual({ name: 'y', type: 'number' });
    });

    it('members with type=property are NOT included in methods', () => {
      const output = serialize([makeEntity()], [], 'method');
      const methodNames = output.entities[0].methods.map((m) => m.name);
      // 'label' is a property, should not appear
      expect(methodNames).not.toContain('label');
    });

    it('constructor type IS included in methods', () => {
      const entity = makeEntity({
        members: [
          {
            name: 'constructor',
            type: 'constructor',
            visibility: 'public',
            parameters: [],
          },
        ],
      });
      const output = serialize([entity], [], 'method');
      expect(output.entities[0].methods[0].name).toBe('constructor');
    });

    it('returnType fallback: member without returnType outputs void', () => {
      const entity = makeEntity({
        members: [
          {
            name: 'doWork',
            type: 'method',
            visibility: 'public',
            // no returnType
          },
        ],
      });
      const output = serialize([entity], [], 'method');
      expect(output.entities[0].methods[0].returnType).toBe('void');
    });
  });

  describe('relation mapping', () => {
    it('maps source → from, target → to, type → type', () => {
      const relations = [makeRelation()];
      const output = serialize([], relations, 'method');

      expect(output.relations[0]).toEqual({
        from: 'src/foo.ts.Foo',
        to: 'src/bar.ts.Bar',
        type: 'dependency',
      });
    });
  });

  describe('sourceFile fallback', () => {
    it('entity without sourceLocation returns unknown for sourceFile', () => {
      const entity: Partial<Entity> = {
        id: 'some/entity',
        name: 'Orphan',
        type: 'class',
        // no sourceLocation
      };
      const output = serialize([entity], [], 'method');
      expect(output.entities[0].sourceFile).toBe('unknown');
    });
  });
});

/**
 * Unit tests for QueryScopeCollector
 *
 * Tests scope registration, first-write-wins semantics,
 * and lastArchJson primary-role logic — all in isolation
 * without going through DiagramProcessor.processAll().
 */

import { describe, it, expect } from 'vitest';
import { QueryScopeCollector } from '@/cli/processors/query-scope-collector.js';
import type { ArchJSON } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArchJson(entityCount = 1): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities: Array.from({ length: entityCount }, (_, i) => ({
      id: `TestClass${i}`,
      name: `TestClass${i}`,
      type: 'class' as const,
      visibility: 'public' as const,
      sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
      members: [],
    })),
    relations: [],
  };
}

function makeEmptyArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryScopeCollector', () => {
  describe('getQuerySourceGroups()', () => {
    it('returns [] before any register() call', () => {
      const collector = new QueryScopeCollector();
      expect(collector.getQuerySourceGroups()).toEqual([]);
    });
  });

  describe('register()', () => {
    it('with a non-empty ArchJSON adds exactly one scope', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(3), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(1);
    });

    it('with an empty-entity ArchJSON adds no scope', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeEmptyArchJson(), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(0);
    });

    it('with the same key twice does not overwrite (first-write-wins)', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(5);

      collector.register(['./src'], first, 'parsed');
      collector.register(['./src'], second, 'parsed');

      const scopes = collector.getQuerySourceGroups();
      expect(scopes).toHaveLength(1);
      // First registration wins — second should not overwrite
      expect(scopes[0].archJson.entities).toHaveLength(1);
    });

    it('scope key is an 8-char hex string', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');

      const [scope] = collector.getQuerySourceGroups();
      expect(scope.key).toMatch(/^[0-9a-f]{8}$/);
    });

    it('scope sources are resolved to absolute paths', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');

      const [scope] = collector.getQuerySourceGroups();
      for (const source of scope.sources) {
        expect(source).toMatch(/^\//);
      }
    });

    it('stores the provided archJson in the scope', () => {
      const collector = new QueryScopeCollector();
      const archJson = makeArchJson(2);
      collector.register(['./src'], archJson, 'parsed', 'primary');

      const [scope] = collector.getQuerySourceGroups();
      expect(scope.archJson).toBe(archJson);
      expect(scope.kind).toBe('parsed');
      expect(scope.role).toBe('primary');
    });

    it('two different source paths register two distinct scopes', () => {
      const collector = new QueryScopeCollector();
      collector.register(['./src'], makeArchJson(), 'parsed');
      collector.register(['./lib'], makeArchJson(), 'parsed');

      expect(collector.getQuerySourceGroups()).toHaveLength(2);
    });
  });

  describe('getLastArchJson()', () => {
    it('returns null before any setLastArchJson() call', () => {
      const collector = new QueryScopeCollector();
      expect(collector.getLastArchJson()).toBeNull();
    });
  });

  describe('setLastArchJson()', () => {
    it('stores the value when last is null', () => {
      const collector = new QueryScopeCollector();
      const archJson = makeArchJson();

      collector.setLastArchJson(archJson, false);

      expect(collector.getLastArchJson()).toBe(archJson);
    });

    it('does NOT overwrite when incoming has FEWER entities and groupHasPrimary=false (stored richer wins)', () => {
      const collector = new QueryScopeCollector();
      const large = makeArchJson(447);
      const small = makeArchJson(4);

      collector.setLastArchJson(large, false);
      collector.setLastArchJson(small, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('DOES overwrite when incoming has MORE entities and groupHasPrimary=false (richer wins)', () => {
      const collector = new QueryScopeCollector();
      const small = makeArchJson(4);
      const large = makeArchJson(447);

      collector.setLastArchJson(small, false);
      collector.setLastArchJson(large, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('overwrites when groupHasPrimary=true even if incoming is smaller (primary wins)', () => {
      const collector = new QueryScopeCollector();
      const large = makeArchJson(447);
      const small = makeArchJson(4);

      collector.setLastArchJson(large, false);
      collector.setLastArchJson(small, true);

      expect(collector.getLastArchJson()).toBe(small);
    });

    it('primary overwrite then non-primary smaller does NOT overwrite', () => {
      const collector = new QueryScopeCollector();
      const tiny = makeArchJson(4);
      const primary = makeArchJson(100);
      const nonPrimarySmall = makeArchJson(10);

      collector.setLastArchJson(tiny, false);
      collector.setLastArchJson(primary, true);
      collector.setLastArchJson(nonPrimarySmall, false);

      expect(collector.getLastArchJson()).toBe(primary);
    });

    it('primary overwrite then non-primary larger DOES overwrite (richer wins over primary)', () => {
      const collector = new QueryScopeCollector();
      const primary = makeArchJson(50);
      const large = makeArchJson(500);

      collector.setLastArchJson(makeArchJson(4), false);
      collector.setLastArchJson(primary, true);
      collector.setLastArchJson(large, false);

      expect(collector.getLastArchJson()).toBe(large);
    });

    it('handles ArchJSON with undefined entities without throwing', () => {
      const collector = new QueryScopeCollector();
      const noEntities = { ...makeArchJson(0), entities: undefined as any };

      collector.setLastArchJson(noEntities, false);
      expect(collector.getLastArchJson()).toBe(noEntities);

      const withEntities = makeArchJson(100);
      collector.setLastArchJson(withEntities, false);
      expect(collector.getLastArchJson()).toBe(withEntities);
    });

    it('DOES overwrite when groupHasPrimary=true', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(2);

      collector.setLastArchJson(first, false);
      collector.setLastArchJson(second, true);

      expect(collector.getLastArchJson()).toBe(second);
    });

    it('two calls with groupHasPrimary=true → last value wins', () => {
      const collector = new QueryScopeCollector();
      const first = makeArchJson(1);
      const second = makeArchJson(2);
      const third = makeArchJson(3);

      collector.setLastArchJson(first, false);
      collector.setLastArchJson(second, true);
      collector.setLastArchJson(third, true);

      expect(collector.getLastArchJson()).toBe(third);
    });
  });
});

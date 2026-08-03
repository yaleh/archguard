/**
 * Unit tests for HeuristicGrouper paths not covered by the existing suite:
 * custom-rule matching internals, Java Maven module detection, limits, and
 * layout direction for many packages.
 */

import { describe, it, expect } from 'vitest';
import { HeuristicGrouper } from '@/mermaid/grouper.js';
import type { ArchJSON } from '@/types/index.js';

function makeEntity(
  id: string,
  name: string,
  file: string,
  overrides: Record<string, unknown> = {}
): any {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 5 },
    ...overrides,
  };
}

function makeArchJson(entities: any[], overrides: Record<string, unknown> = {}): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities,
    relations: [],
    ...overrides,
  } as unknown as ArchJSON;
}

describe('HeuristicGrouper custom rules', () => {
  it('groups matching entities into custom packages when a rule matches', () => {
    const grouper = new HeuristicGrouper({
      customRules: [{ pattern: /src\/controller\//, packageName: 'Controllers', priority: 2 }],
    });
    const archJson = makeArchJson([
      makeEntity('c1', 'UserCtrl', 'src/controller/UserCtrl.ts'),
      makeEntity('c2', 'Svc', 'src/service/Svc.ts'),
    ]);
    const result = grouper.group(archJson);
    // custom rule match short-circuits path grouping and returns only custom packages
    const ctrl = result.packages.find((p) => p.name === 'Controllers');
    expect(ctrl?.entities).toContain('c1');
    expect(result.packages.some((p) => p.name === 'Svc')).toBe(false);
  });

  it('applies higher-priority rules first and prevents double-grouping', () => {
    const grouper = new HeuristicGrouper({
      customRules: [
        { pattern: /src\/admin\//, packageName: 'Admin', priority: 1 },
        { pattern: /src\/admin\/api\//, packageName: 'AdminAPI', priority: 5 },
      ],
    });
    const archJson = makeArchJson([makeEntity('a1', 'Api', 'src/admin/api/Api.ts')]);
    const result = grouper.group(archJson);
    // AdminAPI (higher priority) claims the entity first
    const adminApi = result.packages.find((p) => p.name === 'AdminAPI');
    const admin = result.packages.find((p) => p.name === 'Admin');
    expect(adminApi?.entities).toContain('a1');
    expect(admin === undefined || !admin.entities.includes('a1')).toBe(true);
  });

  it('falls back to path grouping when no rule matches', () => {
    const grouper = new HeuristicGrouper({
      customRules: [{ pattern: /nomatch/, packageName: 'X', priority: 1 }],
    });
    const archJson = makeArchJson([makeEntity('e1', 'Foo', 'src/foo/Foo.ts')]);
    const result = grouper.group(archJson);
    expect(result.packages.some((p) => p.name === 'X')).toBe(false);
    expect(result.packages.length).toBeGreaterThan(0);
  });
});

describe('HeuristicGrouper Java Maven modules', () => {
  it('groups Java entities by Maven module name', () => {
    const grouper = new HeuristicGrouper();
    const archJson = makeArchJson(
      [makeEntity('j1', 'Service', '/proj/core/src/main/java/com/example/Service.java')],
      { language: 'java' }
    );
    const result = grouper.group(archJson);
    // extractJavaMavenModuleName captures 'core' → formatted as 'Core Layer'
    expect(result.packages.some((p) => p.name.toLowerCase().includes('core'))).toBe(true);
  });
});

describe('HeuristicGrouper limits', () => {
  it('caps the number of packages by maxPackages keeping largest first', () => {
    const entities = [];
    for (let i = 0; i < 6; i++) {
      entities.push(makeEntity(`e${i}`, `E${i}`, `src/pkg${i}/E${i}.ts`));
      // give pkg0 the most entities
      if (i === 0) entities.push(makeEntity('e0b', 'E0B', 'src/pkg0/E0B.ts'));
    }
    const grouper = new HeuristicGrouper({ maxPackages: 2 });
    const result = grouper.group(makeArchJson(entities));
    expect(result.packages.length).toBe(2);
    // largest package first
    expect(result.packages[0].entities.length).toBeGreaterThanOrEqual(
      result.packages[1].entities.length
    );
  });
});

describe('HeuristicGrouper layout direction', () => {
  it('uses LR for few packages and TB for many', () => {
    const grouper = new HeuristicGrouper();
    const few = makeArchJson([
      makeEntity('a', 'A', 'src/a/A.ts'),
      makeEntity('b', 'B', 'src/b/B.ts'),
    ]);
    expect(grouper.group(few).layout.direction).toBe('LR');
    const many = makeArchJson(
      Array.from({ length: 6 }, (_, i) => makeEntity(`e${i}`, `E${i}`, `src/p${i}/E${i}.ts`))
    );
    expect(grouper.group(many).layout.direction).toBe('TB');
  });
});

describe('HeuristicGrouper empty and edge cases', () => {
  it('returns empty packages for empty entities', () => {
    const result = new HeuristicGrouper().group(makeArchJson([]));
    expect(result.packages).toEqual([]);
  });
});

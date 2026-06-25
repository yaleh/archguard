/**
 * Unit tests for Relation Extraction - Story 5
 * Testing relationship extraction (inheritance, implementation, composition, dependency)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect } from 'vitest';
import { RelationExtractor } from '@/parser/relation-extractor';

const extractor = new RelationExtractor();

describe('RelationExtractor - Inheritance', () => {
  it('should detect class inheritance', () => {
    const code = `
      class User {}
      class AdminUser extends User {
        role: string;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String),
      type: 'inheritance',
      source: 'AdminUser',
      target: 'User',
    });
  });

  it('should detect multiple inheritance relationships', () => {
    const code = `
      class Base {}
      class Derived1 extends Base {}
      class Derived2 extends Base {}
    `;

    const relations = extractor.extract(code);

    expect(relations).toHaveLength(2);
    expect(relations.filter((r) => r.type === 'inheritance')).toHaveLength(2);
  });
});

describe('RelationExtractor - Implementation', () => {
  it('should detect interface implementation', () => {
    const code = `
      interface IUserService {
        findUser(): void;
      }
      class UserService implements IUserService {
        findUser() {}
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String) as string,
      type: 'implementation' as const,
      source: 'UserService',
      target: 'IUserService',
    });
  });

  it('should detect multiple interface implementations', () => {
    const code = `
      interface ILogger {}
      interface ICache {}
      class Service implements ILogger, ICache {}
    `;

    const relations = extractor.extract(code);

    expect(relations).toHaveLength(2);
    expect(relations.filter((r) => r.type === 'implementation')).toHaveLength(2);
  });

  it('should detect both extends and implements', () => {
    const code = `
      class BaseService {}
      interface ILoggable {}
      class UserService extends BaseService implements ILoggable {}
    `;

    const relations = extractor.extract(code);

    expect(relations).toHaveLength(2);
    expect(relations.find((r) => r.type === 'inheritance')).toBeDefined();
    expect(relations.find((r) => r.type === 'implementation')).toBeDefined();
  });
});

describe('RelationExtractor - Interface Extends', () => {
  it('should detect interface extension', () => {
    const code = `
      interface User {}
      interface AdminUser extends User {
        role: string;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String),
      type: 'inheritance',
      source: 'AdminUser',
      target: 'User',
    });
  });
});

describe('RelationExtractor - Composition', () => {
  it('should detect composition through properties', () => {
    const code = `
      class Database {}
      class UserService {
        private db: Database;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String),
      type: 'composition',
      source: 'UserService',
      target: 'Database',
    });
  });

  it('should detect composition in constructor', () => {
    const code = `
      class Database {}
      class UserService {
        constructor(private db: Database) {}
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String),
      type: 'composition',
      source: 'UserService',
      target: 'Database',
    });
  });
});

describe('RelationExtractor - Dependency', () => {
  it('should detect dependency through method parameters', () => {
    const code = `
      class User {}
      class UserService {
        findUser(id: string): User {
          return new User();
        }
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual({
      id: expect.any(String) as string,
      type: 'dependency' as const,
      source: 'UserService',
      target: 'User',
    });
  });

  it('should detect dependency through method return type', () => {
    const code = `
      class User {}
      class Factory {
        create(): User {
          return new User();
        }
      }
    `;

    const relations = extractor.extract(code);

    const userDeps = relations.filter((r) => r.source === 'Factory' && r.target === 'User');
    expect(userDeps.length).toBeGreaterThan(0);
  });
});

describe('RelationExtractor - Complex Scenarios', () => {
  it('should handle multiple relationship types in one class', () => {
    const code = `
      class BaseService {}
      interface ILogger {}
      class Database {}
      class User {}

      class UserService extends BaseService implements ILogger {
        private db: Database;

        findUser(id: string): User {
          return new User();
        }
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.length).toBeGreaterThan(0);

    const inheritance = relations.find(
      (r) => r.type === 'inheritance' && r.source === 'UserService'
    );
    expect(inheritance).toBeDefined();

    const implementation = relations.find(
      (r) => r.type === 'implementation' && r.source === 'UserService'
    );
    expect(implementation).toBeDefined();

    const composition = relations.find(
      (r) => r.type === 'composition' && r.source === 'UserService'
    );
    expect(composition).toBeDefined();
  });

  it('should avoid duplicate relations', () => {
    const code = `
      class User {}
      class UserService {
        private user: User;

        getUser(): User {
          return this.user;
        }

        setUser(user: User): void {
          this.user = user;
        }
      }
    `;

    const relations = extractor.extract(code);

    // Should not create duplicate relations for User
    const userRelations = relations.filter(
      (r) => r.source === 'UserService' && r.target === 'User'
    );

    // Should have composition (from property) and possibly dependency
    // But each unique relation should appear only once
    const uniqueRelationKeys = new Set(
      userRelations.map((r) => `${r.type}-${r.source}-${r.target}`)
    );
    expect(uniqueRelationKeys.size).toBe(userRelations.length);
  });
});

describe('RelationExtractor - External Import Filtering', () => {
  it('should not create relation for type imported from an npm package (non-relative path)', () => {
    const code = `
      import type { Bar } from 'cli-progress';
      import { MultiBar } from 'cli-progress';

      class ParallelProgressReporter {
        private bar: Bar;
        private multiBar: MultiBar;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'Bar')).toBeUndefined();
    expect(relations.find((r) => r.target === 'MultiBar')).toBeUndefined();
  });

  it('should not create relation for type imported from a scoped npm package', () => {
    const code = `
      import type { SomeType } from '@some/package';

      class MyService {
        private dep: SomeType;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'SomeType')).toBeUndefined();
  });

  it('should still create relation for type imported from a relative path', () => {
    const code = `
      import type { LocalConfig } from './local-config';

      class MyService {
        private config: LocalConfig;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'LocalConfig')).toBeDefined();
  });

  it('should still create relation for locally defined types (no import)', () => {
    const code = `
      class Engine {}

      class Car {
        private engine: Engine;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.source === 'Car' && r.target === 'Engine')).toBeDefined();
  });

  it('should filter external types from constructor parameters', () => {
    const code = `
      import { Ora } from 'ora';

      class ProgressReporter {
        constructor(private spinner: Ora) {}
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'Ora')).toBeUndefined();
  });
});

describe('RelationExtractor - Gap A: Function Import Relations', () => {
  it('should extract dependency relations for named imports called inside a function body', () => {
    const code = `
      import { fetchData } from './api';
      import { useHelper } from './helpers';
      export function useWeather() {
        const data = fetchData();
        return useHelper(data);
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'useWeather', target: 'fetchData' })
    );
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'useWeather', target: 'useHelper' })
    );
  });

  it('should extract dependency relations for arrow-function variables that call local imports', () => {
    const code = `
      import { computeScore } from './scoring';
      export const processResult = (input: string) => {
        return computeScore(input);
      };
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({
        type: 'dependency',
        source: 'processResult',
        target: 'computeScore',
      })
    );
  });

  it('should NOT emit dependency relation for imports from external packages', () => {
    const code = `
      import { lodashHelper } from 'lodash';
      export function myUtil() {
        return lodashHelper();
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'lodashHelper')).toBeUndefined();
  });

  it('should NOT emit self-relation for a function', () => {
    const code = `
      import { useWeather } from './weather';
      export function useWeather() {
        return useWeather();
      }
    `;

    const relations = extractor.extract(code);

    const selfRels = relations.filter(
      (r) => r.source === 'useWeather' && r.target === 'useWeather'
    );
    expect(selfRels).toHaveLength(0);
  });

  it('should not emit relation for a local import not referenced in the function body', () => {
    const code = `
      import { fetchData } from './api';
      import { unusedHelper } from './helpers';
      export function useWeather() {
        return fetchData();
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'unusedHelper')).toBeUndefined();
  });

  it('should extract relations from multiple functions in the same file', () => {
    const code = `
      import { callA } from './a';
      import { callB } from './b';
      export function funcOne() {
        callA();
      }
      export function funcTwo() {
        callB();
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'funcOne', target: 'callA' })
    );
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'funcTwo', target: 'callB' })
    );
  });
});

describe('RelationExtractor - Gap B: Interface Property Type Refs', () => {
  it('should extract composition relations for custom types in interface properties', () => {
    const code = `
      interface ForecastPoint {}
      interface Coordinates {}
      interface WeatherData {
        forecast: ForecastPoint;
        location: Coordinates;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({
        type: 'composition',
        source: 'WeatherData',
        target: 'ForecastPoint',
      })
    );
    expect(relations).toContainEqual(
      expect.objectContaining({
        type: 'composition',
        source: 'WeatherData',
        target: 'Coordinates',
      })
    );
  });

  it('should NOT emit composition for primitive property types in interfaces', () => {
    const code = `
      interface Config {
        name: string;
        count: number;
        active: boolean;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'string')).toBeUndefined();
    expect(relations.find((r) => r.target === 'number')).toBeUndefined();
    expect(relations.find((r) => r.target === 'boolean')).toBeUndefined();
  });

  it('should NOT emit composition for interface property types imported from external packages', () => {
    const code = `
      import type { ExternalModel } from 'some-package';
      interface MyData {
        external: ExternalModel;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations.find((r) => r.target === 'ExternalModel')).toBeUndefined();
  });

  it('should emit composition for interface property types imported from local paths', () => {
    const code = `
      import type { LocalType } from './local-types';
      interface MyData {
        item: LocalType;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'composition', source: 'MyData', target: 'LocalType' })
    );
  });

  it('should handle interface that both extends and has typed properties', () => {
    const code = `
      interface Base {}
      interface Point {}
      interface Shape extends Base {
        center: Point;
      }
    `;

    const relations = extractor.extract(code);

    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'inheritance', source: 'Shape', target: 'Base' })
    );
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'composition', source: 'Shape', target: 'Point' })
    );
  });

  it('should not emit duplicate composition relations for repeated types in interface', () => {
    const code = `
      interface Point {}
      interface Line {
        start: Point;
        end: Point;
      }
    `;

    const relations = extractor.extract(code);

    const pointRels = relations.filter((r) => r.source === 'Line' && r.target === 'Point');
    expect(pointRels).toHaveLength(1);
  });
});

describe('RelationExtractor - Cross-file type resolution (import() format)', () => {
  it('should extract composition when property type resolves to cross-file import() format', () => {
    // Create a fresh extractor to get an isolated project
    const crossExtractor = new RelationExtractor();
    // Add the "other" file first so TypeChecker can resolve across files
    crossExtractor['project'].createSourceFile('/types.ts', 'export class Foo {}');
    const barFile = crossExtractor['project'].createSourceFile(
      '/bar.ts',
      `
      import { Foo } from './types.js';
      export class Bar {
        private foo: Foo;
      }
    `
    );
    const relations = crossExtractor.extractFromSourceFile(barFile);
    const comp = relations.filter(
      (r) => r.type === 'composition' && r.source === 'Bar' && r.target === 'Foo'
    );
    expect(comp).toHaveLength(1);
  });

  it('extractTypeName handles import() format directly', () => {
    const ext = new RelationExtractor();
    // Access private method via type cast
    const result = (
      ext as unknown as { extractTypeName(s: string): string | null }
    ).extractTypeName('import("/home/user/project/src/types/index").ArchJSON');
    expect(result).toBe('ArchJSON');
  });
});

describe('RelationExtractor - Function signature type extraction', () => {
  it('should extract dependency from function parameter type annotation', () => {
    const code = `
      import { Entity } from './types.js';
      export function processEntity(entity: Entity): void {}
    `;
    const relations = extractor.extract(code);
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'processEntity', target: 'Entity' })
    );
  });

  it('should extract dependency from function return type annotation', () => {
    const code = `
      import { Result } from './result.js';
      export function compute(): Result { return {} as Result; }
    `;
    const relations = extractor.extract(code);
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'compute', target: 'Result' })
    );
  });

  it('should extract dependency from arrow function parameter type annotation', () => {
    const code = `
      import { Config } from './config.js';
      export const applyConfig = (cfg: Config): void => {};
    `;
    const relations = extractor.extract(code);
    expect(relations).toContainEqual(
      expect.objectContaining({ type: 'dependency', source: 'applyConfig', target: 'Config' })
    );
  });

  it('should NOT emit duplicate when type appears both in body text and signature', () => {
    const code = `
      import { Foo } from './foo.js';
      export function useFoo(foo: Foo): void {
        const x = new Foo();
      }
    `;
    const relations = extractor.extract(code);
    const depsToFoo = relations.filter((r) => r.source === 'useFoo' && r.target === 'Foo');
    expect(depsToFoo).toHaveLength(1); // dedup by relationSet
  });

  it('should NOT extract primitive types from function signatures', () => {
    const code = `
      export function add(a: number, b: string): boolean { return false; }
    `;
    const relations = extractor.extract(code);
    expect(relations).toHaveLength(0);
  });
});

describe('RelationExtractor - Structural type filtering', () => {
  it('should NOT emit composition for function-typed interface properties', () => {
    const code = `
      interface EventHandlers {
        onClick: () => void;
        onChange: (value: string) => boolean;
        onSubmit: (data: FormData, event: Event) => Promise<void>;
      }
    `;
    const relations = extractor.extract(code);
    // No composition relations — all props are anonymous function types
    expect(relations.filter((r) => r.type === 'composition')).toHaveLength(0);
  });

  it('should NOT emit composition for object-literal-typed interface properties', () => {
    const code = `
      interface Config {
        options: { debug: boolean; timeout: number };
      }
    `;
    const relations = extractor.extract(code);
    expect(relations.filter((r) => r.type === 'composition')).toHaveLength(0);
  });

  it('should NOT emit composition for tuple-typed interface properties', () => {
    const code = `
      interface Pair {
        coords: [number, number];
      }
    `;
    const relations = extractor.extract(code);
    expect(relations.filter((r) => r.type === 'composition')).toHaveLength(0);
  });

  it('should still emit composition for named-type interface properties', () => {
    const code = `
      interface Component {
        onClick: () => void;
        data: WeatherData;
        handler: (x: number) => void;
      }
    `;
    const relations = extractor.extract(code);
    const comp = relations.filter((r) => r.type === 'composition');
    expect(comp).toHaveLength(1);
    expect(comp[0].target).toBe('WeatherData');
  });
});

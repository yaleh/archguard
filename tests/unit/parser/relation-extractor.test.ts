/**
 * Unit tests for Relation Extraction - Story 5
 * Testing relationship extraction (inheritance, implementation, composition, dependency)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeAll } from 'vitest';
import { RelationExtractor } from '@/parser/relation-extractor';

describe('RelationExtractor - Inheritance', () => {
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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
  let extractor: RelationExtractor;

  beforeAll(() => {
    extractor = new RelationExtractor();
  });

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

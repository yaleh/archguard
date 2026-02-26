/**
 * Unit tests for Member Extraction - Story 2
 * Testing methods, properties, and constructors
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ClassExtractor } from '@/parser/class-extractor';

describe('ClassExtractor - Methods', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  it('should extract simple method', () => {
    const code = `
      class UserService {
        findUser(id: string): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      name: 'findUser',
      type: 'method',
      visibility: 'public',
      parameters: [{ name: 'id', type: 'string', isOptional: false }],
      returnType: 'User',
      isAsync: false,
      isStatic: false,
    });
  });

  it('should extract async method', () => {
    const code = `
      class UserService {
        async findUser(id: string): Promise<User> {
          return await db.query(id);
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isAsync).toBe(true);
    expect(result.members[0]?.returnType).toBe('Promise<User>');
  });

  it('should extract static method', () => {
    const code = `
      class MathUtils {
        static add(a: number, b: number): number {
          return a + b;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isStatic).toBe(true);
  });

  it('should handle method visibility modifiers', () => {
    const code = `
      class UserService {
        public getUser() {}
        private validateUser() {}
        protected checkPermission() {}
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(3);
    expect(result.members[0]?.visibility).toBe('public');
    expect(result.members[1]?.visibility).toBe('private');
    expect(result.members[2]?.visibility).toBe('protected');
  });

  it('should extract method with multiple parameters', () => {
    const code = `
      class Calculator {
        add(a: number, b: number, c: number = 0): number {
          return a + b + c;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.parameters).toHaveLength(3);
    expect(result.members[0]?.parameters?.[0]).toMatchObject({
      name: 'a',
      type: 'number',
      isOptional: false,
    });
    expect(result.members[0]?.parameters?.[2]).toMatchObject({
      name: 'c',
      type: 'number',
      isOptional: true,
      defaultValue: '0',
    });
  });

  it('should extract method with optional parameters', () => {
    const code = `
      class UserService {
        findUser(id: string, includeDeleted?: boolean): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.parameters?.[1]).toMatchObject({
      name: 'includeDeleted',
      type: 'boolean',
      isOptional: true,
    });
  });

  it('should handle abstract methods', () => {
    const code = `
      abstract class BaseService {
        abstract process(data: any): void;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isAbstract).toBe(true);
  });
});

describe('ClassExtractor - Properties', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  it('should extract simple property', () => {
    const code = `
      class User {
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      name: 'name',
      type: 'property',
      fieldType: 'string',
      visibility: 'public',
      isReadonly: false,
    });
  });

  it('should handle readonly properties', () => {
    const code = `
      class Config {
        readonly apiKey: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isReadonly).toBe(true);
  });

  it('should extract property with initializer', () => {
    const code = `
      class Counter {
        count: number = 0;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.defaultValue).toBe('0');
  });

  it('should handle static properties', () => {
    const code = `
      class Config {
        static instance: Config;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isStatic).toBe(true);
  });

  it('should handle property visibility', () => {
    const code = `
      class User {
        public name: string;
        private password: string;
        protected role: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(3);
    expect(result.members[0]?.visibility).toBe('public');
    expect(result.members[1]?.visibility).toBe('private');
    expect(result.members[2]?.visibility).toBe('protected');
  });
});

describe('ClassExtractor - Constructors', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  it('should extract constructor', () => {
    const code = `
      class User {
        constructor(name: string, age: number) {}
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      name: 'constructor',
      type: 'constructor',
      visibility: 'public',
      parameters: [
        { name: 'name', type: 'string', isOptional: false },
        { name: 'age', type: 'number', isOptional: false },
      ],
    });
  });

  it('should extract constructor with property parameters', () => {
    const code = `
      class User {
        constructor(
          public name: string,
          private age: number
        ) {}
      }
    `;

    const result = extractor.extract(code);

    const constructor = result.members.find((m) => m.type === 'constructor');
    expect(constructor?.parameters).toHaveLength(2);
  });

  it('should handle private constructor', () => {
    const code = `
      class Singleton {
        private constructor() {}
      }
    `;

    const result = extractor.extract(code);

    const constructor = result.members.find((m) => m.type === 'constructor');
    expect(constructor?.visibility).toBe('private');
  });
});

describe('ClassExtractor - Mixed Members', () => {
  let extractor: ClassExtractor;

  beforeAll(() => {
    extractor = new ClassExtractor();
  });

  it('should extract all member types together', () => {
    const code = `
      class UserService {
        private db: Database;

        constructor(db: Database) {
          this.db = db;
        }

        async findUser(id: string): Promise<User> {
          return await this.db.query(id);
        }

        static getInstance(): UserService {
          return new UserService();
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(4);

    const property = result.members.find((m) => m.type === 'property');
    expect(property?.name).toBe('db');

    const constructor = result.members.find((m) => m.type === 'constructor');
    expect(constructor?.name).toBe('constructor');

    const methods = result.members.filter((m) => m.type === 'method');
    expect(methods).toHaveLength(2);
  });
});

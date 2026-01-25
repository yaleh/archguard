/**
 * Unit tests for TypeScriptParser - Story 6
 * Testing complete Arch-JSON generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TypeScriptParser } from '@/parser/typescript-parser';

describe('TypeScriptParser - Single File', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  it('should parse a simple class file', () => {
    const code = `
      export class User {
        name: string;
        age: number;

        constructor(name: string, age: number) {
          this.name = name;
          this.age = age;
        }

        greet(): string {
          return \`Hello, \${this.name}\`;
        }
      }
    `;

    const result = parser.parseCode(code);

    expect(result.version).toBe('1.0');
    expect(result.language).toBe('typescript');
    expect(result.timestamp).toBeDefined();
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe('User');
  });

  it('should parse file with multiple entities', () => {
    const code = `
      export interface IUser {
        name: string;
      }

      export class User implements IUser {
        name: string;
      }

      export enum Role {
        Admin,
        User
      }
    `;

    const result = parser.parseCode(code);

    expect(result.entities).toHaveLength(3);

    const interface_ = result.entities.find((e) => e.type === 'interface');
    expect(interface_?.name).toBe('IUser');

    const class_ = result.entities.find((e) => e.type === 'class');
    expect(class_?.name).toBe('User');

    const enum_ = result.entities.find((e) => e.type === 'enum');
    expect(enum_?.name).toBe('Role');
  });

  it('should extract relations', () => {
    const code = `
      export class BaseService {}

      export interface ILogger {}

      export class UserService extends BaseService implements ILogger {
        private db: Database;

        findUser(id: string): User {
          return new User();
        }
      }

      export class Database {}
      export class User {}
    `;

    const result = parser.parseCode(code);

    expect(result.relations.length).toBeGreaterThan(0);

    const inheritance = result.relations.find(
      (r) => r.type === 'inheritance' && r.source === 'UserService'
    );
    expect(inheritance).toBeDefined();

    const implementation = result.relations.find(
      (r) => r.type === 'implementation' && r.source === 'UserService'
    );
    expect(implementation).toBeDefined();
  });
});

describe('TypeScriptParser - JSON Serialization', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  it('should generate valid JSON', () => {
    const code = `
      export class User {
        name: string;
      }
    `;

    const result = parser.parseCode(code);
    const json = JSON.stringify(result);

    // Verify JSON is valid
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const _parsed = JSON.parse(json);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return _parsed;
    }).not.toThrow();
  });

  it('should have correct structure', () => {
    const code = `
      export class User {
        name: string;
      }
    `;

    const result = parser.parseCode(code);

    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('language');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('sourceFiles');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('relations');
  });
});

describe('TypeScriptParser - Complex Scenarios', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  it('should handle decorators', () => {
    const code = `
      @Injectable()
      export class UserService {
        @Cache(60)
        findUser(id: string): User {
          return new User();
        }
      }

      export class User {}
    `;

    const result = parser.parseCode(code);

    const userService = result.entities.find((e) => e.name === 'UserService');
    expect(userService?.decorators).toHaveLength(1);
    expect(userService?.decorators?.[0]?.name).toBe('Injectable');

    const method = userService?.members.find((m) => m.name === 'findUser');
    expect(method?.decorators).toHaveLength(1);
    expect(method?.decorators?.[0]?.name).toBe('Cache');
  });

  it('should handle generic types', () => {
    const code = `
      export class Container<T> {
        value: T;

        getValue(): T {
          return this.value;
        }
      }

      export interface Repository<T> {
        findById(id: string): T;
      }
    `;

    const result = parser.parseCode(code);

    const container = result.entities.find((e) => e.name === 'Container');
    expect(container?.genericParams).toEqual(['T']);

    const repository = result.entities.find((e) => e.name === 'Repository');
    expect(repository?.genericParams).toEqual(['T']);
  });

  it('should handle abstract classes', () => {
    const code = `
      export abstract class BaseService {
        abstract process(): void;

        protected log(message: string): void {
          console.log(message);
        }
      }
    `;

    const result = parser.parseCode(code);

    const baseService = result.entities.find((e) => e.name === 'BaseService');
    expect(baseService?.isAbstract).toBe(true);

    const processMethod = baseService?.members.find((m) => m.name === 'process');
    expect(processMethod?.isAbstract).toBe(true);
  });

  it('should handle const enums', () => {
    const code = `
      export const enum Direction {
        Up,
        Down,
        Left,
        Right
      }
    `;

    const result = parser.parseCode(code);

    const direction = result.entities.find((e) => e.name === 'Direction');
    expect(direction?.isConst).toBe(true);
  });
});

describe('TypeScriptParser - Empty Cases', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  it('should handle empty code', () => {
    const code = '';

    const result = parser.parseCode(code);

    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('should handle code with only imports', () => {
    const code = `
      import { Something } from 'somewhere';
    `;

    const result = parser.parseCode(code);

    expect(result.entities).toHaveLength(0);
  });

  it('should handle code with only variables', () => {
    const code = `
      export const x = 1;
      export const y = 2;
    `;

    const result = parser.parseCode(code);

    expect(result.entities).toHaveLength(0);
  });
});

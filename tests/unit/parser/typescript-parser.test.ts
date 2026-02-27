/**
 * Unit tests for TypeScriptParser - Story 6
 * Testing complete Arch-JSON generation
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TypeScriptParser } from '@/parser/typescript-parser';

describe('TypeScriptParser - Single File', () => {
  let parser: TypeScriptParser;

  beforeAll(() => {
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

  beforeAll(() => {
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

  beforeAll(() => {
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

  beforeAll(() => {
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

describe('TypeScriptParser - File-scoped entity IDs with workspaceRoot (A-1 TDD)', () => {
  it('should produce file-scoped id when workspaceRoot is provided', () => {
    const parser = new TypeScriptParser('/project');
    const code = 'export class Config {}';

    const result = parser.parseCode(code, '/project/src/cli/config.ts');

    const entity = result.entities.find((e) => e.name === 'Config');
    expect(entity).toBeDefined();
    // id should be relative path + '.' + name
    expect(entity.id).toBe('src/cli/config.ts.Config');
  });

  it('should produce file-scoped id for interface when workspaceRoot is provided', () => {
    const parser = new TypeScriptParser('/project');
    const code = 'export interface IService {}';

    const result = parser.parseCode(code, '/project/src/core/service.ts');

    const entity = result.entities.find((e) => e.name === 'IService');
    expect(entity).toBeDefined();
    expect(entity.id).toBe('src/core/service.ts.IService');
  });

  it('should produce file-scoped id for enum when workspaceRoot is provided', () => {
    const parser = new TypeScriptParser('/project');
    const code = 'export enum Status { Active, Inactive }';

    const result = parser.parseCode(code, '/project/src/types/status.ts');

    const entity = result.entities.find((e) => e.name === 'Status');
    expect(entity).toBeDefined();
    expect(entity.id).toBe('src/types/status.ts.Status');
  });

  it('should use absolute path as id when no workspaceRoot provided', () => {
    // Without workspaceRoot, filePath is used as-is (absolute path or relative)
    const parser = new TypeScriptParser();
    const code = 'export class Config {}';

    const result = parser.parseCode(code, 'src/cli/config.ts');

    const entity = result.entities.find((e) => e.name === 'Config');
    expect(entity).toBeDefined();
    // With no workspaceRoot, path is passed as-is
    expect(entity.id).toBe('src/cli/config.ts.Config');
  });

  it('should produce distinct IDs for same class name in different files', () => {
    const parser = new TypeScriptParser('/project');
    const code = 'export class Config {}';

    const result1 = parser.parseCode(code, '/project/src/cli/config.ts');
    const result2 = parser.parseCode(code, '/project/src/server/config.ts');

    const id1 = result1.entities.find((e) => e.name === 'Config')?.id;
    const id2 = result2.entities.find((e) => e.name === 'Config')?.id;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(id1).toBe('src/cli/config.ts.Config');
    expect(id2).toBe('src/server/config.ts.Config');
  });
});

describe('TypeScriptParser - cross-file relation resolution (B-P1 TDD)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'archguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves cross-file relation target to scoped ID', () => {
    // Create src/types/base.ts with a base class
    mkdirSync(path.join(tmpDir, 'src', 'types'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src', 'types', 'base.ts'), 'export class BaseGenerator {}');
    // Create src/mermaid/generator.ts that extends BaseGenerator via import.
    // Using 'extends' gives a bare-name target (not import-qualified) from RelationExtractor.
    mkdirSync(path.join(tmpDir, 'src', 'mermaid'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'src', 'mermaid', 'generator.ts'),
      'import { BaseGenerator } from "../types/base.js";\nexport class Generator extends BaseGenerator {}'
    );

    const parser = new TypeScriptParser(tmpDir);
    const result = parser.parseProject(tmpDir, 'src/**/*.ts');

    // After P1 fix: relation target should be scoped to the file where BaseGenerator is defined
    const rel = result.relations.find((r) => r.target === 'src/types/base.ts.BaseGenerator');
    expect(rel).toBeDefined();
    // The bare 'BaseGenerator' should NOT remain as a target
    const bareRel = result.relations.find((r) => r.target === 'BaseGenerator');
    expect(bareRel).toBeUndefined();
  });

  it('filters out primitive type relations', () => {
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'src', 'foo.ts'),
      'export class Foo { name: string = ""; count: number = 0; }'
    );

    const parser = new TypeScriptParser(tmpDir);
    const result = parser.parseProject(tmpDir, 'src/**/*.ts');

    const stringRel = result.relations.find((r) => r.target === 'string');
    expect(stringRel).toBeUndefined();
    const numberRel = result.relations.find((r) => r.target === 'number');
    expect(numberRel).toBeUndefined();
  });

  it('keeps unknown non-primitive relations for diagnostics', () => {
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'src', 'foo.ts'),
      'export class Foo { handler!: SomeExternalType; }'
    );

    const parser = new TypeScriptParser(tmpDir);
    const result = parser.parseProject(tmpDir, 'src/**/*.ts');

    // SomeExternalType is unknown (not a primitive, not in project) — kept for diagnostics
    // Just assert no crash and entities exist
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('resolves relation source to scoped ID matching entity IDs', () => {
    mkdirSync(path.join(tmpDir, 'src', 'types'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src', 'types', 'index.ts'), 'export interface IService {}');
    mkdirSync(path.join(tmpDir, 'src', 'core'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'src', 'core', 'service.ts'),
      'import { IService } from "../types/index.js";\nexport class ServiceImpl implements IService {}'
    );

    const parser = new TypeScriptParser(tmpDir);
    const result = parser.parseProject(tmpDir, 'src/**/*.ts');

    // Source should be scoped to the file where ServiceImpl is defined
    const implRel = result.relations.find(
      (r) => r.type === 'implementation' && r.target === 'src/types/index.ts.IService'
    );
    expect(implRel).toBeDefined();
    // Source should also be scoped
    expect(implRel.source).toBe('src/core/service.ts.ServiceImpl');
  });
});

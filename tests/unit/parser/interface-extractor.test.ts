/**
 * Unit tests for Interface Extraction - Story 3
 * Testing interface and enum extraction
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { InterfaceExtractor } from '@/parser/interface-extractor';

describe('InterfaceExtractor - Simple Interfaces', () => {
  let extractor: InterfaceExtractor;

  beforeAll(() => {
    extractor = new InterfaceExtractor();
  });

  it('should extract simple interface', () => {
    const code = `
      interface User {
        id: string;
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result).toMatchObject({
      name: 'User',
      type: 'interface',
    });
    expect(result.members).toHaveLength(2);
    expect(result.members[0]).toMatchObject({
      name: 'id',
      type: 'property',
      fieldType: 'string',
    });
    expect(result.members[1]).toMatchObject({
      name: 'name',
      type: 'property',
      fieldType: 'string',
    });
  });

  it('should handle method signatures', () => {
    const code = `
      interface UserRepository {
        findById(id: string): Promise<User>;
        save(user: User): Promise<void>;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(2);
    expect(result.members[0]?.type).toBe('method');
    expect(result.members[0]?.name).toBe('findById');
    expect(result.members[0]?.parameters).toHaveLength(1);
    expect(result.members[0]?.returnType).toBe('Promise<User>');
  });

  it('should handle extends', () => {
    const code = `
      interface AdminUser extends User {
        role: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.extends).toContain('User');
    expect(result.members).toHaveLength(1);
  });

  it('should handle multiple extends', () => {
    const code = `
      interface SuperAdmin extends User, Admin {
        permissions: string[];
      }
    `;

    const result = extractor.extract(code);

    expect(result.extends).toEqual(['User', 'Admin']);
  });

  it('should extract optional properties', () => {
    const code = `
      interface Config {
        apiKey: string;
        timeout?: number;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isOptional).toBeUndefined();
    expect(result.members[1]?.isOptional).toBe(true);
  });

  it('should extract readonly properties', () => {
    const code = `
      interface Config {
        readonly id: string;
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.isReadonly).toBe(true);
    expect(result.members[1]?.isReadonly).toBe(false);
  });

  it('should handle generic interfaces', () => {
    const code = `
      interface Container<T> {
        value: T;
      }
    `;

    const result = extractor.extract(code);

    expect(result.genericParams).toEqual(['T']);
  });

  it('should throw error when no interface found', () => {
    const code = 'class User {}';

    expect(() => extractor.extract(code)).toThrow('No interface found');
  });
});

describe('InterfaceExtractor - Complex Interfaces', () => {
  let extractor: InterfaceExtractor;

  beforeAll(() => {
    extractor = new InterfaceExtractor();
  });

  it('should handle mixed property and method signatures', () => {
    const code = `
      interface Repository<T> {
        readonly name: string;
        findAll(): Promise<T[]>;
        findById(id: string): Promise<T>;
        save(item: T): Promise<void>;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(4);

    const properties = result.members.filter((m) => m.type === 'property');
    expect(properties).toHaveLength(1);

    const methods = result.members.filter((m) => m.type === 'method');
    expect(methods).toHaveLength(3);
  });

  it('should handle index signatures', () => {
    const code = `
      interface Dictionary {
        [key: string]: any;
      }
    `;

    const result = extractor.extract(code);

    // Index signatures might be extracted as special members or ignored
    // This test verifies the interface is extracted without errors
    expect(result.name).toBe('Dictionary');
    expect(result.type).toBe('interface');
  });
});

describe('InterfaceExtractor - File-scoped entity IDs (A-1 TDD)', () => {
  let extractor: InterfaceExtractor;

  beforeAll(() => {
    extractor = new InterfaceExtractor();
  });

  it('should produce distinct IDs for same interface name in different files', () => {
    const code = 'export interface IConfig {}';

    const result1 = extractor.extract(code, 'src/cli/config.ts');
    const result2 = extractor.extract(code, 'src/server/config.ts');

    // IDs must be distinct when filePaths differ
    expect(result1.id).not.toBe(result2.id);
  });

  it('should prefix entity id with file path: src/core/interfaces.ts.IRepository', () => {
    const code = 'export interface IRepository {}';
    const result = extractor.extract(code, 'src/core/interfaces.ts');

    // id must be file-path prefixed, NOT bare 'IRepository'
    expect(result.id).toBe('src/core/interfaces.ts.IRepository');
    expect(result.name).toBe('IRepository');
  });
});

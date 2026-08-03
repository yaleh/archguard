/**
 * Unit tests for generator-formatting helpers.
 */

import { describe, it, expect } from 'vitest';
import type { Entity, Member, Relation } from '@/types/index.js';
import {
  entityTypeToClassDef,
  normalizeEntityName,
  escapeId,
  normalizeTypeName,
  sanitizeType,
  shouldIncludeMember,
  getVisibilitySymbol,
  generateMemberLine,
  generateRelationLine,
  isNoisyTarget,
  generateClassDefinition,
  ENTITY_CLASSDEF_STYLES,
} from '@/mermaid/generator-formatting.js';

describe('entityTypeToClassDef', () => {
  it('maps class to classNode', () => {
    expect(entityTypeToClassDef('class')).toBe('classNode');
  });
  it('maps other types to themselves', () => {
    expect(entityTypeToClassDef('interface')).toBe('interface');
    expect(entityTypeToClassDef('enum')).toBe('enum');
    expect(entityTypeToClassDef('custom')).toBe('custom');
  });
});

describe('normalizeEntityName', () => {
  it('extracts the name from import(...) syntax', () => {
    expect(normalizeEntityName("import('@/foo').Bar")).toBe('Bar');
  });
  it('extracts the last segment from import___ syntax', () => {
    expect(normalizeEntityName('import___src___Foo')).toBe('Foo');
  });
  it('extracts a scoped name after a file extension', () => {
    expect(normalizeEntityName('foo.ts.Foo')).toBe('Foo');
    expect(normalizeEntityName('bar.js.Baz')).toBe('Baz');
  });
  it('maps anonymous objects and lambdas to [Type]', () => {
    expect(normalizeEntityName('{ a: 1 }')).toBe('[Type]');
    expect(normalizeEntityName('(x) => x')).toBe('[Type]');
  });
  it('returns plain names unchanged', () => {
    expect(normalizeEntityName('MyClass')).toBe('MyClass');
  });
});

describe('escapeId', () => {
  it('returns Unknown for empty id', () => {
    expect(escapeId('')).toBe('Unknown');
  });
  it('strips trailing generic type parameters', () => {
    expect(escapeId('Foo<Bar>')).toBe('Foo');
  });
  it('replaces non-alphanumeric characters with underscores', () => {
    expect(escapeId('a.b-c/d')).toBe('a_b_c_d');
  });
  it('keeps letters and digits', () => {
    expect(escapeId('Foo2')).toBe('Foo2');
  });
});

describe('normalizeTypeName', () => {
  it('strips import(...) qualifiers', () => {
    expect(normalizeTypeName("import('@/x').Foo")).toBe('Foo');
  });
  it('strips import___ prefixes', () => {
    expect(normalizeTypeName('import___src___Foo')).toBe('Foo');
  });
  it('returns unchanged when no special syntax', () => {
    expect(normalizeTypeName('string')).toBe('string');
  });
});

describe('sanitizeType', () => {
  it('returns any for empty input', () => {
    expect(sanitizeType('')).toBe('any');
  });
  it('collapses object literals', () => {
    expect(sanitizeType('{ a: string }')).toBe('object');
  });
  it('maps advanced mapped types to any', () => {
    expect(sanitizeType('Partial<Foo>')).toBe('any');
    expect(sanitizeType('Record<string, number>')).toBe('any');
  });
  it('maps function signatures by replacing the arrow prefix with Function', () => {
    expect(sanitizeType('(a: number) =>')).toBe('Function');
    // the return type is left appended verbatim by the implementation
    expect(sanitizeType('(a: number) => void')).toBe('Functionvoid');
  });
  it('collapses Promise wrapping', () => {
    expect(sanitizeType('Promise<string>')).toBe('any');
  });
  it('maps union types to any', () => {
    expect(sanitizeType('string | number')).toBe('any');
  });
  it('maps intersection types to object', () => {
    expect(sanitizeType('A & B')).toBe('object');
  });
  it('collapses arrays to Array', () => {
    expect(sanitizeType('string[]')).toBe('Array');
  });
  it('returns any when result is too long', () => {
    expect(sanitizeType('a'.repeat(60))).toBe('any');
  });
  it('strips nested generics down to the bare name', () => {
    expect(sanitizeType('Map<string, number>')).toBe('Map');
    // advanced mapped types are collapsed to any before generic stripping
    expect(sanitizeType('Record<string, number>')).toBe('any');
  });
});

describe('shouldIncludeMember', () => {
  const priv: Member = { name: 'p', type: 'property', visibility: 'private' };
  const prot: Member = { name: 'r', type: 'property', visibility: 'protected' };
  const pub: Member = { name: 'u', type: 'property', visibility: 'public' };
  it('excludes private when includePrivate is false', () => {
    expect(shouldIncludeMember(priv, { includePrivate: false, includeProtected: true })).toBe(false);
  });
  it('includes private when includePrivate is true', () => {
    expect(shouldIncludeMember(priv, { includePrivate: true, includeProtected: false })).toBe(true);
  });
  it('excludes protected when includeProtected is false', () => {
    expect(shouldIncludeMember(prot, { includePrivate: true, includeProtected: false })).toBe(false);
  });
  it('includes protected when includeProtected is true', () => {
    expect(shouldIncludeMember(prot, { includePrivate: false, includeProtected: true })).toBe(true);
  });
  it('always includes public', () => {
    expect(shouldIncludeMember(pub, { includePrivate: false, includeProtected: false })).toBe(true);
  });
});

describe('getVisibilitySymbol', () => {
  it('maps visibility to symbols', () => {
    expect(getVisibilitySymbol('public')).toBe('+');
    expect(getVisibilitySymbol('private')).toBe('-');
    expect(getVisibilitySymbol('protected')).toBe('#');
  });
});

describe('generateMemberLine', () => {
  it('generates a property line with readonly and optional', () => {
    const m: Member = {
      name: 'count',
      type: 'property',
      visibility: 'private',
      isReadonly: true,
      isOptional: true,
      fieldType: 'number',
    };
    expect(generateMemberLine(m)).toBe('-readonly count?: number');
  });
  it('generates a method line with params and return type', () => {
    const m: Member = {
      name: 'run',
      type: 'method',
      visibility: 'public',
      isAsync: true,
      returnType: 'Promise<void>',
      parameters: [{ name: 'x', type: 'number' }],
    };
    expect(generateMemberLine(m)).toBe('+async run(x: number): any');
  });
  it('generates a static abstract method', () => {
    const m: Member = {
      name: 'make',
      type: 'method',
      visibility: 'protected',
      isStatic: true,
      isAbstract: true,
    };
    expect(generateMemberLine(m)).toBe('#static abstract make()');
  });
  it('handles fields/constructors without params', () => {
    const ctor: Member = { name: 'constructor', type: 'constructor', visibility: 'public' };
    expect(generateMemberLine(ctor)).toBe('+constructor()');
  });
  it('handles optional params', () => {
    const m: Member = {
      name: 'go',
      type: 'method',
      visibility: 'public',
      parameters: [{ name: 'opt', type: 'string', isOptional: true }],
    };
    expect(generateMemberLine(m)).toBe('+go(opt?: string)');
  });
});

describe('generateRelationLine', () => {
  const map = new Map([['a', 'A'], ['b', 'B']]);
  it('returns null for call relations', () => {
    const r = { id: '1', type: 'call', source: 'a', target: 'b' } as Relation;
    expect(generateRelationLine(r, map)).toBeNull();
  });
  it('renders inheritance', () => {
    expect(generateRelationLine({ id: '1', type: 'inheritance', source: 'a', target: 'b' } as Relation, map)).toBe('B <|-- A');
  });
  it('renders implementation', () => {
    expect(generateRelationLine({ id: '1', type: 'implementation', source: 'a', target: 'b' } as Relation, map)).toBe('B <|.. A');
  });
  it('renders composition', () => {
    expect(generateRelationLine({ id: '1', type: 'composition', source: 'a', target: 'b' } as Relation, map)).toBe('A *-- B');
  });
  it('renders aggregation', () => {
    expect(generateRelationLine({ id: '1', type: 'aggregation', source: 'a', target: 'b' } as Relation, map)).toBe('A o-- B');
  });
  it('renders dependency as default', () => {
    expect(generateRelationLine({ id: '1', type: 'dependency', source: 'a', target: 'b' } as Relation, map)).toBe('A --> B');
  });
  it('falls back to the raw id when not in the name map', () => {
    expect(generateRelationLine({ id: '1', type: 'dependency', source: 'x', target: 'y' } as Relation, map)).toBe('x --> y');
  });
});

describe('isNoisyTarget', () => {
  it('flags object literal, quotes, parens, arrows, numbers, single letters, dotted', () => {
    expect(isNoisyTarget('{foo}')).toBe(true);
    expect(isNoisyTarget('"str"')).toBe(true);
    expect(isNoisyTarget("'str'")).toBe(true);
    expect(isNoisyTarget('(x)')).toBe(true);
    expect(isNoisyTarget('a => b')).toBe(true);
    expect(isNoisyTarget('123')).toBe(true);
    expect(isNoisyTarget('A')).toBe(true);
    expect(isNoisyTarget('foo.bar')).toBe(true);
  });
  it('does not flag clean identifiers', () => {
    expect(isNoisyTarget('FooBar')).toBe(false);
    expect(isNoisyTarget('abc')).toBe(false);
  });
});

describe('generateClassDefinition', () => {
  const entity: Entity = {
    id: 'e1',
    name: 'Foo',
    type: 'class',
    visibility: 'public',
    members: [
      { name: 'a', type: 'property', visibility: 'public', fieldType: 'number' },
      { name: 'b', type: 'method', visibility: 'private' },
    ],
    sourceLocation: { file: 'foo.ts', startLine: 1, endLine: 10 },
  };
  it('renders a class block including only included members', () => {
    const lines = generateClassDefinition(entity, 0, { includePrivate: false, includeProtected: false });
    expect(lines).toEqual(['class Foo {', '  +a: number', '}']);
  });
  it('renders with indent and includes private when requested', () => {
    const lines = generateClassDefinition(entity, 1, { includePrivate: true, includeProtected: true });
    // each indent level is two spaces
    expect(lines).toEqual(['  class Foo {', '    +a: number', '    -b()', '  }']);
  });
});

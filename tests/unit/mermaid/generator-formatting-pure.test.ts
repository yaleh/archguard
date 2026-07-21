import { describe, it, expect } from 'vitest';
import {
  normalizeEntityName,
  isNoisyTarget,
  getVisibilitySymbol,
  shouldIncludeMember,
} from '@/mermaid/generator-formatting.js';
import type { Member } from '@/types/index.js';

// ---------------------------------------------------------------------------
// normalizeEntityName
// Pure string normaliser — no direct unit tests exist (only tested through the
// full generator pipeline). These assertions exercise each distinct code path.
// ---------------------------------------------------------------------------
describe('normalizeEntityName', () => {
  it('strips import() wrapper and returns the qualified name', () => {
    expect(normalizeEntityName('import("/some/path").MyClass')).toBe('MyClass');
  });

  it('strips import() wrapper with nested dotted name', () => {
    expect(normalizeEntityName('import("/a/b").Foo.Bar')).toBe('Foo.Bar');
  });

  it('extracts last segment from import___ encoded name', () => {
    expect(normalizeEntityName('import___path___Widget')).toBe('Widget');
  });

  it('extracts class name scoped inside a .ts path', () => {
    expect(normalizeEntityName('src/parser/typescript-parser.ts.TypeScriptParser')).toBe(
      'TypeScriptParser'
    );
  });

  it('returns [Type] for anonymous object / arrow-function literals', () => {
    expect(normalizeEntityName('{ foo: string }')).toBe('[Type]');
    expect(normalizeEntityName('(x: number) => void')).toBe('[Type]');
  });

  it('returns the name unchanged when no special pattern matches', () => {
    expect(normalizeEntityName('MyPlainClass')).toBe('MyPlainClass');
  });

  it('returns empty string unchanged when input is empty', () => {
    expect(normalizeEntityName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isNoisyTarget
// Pure predicate — identifies targets that should be suppressed from diagrams.
// No existing test file imports or calls this function directly.
// ---------------------------------------------------------------------------
describe('isNoisyTarget', () => {
  it('flags object-literal targets (starts with {)', () => {
    expect(isNoisyTarget('{ foo: string }')).toBe(true);
  });

  it('flags string-literal targets (starts with ")', () => {
    expect(isNoisyTarget('"some-string"')).toBe(true);
  });

  it('flags string-literal targets (starts with \')', () => {
    expect(isNoisyTarget("'some-string'")).toBe(true);
  });

  it('flags targets starting with ( (tuple / function signature)', () => {
    expect(isNoisyTarget('(x: number) => string')).toBe(true);
  });

  it('flags arrow-function types containing =>', () => {
    expect(isNoisyTarget('Handler => void')).toBe(true);
  });

  it('flags targets starting with a digit', () => {
    expect(isNoisyTarget('42')).toBe(true);
  });

  it('flags single uppercase letters (generic type params)', () => {
    expect(isNoisyTarget('T')).toBe(true);
  });

  it('flags lowercase-prefixed dotted names (module-qualified identifiers)', () => {
    expect(isNoisyTarget('common.ring_buffer')).toBe(true);
  });

  it('does NOT flag a normal PascalCase class name', () => {
    expect(isNoisyTarget('MyService')).toBe(false);
  });

  it('does NOT flag a multi-word PascalCase with no leading dot', () => {
    expect(isNoisyTarget('TypeScriptParser')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getVisibilitySymbol
// Pure lookup — maps Member visibility strings to Mermaid symbols.
// ---------------------------------------------------------------------------
describe('getVisibilitySymbol', () => {
  it('returns + for public', () => {
    expect(getVisibilitySymbol('public')).toBe('+');
  });

  it('returns - for private', () => {
    expect(getVisibilitySymbol('private')).toBe('-');
  });

  it('returns # for protected', () => {
    expect(getVisibilitySymbol('protected')).toBe('#');
  });

  it('returns + as default for undefined / unknown visibility', () => {
    expect(getVisibilitySymbol(undefined as unknown as Member['visibility'])).toBe('+');
  });
});

// ---------------------------------------------------------------------------
// shouldIncludeMember
// Pure filtering predicate for visibility options.
// ---------------------------------------------------------------------------
describe('shouldIncludeMember', () => {
  const make = (visibility: Member['visibility']): Member =>
    ({ visibility, type: 'property', name: 'x' }) as Member;

  it('includes public members always', () => {
    expect(
      shouldIncludeMember(make('public'), { includePrivate: false, includeProtected: false })
    ).toBe(true);
  });

  it('excludes private members when includePrivate is false', () => {
    expect(
      shouldIncludeMember(make('private'), { includePrivate: false, includeProtected: true })
    ).toBe(false);
  });

  it('includes private members when includePrivate is true', () => {
    expect(
      shouldIncludeMember(make('private'), { includePrivate: true, includeProtected: false })
    ).toBe(true);
  });

  it('excludes protected members when includeProtected is false', () => {
    expect(
      shouldIncludeMember(make('protected'), { includePrivate: true, includeProtected: false })
    ).toBe(false);
  });

  it('includes protected members when includeProtected is true', () => {
    expect(
      shouldIncludeMember(make('protected'), { includePrivate: false, includeProtected: true })
    ).toBe(true);
  });
});

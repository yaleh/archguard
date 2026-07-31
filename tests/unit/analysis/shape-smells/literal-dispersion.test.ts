/**
 * Phase A: LiteralDispersionDetector — type extraction and dispersion mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  extractDiscriminatorTypes,
  scanFileForComparisons,
  detectDispersion,
} from '@/analysis/shape-smells/literal-dispersion';
import type { DiscriminatorType } from '@/analysis/shape-smells/types';

// ---------------------------------------------------------------------------
// extractDiscriminatorTypes
// ---------------------------------------------------------------------------

describe('extractDiscriminatorTypes', () => {
  it('returns empty array when no enums or string literal unions present', () => {
    const source = 'const x = 1;\nfunction foo() { return 42; }';
    const result = extractDiscriminatorTypes(source, 'test.ts');
    expect(result).toEqual([]);
  });

  it('extracts string literal unions like type X = "a" | "b"', () => {
    const source = 'type AppKind = "web" | "mobile" | "desktop";';
    const result = extractDiscriminatorTypes(source, 'types.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'AppKind',
      kind: 'string-literal-union',
      file: 'types.ts',
    });
    expect(result[0].values).toEqual(['web', 'mobile', 'desktop']);
  });

  it('extracts exported string literal unions', () => {
    const source = 'export type Status = "active" | "inactive";';
    const result = extractDiscriminatorTypes(source, 'types.ts');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Status');
    expect(result[0].values).toEqual(['active', 'inactive']);
  });

  it('extracts enums with string values', () => {
    const source = 'enum AppKind {\n  Web = "web",\n  Mobile = "mobile",\n}';
    const result = extractDiscriminatorTypes(source, 'enums.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'AppKind',
      kind: 'enum',
      file: 'enums.ts',
    });
    expect(result[0].values).toEqual(['web', 'mobile']);
  });

  it('extracts enums with bare members (auto member names as values)', () => {
    const source = 'enum Direction {\n  North,\n  South,\n  East,\n  West,\n}';
    const result = extractDiscriminatorTypes(source, 'enums.ts');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Direction');
    expect(result[0].values).toEqual(['North', 'South', 'East', 'West']);
  });

  it('ignores interfaces and classes (not discriminator types)', () => {
    const source = `
      interface Foo { bar: string; }
      class Baz { qux() {} }
    `;
    const result = extractDiscriminatorTypes(source, 'test.ts');
    expect(result).toEqual([]);
  });

  it('reports the correct line number for each type declaration', () => {
    const source = '\n\ntype Color = "red" | "green";';
    const result = extractDiscriminatorTypes(source, 'colors.ts');
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
  });

  it('handles multiple types in the same file', () => {
    const source = `
      type Kind = "a" | "b";
      enum Status { Active = "active", Inactive = "inactive" }
    `;
    const result = extractDiscriminatorTypes(source, 'multi.ts');
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('string-literal-union');
    expect(result[1].kind).toBe('enum');
  });

  it('handles single-value string literal union', () => {
    const source = 'type Single = "only";';
    const result = extractDiscriminatorTypes(source, 'single.ts');
    expect(result).toHaveLength(1);
    expect(result[0].values).toEqual(['only']);
  });
});

// ---------------------------------------------------------------------------
// scanFileForComparisons
// ---------------------------------------------------------------------------

describe('scanFileForComparisons', () => {
  it('returns empty array when no comparisons found', () => {
    const source = 'const x = 1;\nconsole.log("hello");';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toEqual([]);
  });

  it('finds === "v" comparisons with correct line numbers', () => {
    const source = 'if (kind === "web")\n  doThing();';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'test.ts', line: 1 });
  });

  it('finds "v" === comparisons with correct line numbers', () => {
    const source = 'if ("mobile" === kind)\n  doThing();';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'test.ts', line: 1 });
  });

  it('finds case "v": patterns with correct line numbers', () => {
    const source = 'switch (kind) {\ncase "desktop":\n  break;\n}';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'test.ts', line: 2 });
  });

  it('finds case X.V: patterns with correct line numbers', () => {
    const source = 'switch (kind) {\ncase AppKind.Web:\n  break;\n}';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'test.ts', line: 2 });
  });

  it('finds multiple comparisons on different lines', () => {
    const source = [
      'if (kind === "a") return 1;',
      'if (kind === "b") return 2;',
      'if (kind === "c") return 3;',
    ].join('\n');
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it('returns empty when no comparison operators or case statements exist', () => {
    const source = 'const kind = AppKind.Web;\n// just a comment';
    const result = scanFileForComparisons(source, 'test.ts');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectDispersion
// ---------------------------------------------------------------------------

describe('detectDispersion', () => {
  const makeType = (overrides: Partial<DiscriminatorType> = {}): DiscriminatorType => ({
    name: 'AppKind',
    values: ['web', 'mobile', 'desktop'],
    kind: 'enum',
    file: 'types.ts',
    line: 1,
    ...overrides,
  });

  it('returns empty when all values appear in only 1 file', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web", Mobile = "mobile", Desktop = "desktop" }'],
      ['capture.ts', 'const x = 1;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toEqual([]);
  });

  it('reports smell with dispersion=2 when a value spans 2 files', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web", Mobile = "mobile" }'],
      ['capture.ts', 'if (kind === "web") return;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toHaveLength(1);

    const smell = result.find((s) => s.value === 'web');
    expect(smell).toBeDefined();
    expect(smell.dispersion).toBe(2);
    expect(smell.severity).toBe('info');
    expect(smell.files).toEqual(['capture.ts', 'types.ts']);
  });

  it('assigns severity "info" at dispersion=2', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web" }'],
      ['other.ts', 'if (kind === "web") return;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
    expect(result[0].dispersion).toBe(2);
  });

  it('assigns severity "warning" at dispersion >= 3', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web" }'],
      ['a.ts', 'if (kind === "web") return;'],
      ['b.ts', 'if (kind === "web") return;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
    expect(result[0].dispersion).toBe(3);
  });

  it('reports independent smells per value', () => {
    const types = [makeType({ values: ['web', 'mobile'] })];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web", Mobile = "mobile" }'],
      ['a.ts', 'if (kind === "web") return;'],
      ['b.ts', 'if (kind === "mobile") return;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toHaveLength(2);

    const webSmell = result.find((s) => s.value === 'web');
    expect(webSmell.dispersion).toBe(2);
    expect(webSmell.severity).toBe('info');

    const mobileSmell = result.find((s) => s.value === 'mobile');
    expect(mobileSmell.dispersion).toBe(2);
    expect(mobileSmell.severity).toBe('info');
  });

  it('includes per-file line locations in smells', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web" }'],
      ['capture.ts', 'if (kind === "web") return;'],
    ]);

    const result = detectDispersion(types, fileContents);
    expect(result).toHaveLength(1);

    const locations = result[0].locations;
    expect(locations).toHaveLength(2);
    expect(locations[0]).toMatchObject({ file: 'types.ts', line: 1 });
    expect(locations[1]).toMatchObject({ file: 'capture.ts', line: 1 });
  });

  it('threshold parameter suppresses smells below the threshold', () => {
    const types = [makeType()];
    const fileContents = new Map([
      ['types.ts', 'enum AppKind { Web = "web" }'],
      ['a.ts', 'if (kind === "web") return;'],
    ]);

    // Default threshold of 2 should report this
    const resultDefault = detectDispersion(types, fileContents);
    expect(resultDefault).toHaveLength(1);

    // threshold of 3 should suppress it
    const resultHigh = detectDispersion(types, fileContents, { threshold: 3 });
    expect(resultHigh).toEqual([]);
  });

  it('detects dispersion from string literal unions', () => {
    const types: DiscriminatorType[] = [
      {
        name: 'Mode',
        values: ['read', 'write'],
        kind: 'string-literal-union',
        file: 'modes.ts',
        line: 1,
      },
    ];

    const fileContents = new Map([
      ['modes.ts', 'type Mode = "read" | "write";'],
      ['handler.ts', 'if (mode === "read") return true;'],
      ['logger.ts', 'if (mode === "write") log();'],
    ]);

    const result = detectDispersion(types, fileContents);
    // "read" appears in modes.ts + handler.ts = 2 files
    // "write" appears in modes.ts + logger.ts = 2 files
    expect(result).toHaveLength(2);
  });
});

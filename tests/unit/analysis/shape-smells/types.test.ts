/**
 * Type-check tests for shape-smell types.
 *
 * These tests verify that the exported type shapes compile correctly
 * and that factory objects conform to the interfaces.
 */

import { describe, it, expect } from 'vitest';
import type {
  SourceLocation,
  DiscriminatorType,
  LiteralDispersionSmell,
  ShapeSmellManifest,
  ShapeSmellResult,
  ShapeSmellAnalysis,
} from '@/analysis/shape-smells/types';

describe('shape-smell types', () => {
  it('SourceLocation shape', () => {
    const loc: SourceLocation = { file: 'a.ts', line: 42 };
    expect(loc.file).toBe('a.ts');
    expect(loc.line).toBe(42);
  });

  it('DiscriminatorType shape', () => {
    const dt: DiscriminatorType = {
      name: 'AppKind',
      values: ['web', 'mobile'],
      kind: 'enum',
      file: 'types.ts',
      line: 7,
    };
    expect(dt.name).toBe('AppKind');
    expect(dt.values).toEqual(['web', 'mobile']);
    expect(dt.kind).toBe('enum');
    expect(dt.file).toBe('types.ts');
    expect(dt.line).toBe(7);
  });

  it('DiscriminatorType allows string-literal-union kind', () => {
    const dt: DiscriminatorType = {
      name: 'Mode',
      values: ['read', 'write'],
      kind: 'string-literal-union',
      file: 'modes.ts',
      line: 1,
    };
    expect(dt.kind).toBe('string-literal-union');
  });

  it('LiteralDispersionSmell shape', () => {
    const smell: LiteralDispersionSmell = {
      typeName: 'AppKind',
      value: 'web',
      files: ['a.ts', 'b.ts'],
      dispersion: 2,
      severity: 'info',
      locations: [
        { file: 'a.ts', line: 10 },
        { file: 'b.ts', line: 5 },
      ],
    };
    expect(smell.dispersion).toBe(2);
    expect(smell.severity).toBe('info');
    expect(smell.files).toHaveLength(2);
    expect(smell.locations).toHaveLength(2);
  });

  it('LiteralDispersionSmell with warning severity', () => {
    const smell: LiteralDispersionSmell = {
      typeName: 'Status',
      value: 'active',
      files: ['x.ts', 'y.ts', 'z.ts'],
      dispersion: 3,
      severity: 'warning',
      locations: [],
    };
    expect(smell.severity).toBe('warning');
    expect(smell.dispersion).toBe(3);
  });

  it('ShapeSmellManifest shape', () => {
    const manifest: ShapeSmellManifest = {
      version: '1',
      generatedAt: '2026-07-31T00:00:00Z',
      totalSmells: 3,
      bySeverity: { info: 2, warning: 1 },
    };
    expect(manifest.totalSmells).toBe(3);
    expect(manifest.bySeverity.info).toBe(2);
    expect(manifest.bySeverity.warning).toBe(1);
  });

  it('ShapeSmellResult shape with literal-dispersion layer', () => {
    const result: ShapeSmellResult = {
      layer: 'literal-dispersion',
      smells: [],
    };
    expect(result.layer).toBe('literal-dispersion');
    expect(result.smells).toEqual([]);
  });

  it('ShapeSmellResult shape with diagnostic for unimplemented layer', () => {
    const result: ShapeSmellResult = {
      layer: 'hidden-coupling',
      smells: [],
      diagnostic: 'Layer 2 (hidden-coupling) not yet implemented.',
    };
    expect(result.diagnostic).toBeTruthy();
  });

  it('ShapeSmellAnalysis shape', () => {
    const analysis: ShapeSmellAnalysis = {
      manifest: {
        version: '1',
        generatedAt: '2026-07-31T00:00:00Z',
        totalSmells: 1,
        bySeverity: { info: 1, warning: 0 },
      },
      results: [{ layer: 'literal-dispersion', smells: [] }],
    };
    expect(analysis.results).toHaveLength(1);
    expect(analysis.manifest.bySeverity.info).toBe(1);
  });
});

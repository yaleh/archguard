/**
 * Unit tests for ArchJsonMapper diagnostics aggregation (P1/P2-1).
 *
 * Per-file parse degradation (extract_error / syntax_error) recorded by the
 * bridge must flow into ArchJSON.diagnostics so CLI/MCP consumers can detect a
 * partial result instead of a clean one.
 */
import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/dart/archjson-mapper.js';
import type { RawDartFile } from '@/plugins/dart/types.js';

describe('ArchJsonMapper diagnostics aggregation', () => {
  it('aggregates per-file diagnostics into ArchJSON.diagnostics', () => {
    const mapper = new ArchJsonMapper();
    const files: RawDartFile[] = [
      {
        filePath: '/a.dart',
        packageName: '',
        imports: [],
        classes: [],
        diagnostics: [{ filePath: '/a.dart', kind: 'extract_error', message: 'boom' }],
      },
      { filePath: '/b.dart', packageName: '', imports: [], classes: [] },
    ];
    const arch = mapper.map(files, '', '/proj', new Map());
    expect(arch.diagnostics).toHaveLength(1);
    expect(arch.diagnostics?.[0].kind).toBe('extract_error');
    expect(arch.diagnostics?.[0].filePath).toBe('/a.dart');
  });

  it('omits diagnostics when no file degraded', () => {
    const mapper = new ArchJsonMapper();
    const files: RawDartFile[] = [
      { filePath: '/a.dart', packageName: '', imports: [], classes: [] },
    ];
    const arch = mapper.map(files, '', '/proj', new Map());
    expect(arch.diagnostics).toBeUndefined();
  });
});

describe('ArchJsonMapper Dart package IDs', () => {
  it('uses the nearest pubspec package name for entity and relation IDs', () => {
    const mapper = new ArchJsonMapper();
    const files: RawDartFile[] = [
      {
        filePath: '/repo/packages/a/lib/a.dart',
        packageName: '',
        imports: [],
        classes: [
          {
            name: 'A',
            kind: 'class',
            visibility: 'public',
            mixins: [],
            interfaces: [],
            members: [],
            filePath: '/repo/packages/a/lib/a.dart',
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    ];
    const arch = mapper.map(files, '', '/repo', new Map([['package_a', '/repo/packages/a']]));
    expect(arch.entities[0]?.id).toBe('package_a.A');
  });
});

/**
 * Tests for PythonImportExtractor (Phase 38E)
 *
 * Verifies that inter-package import relations are correctly extracted
 * from Python import statements.
 */
import { describe, it, expect } from 'vitest';
import { PythonImportExtractor } from '@/plugins/python/import-extractor.js';
import type { PythonRawImport } from '@/plugins/python/types.js';

function makeKnown(...moduleIds: string[]): Set<string> {
  return new Set(moduleIds);
}

// ---------------------------------------------------------------------------
// Basic absolute imports
// ---------------------------------------------------------------------------

describe('PythonImportExtractor – absolute imports', () => {
  const extractor = new PythonImportExtractor();

  it('extracts relation for `import lmdeploy.messages` when module is known', () => {
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.messages' }];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceModuleId: 'lmdeploy.pytorch.models',
      targetModuleId: 'lmdeploy.messages',
    });
  });

  it('extracts relation for `from lmdeploy.messages import Foo` when module is known', () => {
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.messages' }];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.layers', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('lmdeploy.messages');
  });

  it('does not create relation for `import torch` when torch is not in knownModuleIds', () => {
    const imports: PythonRawImport[] = [{ module: 'torch' }];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(0);
  });

  it('does not create a self-import relation', () => {
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.pytorch.models' }];
    const known = makeKnown('lmdeploy.pytorch.models');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(0);
  });

  it('does not create relation for __future__ import', () => {
    const imports: PythonRawImport[] = [{ module: '__future__' }];
    const known = makeKnown('__future__');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(0);
  });

  it('handles multiple imports and creates multiple relations', () => {
    const imports: PythonRawImport[] = [
      { module: 'lmdeploy.messages' },
      { module: 'lmdeploy.utils' },
      { module: 'torch' },
    ];
    const known = makeKnown('lmdeploy.messages', 'lmdeploy.utils');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(2);
    const targets = result.map((r) => r.targetModuleId);
    expect(targets).toContain('lmdeploy.messages');
    expect(targets).toContain('lmdeploy.utils');
  });

  it('deduplicates when same module appears twice in imports', () => {
    const imports: PythonRawImport[] = [
      { module: 'lmdeploy.messages' },
      { module: 'lmdeploy.messages' },
    ];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Relative imports
// ---------------------------------------------------------------------------

describe('PythonImportExtractor – relative imports', () => {
  const extractor = new PythonImportExtractor();

  it('resolves `from . import utils` in lmdeploy.pytorch.models → lmdeploy.pytorch.utils', () => {
    // Relative import: module = '.utils' or module represented with leading dot
    const imports: PythonRawImport[] = [{ module: '.utils' }];
    const known = makeKnown('lmdeploy.pytorch.utils');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('lmdeploy.pytorch.utils');
  });

  it('resolves `from .. import messages` in lmdeploy.pytorch.models → lmdeploy.messages', () => {
    const imports: PythonRawImport[] = [{ module: '..messages' }];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('lmdeploy.messages');
  });

  it('resolves `from .ops import attention` in lmdeploy.pytorch.layers → lmdeploy.pytorch.ops', () => {
    const imports: PythonRawImport[] = [{ module: '.ops' }];
    const known = makeKnown('lmdeploy.pytorch.ops');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.layers', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('lmdeploy.pytorch.ops');
  });

  it('skips relative import when resolved target is not in knownModuleIds', () => {
    const imports: PythonRawImport[] = [{ module: '.unknown_module' }];
    const known = makeKnown('lmdeploy.messages');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(0);
  });

  it('handles single dot (from . import something) — resolves to parent package', () => {
    // '.' means current package; no suffix
    const imports: PythonRawImport[] = [{ module: '.' }];
    // The resolved target for '.' in 'lmdeploy.pytorch.models' is 'lmdeploy.pytorch'
    const known = makeKnown('lmdeploy.pytorch');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('lmdeploy.pytorch');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('PythonImportExtractor – edge cases', () => {
  const extractor = new PythonImportExtractor();

  it('returns empty array when imports list is empty', () => {
    const result = extractor.extract([], 'myapp.core', makeKnown('myapp.utils'));
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no imports match knownModuleIds', () => {
    const imports: PythonRawImport[] = [
      { module: 'os' },
      { module: 'sys' },
      { module: 'typing' },
    ];
    const known = makeKnown('myapp.core', 'myapp.utils');
    const result = extractor.extract(imports, 'myapp.models', known);
    expect(result).toHaveLength(0);
  });

  it('sourceModuleId is always the currentModuleId', () => {
    const imports: PythonRawImport[] = [
      { module: 'lmdeploy.messages' },
      { module: 'lmdeploy.utils' },
    ];
    const known = makeKnown('lmdeploy.messages', 'lmdeploy.utils');
    const result = extractor.extract(imports, 'lmdeploy.pytorch.models', known);
    for (const rel of result) {
      expect(rel.sourceModuleId).toBe('lmdeploy.pytorch.models');
    }
  });
});

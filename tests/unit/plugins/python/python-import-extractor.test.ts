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
// Project-root prefix stripping (absolute imports with package root prefix)
// ---------------------------------------------------------------------------

describe('PythonImportExtractor – project root prefix stripping', () => {
  const extractor = new PythonImportExtractor();

  /**
   * Scenario: sources dir is /lmdeploy/lmdeploy/ (workspaceRoot = that dir).
   * Known module IDs are relative to that root, e.g. "pytorch.engine.engine".
   * But Python code inside the project uses absolute imports:
   *   from lmdeploy.pytorch.engine import X
   * The raw import module is "lmdeploy.pytorch.engine", but the known ID is
   * "pytorch.engine" (or "pytorch.engine.engine"). The first dotted component
   * "lmdeploy" is the project root package and must be stripped.
   */
  it('resolves cross-package import when import has project root prefix not in knownModuleIds', () => {
    // from mypackage.submodule import X
    // workspaceRoot = /path/to/mypackage/, so known IDs have no "mypackage." prefix
    const imports: PythonRawImport[] = [{ module: 'mypackage.submodule' }];
    const known = makeKnown('submodule'); // known ID lacks "mypackage." prefix
    const result = extractor.extract(imports, 'mypackage.core', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('submodule');
  });

  it('resolves deep absolute import by stripping project root prefix', () => {
    // from lmdeploy.pytorch.engine.engine import LlamaForCausalLM
    // knownModuleIds: pytorch.engine.engine (relative to lmdeploy/ sources dir)
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.pytorch.engine.engine' }];
    const known = makeKnown('pytorch.engine.engine', 'serve.server');
    const result = extractor.extract(imports, 'pytorch.layers.linear', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('pytorch.engine.engine');
  });

  it('still resolves when the import needs both prefix stripping and right-side truncation', () => {
    // from lmdeploy.pytorch.engine import SomeClass (imports the package, not a submodule)
    // knownModuleIds: pytorch.engine (not pytorch.engine.SomeClass)
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.pytorch.engine' }];
    const known = makeKnown('pytorch.engine', 'pytorch.layers');
    const result = extractor.extract(imports, 'pytorch.serve.server', known);
    expect(result).toHaveLength(1);
    expect(result[0].targetModuleId).toBe('pytorch.engine');
  });

  it('does not strip prefix when it would produce a self-import', () => {
    // source module is "submodule", import is "mypackage.submodule" → strips to "submodule" = self
    const imports: PythonRawImport[] = [{ module: 'mypackage.submodule' }];
    const known = makeKnown('submodule');
    const result = extractor.extract(imports, 'submodule', known);
    expect(result).toHaveLength(0);
  });

  it('returns empty when no prefix-stripped candidate is in knownModuleIds', () => {
    const imports: PythonRawImport[] = [{ module: 'lmdeploy.nonexistent.module' }];
    const known = makeKnown('pytorch.engine', 'serve.server');
    const result = extractor.extract(imports, 'pytorch.layers', known);
    expect(result).toHaveLength(0);
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
    const imports: PythonRawImport[] = [{ module: 'os' }, { module: 'sys' }, { module: 'typing' }];
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

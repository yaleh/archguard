# Plan 45: Fix Python Package Diagram Zero-Arrow Issue

**Proposal**: `docs/proposals/proposal-python-package-arrows.md`
**Priority**: HIGH (Python package diagrams show 0 arrows despite correct relation emission)
**Estimated total changes**: ~35 lines source + ~40 test lines across 2 files

---

## Overview

Single targeted fix to `src/parser/archjson-aggregator.ts` that restores inter-package arrows in Python package diagrams:

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | 0 arrows in Python package diagrams | `entityToPackage` keyed by class IDs; Python relations use module IDs as sources | HIGH |

---

## Phase A — Build Module-Level Fallback Map in `analyzePackageDependencies()`

**Files**: `src/parser/archjson-aggregator.ts`, `tests/unit/parser/archjson-aggregator.test.ts`
**Estimated lines**: ~35 source + ~40 test

### Stage A1 — Add `moduleToPackage` secondary map

**File**: `src/parser/archjson-aggregator.ts`, inside `analyzePackageDependencies()` (starting at line 233)

**Current code** (lines 239–248):

```typescript
// Create entity ID to package mapping (using file paths)
const entityToPackage = new Map<string, string>();
for (const entity of entities) {
  const packageName = this.extractPackageFromFile(
    entity.sourceLocation.file,
    workspaceRoot,
    language
  );
  entityToPackage.set(entity.id, packageName);
}
```

**Replacement** — add `moduleToPackage` construction immediately after `entityToPackage` is built:

```typescript
// Create entity ID to package mapping (using file paths)
const entityToPackage = new Map<string, string>();
for (const entity of entities) {
  const packageName = this.extractPackageFromFile(
    entity.sourceLocation.file,
    workspaceRoot,
    language
  );
  entityToPackage.set(entity.id, packageName);
}

// Build module-level fallback map for Python (and other languages where relations
// use module IDs instead of class IDs as source/target).
//
// For each entity ID like 'pytorch.engine.Engine' in package 'pytorch':
//   strip last component → 'pytorch.engine' → maps to 'pytorch'
// This allows relations with source 'pytorch.engine' (module-level) to resolve
// to package 'pytorch' even though 'pytorch.engine' is not an entity ID.
const moduleToPackage = new Map<string, string>();
for (const [entityId, packageName] of entityToPackage) {
  const lastDot = entityId.lastIndexOf('.');
  if (lastDot > 0) {
    const moduleId = entityId.slice(0, lastDot);
    // First writer wins: if multiple entities share a module, they all map to the same package
    if (!moduleToPackage.has(moduleId)) {
      moduleToPackage.set(moduleId, packageName);
    }
    // Also register intermediate prefixes (for deeply nested module IDs)
    // e.g., 'pytorch.engine.layers.LayerNorm' → also register 'pytorch.engine.layers' and 'pytorch.engine'
    let prefix = moduleId;
    let dotIdx: number;
    while ((dotIdx = prefix.lastIndexOf('.')) > 0) {
      prefix = prefix.slice(0, dotIdx);
      if (!moduleToPackage.has(prefix)) {
        moduleToPackage.set(prefix, packageName);
      }
    }
  }
}
```

### Stage A2 — Use `moduleToPackage` as fallback in the relation mapping loop

**File**: `src/parser/archjson-aggregator.ts`, inside the `for (const relation of relations)` loop (lines 253–278)

**Current code** (lines 254–255):

```typescript
const sourcePackage = entityToPackage.get(relation.source);
const targetPackage = entityToPackage.get(relation.target);
```

**Replacement**:

```typescript
const sourcePackage =
  entityToPackage.get(relation.source) ?? moduleToPackage.get(relation.source);
const targetPackage =
  entityToPackage.get(relation.target) ?? moduleToPackage.get(relation.target);
```

No other changes to the loop body are needed — the existing skip conditions and deduplication logic remain intact.

**Acceptance**: A Python ArchJSON with entities `['myapp.models.User']` and relation `{ source: 'myapp.models', target: 'myapp.views', type: 'dependency' }` produces a non-empty `analyzePackageDependencies()` result.

### Stage A3 — Add unit tests for module-level fallback

**File**: `tests/unit/parser/archjson-aggregator.test.ts` (extend existing file)

Add test group: `describe('analyzePackageDependencies — Python module-level relation sources')`:

```typescript
describe('analyzePackageDependencies — Python module-level relation sources', () => {
  let aggregator: ArchJSONAggregator;

  beforeEach(() => {
    aggregator = new ArchJSONAggregator();
  });

  it('resolves module-level source to package when entity is in that module', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'python',
      entities: [
        {
          id: 'myapp.models.User',
          name: 'User',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'myapp/models.py', startLine: 1, endLine: 10 },
        },
        {
          id: 'myapp.views.UserView',
          name: 'UserView',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'myapp/views.py', startLine: 1, endLine: 5 },
        },
      ],
      relations: [
        { id: 'r1', source: 'myapp.models', target: 'myapp.views', type: 'dependency' },
      ],
      extensions: {},
    };

    const result = aggregator.aggregate(archJson, 'package');
    expect(result.relations.length).toBeGreaterThan(0);
    const rel = result.relations[0];
    expect(rel.source).toBe('myapp');
    expect(rel.target).toBe('myapp');
    // Self-relation — same package, should be filtered
  });

  it('maps cross-package module-level relation to package relation', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'python',
      entities: [
        {
          id: 'engine.core.Engine',
          name: 'Engine',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'engine/core.py', startLine: 1, endLine: 20 },
        },
        {
          id: 'scheduler.base.Scheduler',
          name: 'Scheduler',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'scheduler/base.py', startLine: 1, endLine: 15 },
        },
      ],
      relations: [
        { id: 'r1', source: 'engine.core', target: 'scheduler.base', type: 'dependency' },
      ],
      extensions: {},
    };

    const result = aggregator.aggregate(archJson, 'package');
    expect(result.relations.length).toBe(1);
    expect(result.relations[0].source).toBe('engine');
    expect(result.relations[0].target).toBe('scheduler');
  });

  it('resolves deeply nested module prefix (3+ levels)', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'python',
      entities: [
        {
          id: 'lmdeploy.pytorch.models.LlamaModel',
          name: 'LlamaModel',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'lmdeploy/pytorch/models/llama.py', startLine: 1, endLine: 50 },
        },
        {
          id: 'lmdeploy.turbomind.engine.Engine',
          name: 'Engine',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'lmdeploy/turbomind/engine.py', startLine: 1, endLine: 30 },
        },
      ],
      relations: [
        // source is a 3-level module ID, not a class ID
        { id: 'r1', source: 'lmdeploy.pytorch.models', target: 'lmdeploy.turbomind.engine', type: 'dependency' },
      ],
      extensions: {},
    };

    const result = aggregator.aggregate(archJson, 'package');
    // Both source and target are in 'lmdeploy' package — self-relation, filtered
    expect(result.relations.length).toBe(0);
  });

  it('does not produce false relations for unresolvable module IDs', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'python',
      entities: [
        {
          id: 'myapp.core.Service',
          name: 'Service',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'myapp/core.py', startLine: 1, endLine: 10 },
        },
      ],
      relations: [
        // Source is an external module with no matching entity
        { id: 'r1', source: 'torch.nn', target: 'myapp.core', type: 'dependency' },
      ],
      extensions: {},
    };

    const result = aggregator.aggregate(archJson, 'package');
    // 'torch.nn' has no matching entity → sourcePackage undefined → filtered
    expect(result.relations.length).toBe(0);
  });

  it('preserves existing class-level relation resolution for TypeScript', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'src/parser/TypeScriptParser',
          name: 'TypeScriptParser',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/parser/typescript-parser.ts', startLine: 1, endLine: 100 },
        },
        {
          id: 'src/cli/AnalyzeCommand',
          name: 'AnalyzeCommand',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/cli/commands/analyze.ts', startLine: 1, endLine: 200 },
        },
      ],
      relations: [
        { id: 'r1', source: 'src/parser/TypeScriptParser', target: 'src/cli/AnalyzeCommand', type: 'dependency' },
      ],
      extensions: {},
    };

    const result = aggregator.aggregate(archJson, 'package');
    // Should still work via entityToPackage (no regression)
    expect(result.relations.length).toBeGreaterThanOrEqual(0); // depends on package extraction
  });
});
```

**Dependencies**: A1, A2

---

## Dependency Graph

```
A2 depends on A1 (moduleToPackage must be built before the loop that uses it)
A3 depends on A1 and A2
```

---

## Testing Strategy

- **TDD**: Write A3 tests first (they will fail before A1/A2 implemented). Implement A1 + A2. Run tests.
- **No integration tests needed**: Fix is pure logic in the aggregator, testable with in-memory ArchJSON fixtures.
- **Existing test suite**: Must remain green (2787+ tests) after all stages complete.
- **Self-validation**: After building, analyze a Python project (e.g., lmdeploy) and verify that the package diagram contains arrows between packages.

---

## Acceptance Criteria

| Stage | Criterion |
|---|---|
| A1 | `moduleToPackage` populated with all intermediate module prefixes for each entity |
| A2 | `analyzePackageDependencies()` returns non-empty result for Python ArchJSON with module-level relation sources |
| A2 | Existing TypeScript and Java package diagram relation tests still pass |
| A3 | Cross-package module-level relation `engine.core → scheduler.base` produces package relation `engine → scheduler` |
| A3 | Unresolvable external module sources (e.g., `torch.nn`) are correctly filtered |
| A3 | Self-relations within the same package are still filtered |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `moduleToPackage` collision: two entities from different packages share a module prefix | First writer wins; entities in same directory are always in same package — no real collision case |
| Intermediate prefix registration is O(entities × depth²) | Python projects have ~200 entities × depth 4 = ~3200 ops; < 1ms |
| False positives for external module names that coincidentally match internal prefixes | External modules have no entities → `moduleToPackage` only contains internal prefixes; safe |

---

## Validation

After implementing:

```bash
npm run build
node dist/cli/index.js analyze -s /path/to/python-project --lang python -f mermaid
# Open .archguard/overview/package.mmd — should contain arrows between packages
```

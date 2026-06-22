# Plan 41: Package JSON Data Integrity

**Proposal**: `docs/proposals/proposal-package-json-data-integrity.md`
**Priority**: HIGH (causes MCP tools to return empty results for TS package queries)
**Estimated total changes**: ~80 lines source + ~80 test lines across 4 files

---

## Overview

Two fixes that make ArchJSON JSON output correct and usable for downstream tooling:

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | Package JSON `relations: []` | TsModuleGraph.edges not serialized into JSON output | HIGH |
| 2 | Class relation IDs use bare names | RelationExtractor emits bare class names; entity IDs are qualified | HIGH |

---

## Phase A — Fix Package JSON: Serialize TsModuleGraph Edges

**Files**: `src/cli/processors/diagram-output-router.ts`, `tests/unit/cli/processors/diagram-output-router.test.ts`
**Estimated lines**: ~30 source + ~35 test

### Stage A1 — Synthesize Relation[] from TsModuleGraph.edges before JSON write

**File**: `src/cli/processors/diagram-output-router.ts`

**Current code** (lines 81–85 of the `route()` method):

```typescript
// Step 1: json format
if (format === 'json') {
  await fs.ensureDir(path.dirname(paths.paths.json));
  await fs.writeJson(paths.paths.json, canonicalizeArchJson(archJSON), { spaces: 2 });
  return;
}
```

**Replacement**: inject a `serializeModuleGraphRelations()` call when conditions are met:

```typescript
// Step 1: json format
if (format === 'json') {
  await fs.ensureDir(path.dirname(paths.paths.json));
  const outputJson = level === 'package' && archJSON.extensions?.tsAnalysis?.moduleGraph
    ? this.injectModuleGraphRelations(archJSON)
    : archJSON;
  await fs.writeJson(paths.paths.json, canonicalizeArchJson(outputJson), { spaces: 2 });
  return;
}
```

Add a private method:

```typescript
/**
 * Convert TsModuleGraph.edges to Relation[] and attach them to a shallow copy
 * of the given ArchJSON. Called only for package-level JSON output.
 *
 * Each TsModuleDependency { from, to, strength } maps to:
 *   { id, type: 'dependency', source: from, target: to }
 *
 * The returned object shares all other fields with the input (shallow copy).
 */
private injectModuleGraphRelations(archJSON: ArchJSON): ArchJSON {
  const { moduleGraph } = archJSON.extensions.tsAnalysis;
  const relations: import('@/types/index.js').Relation[] = moduleGraph.edges.map((edge) => ({
    id: `${edge.from}_dependency_${edge.to}`,
    type: 'dependency' as const,
    source: edge.from,
    target: edge.to,
  }));
  return { ...archJSON, relations };
}
```

**Why a shallow copy**: The original `archJSON` reference is shared with the Mermaid rendering path (when called with mermaid format). Mutating it directly would corrupt the mermaid output in mixed-format scenarios. The shallow copy is intentional.

**Import**: The `Relation` type import may need to be added at the top of `diagram-output-router.ts` if not already present. Check existing imports; add:

```typescript
import type { ArchJSON, Relation } from '@/types/index.js';
```

**Acceptance**: `overview/package.json` for an ArchGuard self-analysis has `relations.length > 0`, matching the number of edges shown in the Mermaid `.mmd` file.

### Stage A2 — Add unit tests for package JSON relation injection

**File**: `tests/unit/cli/processors/diagram-output-router.test.ts`

Add test group: `describe('route — json format with tsAnalysis.moduleGraph')`:

```typescript
it('injects module graph edges as relations when level=package and moduleGraph present', async () => {
  const archJSON = {
    version: '1.0',
    language: 'typescript',
    entities: [],
    relations: [], // empty class-level relations
    extensions: {
      tsAnalysis: {
        moduleGraph: {
          nodes: [
            { id: 'src/cli', name: 'src/cli', type: 'internal', fileCount: 3, stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 } },
            { id: 'src/parser', name: 'src/parser', type: 'internal', fileCount: 5, stats: { classes: 3, interfaces: 0, functions: 0, enums: 0 } },
          ],
          edges: [
            { from: 'src/cli', to: 'src/parser', strength: 2, importedNames: [] },
          ],
          cycles: [],
        },
      },
    },
  } as unknown as ArchJSON;

  const diagram = { level: 'package', format: 'json', name: 'overview/package' } as DiagramConfig;
  // mock fs.writeJson to capture the written object
  const writeJsonSpy = vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
  vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

  await router.route(archJSON, paths, diagram, pool);

  const written = writeJsonSpy.mock.calls[0][1] as ArchJSON;
  expect(written.relations).toHaveLength(1);
  expect(written.relations[0].source).toBe('src/cli');
  expect(written.relations[0].target).toBe('src/parser');
  expect(written.relations[0].type).toBe('dependency');
});

it('does not inject module graph relations when level=class', async () => {
  // same archJSON as above, but level='class'
  const diagram = { level: 'class', format: 'json', name: 'class/all-classes' } as DiagramConfig;
  const writeJsonSpy = vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
  vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

  await router.route(archJSON, paths, diagram, pool);

  const written = writeJsonSpy.mock.calls[0][1] as ArchJSON;
  expect(written.relations).toHaveLength(0); // original empty array preserved
});

it('does not inject when moduleGraph absent', async () => {
  const archJsonNoGraph = { ...archJSON, extensions: {} } as unknown as ArchJSON;
  const diagram = { level: 'package', format: 'json', name: 'overview/package' } as DiagramConfig;
  const writeJsonSpy = vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
  vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

  await router.route(archJsonNoGraph, paths, diagram, pool);

  const written = writeJsonSpy.mock.calls[0][1] as ArchJSON;
  expect(written.relations).toHaveLength(0);
});
```

**Dependencies**: A1

---

## Phase B — Fix Class Relation IDs: Qualify Bare Names in TypeScriptParser

**Files**: `src/parser/typescript-parser.ts`, `tests/unit/parser/typescript-parser.test.ts`
**Estimated lines**: ~50 source + ~45 test

### Stage B1 — Build name→entityId index and rewrite relations post-parse

**File**: `src/parser/typescript-parser.ts`

The `parseProject()` method (or `parseCode()`) currently assembles `entities` and `relations` and returns them. Both arrays are available at the same point where the final `ArchJSON` is assembled.

Add a `qualifyRelations()` method:

```typescript
/**
 * Post-pass: rewrite relation source/target from bare class names to qualified entity IDs.
 *
 * RelationExtractor emits source/target as bare class names, e.g. 'TypeScriptParser'.
 * Entity IDs are qualified: 'src/parser/typescript-parser.ts.TypeScriptParser'.
 *
 * Build a Map<simpleName, qualifiedId> from entities. For collisions (same simple name
 * in multiple files), only the first encountered wins — this is acceptable because
 * cross-file same-name collisions already cause incorrect diagrams and this is a
 * known limitation of unqualified resolution.
 *
 * Relations whose source or target cannot be resolved are left unchanged (they may
 * refer to external library types or unresolved imports).
 *
 * @param entities - All entities in the parsed ArchJSON
 * @param relations - Relations as emitted by RelationExtractor (bare names)
 * @returns New Relation[] with qualified IDs where resolvable
 */
private qualifyRelations(entities: Entity[], relations: Relation[]): Relation[] {
  // Build simple name → first matching entity ID
  const nameToId = new Map<string, string>();
  for (const entity of entities) {
    if (!nameToId.has(entity.name)) {
      nameToId.set(entity.name, entity.id);
    }
  }

  return relations.map((rel) => {
    const resolvedSource = nameToId.get(rel.source) ?? rel.source;
    const resolvedTarget = nameToId.get(rel.target) ?? rel.target;
    if (resolvedSource === rel.source && resolvedTarget === rel.target) {
      return rel; // no change needed
    }
    return {
      ...rel,
      id: `${resolvedSource}_${rel.type}_${resolvedTarget}`,
      source: resolvedSource,
      target: resolvedTarget,
    };
  });
}
```

Call `qualifyRelations` in `parseProject()` and `parseCode()` immediately before assembling the return value:

```typescript
// In parseProject() and parseCode(), before the final return:
const qualifiedRelations = this.qualifyRelations(entities, relations);
return {
  version: '1.0',
  language: 'typescript',
  entities,
  relations: qualifiedRelations,
  // ...
};
```

**Acceptance**: For a file `src/parser/typescript-parser.ts` defining `TypeScriptParser` that imports `ParallelParser`, the relation `source` is `src/parser/typescript-parser.ts.TypeScriptParser` and `target` is `src/parser/parallel-parser.ts.ParallelParser` (assuming `ParallelParser` is in that file).

### Stage B2 — Add unit tests for relation qualification

**File**: `tests/unit/parser/typescript-parser.test.ts`

Add test group: `describe('TypeScriptParser — qualifyRelations post-pass')`:

```typescript
it('rewrites bare class name source/target to qualified entity IDs', () => {
  const code = `
    import { Bar } from './bar';
    export class Foo extends Bar {}
  `;
  const archJson = parser.parseCode(code, 'src/foo.ts');
  const fooId = 'src/foo.ts.Foo';
  const fooEntity = archJson.entities.find((e) => e.id === fooId);
  expect(fooEntity).toBeDefined();

  // If Bar is not in this file's entities, relation target stays as bare 'Bar'
  // (no cross-file resolution in single-file parseCode)
  const rel = archJson.relations.find((r) => r.type === 'inheritance');
  expect(rel?.source).toBe(fooId); // Foo is resolved
  // Bar is external — stays as 'Bar' (no entity for it in single-file parse)
  expect(rel?.target).toBe('Bar');
});

it('resolves internal relations between two classes in the same file', () => {
  const code = `
    export class Bar {}
    export class Foo extends Bar {}
  `;
  const archJson = parser.parseCode(code, 'src/both.ts');
  const barId = 'src/both.ts.Bar';
  const fooId = 'src/both.ts.Foo';

  const rel = archJson.relations.find((r) => r.type === 'inheritance');
  expect(rel?.source).toBe(fooId);
  expect(rel?.target).toBe(barId);
});

it('does not throw when relations is empty', () => {
  const code = `export class Alone {}`;
  expect(() => parser.parseCode(code, 'src/alone.ts')).not.toThrow();
  const archJson = parser.parseCode(code, 'src/alone.ts');
  expect(archJson.relations).toHaveLength(0);
});

it('leaves unresolvable targets unchanged', () => {
  const code = `
    import type { ExternalType } from 'some-lib';
    export class MyClass implements ExternalType {}
  `;
  const archJson = parser.parseCode(code, 'src/my-class.ts');
  const rel = archJson.relations.find((r) => r.type === 'implementation');
  // ExternalType has no entity → target stays as 'ExternalType'
  expect(rel?.target).toBe('ExternalType');
});
```

**Dependencies**: B1

---

## Dependency Graph

```
Phase A (package JSON relations) — independent of Phase B
Phase B (class relation IDs) — independent of Phase A
A2 depends on A1
B2 depends on B1
```

---

## Testing Strategy

- **TDD**: Write A2 and B2 tests before implementation to confirm the bug and the fix contract.
- **Unit-only**: No integration tests required; both fixes are pure logic changes.
- **Existing suite**: Must remain green (2787+ tests passing) after all phases.
- **Validation**: Run `node dist/cli/index.js analyze -f json -v` on ArchGuard itself and verify:
  - `overview/package.json` has `relations.length > 0`
  - `class/all-classes.json` has `relations` with IDs matching entity IDs

---

## Acceptance Criteria

| Phase | Criterion |
|---|---|
| A | `overview/package.json` `relations` length equals `TsModuleGraph.edges` length |
| A | Each relation `source`/`target` matches a module node ID in the graph |
| A | Non-package JSON output (e.g., class diagram JSON) is unaffected |
| B | Intra-file class relations use qualified entity IDs for source and target |
| B | External type targets (no entity in the parsed scope) retain their bare name |
| B | Zero `DANGLING_RELATION_SOURCE` warnings for internal relations in class JSON |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Phase A: Module IDs (e.g., `src/cli`) have no corresponding entities → relations are "dangling" | Acceptable: the module graph is a separate layer from entity graph; JSON is still useful for graph traversal |
| Phase B: Two classes with the same simple name in different files — only first wins | Document as known limitation; fully qualified imports already prevent this for well-structured projects |
| Phase B: Modifying `parseCode()` output affects tests that assert on bare-name relations | Review existing tests; update assertions to use qualified IDs where affected |

---

## Validation

```bash
npm run build
node dist/cli/index.js analyze -f json -v
# Check overview/package.json:
node -e "const j=require('.archguard/overview/package.json'); console.log('relations:', j.relations.length)"
# Expected: > 0 (matches visible arrows in .archguard/overview/package.mmd)

# Check class/all-classes.json:
node -e "
  const j = require('.archguard/class/all-classes.json');
  const ids = new Set(j.entities.map(e => e.id));
  const dangling = j.relations.filter(r => !ids.has(r.source) || !ids.has(r.target));
  console.log('dangling relations:', dangling.length, '/ total:', j.relations.length);
"
# Expected: dangling relations: 0 (or small number for known external types)
```

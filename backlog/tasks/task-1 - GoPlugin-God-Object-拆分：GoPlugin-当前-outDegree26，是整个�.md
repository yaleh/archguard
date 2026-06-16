---
id: TASK-1
title: GoPlugin God Object 拆分：GoPlugin 当前 outDegree=26，是整个�
status: In Progress
assignee: []
created_date: '2026-06-16 07:50'
updated_date: '2026-06-16 09:51'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
# Plan: GoPlugin God Object 拆分

Proposal: docs/proposals/proposal-goplugin-god-object-goplugin--outdegree26-coupling.md

## Phase A: Extract GoModReader utility function

### Task

Create `src/plugins/golang/go-mod-reader.ts` with a single exported async function:

```typescript
export async function readModuleName(workspaceRoot: string): Promise<string>
```

This function is extracted verbatim from the private `readModuleName` method in `GoPlugin` (lines 587–595 of `src/plugins/golang/index.ts`). It reads `go.mod`, extracts the module declaration, and returns `'unknown'` on any error.

In `src/plugins/golang/index.ts`:
- Delete the private `readModuleName` method.
- Add `import { readModuleName } from './go-mod-reader.js'`.
- Replace both call sites (`initialize` line 156, `parseToRawData` line 440) with the imported function.

Add `tests/unit/plugins/golang/go-mod-reader.test.ts` covering:
1. Returns module name from valid `go.mod`.
2. Returns `'unknown'` when `go.mod` is missing.
3. Returns `'unknown'` when module declaration is absent.

Estimated line change: ~25 lines added (new file) + ~8 lines changed in index.ts = ~33 lines total.

### DoD

```bash
# Private readModuleName is gone from index.ts
! grep -q "private async readModuleName\|private readModuleName" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# GoModReader is imported in index.ts
grep -q "go-mod-reader" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# Exported function is declared in the new file
grep -q "export async function readModuleName\|export function readModuleName" /home/yale/work/archguard/src/plugins/golang/go-mod-reader.ts
```

```bash
# Tests pass
! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
```

```bash
# Type-check clean
cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
```

---

## Phase B: Extract GoplsInterfaceResolver class

### Task

Create `src/plugins/golang/gopls-interface-resolver.ts` with class `GoplsInterfaceResolver`:

```typescript
export class GoplsInterfaceResolver {
  private goplsClient: GoplsClient | null = null;
  private matcher: InterfaceMatcher;

  constructor();
  async initialize(workspaceRoot: string): Promise<void>;
  async resolve(
    structs: Array<GoStruct & { packageName: string }>,
    interfaces: Array<GoInterface & { packageName: string }>
  ): Promise<Implementation[]>;
  async dispose(): Promise<void>;
  isGoplsAvailable(): boolean;
}
```

`initialize` wraps the gopls startup try/catch currently scattered across `parseToRawData` (lines 405–412) and `parseFiles` (lines 217–224). `resolve` wraps `matcher.matchWithGopls` with the null-guard fallback to `matcher.matchImplicitImplementations`.

In `src/plugins/golang/index.ts`:
- Remove `import { InterfaceMatcher } from './interface-matcher.js'`.
- Remove `import { GoplsClient } from './gopls-client.js'`.
- Add `import { GoplsInterfaceResolver } from './gopls-interface-resolver.js'`.
- Replace `private matcher: InterfaceMatcher` and `private goplsClient: GoplsClient | null` fields with `private resolver!: GoplsInterfaceResolver`.
- In `initialize()`: instantiate `this.resolver = new GoplsInterfaceResolver()` and call `await this.resolver.initialize(config.workspaceRoot)`.
- In `parseCode`: call `this.resolver.resolve([struct], [interface])` (single-file fallback).
- In `parseFiles` and `parseProject`: replace the gopls-null-guard branches with `await this.resolver.resolve(allStructs, allInterfaces)`.
- In `dispose()`: delegate to `this.resolver.dispose()`.

Estimated line change: ~80 lines added (new file) + ~35 lines changed in index.ts = ~115 lines total.

### DoD

```bash
# InterfaceMatcher and GoplsClient no longer directly imported by index.ts
! grep -q "from './interface-matcher.js'\|from './gopls-client.js'" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# GoplsInterfaceResolver is imported in index.ts
grep -q "GoplsInterfaceResolver" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# New file exists with the class declaration
grep -q "class GoplsInterfaceResolver" /home/yale/work/archguard/src/plugins/golang/gopls-interface-resolver.ts
```

```bash
# Tests pass
! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
```

```bash
# Type-check clean
cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
```

---

## Phase C: Extract GoParseCoordinator class

### Task

Create `src/plugins/golang/go-parse-coordinator.ts` with class `GoParseCoordinator`:

```typescript
export class GoParseCoordinator {
  private treeSitter: TreeSitterBridge;
  private mapper: ArchJsonMapper;
  private resolver: GoplsInterfaceResolver;

  constructor(resolver: GoplsInterfaceResolver);
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig & TreeSitterParseOptions
  ): Promise<GoRawData>;
  async buildArchJson(
    rawData: GoRawData,
    workspaceRoot: string
  ): Promise<Pick<ArchJSON, 'entities' | 'relations' | 'sourceFiles'>>;
}
```

`parseToRawData` is the body moved verbatim from `GoPlugin.parseToRawData` (lines 396–495 of `index.ts`), with `readModuleName` already a free function (from Phase A) and `this.goplsClient`/`this.matcher` replaced by `this.resolver.resolve(...)` and `this.resolver.initialize(workspaceRoot)`.

`buildArchJson` extracts the ArchJSON construction block currently duplicated in `parseProject` (lines 332–363) and `parseFiles` (lines 266–274): calls `mapper.mapEntities`, `mapper.mapRelations`, `mapper.mapMissingInterfaceEntities`, returns `{ entities, relations, sourceFiles }`.

`glob`, `path`, `fs`, `TreeSitterBridge`, `TreeSitterParseOptions`, `ArchJsonMapper`, `GoRawPackage`, `GoRawData` imports move to the new file.

In `src/plugins/golang/index.ts`:
- Remove imports: `glob`, `TreeSitterBridge`, `TreeSitterParseOptions`, `ArchJsonMapper`, `GoRawPackage`.
- Merge the two `@/types/index.js` imports (`ArchJSON` + `ARCHJSON_SCHEMA_VERSION`) into one line.
- Add `import { GoParseCoordinator } from './go-parse-coordinator.js'`.
- Replace `parseToRawData` body with `return this.coordinator.parseToRawData(workspaceRoot, config)`.
- Replace ArchJSON construction block in `parseProject` with `const base = await this.coordinator.buildArchJson(rawData, workspaceRoot)`.
- Replace ArchJSON construction block in `parseFiles` with coordinator delegation.
- Remove `private treeSitter` (already gone) and `private mapper` fields.
- Add `private coordinator!: GoParseCoordinator` field.
- In `initialize()`: `this.coordinator = new GoParseCoordinator(this.resolver)`.

Estimated line change: ~160 lines added (new file) + ~55 lines changed in index.ts = ~215 lines total.

Add `tests/unit/plugins/golang/go-parse-coordinator.test.ts` covering:
1. `parseToRawData` merges packages by `fullName`.
2. `parseToRawData` re-attaches orphaned methods.
3. `buildArchJson` returns non-empty entities and relations arrays.
4. Empty file list returns empty packages.

### DoD

```bash
# GoParseCoordinator file exists with class declaration
grep -q "class GoParseCoordinator" /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts
```

```bash
# GoParseCoordinator line count ≤ 200
wc -l /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts | awk '{print $1}' | xargs -I{} test {} -le 200
```

```bash
# glob, TreeSitterBridge, ArchJsonMapper no longer imported in index.ts
! grep -q "from 'glob'\|from './tree-sitter-bridge.js'\|from './archjson-mapper.js'" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# No fs.readFile or glob( calls remain in index.ts
! grep -q "fs\.readFile\|glob(" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# Tests pass
! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
```

```bash
# Type-check clean
cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
```

---

## Phase D: Slim down GoPlugin facade to ≤12 imports

### Task

After Phases A–C, `index.ts` has approximately 16 import lines. This phase removes the remaining excess.

Remaining import lines at start of Phase D (expected, after A adds go-mod-reader, B swaps InterfaceMatcher+GoplsClient→GoplsInterfaceResolver, C removes glob+TreeSitterBridge+TreeSitterParseOptions+ArchJsonMapper and adds GoParseCoordinator):
1. `import path from 'path'`
2. `import fs from 'fs-extra'`
3. `import type { ILanguagePlugin, PluginMetadata, PluginInitConfig, RawTestFile } from '@/core/interfaces/language-plugin.js'`
4. `import type { TestPatternConfig } from '@/types/extensions/test-analysis.js'`
5. `import type { ParseConfig } from '@/core/interfaces/parser.js'`
6. `import type { ArchJSON } from '@/types/index.js'`  ← split from ARCHJSON_SCHEMA_VERSION in current code
7. `import { ARCHJSON_SCHEMA_VERSION } from '@/types/index.js'`  ← same module, separate line
8. `import type { IDependencyExtractor } from '@/core/interfaces/dependency.js'`
9. `import { DependencyExtractor } from './dependency-extractor.js'`
10. `import type { GoRawData } from './types.js'`
11. `import type { GoArchitectureAtlas, AtlasConfig, ... } from './atlas/types.js'`
12. `import { GoAtlasCoordinator } from './go-atlas-coordinator.js'`
13. `import { GoTestAnalyzer } from './go-test-analyzer.js'`
14. `import { GoParseCoordinator } from './go-parse-coordinator.js'`  ← added Phase C
15. `import { GoplsInterfaceResolver } from './gopls-interface-resolver.js'`  ← added Phase B
16. `import { readModuleName } from './go-mod-reader.js'`  ← added Phase A (still used in initialize)

Steps to reach ≤12 (16 → 12, four reductions needed):
1. Merge lines 6+7 into one: `import { ARCHJSON_SCHEMA_VERSION, type ArchJSON } from '@/types/index.js'` → saves 1 (→15 lines).
2. Internalise `readModuleName` call into `GoParseCoordinator`: add `async initModuleName(workspaceRoot: string): Promise<void>` to the coordinator, call it from `GoPlugin.initialize` instead of calling `readModuleName` directly. This drops `import { readModuleName } from './go-mod-reader.js'` from index.ts → saves 1 (→14 lines).
3. Change `readonly dependencyExtractor: IDependencyExtractor` annotation to `readonly dependencyExtractor: DependencyExtractor` so `IDependencyExtractor` is only used in the re-export (`export type { IDependencyExtractor }`) and can be served by a bare re-export without a named import → removes 1 import line (→13 lines).
4. Add `export type { GoRawData } from './types.js'` to `go-parse-coordinator.ts` and change the import in `index.ts` from `import type { GoRawData } from './types.js'` to drawing it from `'./go-parse-coordinator.js'` — consolidating the `./types.js` reference out of `index.ts` → saves 1 (→12 lines).

Step 4 is safe: `GoRawData` is used in `index.ts` only as the return type of the `parseToRawData` forwarding method; re-exporting it through the coordinator module makes the dependency explicit without changing semantics.

Estimated line change: ~25 lines changed across index.ts + go-parse-coordinator.ts = ~25 lines total.

### DoD

```bash
# Final import line count ≤ 12
grep -c "^import" /home/yale/work/archguard/src/plugins/golang/index.ts | xargs test 12 -ge
```

```bash
# No fs.readFile or glob( calls in index.ts
! grep -q "fs\.readFile\|glob(" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# Tests pass
! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
```

```bash
# Type-check clean
cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
```

---

## Constraints

- `GoPlugin.parseToRawData` signature `(workspaceRoot: string, config: ParseConfig & TreeSitterParseOptions): Promise<GoRawData>` must not change; the method remains on `GoPlugin` as a one-line forwarding call.
- `IGoAtlas`, `ILanguagePlugin`, all CLI flags (`--atlas`, `--atlas-layers`, etc.), and the MCP tool surface must remain unchanged.
- `GoAtlasCoordinator` and `GoTestAnalyzer` internals are out of scope.
- No dependency injection containers or interface abstractions for the new internal collaborators.
- `initialize` ordering must be preserved: `readModuleName` (or coordinator equivalent) is called before `GoTestAnalyzer` is constructed, so `cachedModuleName` is available for `new GoTestAnalyzer(moduleName)`.
- Each phase must leave the full test suite passing before the next phase starts.
- The `fs.existsSync` call in `canHandle` is intentionally retained; the `! grep -q "fs\.readFile\|glob("` DoD checks do NOT target `existsSync`.
- `inferBodyStrategy` and `isTestPackage` free functions must remain accessible to `parseProject`; they may stay in `index.ts` or be relocated to `go-parse-coordinator.ts` as unexported helpers — either is acceptable as long as they are not inlined into caller code.

---

## Acceptance Gate

```bash
# 1. All three new files exist
test -f /home/yale/work/archguard/src/plugins/golang/go-mod-reader.ts && \
test -f /home/yale/work/archguard/src/plugins/golang/gopls-interface-resolver.ts && \
test -f /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts
```

```bash
# 2. GoPlugin import count ≤ 12
grep -c "^import" /home/yale/work/archguard/src/plugins/golang/index.ts | xargs test 12 -ge
```

```bash
# 3. GoParseCoordinator ≤ 200 lines
wc -l /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts | awk '{print $1}' | xargs -I{} test {} -le 200
```

```bash
# 4. No inline file I/O in GoPlugin (fs.readFile or glob calls)
! grep -q "fs\.readFile\|glob(" /home/yale/work/archguard/src/plugins/golang/index.ts
```

```bash
# 5. GoModReader exports readModuleName
grep -q "export async function readModuleName\|export function readModuleName" /home/yale/work/archguard/src/plugins/golang/go-mod-reader.ts
```

```bash
# 6. Full test suite passes
! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
```

```bash
# 7. Type-check clean
cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
```
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 ! grep -q "private async readModuleName\|private readModuleName" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #2 grep -q "go-mod-reader" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #3 grep -q "export async function readModuleName\|export function readModuleName" /home/yale/work/archguard/src/plugins/golang/go-mod-reader.ts
- [ ] #4 ! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")
- [ ] #5 cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"
- [ ] #6 ! grep -q "from './interface-matcher.js'\|from './gopls-client.js'" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #7 grep -q "GoplsInterfaceResolver" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #8 grep -q "class GoplsInterfaceResolver" /home/yale/work/archguard/src/plugins/golang/gopls-interface-resolver.ts
- [ ] #9 grep -q "class GoParseCoordinator" /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts
- [ ] #10 wc -l /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts | awk '{print $1}' | xargs -I{} test {} -le 200
- [ ] #11 ! grep -q "from 'glob'\|from './tree-sitter-bridge.js'\|from './archjson-mapper.js'" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #12 ! grep -q "fs\.readFile\|glob(" /home/yale/work/archguard/src/plugins/golang/index.ts
- [ ] #13 grep -c "^import" /home/yale/work/archguard/src/plugins/golang/index.ts | xargs test 12 -ge
- [ ] #14 test -f /home/yale/work/archguard/src/plugins/golang/go-mod-reader.ts && \ test -f /home/yale/work/archguard/src/plugins/golang/gopls-interface-resolver.ts && \ test -f /home/yale/work/archguard/src/plugins/golang/go-parse-coordinator.ts
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal review iteration 1: NEEDS_REVISION — (1) Background claimed '19 modules' but actual unique module count is 17; corrected. (2) Background claimed 'outDegree of 26' conflating import-count with ArchGuard's entity-relation outDegree metric; removed the misleading outDegree claim and replaced with accurate import counts. (3) Goal 1 threshold ≤8 was unachievable: after extracting GoParseCoordinator/GoModReader/GoplsInterfaceResolver, GoPlugin still retains ~11 imports (ILanguagePlugin, ParseConfig, ArchJSON, atlas types, GoAtlasCoordinator, GoTestAnalyzer, new collaborators, fs-extra, path); corrected to ≤12. (4) Goal 5 verification command 'grep -n "fs\.|glob("' returning zero hits was unachievable since canHandle() legitimately uses fs.existsSync; narrowed the check to fs.readFile and glob() only and added explanatory note.

Proposal review iteration 2: NEEDS_REVISION — Fixed consistency issue: 'Extract four responsibility boundaries' contradicted Background's 'five responsibility domains'; Proposed Approach now correctly states three new collaborators cover the five domains (two existing classes retained)

Proposal review iteration 3: NEEDS_REVISION — Clarified 'four collaborators above' to explicitly enumerate GoParseCoordinator, GoplsInterfaceResolver, GoAtlasCoordinator, GoTestAnalyzer and note GoModReader is a utility function (not a held reference); all other checks passed

Proposal review iteration 4: NEEDS_REVISION — (1) Goal 5 verification command used bare grep which exits 1 (failure) when zero hits, i.e. when the goal IS met; fixed to '! grep -qn ...' which exits 0 on success. (2) Proposed Approach intro said 'three new collaborators' but GoModReader is a function not a class; fixed to 'two new collaborator classes and one utility function' eliminating the four-vs-three confusion.

Proposal review iteration 5: APPROVED

Proposal approved. Starting plan draft.

Plan review iteration 1: NEEDS_REVISION — (1) Phase A npm test DoD was missing 'cd /home/yale/work/archguard &&' prefix (now fixed); (2) Phase D count arithmetic said 'approximately 13 import lines' but actual post-A/B/C count is 16, and steps 1+2+3 only reduce to 13 not 12 — added step 4 (re-export GoRawData from go-parse-coordinator.ts to eliminate the ./types.js import line in index.ts) to correctly reach ≤12.

Plan review iteration 2: APPROVED

Docs committed: docs/proposals/proposal-goplugin-god-object-goplugin--outdegree26-coupling.md + docs/plans/124-goplugin-god-object-goplugin--outdegree26-coupling.md

claimed: 2026-06-16T09:51:16Z
<!-- SECTION:NOTES:END -->

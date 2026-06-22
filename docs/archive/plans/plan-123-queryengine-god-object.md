# Plan: QueryEngine God Object — Extract RelationQueryService + QueryContext

Proposal: docs/proposals/proposal-queryengine-god-object.md

## Phase A: Create RelationQueryService and migrate graph-traversal logic

### Task
Create `src/core/query/relation-query-service.ts` containing `RelationQueryService` with:
- Constructor: `(archJson: ArchJSON, archIndex: ArchIndex, entityQueryService: EntityQueryService)`
- Methods migrated from QueryEngine: `getDependencies`, `getDependents`, `findImplementers`, `findSubclasses`, `findCallers`, and private `bfs`
- Each method returns raw `Entity[]` (or the existing findCallers return type) — no output-option logic
Write `tests/unit/core/query/relation-query-service.test.ts` with isolated unit tests that import `RelationQueryService` directly (no `QueryEngine` import).

Files changed:
- NEW: `src/core/query/relation-query-service.ts`
- NEW: `tests/unit/core/query/relation-query-service.test.ts`

### DoD
- [ ] `test -f /home/yale/work/archguard/src/core/query/relation-query-service.ts`
- [ ] `! grep -q "QueryEngine" /home/yale/work/archguard/tests/unit/core/query/relation-query-service.test.ts`
- [ ] `grep -q "class RelationQueryService" /home/yale/work/archguard/src/core/query/relation-query-service.ts`
- [ ] `grep -q "findCallers\|bfs" /home/yale/work/archguard/src/core/query/relation-query-service.ts`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

## Phase B: Delegate QueryEngine graph-traversal methods to RelationQueryService

### Task
In `src/core/query/query-engine.ts`:
- Add `private readonly relationQueryService: RelationQueryService` field, instantiated in constructor.
- Replace the bodies of `getDependencies`, `getDependents`, `findImplementers`, `findSubclasses`, `findCallers` with delegation calls to `this.relationQueryService`.
- Remove the private `bfs` method (now lives in `RelationQueryService`).
- Keep method signatures and `applyOutputOptions` wrapping identical so callers are unaffected.
- Export `RelationQueryService` from `src/core/query/index.ts`.

Files changed:
- MODIFY: `src/core/query/query-engine.ts`
- MODIFY: `src/core/query/index.ts`

### DoD
- [ ] `! grep -q "private bfs(" /home/yale/work/archguard/src/core/query/query-engine.ts`
- [ ] `grep -q "relationQueryService" /home/yale/work/archguard/src/core/query/query-engine.ts`
- [ ] `grep -q "RelationQueryService" /home/yale/work/archguard/src/core/query/index.ts`
- [ ] `cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

## Phase C: Introduce QueryContext and update loadEngine return type

### Task
In `src/cli/query/engine-loader.ts`:
- Define and export `QueryContext` interface: `{ engine: QueryEngine; extensionAccessor: ExtensionAccessor; scopeEntry: QueryScopeEntry }`.
- Change `loadEngine` to return `Promise<QueryContext>` instead of `Promise<QueryEngine>`.
- Instantiate `ExtensionAccessor` inside `loadEngine` (from the same `archJson`) and include it in the returned object. Pass the same instance into `QueryEngine` constructor via `options.extensionAccessor` (or construct `QueryEngine` first and expose its accessor) to avoid double-instantiation.

Update all 5 caller files to destructure `QueryContext`:
- `src/cli/mcp/mcp-server.ts` — 10 `await loadEngine(...)` call sites
- `src/cli/mcp/tools/call-graph-tools.ts` — 1 call site
- `src/cli/mcp/tools/test-analysis-tools.ts` — 4 call sites
- `src/cli/mcp/tools/atlas-analytics-tools.ts` — 3 call sites
- `src/cli/commands/query.ts` — 1 call site

At each call site, replace `const engine = await loadEngine(...)` with `const { engine, extensionAccessor, scopeEntry } = await loadEngine(...)` (or just `{ engine }` where only `engine` is used).

Files changed:
- MODIFY: `src/cli/query/engine-loader.ts`
- MODIFY: `src/cli/mcp/mcp-server.ts`
- MODIFY: `src/cli/mcp/tools/call-graph-tools.ts`
- MODIFY: `src/cli/mcp/tools/test-analysis-tools.ts`
- MODIFY: `src/cli/mcp/tools/atlas-analytics-tools.ts`
- MODIFY: `src/cli/commands/query.ts`

### DoD
- [ ] `grep -q "QueryContext" /home/yale/work/archguard/src/cli/query/engine-loader.ts`
- [ ] `grep -q "export.*QueryContext\|export type QueryContext" /home/yale/work/archguard/src/cli/query/engine-loader.ts`
- [ ] `cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

## Phase D: Remove extension-forwarding methods from QueryEngine public interface

### Task
From `src/core/query/query-engine.ts`, remove the four extension-forwarding public methods that are now redundant:
- `getAtlasLayer`
- `hasAtlasExtension`
- `getTestAnalysis`
- `hasTestAnalysis`

Update all caller files to use `extensionAccessor` directly (from the `QueryContext`) in place of former `engine.*` calls:
- `src/cli/mcp/mcp-server.ts`: `engine.hasAtlasExtension()` → `extensionAccessor.hasAtlasExtension()`, `engine.getAtlasLayer(...)` → `extensionAccessor.getAtlasLayer(...)`
- `src/cli/mcp/tools/atlas-analytics-tools.ts`: same pattern (3 call sites)
- `src/cli/mcp/tools/test-analysis-tools.ts`: `engine.hasTestAnalysis()` → `extensionAccessor.hasTestAnalysis()`, `engine.getTestAnalysis()` → `extensionAccessor.getTestAnalysis()`
- `src/cli/commands/query.ts`: all `engine.has*/engine.get*` extension calls → `extensionAccessor.*`

Files changed:
- MODIFY: `src/core/query/query-engine.ts`
- MODIFY: `src/cli/mcp/mcp-server.ts`
- MODIFY: `src/cli/mcp/tools/atlas-analytics-tools.ts`
- MODIFY: `src/cli/mcp/tools/test-analysis-tools.ts`
- MODIFY: `src/cli/commands/query.ts`

### DoD
- [ ] `! grep -q "getAtlasLayer\|hasAtlasExtension\|getTestAnalysis\|hasTestAnalysis" /home/yale/work/archguard/src/core/query/query-engine.ts`
- [ ] `! grep -q "engine\.getAtlasLayer\|engine\.hasAtlasExtension\|engine\.getTestAnalysis\|engine\.hasTestAnalysis" /home/yale/work/archguard/src/cli/commands/query.ts`
- [ ] `! grep -q "engine\.getAtlasLayer\|engine\.hasAtlasExtension" /home/yale/work/archguard/src/cli/mcp/tools/atlas-analytics-tools.ts`
- [ ] `! grep -q "engine\.getTestAnalysis\|engine\.hasTestAnalysis" /home/yale/work/archguard/src/cli/mcp/tools/test-analysis-tools.ts`
- [ ] `! grep -q "engine\.getAtlasLayer\|engine\.hasAtlasExtension" /home/yale/work/archguard/src/cli/mcp/mcp-server.ts`
- [ ] `cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

## Phase E: Remove graph-traversal delegation wrappers from QueryEngine public interface

### Task
Now that `QueryContext` exposes `engine`, `extensionAccessor`, and `scopeEntry`, update MCP tools and CLI `query` command to call `RelationQueryService` directly for graph traversal, then remove the five delegation methods from `QueryEngine`:
- `getDependencies`
- `getDependents`
- `findImplementers`
- `findSubclasses`
- `findCallers`

`QueryContext` must be extended to also expose `relationQueryService: RelationQueryService` so callers have direct access.

Update caller files:
- `src/cli/mcp/tools/call-graph-tools.ts`: replace `engine.getDependencies(...)`, `engine.findCallers(...)`, etc. with `relationQueryService.*(...)`; wrap results with `engine.applyOutputOptions(...)`.
- `src/cli/commands/query.ts`: replace all five graph-traversal `engine.*` calls with `relationQueryService.*` + `engine.applyOutputOptions`.
- Any other call sites discovered by `grep -r "engine\.getDependencies\|engine\.getDependents\|engine\.findImplementers\|engine\.findSubclasses\|engine\.findCallers" src/`.

After removal, verify with isolated tests that `RelationQueryService` is independently testable.

Files changed:
- MODIFY: `src/cli/query/engine-loader.ts` (add `relationQueryService` to `QueryContext`)
- MODIFY: `src/core/query/query-engine.ts` (remove 5 delegation methods)
- MODIFY: `src/cli/mcp/tools/call-graph-tools.ts`
- MODIFY: `src/cli/commands/query.ts`

### DoD
- [ ] `! grep -q "getDependencies\|getDependents\|findImplementers\|findSubclasses\|findCallers" /home/yale/work/archguard/src/core/query/query-engine.ts`
- [ ] `grep -q "relationQueryService" /home/yale/work/archguard/src/cli/query/engine-loader.ts`
- [ ] `! grep -q "engine\.getDependencies\|engine\.getDependents\|engine\.findImplementers\|engine\.findSubclasses\|engine\.findCallers" /home/yale/work/archguard/src/cli/mcp/tools/call-graph-tools.ts`
- [ ] `! grep -q "engine\.getDependencies\|engine\.getDependents\|engine\.findImplementers\|engine\.findSubclasses\|engine\.findCallers" /home/yale/work/archguard/src/cli/commands/query.ts`
- [ ] `cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

## Constraints
- Do not split `ArchMetrics` internals — multi-language branching is intentional business logic.
- `applyOutputOptions` must remain on `QueryEngine` (used by CLI, MCP, and test-analysis-tools).
- `toSummary`, `getScopeEntry`, `getCycles`, `getSummary` must remain on `QueryEngine`.
- `RelationQueryService` must have no import from `query-engine.ts` to avoid circular dependencies.
- `QueryContext.extensionAccessor` must be the same instance used by `QueryEngine` internally (constructed from the same `archJson`); do not double-instantiate.
- Backward-compat re-export shim at `src/cli/query/query-engine.ts` must remain untouched.
- Each phase must leave `npm test` passing before proceeding to the next phase.
- Goal 1 (≤ 8 public methods on QueryEngine) is the target of the full A–E sequence. After Phase E, the grep count (`grep -cP "^  [a-z][a-zA-Z]+\(" src/core/query/query-engine.ts`) must return ≤ 8 (constructor included in that count).

## Acceptance Gate
- [ ] `cd /home/yale/work/archguard && grep -cP "^  [a-z][a-zA-Z]+\(" src/core/query/query-engine.ts | xargs test 8 -ge`
- [ ] `grep -l "bfs" /home/yale/work/archguard/src/core/query/*.ts | xargs -I{} basename {} | grep -qx "relation-query-service.ts"`
- [ ] `! grep -q "engine\.getAtlasLayer\|engine\.hasAtlas\|engine\.getTestAnalysis\|engine\.hasTestAnalysis" /home/yale/work/archguard/src/cli/commands/query.ts /home/yale/work/archguard/src/cli/mcp/tools/atlas-analytics-tools.ts /home/yale/work/archguard/src/cli/mcp/tools/test-analysis-tools.ts /home/yale/work/archguard/src/cli/mcp/mcp-server.ts`
- [ ] `! grep -rq "engine\.getDependencies\|engine\.getDependents\|engine\.findImplementers\|engine\.findSubclasses\|engine\.findCallers" /home/yale/work/archguard/src/cli/`
- [ ] `cd /home/yale/work/archguard && npm run type-check 2>&1 | grep -c "error TS" | grep -q "^0$"`
- [ ] `! (cd /home/yale/work/archguard && npm test 2>&1 | tail -5 | grep -q " failed")`

# Proposal: Java Relation Quality, Python Diagram Rendering, Git History, and Async Test Fixes

## Background

During validation of Java (Jlama), Python (lmdeploy), and C++ (llama.cpp) projects, several quality issues were discovered in Plan 38 and adjacent work:

1. **Contributor share > 100%** — A regression in Plan 38 where package-level contributor shares can exceed 1.0, making output misleading.
2. **Java false-positive relations** — `isUserDefinedType()` in the Java plugin has an incomplete exclusion list, producing 252 false-positive relations in Jlama.
3. **Java MRJAR directory inflation** — Multi-Release JAR directories (`java20/`, `java21/`) match the Maven module detection pattern, inflating module counts.
4. **Python async helper test false positives** — Static 30-line window for assertion counting misses assertions in async helper methods, flagging valid tests as zero-assertion.
5. **Python package diagram missing relations** — Module-level source IDs in Python relations do not match class-level entity IDs, resulting in zero arrows in package diagrams.

## Goals

- Fix contributor share calculation so values are always in `[0, 1]`.
- Reduce Java false-positive relations by filtering generic type parameters and common JDK names.
- Fix MRJAR directory inflation to produce logically correct Java module counts.
- Fix Python async test false positives with a file-level assertion floor heuristic.
- Fix Python package diagram to show inter-package dependency arrows.

## Issue 1: Contributor Share > 100% (HIGH — Plan 38 regression)

### Root Cause

`aggregatePackageMetrics()` in `src/cli/git-history/history-aggregator.ts` lines 247–262:

```typescript
const mergedAuthors = new Map<string, number>();
for (const fm of acc.files) {
  for (const contributor of fm.topContributors ?? []) {
    mergedAuthors.set(
      contributor.email,
      (mergedAuthors.get(contributor.email) ?? 0) + contributor.commitCount
    );
  }
}
// ...
share: commitCount > 0 ? count / commitCount : 0,
```

`contributor.commitCount` is the number of commits to a **single file**. When a contributor modifies 5 files each with 20 commits, their sum is 100. But `commitCount` (the package deduped SHA count) is 44 unique commits → share = 227%.

### Proposed Fix

Track per-contributor SHA sets at the package level. For each file's `commitShas` array, group by author. The `FileHistoryMetrics` currently stores `topContributors` (top 5 by count) but not per-author SHA sets.

Two approaches:

**Option A — Store per-author SHAs in FileHistoryMetrics** (preferred):
- In `aggregateFileMetrics()`, change the `authors` map from `Map<string, number>` to `Map<string, Set<string>>` (email → SHA set), storing commit SHAs per author.
- Emit `contributorShas?: Record<string, string[]>` in `FileHistoryMetrics`.
- In `aggregatePackageMetrics()`, union the per-author SHA sets across files, then `authorPkgCount = shaSet.size` and `share = authorPkgCount / packageShaSet.size`.

**Option B — Cap share at 1.0** (quick, inaccurate):
- `share: Math.min(count / commitCount, 1)` — masks the bug but doesn't fix the underlying count.

Option A is chosen because it produces accurate numbers rather than silently clamping.

**Tradeoff**: `contributorShas` increases memory and serialized size. Mitigation: keep only top-5 contributor SHAs (matching the existing `topContributors` slice).

## Issue 2: Java False-Positive Relations — `isUserDefinedType()` Incomplete (CRITICAL)

### Root Cause

`src/plugins/java/archjson-mapper.ts`, `isUserDefinedType()` (line 311) only excludes:
- 8 primitives + 10 boxed types + `String`, `Object`
- `java.` prefix check

Missing exclusions causing 252 false positives in Jlama:

| Category | Examples | Count (estimate) |
|---|---|---|
| Single-letter generics | `T`, `E`, `K`, `V`, `R`, `N` | ~30 |
| Two-letter generic variants | `T1`, `T2`, `K1`, `V1` | ~10 |
| Common JDK collection names | `List`, `Map`, `Set`, `Collection`, `Queue`, `Deque` | ~20 |
| Common JDK utility names | `Optional`, `Stream`, `Future`, `Callable`, `Runnable`, `Comparator` | ~30 |
| Common JDK exception names | `Exception`, `RuntimeException`, `Error`, `Throwable` | ~20 |
| Common JDK I/O names | `InputStream`, `OutputStream`, `Reader`, `Writer`, `Path`, `File` | ~25 |
| Common JDK misc | `Thread`, `Logger`, `Class`, `StringBuilder`, `ByteBuffer` | ~20 |
| Framework common names | `Builder`, `Response`, `Request` | ~15 |

### Proposed Fix

Add three guards in order:

1. **Single-letter generic guard**: `if (name.length === 1 && /[A-Z]/.test(name)) return false`
2. **Two-letter generic variant guard**: `if (/^[A-Z][1-9]$/.test(name)) return false`
3. **Comprehensive JDK/framework name set**:

```typescript
const JDK_COMMON_NAMES = new Set([
  // Collections
  'List', 'Map', 'Set', 'Collection', 'Queue', 'Deque', 'Iterator',
  'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
  'LinkedHashMap', 'LinkedHashSet', 'EnumSet', 'EnumMap',
  // Utility
  'Optional', 'Stream', 'Future', 'CompletableFuture', 'Callable',
  'Runnable', 'Comparator', 'Supplier', 'Consumer', 'Function', 'Predicate',
  'BiFunction', 'BiConsumer', 'BiPredicate',
  // Exceptions
  'Exception', 'RuntimeException', 'Error', 'Throwable',
  'IllegalArgumentException', 'IllegalStateException', 'NullPointerException',
  'IndexOutOfBoundsException', 'UnsupportedOperationException',
  'IOException', 'ClassNotFoundException',
  // I/O & NIO
  'InputStream', 'OutputStream', 'Reader', 'Writer', 'Path', 'File',
  'ByteBuffer', 'CharBuffer', 'URL', 'URI',
  // Concurrency
  'Thread', 'Executor', 'ExecutorService', 'Lock', 'ReentrantLock',
  'AtomicInteger', 'AtomicLong', 'AtomicBoolean', 'AtomicReference',
  // Misc
  'Logger', 'Class', 'StringBuilder', 'StringBuffer', 'Number',
  'Cloneable', 'Serializable', 'Iterable', 'Enum', 'Record',
  // Framework common
  'Builder', 'Response', 'Request', 'Handler', 'Listener', 'Callback',
]);
```

**Tradeoff**: This set may suppress legitimate user-defined types with these names (e.g., a project's own `Request` class). However, because the mapper uses **simple names** (extracted via `extractTypeName()`), and `resolveTypeId()` maps unqualified names to `currentPackage.Name` (which has no entity in the graph anyway for standard library types), suppressing them at `isUserDefinedType()` is correct. User types with names like `Builder` will only be suppressed when used as unqualified simple names — if they're properly imported as `com.example.Builder`, the type string will contain a `.` and bypass `isUserDefinedType()` entirely (since `extractTypeName()` is called first). Thus false negatives are negligible.

## Issue 3: Java MRJAR Multi-Release Directory Inflation (HIGH)

### Root Cause

`src/parser/archjson-aggregator.ts`, `extractJavaMavenModule()`:

```typescript
const match =
  normalized.match(/^([^/]+)\/src\/(?:main|test)\/java\//) ??
  normalized.match(/\/([^/]+)\/src\/(?:main|test)\/java\//);
```

Multi-Release JAR layout under `jlama-native`:
```
jlama-native/src/main/java21/com/github/...
jlama-native/src/main/java22/com/github/...
```

The path `jlama-native/src/main/java21/...` matches neither pattern (uses `java21` not `java`), but there's a more subtle case: some projects place MRJAR classes in `src/main/java21/` paths. When the aggregator sees these paths, the first regex captures `jlama-native` correctly. However, if a project structures them as `java21/src/main/java/`, the second regex captures `java21` as the module name.

Actually the issue is more nuanced: the pattern `\/([^/]+)\/src\/(?:main|test)\/java\/` in a path like `jlama-native/src/main/java21/...` would match the `java21` segment if the path format is different. We need to guard against module names matching `/^java\d+$/` or `META-INF`.

### Proposed Fix

Add a guard after the regex match:

```typescript
const moduleName = match?.[1] ?? null;
if (moduleName && (/^java\d+$/.test(moduleName) || moduleName === 'META-INF')) {
  return null; // skip MRJAR version directories
}
return moduleName;
```

This prevents `java21`, `java22`, `java20` from being used as module names. The entities in these directories will fall back to the parent detection logic.

**Alternative**: Normalize to the parent directory. But since the regex doesn't have easy access to the parent, returning `null` (which causes the file to be treated as a root-level file or ignored by the module-level grouping) is safer.

## Issue 4: Python Zero-Assertion False Positives for Async Helper Tests (HIGH)

### Root Cause

`src/plugins/python/index.ts`, `extractTestStructure()` lines 299–303:

```typescript
const bodyEnd = Math.min(i + 30, lines.length);
const assertionCount = lines
  .slice(i + 1, bodyEnd)
  .filter((l) => assertionPatterns.some((ap) => l.includes(ap))).length;
```

The 30-line window covers only the immediate body of `test_foo()`. In async test patterns:

```python
async def test_foo(self):
    response = await self._call_api()
    await self._assert_response(response)  # delegates to helper

async def _assert_response(self, response):
    assert response.status == 200
    assert response.body is not None
```

All assertions are in `_assert_response`, which may be > 30 lines away from the test function definition, or in a separate helper.

### Proposed Fix

**Pragmatic file-level floor heuristic**:

After extracting all test cases, compute a file-level assertion count from ALL lines (not just 30-line windows):

```typescript
const fileAssertionCount = lines.filter(
  (l) => assertionPatterns.some((ap) => l.includes(ap))
).length;

const allTestsZero = testCases.every((tc) => tc.assertionCount === 0);
if (allTestsZero && fileAssertionCount > 0) {
  // File has assertions in helpers — distribute floor of 1 per non-skipped test
  for (const tc of testCases) {
    if (!tc.isSkipped) tc.assertionCount = 1;
  }
}
```

This is a **pragmatic fix**: if the file has any assertions at all but all test cases appear to have zero, we assume the assertions are in helper methods and set a floor of 1.

**Tradeoff**: May mask genuinely assertion-free tests if there are assertion-like strings in comments or helper functions that are not called by any test. This is an acceptable trade-off because:
- Zero-assertion detection is a heuristic, not a guarantee.
- The alternative (false positives) is more disruptive.
- The fix can be toggled with a config option if needed.

## Issue 5: Python Inter-Package Relations Not Shown in Package Diagram (HIGH)

### Root Cause

`src/mermaid/generator.ts`, `generateRelations()` (line 498–513):

```typescript
for (const relation of this.archJson.relations) {
  if (
    (knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source)) &&
    !this.isNoisyTarget(relation.target)
  ) {
    lines.push(`  ${this.generateRelationLine(relation)}`);
  }
}
```

Python's dependency relations use **module-level source IDs** such as `lmdeploy.pytorch.models`, but entities have **class-level IDs** such as `lmdeploy.pytorch.models.LlamaModel`. The filter `knownEntityIds.has(relation.source)` fails because no entity has `lmdeploy.pytorch.models` as its ID → zero relations pass.

### Proposed Fix

**Option A — Package-prefix mapping in `generateRelations()`** (preferred for non-invasive fix):

For package-level diagrams, when `relation.source` is not in `knownEntityIds`, check if any entity has an ID that starts with `relation.source + '.'`. If so, the relation source is a module prefix and should be treated as the package node.

```typescript
// For package diagrams: resolve module-level IDs to package nodes
const resolvedSource = knownEntityIds.has(relation.source)
  ? relation.source
  : [...knownEntityIds].find((id) => id.startsWith(relation.source + '.')) ?? null;
```

This is O(n) per relation. For large projects this could be slow; mitigate by building a prefix index.

**Option B — Emit module pseudo-entities from Python plugin**:

The Python plugin could emit a pseudo-entity per module (type: `module`) so that `knownEntityIds` contains `lmdeploy.pytorch.models`. This would require:
- Adding a `module` entity type to the type system.
- Updating all diagram generators to handle `module` entities.
- More invasive changes across the codebase.

Option A is chosen for Plan 39 as it is localized to `generator.ts` with no type system changes.

**Implementation detail**: Build a `moduleToEntityPrefix` map once before the loop:

```typescript
const moduleIdPrefixes = new Set<string>();
for (const id of knownEntityIds) {
  const parts = id.split('.');
  for (let i = 1; i < parts.length; i++) {
    moduleIdPrefixes.add(parts.slice(0, i).join('.'));
  }
}
```

Then check `moduleIdPrefixes.has(relation.source)` as the condition.

## Architecture Impact

| Component | Files Changed | Risk |
|---|---|---|
| `history-aggregator.ts` | 1 | Low (regression fix) |
| `git-history-types.ts` | 1 | Low (additive field) |
| `java/archjson-mapper.ts` | 1 | Low (exclusion list) |
| `archjson-aggregator.ts` | 1 | Low (guard clause) |
| `python/index.ts` | 1 | Low (floor heuristic) |
| `mermaid/generator.ts` | 1 | Medium (prefix logic) |

Total: 6 files, all localized changes.

## Risks

1. **Issue 1 fix**: If `commitShas` is not available at the file level for all git providers, the per-author SHA set may be empty. Mitigation: fall back to the existing sum-based count when `contributorShas` is absent.
2. **Issue 2 fix**: Common names like `Builder` or `Response` may be user-defined in some projects. Mitigation: the JDK set is a pragmatic filter, not a perfect one. Document that fully-qualified imports are preferred for these names.
3. **Issue 5 fix**: Prefix index computation is O(entities × depth). For typical Java/Python projects with 1000 entities and depth 4, this is ~4000 operations — negligible.

## References

- `src/cli/git-history/history-aggregator.ts` — Issue 1 root
- `src/plugins/java/archjson-mapper.ts` — Issue 2 root
- `src/parser/archjson-aggregator.ts` — Issue 3 root
- `src/plugins/python/index.ts` — Issue 4 root
- `src/mermaid/generator.ts` — Issue 5 root
- `docs/plans/plan-38-git-history-fixes-and-mcp-test-scope.md` — Plan 38 context

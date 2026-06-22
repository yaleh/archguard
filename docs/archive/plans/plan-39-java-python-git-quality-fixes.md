# Plan 39: Java Relation Quality, Python Diagram Rendering, Git History, and Async Test Fixes

**Proposal**: `docs/proposals/proposal-java-python-git-quality-fixes.md`
**Priority**: CRITICAL (Issue 2) + HIGH (Issues 1, 3, 4, 5)
**Estimated total changes**: ~200 lines across 7 files + ~120 test lines

---

## Overview

Five targeted bug fixes across four subsystems:

| # | Issue | Subsystem | Priority |
|---|---|---|---|
| 1 | Contributor share > 100% | `git-history/history-aggregator.ts` | HIGH |
| 2 | Java false-positive relations | `plugins/java/archjson-mapper.ts` | CRITICAL |
| 3 | Java MRJAR directory inflation | `parser/archjson-aggregator.ts` | HIGH |
| 4 | Python async helper test false positives | `plugins/python/index.ts` | HIGH |
| 5 | Python package diagram missing relations | `mermaid/generator.ts` | HIGH |

---

## Phase A — Git History: Fix Contributor Share > 100%

**Files**: `src/types/git-history.ts`, `src/cli/git-history/history-aggregator.ts`, `tests/unit/cli/git-history/history-aggregator.test.ts`
**Estimated lines**: ~60 source + ~40 test

### Stage A1 — Add per-author SHAs to FileHistoryMetrics type

**File**: `src/types/git-history.ts`

- Add optional field to `FileHistoryMetrics`: `contributorShas?: Record<string, string[]>` (email → sorted SHA list for that file)
- Add optional field to `ContributorSummary`: (no change needed — share is computed at output time)

**Acceptance**: Type compiles; existing tests pass.

### Stage A2 — Populate contributorShas in aggregateFileMetrics()

**File**: `src/cli/git-history/history-aggregator.ts`

- In `aggregateFileMetrics()`, change the `authors` map within `FileAccumulator` from `Map<string, number>` to `Map<string, Set<string>>` (email → SHA set).
- When processing a commit: `acc.authors.set(email, existingSet.add(commit.sha))`.
- When building `topContributors`, `commitCount = shaSet.size`.
- Emit `contributorShas: Object.fromEntries([...acc.authors.entries()].map(([e, s]) => [e, [...s]]))` in `FileHistoryMetrics`.

**Acceptance**: `topContributors[i].share` always ≤ 1.0 for file metrics.

### Stage A3 — Fix package-level share using contributorShas

**File**: `src/cli/git-history/history-aggregator.ts`

In `aggregatePackageMetrics()`, replace the `mergedAuthors: Map<string, number>` with `mergedAuthors: Map<string, Set<string>>`:

```typescript
const mergedAuthors = new Map<string, Set<string>>();
for (const fm of acc.files) {
  for (const [email, shas] of Object.entries(fm.contributorShas ?? {})) {
    const existing = mergedAuthors.get(email) ?? new Set<string>();
    for (const sha of shas) existing.add(sha);
    mergedAuthors.set(email, existing);
  }
}
const sortedPkgAuthors = [...mergedAuthors.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 5);
const topContributors: ContributorSummary[] = sortedPkgAuthors.map(([email, shaSet]) => ({
  email,
  commitCount: shaSet.size,
  share: packageShaSet.size > 0 ? shaSet.size / packageShaSet.size : 0,
}));
```

Where `packageShaSet` is the existing `allShas` set already computed at line 199.

**Acceptance**: For a contributor who modifies 5 files each with 20 unique commits across a package of 44 unique commits, share = min(actual_unique_commits_by_author / 44, 1.0) ≤ 1.0.

### Stage A4 — Add regression tests

**File**: `tests/unit/cli/git-history/history-aggregator.test.ts`

Add test group: `describe('aggregatePackageMetrics — topContributors share never exceeds 1.0')`:

- Test: single contributor commits to 5 files (each file has 4 commits, overlapping SHAs): share ≤ 1.0
- Test: contributor with different SHAs in each file: share = authorUniqueCount / packageUniqueCount
- Test: two contributors, shares sum ≤ 1.0

**Dependencies**: A1, A2, A3

---

## Phase B — Java: Fix False-Positive Relations

**Files**: `src/plugins/java/archjson-mapper.ts`, `tests/unit/plugins/java/archjson-mapper.test.ts`
**Estimated lines**: ~60 source + ~40 test

### Stage B1 — Add JDK_COMMON_NAMES set and guards to isUserDefinedType()

**File**: `src/plugins/java/archjson-mapper.ts`

Add module-level constant before the class:

```typescript
const JDK_COMMON_NAMES = new Set([
  // Collections
  'List', 'Map', 'Set', 'Collection', 'Queue', 'Deque', 'Iterator',
  'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
  'LinkedHashMap', 'LinkedHashSet', 'EnumSet', 'EnumMap',
  // Functional
  'Optional', 'Stream', 'Future', 'CompletableFuture', 'Callable',
  'Runnable', 'Comparator', 'Supplier', 'Consumer', 'Function', 'Predicate',
  'BiFunction', 'BiConsumer', 'BiPredicate', 'UnaryOperator', 'BinaryOperator',
  // Exceptions
  'Exception', 'RuntimeException', 'Error', 'Throwable',
  'IllegalArgumentException', 'IllegalStateException', 'NullPointerException',
  'IndexOutOfBoundsException', 'ArrayIndexOutOfBoundsException',
  'UnsupportedOperationException', 'IOException', 'ClassNotFoundException',
  'NumberFormatException', 'ArithmeticException', 'StackOverflowError',
  // I/O & NIO
  'InputStream', 'OutputStream', 'Reader', 'Writer', 'Path', 'File',
  'ByteBuffer', 'CharBuffer', 'URL', 'URI', 'Charset',
  // Concurrency
  'Thread', 'Executor', 'ExecutorService', 'Lock', 'ReentrantLock',
  'AtomicInteger', 'AtomicLong', 'AtomicBoolean', 'AtomicReference',
  'CountDownLatch', 'Semaphore', 'ConcurrentHashMap',
  // Misc
  'Logger', 'Class', 'StringBuilder', 'StringBuffer', 'Number',
  'Cloneable', 'Serializable', 'Iterable', 'AutoCloseable', 'Enum',
  // Framework common
  'Builder', 'Response', 'Request', 'Handler', 'Listener', 'Callback',
]);
```

Modify `isUserDefinedType()`:

```typescript
// Single-letter generics: T, E, K, V, R, N, S, U, W, X, Y, Z
if (name.length === 1 && /[A-Z]/.test(name)) return false;

// Two-letter generic variants: T1, T2, K1, V1, E1
if (/^[A-Z][1-9]$/.test(name)) return false;

// Common JDK and framework names
if (JDK_COMMON_NAMES.has(name)) return false;
```

**Acceptance**: `isUserDefinedType('List')` → false; `isUserDefinedType('T')` → false; `isUserDefinedType('MyService')` → true; `isUserDefinedType('java.util.List')` → false (covered by existing `java.` check, but `extractTypeName` would have stripped the generics leaving `java.util.List` — which is then checked by the `java.` prefix guard).

### Stage B2 — Tests

**File**: `tests/unit/plugins/java/archjson-mapper.test.ts` (or create new test file if needed)

Add test group: `describe('isUserDefinedType — expanded exclusion list')`:

- Single-letter generics: `T`, `E`, `K`, `V` → false
- Two-letter variants: `T1`, `K1`, `V2` → false
- JDK collections: `List`, `Map`, `Set`, `Collection` → false
- JDK exceptions: `Exception`, `RuntimeException`, `IOException` → false
- JDK I/O: `InputStream`, `Path`, `File` → false
- Framework: `Builder`, `Response`, `Request` → false
- User-defined: `MyService`, `UserRepository`, `OrderProcessor` → true
- Primitives (already covered): `int`, `String`, `Object` → false

**Dependencies**: B1

---

## Phase C — Java: Fix MRJAR Directory Inflation

**Files**: `src/parser/archjson-aggregator.ts`, `tests/unit/parser/archjson-aggregator.test.ts`
**Estimated lines**: ~15 source + ~20 test

### Stage C1 — Add MRJAR guard in extractJavaMavenModule()

**File**: `src/parser/archjson-aggregator.ts`

After `const match = ...`:

```typescript
const moduleName = match?.[1] ?? null;
if (!moduleName) return null;

// Skip Multi-Release JAR version directories (java20, java21, java22, etc.)
if (/^java\d+$/.test(moduleName) || moduleName === 'META-INF') {
  return null;
}

return moduleName;
```

**Acceptance**: Path `jlama-native/src/main/java21/...` with `java21` as captured group → returns null.

### Stage C2 — Tests

**File**: `tests/unit/parser/archjson-aggregator.test.ts`

`extractJavaMavenModule()` is private; test indirectly via `aggregator.aggregate()` with a Java ArchJSON containing entities whose `sourceLocation.file` paths use MRJAR patterns. Check that MRJAR paths do not produce spurious extra modules in the aggregated package-level output.

Scenarios to test (entities at given paths in a Java ArchJSON):

- Entity at `jlama-native/src/main/java21/com/github/Foo.java` → should NOT produce a `java21` module (returns null, entity falls into root or `jlama-native` module)
- Entity at `jlama-native/src/main/java22/com/github/Bar.java` → same
- Entity at `jlama-native/src/main/java/com/github/Baz.java` → produces `jlama-native` module (normal path unaffected)
- Entity at `jlama-core/src/test/java/com/github/Test.java` → produces `jlama-core` module (test sources unaffected)

**Dependencies**: C1

---

## Phase D — Python: Fix Async Helper Test False Positives

**Files**: `src/plugins/python/index.ts`, `tests/unit/plugins/python/python-plugin.test.ts`
**Estimated lines**: ~20 source + ~25 test

### Stage D1 — File-level assertion floor heuristic

**File**: `src/plugins/python/index.ts`, in `extractTestStructure()` after the test case extraction loop

After `if (testCases.length === 0) return null;`, add:

```typescript
// Pragmatic fix for async helper patterns:
// If ALL test cases have assertionCount=0 but the file has assertions in helpers,
// set a floor of 1 per non-skipped test case to avoid false zero-assertion reports.
const allTestsZero = testCases.every((tc) => tc.assertionCount === 0);
if (allTestsZero) {
  const fileAssertionCount = lines.filter(
    (l) => assertionPatterns.some((ap) => l.includes(ap))
  ).length;
  if (fileAssertionCount > 0) {
    for (const tc of testCases) {
      if (!tc.isSkipped) {
        tc.assertionCount = 1;
      }
    }
  }
}
```

**Acceptance**: A test file where `test_foo()` body has 0 assertions but file has `assert` in a helper → `testCases[0].assertionCount === 1`.

### Stage D2 — Tests

**File**: `tests/unit/plugins/python/python-plugin.test.ts`

Add test group: `describe('extractTestStructure — async helper assertion floor')`:

- File with `test_foo()` calling `_assert_something()` and all assertions in helper → `assertionCount = 1` (not 0)
- File where ALL assertions are genuinely absent (no assert anywhere) → `assertionCount = 0` (floor not triggered)
- File where test body has assertions within 30 lines → unchanged (normal path)
- Skipped test case with zero assertions in helper file → `assertionCount = 0` (skip not modified)

**Dependencies**: D1

---

## Phase E — Python: Fix Package Diagram Missing Relations

**Files**: `src/mermaid/generator.ts`, `tests/unit/mermaid/generator.test.ts` (or new test file)
**Estimated lines**: ~25 source + ~30 test

### Stage E1 — Build module prefix index in generateRelations()

**File**: `src/mermaid/generator.ts`, `generateRelations()` method

Replace current filter logic with prefix-aware filter:

```typescript
private generateRelations(_packageGroups: PackageGroup[]): string[] {
  const lines: string[] = [];
  const knownEntityNames = new Set(this.archJson.entities.map((e) => e.name));
  const knownEntityIds = new Set(this.archJson.entities.map((e) => e.id));

  // Build module prefix index for Python/module-level relation sources
  // e.g., entity ID 'lmdeploy.pytorch.models.LlamaModel' → prefixes:
  //   'lmdeploy', 'lmdeploy.pytorch', 'lmdeploy.pytorch.models'
  const moduleIdPrefixes = new Set<string>();
  for (const id of knownEntityIds) {
    const parts = id.split('.');
    for (let i = 1; i < parts.length; i++) {
      moduleIdPrefixes.add(parts.slice(0, i).join('.'));
    }
  }

  for (const relation of this.archJson.relations) {
    const sourceKnown =
      knownEntityNames.has(relation.source) ||
      knownEntityIds.has(relation.source) ||
      moduleIdPrefixes.has(relation.source);

    if (sourceKnown && !this.isNoisyTarget(relation.target)) {
      lines.push(`  ${this.generateRelationLine(relation)}`);
    }
  }

  return lines;
}
```

**Acceptance**: A relation with source `lmdeploy.pytorch.models` (module-level) where entity `lmdeploy.pytorch.models.LlamaModel` exists → relation is included in package diagram output.

### Stage E2 — Tests

**File**: `tests/unit/mermaid/generator.test.ts`

Add test group: `describe('generateRelations — module-level source IDs (Python)')`:

- Entity `myapp.models.UserModel` + relation source `myapp.models` → relation included
- Entity `myapp.models.UserModel` + relation source `myapp` → relation included
- Entity `MyClass` + relation source `MyClass` → relation included (existing path)
- Entity `myapp.models.UserModel` + relation source `myapp.utils` (no matching entity prefix) → relation excluded
- Noisy target `z.infer` → relation excluded regardless of source

**Dependencies**: E1

---

## Dependency Graph

```
Phase A (git-history) — independent
Phase B (java relations) — independent
Phase C (java MRJAR) — independent
Phase D (python tests) — independent
Phase E (python diagram) — independent
```

All 5 phases are mutually independent and can be implemented in any order or in parallel.

---

## Testing Strategy

- **TDD**: Write failing tests in Stage x2/x4 before implementing x1/x3.
- **Coverage**: Each phase adds tests covering the bug scenario + regression guard + edge cases.
- **No integration tests needed**: All fixes are pure logic changes testable with unit mocks.
- **Existing test suite**: Must remain green (2787 tests passing) after all phases complete.

---

## Acceptance Criteria

| Phase | Criterion |
|---|---|
| A | `topContributors[i].share <= 1.0` for all package metrics, even with overlapping file commits |
| B | `isUserDefinedType('List')` → false; Java analysis of Jlama reduces false-positive relations by ~90% |
| C | `extractJavaMavenModule('jlama-native/src/main/java21/...')` → null |
| D | Test file with assertions only in helper methods does not report zero-assertion tests |
| E | Python package diagram for lmdeploy shows inter-package arrows |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Phase A: `contributorShas` missing for older data | Fall back to `topContributors[i].commitCount` sum if `contributorShas` absent |
| Phase B: `Builder`/`Response` as legitimate user types | Only affects unqualified simple names; fully-qualified imports bypass the filter |
| Phase C: Non-MRJAR modules named `java21` | Extremely unlikely in practice; the pattern `/^java\d+$/` is specific |
| Phase D: Floor heuristic masks genuine zero-assertion | Floor only triggers when file has ≥1 assertion; file-wide scan is reliable |
| Phase E: Prefix index is O(entities×depth) | Typical project: ~1000 entities × depth 4 = ~4000 ops, <1ms |

# Information Shape Smell Detection: Literal Dispersion, Hidden Coupling, and Cross-Layer Semantic Drift

> Status: Draft
> Date: 2026-03-29
> Scope: Add a detection pipeline for design defects that manifest as information shape
>        mismatches — where a scalar value (enum/union) is used across modules in ways that
>        indicate a missing abstraction (profile, capability set, strategy pattern).
> Depends on: [ADR-004](../adr/004-single-analysis-write-path-for-cli-and-mcp.md),
>             [ADR-006](../adr/006-mcp-tool-design-standards.md)
> Origin: Observed in viewlint's `appKind` evolution — a string literal union
>         (`"public-site" | "map-workbench" | ...`) spread across 4 modules as conditional
>         branches before being refactored into a profile/capability-pack registry.

---

## Background

ArchGuard currently provides two categories of design feedback:

1. **Static structure analysis** — dependency cycles, fan-in/fan-out, entity/relation metrics,
   class hierarchy depth.
2. **Evolutionary analysis** — co-change coupling, change risk, ownership concentration, churn.

These cover OOD smells (God class, Shotgun Surgery via co-change) and structural health
(cycles, coupling). But there is a category of design defect that neither layer reliably
detects:

> A scalar value (enum, string literal union, discriminator field) that controls conditional
> behavior across multiple modules, where the true design intent requires a structured
> abstraction (profile, capability set, strategy pattern, plugin).

This defect pattern has specific characteristics:

- **No dependency cycle** — modules don't import each other; they share a type definition.
- **No God class** — each module is reasonably sized and focused.
- **High co-change** — modules change together when the enum is extended, but the reason is
  invisible to pure structural analysis.
- **Semantic drift** — the same enum value means different things in different modules
  (data extraction in one, query organization in another, rule prerequisite in a third).

In Geometric Information Theory (GIT) terms: the enum's Fisher Information matrix is rank-1
(scalar), but the output space it controls is rank-N (N independent behavioral dimensions).
The rank deficiency is the design defect.

### Motivating Case: viewlint `appKind`

In the viewlint project, `appKind` (a 4-value string union: `"public-site"`,
`"map-workbench"`, `"dashboard"`, `"flow-app"`) evolved through this sequence:

1. Introduced as a configuration label in `types.ts` and `config.ts` — benign.
2. Used as a conditional gate in `capture.ts` — `if (appKind === "map-workbench")
   { deriveShellFacts(...) }` — first behavioral branch.
3. Used in `query-engine.ts` — `appKind === "map-workbench" ? "panel-centric" : ...` —
   second behavioral branch in a different semantic layer.
4. Used in `rules.ts` — `appKind === "map-workbench" && satisfiesMapWorkbenchPrimaryEntry()`
   — third behavioral branch in yet another semantic layer.

At this point, the literal dispersion of `"map-workbench"` was 3 (across capture, query,
rules). Adding a new app kind would require modifying all 3 modules — classic Shotgun Surgery,
but invisible to dependency-graph analysis because the coupling is through shared enum values,
not import edges.

The fix was an `AppProfile` registry with capability packs, replacing all `appKind ===`
comparisons with `hasCapabilityPack(state, "shell-extraction")`. Dispersion dropped to 0.

**ArchGuard's co-change analysis did detect the symptom** (rules.ts ↔ query-engine.ts
strength 0.45 with no direct dependency), **but could not name the cause** (shared
`"map-workbench"` literal) or suggest the remedy (profile/capability abstraction).

---

## Goals

1. Detect **literal dispersion** — enum/union/discriminator values compared across multiple
   modules — as a first-class smell with actionable reports.
2. Detect **hidden coupling** — file pairs with high co-change but no static dependency — by
   cross-referencing evolutionary and structural data.
3. Provide **enum extension impact** estimates — when an enum/union type changes, how many
   files historically need simultaneous modification.
4. Expose results through MCP tools aligned with existing query conventions.
5. Support TypeScript and Go in the first iteration; design for language-extensibility.

## Non-Goals

- Do not perform semantic classification of what each conditional branch does (that requires
  LLM-level understanding; this proposal stays mechanical).
- Do not auto-generate refactoring suggestions (profile extraction, strategy pattern). Report
  the smell; leave the remedy to the developer/agent.
- Do not replace existing co-change or cycle detection. This is a complementary signal.
- Do not attempt to detect all forms of Shotgun Surgery. This proposal focuses specifically
  on the enum/literal dispersion variant.

---

## Current State Audit

### What ArchGuard can detect today

| Signal | Tool | Detects appKind problem? |
|--------|------|--------------------------|
| Dependency cycles | `archguard_detect_cycles` | No — no cycle exists |
| Entity fan-in/fan-out | `archguard_summary` | Partially — types.ts has high dependents |
| Co-change coupling | `archguard_get_cochange` | Symptom only — "these files change together" |
| Change risk | `archguard_get_change_risk` | Symptom only — "these files are risky" |

### What ArchGuard cannot detect today

1. **TypeScript type alias consumers** — `AppKind` is a string literal union type, not a
   class/interface. `archguard_get_dependents("AppKind")` returns empty.
2. **Literal value dispersion** — no tool tracks where specific enum values are compared.
3. **Co-change × no-dependency cross-reference** — co-change and dependency are independent
   queries with no built-in "hidden coupling" combination.
4. **Enum extension impact** — no tool measures the historical file spread when a type
   definition changes.

### Existing extension points

- **ArchJSON extensions** (ADR-002) — can carry additional analysis data per scope.
- **MCP tool registration** — new tools can be added following ADR-006 conventions.
- **Git history artifacts** — `.archguard/query/git-history/` already stores co-change data.
- **FileStats in metrics** — per-file structural data is already computed.

---

## Proposed Design

### Design Principles

#### 1. Mechanical detection, not semantic interpretation

All detections in this proposal are based on syntactic patterns (literal comparisons, type
references) and statistical signals (co-change × dependency cross). No detection requires
understanding what the code "means". This keeps the system deterministic and auditable.

#### 2. Three-layer detection pipeline

```
Layer 1: Literal Dispersion Analysis (static, per-analysis)
  Input:  ArchJSON entities + source files
  Output: LiteralDispersionSmell[]

Layer 2: Hidden Coupling Detection (static × evolutionary, requires git history)
  Input:  Co-change data + dependency graph
  Output: HiddenCouplingSmell[]

Layer 3: Enum Extension Impact (evolutionary, requires git history)
  Input:  Git history + type definition changes
  Output: EnumExtensionImpact[]
```

Layers are independent and incrementally adoptable. Layer 1 requires only static analysis.
Layers 2-3 require `archguard_analyze_git` to have been run first.

#### 3. Persist results alongside existing query artifacts

Store detection results under:

```
<projectRoot>/.archguard/query/shape-smells/
  manifest.json
  literal-dispersion.json
  hidden-coupling.json
  enum-extension-impact.json
```

### Layer 1: Literal Dispersion Analysis

#### What it detects

Given a discriminated type (enum, string literal union, discriminated union), find values
that are compared (`=== value` or `value ===`) in multiple distinct source files.

#### Algorithm

```
Input: source files, parsed type definitions from ArchJSON

1. Identify candidate discriminator types:
   - TypeScript: string literal union types, enum declarations
   - Go: const groups with iota, string-typed const blocks

2. For each candidate type T with values {v1, v2, ...}:
   a. For each value vi:
      - Scan source files for patterns:
        - `=== "vi"` or `"vi" ===`
        - `=== vi` or `vi ===` (for non-string enums)
        - switch/case branches on vi
      - Record: { value: vi, files: Set<filePath>, locations: SourceLocation[] }
   b. Compute dispersion(vi) = |unique files containing comparisons on vi|

3. Report smells where dispersion(vi) >= threshold (default: 2)
```

#### Output type

```typescript
interface LiteralDispersionSmell {
  type: "literal-dispersion";
  severity: "info" | "warning";            // info at 2, warning at 3+
  discriminatorType: string;                // e.g., "AppKind"
  discriminatorLocation: SourceLocation;    // where the type is defined
  value: string;                            // e.g., "map-workbench"
  dispersion: number;                       // number of distinct files
  files: Array<{
    filePath: string;
    locations: SourceLocation[];            // each comparison site
  }>;
  message: string;
  suggestion: string;
}
```

#### Example output

```json
{
  "type": "literal-dispersion",
  "severity": "warning",
  "discriminatorType": "AppKind",
  "value": "map-workbench",
  "dispersion": 3,
  "files": [
    { "filePath": "src/capture.ts", "locations": [{ "line": 1053 }] },
    { "filePath": "src/query-engine.ts", "locations": [{ "line": 180 }, { "line": 181 }] },
    { "filePath": "src/rules.ts", "locations": [{ "line": 149 }] }
  ],
  "message": "Value \"map-workbench\" of type AppKind is compared in 3 files. Adding a new AppKind value may require changes to all 3.",
  "suggestion": "Consider extracting appKind-dependent behavior into a profile or strategy pattern to reduce cross-module coupling."
}
```

### Layer 2: Hidden Coupling Detection

#### What it detects

File pairs with high co-change strength but no direct static dependency (no import/require
edge in the dependency graph). This indicates coupling through a shared concept that is not
explicitly modeled.

#### Algorithm

```
Input: co-change adjacency (from git history), dependency graph (from ArchJSON)

1. Load co-change pairs where strength >= threshold (default: 0.3)
2. Load static dependency edges (import/require/use relations)
3. For each co-change pair (A, B):
   a. Check if A imports B, B imports A, or both share a common direct import
   b. If NO static dependency exists:
      - Report as hidden coupling
      - Attempt to identify shared discriminator:
        i. Find types imported by BOTH A and B
        ii. Among those shared types, check if any has literal dispersion >= 2
            covering both A and B
        iii. If found, annotate the coupling with the shared discriminator

4. Report hidden coupling smells
```

#### Output type

```typescript
interface HiddenCouplingSmell {
  type: "hidden-coupling";
  severity: "info" | "warning";
  fileA: string;
  fileB: string;
  cochangeStrength: number;
  hasStaticDependency: boolean;                // always false for reported smells
  sharedDiscriminator: string | null;          // e.g., "AppKind" if identified
  sharedDiscriminatorValues: string[];         // e.g., ["map-workbench"]
  message: string;
}
```

### Layer 3: Enum Extension Impact

#### What it detects

When a type definition file changes (specifically: a discriminator type gains or loses a
value), how many other files need to change in the same commit. This is a historical measure
of Shotgun Surgery severity for enum-like types.

#### Algorithm

```
Input: git commit history, type definition file locations

1. Identify commits that modified discriminator type definitions:
   - Parse diff hunks in type definition files
   - Detect added/removed enum values or union members

2. For each such commit:
   a. Count other files changed in the same commit
   b. Record: { type, addedValue, commitHash, affectedFiles[] }

3. Aggregate per discriminator type:
   - mean/median/max affected file count
   - trend over time (increasing = getting worse)
```

#### Output type

```typescript
interface EnumExtensionImpact {
  type: "enum-extension-impact";
  discriminatorType: string;
  location: SourceLocation;
  extensionEvents: Array<{
    commitHash: string;
    date: string;
    addedValues: string[];
    removedValues: string[];
    affectedFileCount: number;
    affectedFiles: string[];
  }>;
  summary: {
    eventCount: number;
    meanAffectedFiles: number;
    maxAffectedFiles: number;
    trend: "increasing" | "stable" | "decreasing";
  };
  message: string;
}
```

---

## Proposed MCP Tools

### `archguard_detect_shape_smells`

Purpose: Run all applicable detection layers and return a summary of information shape smells.

```typescript
// Parameters
{
  projectRoot?: string;
  scope?: string;
  layers?: ("literal-dispersion" | "hidden-coupling" | "enum-extension-impact")[];
  dispersionThreshold?: number;    // default: 2
  cochangeThreshold?: number;      // default: 0.3
}

// Response
{
  literalDispersion: LiteralDispersionSmell[];
  hiddenCoupling: HiddenCouplingSmell[];
  enumExtensionImpact: EnumExtensionImpact[];
  summary: {
    totalSmells: number;
    byLayer: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
```

Description: "Detect information shape smells: literal dispersion (enum values compared
across modules), hidden coupling (co-change without dependency), and enum extension impact
(Shotgun Surgery on type changes). Layers 2-3 require archguard_analyze_git first."

### `archguard_get_literal_dispersion`

Purpose: Query literal dispersion for a specific type or value.

```typescript
// Parameters
{
  projectRoot?: string;
  scope?: string;
  typeName?: string;     // filter to a specific type
  value?: string;        // filter to a specific value
  minDispersion?: number; // default: 1 (show all)
}
```

Description: "Return literal dispersion data for enum/union type values. Shows which files
compare each value and the total dispersion count. High dispersion (>= 2) suggests a missing
abstraction."

---

## Implementation Scope

### New files

| File | Purpose |
|------|---------|
| `src/analysis/shape-smells/literal-dispersion.ts` | Layer 1 detector |
| `src/analysis/shape-smells/hidden-coupling.ts` | Layer 2 detector |
| `src/analysis/shape-smells/enum-extension-impact.ts` | Layer 3 detector |
| `src/analysis/shape-smells/types.ts` | Shared types for smell results |
| `src/analysis/shape-smells/index.ts` | Pipeline orchestration |
| `tests/analysis/shape-smells/literal-dispersion.test.ts` | Layer 1 tests |
| `tests/analysis/shape-smells/hidden-coupling.test.ts` | Layer 2 tests |
| `tests/analysis/shape-smells/enum-extension-impact.test.ts` | Layer 3 tests |

### Modified files

| File | Change |
|------|--------|
| `src/cli/mcp/mcp-server.ts` | Register new MCP tools |
| `src/cli/mcp/mcp-tools.ts` | Tool implementations |
| `src/types/extensions.ts` | Add ShapeSmellExtension type |
| `src/cli/analyze/run-analysis.ts` | Optional shape-smell analysis pass |

### Unchanged

- Parser layer — no changes to language plugins or entity extraction.
- ArchJSON core — shape smells are stored as separate query artifacts, not in ArchJSON.
- Existing MCP tools — no modifications to current tool behavior.

---

## Acceptance Criteria

1. `archguard_detect_shape_smells` with `layers: ["literal-dispersion"]` detects TypeScript
   string literal union values compared in >= 2 files.
2. Detection correctly identifies `switch`/`case` branches, `=== "value"`, and
   `"value" ===` patterns.
3. `archguard_detect_shape_smells` with `layers: ["hidden-coupling"]` cross-references
   co-change data with dependency graph and reports file pairs with strength >= 0.3 but no
   static dependency.
4. Hidden coupling detection annotates smells with the shared discriminator type when one is
   identifiable.
5. `archguard_detect_shape_smells` with `layers: ["enum-extension-impact"]` identifies
   commits where discriminator types were extended and counts affected files.
6. All three layers produce well-typed, structured output matching the proposed interfaces.
7. Results are persisted under `.archguard/query/shape-smells/` and are queryable without
   re-running analysis.
8. `archguard_get_literal_dispersion` supports filtering by type name and value.
9. MCP tool descriptions embed limitations per ADR-006.
10. Self-validation: running detection on ArchGuard's own codebase produces reasonable
    results (low/zero dispersion expected for a well-structured project).
11. Dispersion threshold is configurable (default 2).
12. Layer 2 and 3 gracefully degrade when git history data is not available (return empty
    results with a diagnostic message, not an error).

---

## Risks & Mitigations

### Risk 1: False positives from legitimate multi-site enum usage

Some enum comparisons across modules are intentional and healthy (e.g., a `LogLevel` enum
compared in both a logger and a formatter).

**Mitigation**: Report dispersion as a metric, not a verdict. Severity is "info" at
dispersion 2, "warning" at 3+. Users/agents decide whether a specific instance warrants
refactoring.

### Risk 2: TypeScript type alias resolution gaps

ArchGuard's TypeScript parser currently does not resolve type aliases to their underlying
values. `type AppKind = "public-site" | "map-workbench"` may not be directly linked to the
string literals used in comparisons.

**Mitigation**: Layer 1 can work without full type resolution by scanning for known enum/union
patterns in source files (regex-based extraction of `type X = "a" | "b" | ...` and
`enum X { ... }`). Full AST-based resolution is a v2 enhancement.

### Risk 3: Performance on large codebases

Scanning all source files for literal patterns could be slow on large projects.

**Mitigation**: Scope scanning to files that import the discriminator type (use dependency
graph as a filter). Fall back to full scan only when type resolution is unavailable.

### Risk 4: Go has different enum patterns

Go uses `const` groups with `iota` rather than `enum` or union types.

**Mitigation**: Plugin-specific discriminator extractors. TypeScript and Go extractors have
different patterns but produce the same `DiscriminatorType` intermediate representation.
Defer other languages to future iterations.

---

## Testing & Validation

### Unit tests

- Layer 1: Synthetic TypeScript files with known dispersion patterns.
- Layer 2: Mock co-change data + mock dependency graph, verify cross-reference logic.
- Layer 3: Mock git history with type-changing commits, verify impact calculation.

### Integration tests

- Run Layer 1 on ArchGuard's own codebase; verify zero or near-zero dispersion (healthy
  codebase should have low dispersion).
- Run full pipeline on a test fixture with deliberately planted appKind-style smells.

### Regression tests

- Ensure existing MCP tools are not affected by new analysis modules.
- Ensure `archguard_analyze` without shape-smell flags does not invoke new detectors.

---

## Recommended Scope Cut

### v1 (this proposal)

- Layer 1: Literal dispersion for TypeScript string literal unions and enums.
- Layer 2: Hidden coupling detection with optional discriminator annotation.
- Layer 3: Enum extension impact from git history.
- Two MCP tools: `archguard_detect_shape_smells`, `archguard_get_literal_dispersion`.
- TypeScript only for Layer 1 discriminator extraction; Layer 2-3 are language-agnostic.

### Deferred to v2

- Go `const`/`iota` discriminator extraction for Layer 1.
- Full AST-based type alias resolution (currently regex-based).
- Entity-level dispersion (function parameters, not just file-level).
- Trend visualization for enum extension impact over time.
- Integration with `archguard_get_change_context` (embed dispersion hints in context).
- Automatic refactoring suggestion generation.

---

## Theoretical Foundation

This proposal operationalizes concepts from Geometric Information Theory (GIT) applied to
software architecture:

- **Literal dispersion** detects Fisher Information rank deficiency — a scalar value controls
  an output space of higher dimension than the value itself can represent.
- **Hidden coupling** detects implicit information flow — modules share a concept that is not
  modeled as an explicit dependency edge, creating invisible co-evolution pressure.
- **Enum extension impact** measures the empirical Shotgun Surgery cost — the actual number
  of files that must change when the type's information capacity is extended by one value.

These three signals together form a detection pipeline for **information shape mismatches** —
cases where the declared shape of a value (scalar enum) does not match the true shape of the
behavior it controls (multi-dimensional capability set).

For detailed theoretical background, see:
- `docs/references/GIT_Analysis_for_ArchGuard.md`
- viewlint `docs/references/GIT_practice_information_shape_in_ai_assisted_architecture.md`

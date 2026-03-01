# Go Flow Graph: Framework Detection & Entry Point Redesign

> Status: Draft v2
> Branch: feat/go
> Scope: Replace `entryPointTypes` user-facing config with automatic framework detection;
>        restructure entry point classification at protocol level;
>        handle unknown frameworks and non-HTTP services.
> Breaking: Yes — EntryPoint schema change requires GO_ATLAS_EXTENSION_VERSION bump to 2.0
> See also: ADR-002 v2.0

---

## Background

The Go Atlas `flow` layer detects HTTP entry points by scanning function bodies for framework-specific
call patterns (e.g. `router.GET(...)`, `http.HandleFunc(...)`). These patterns are hardcoded in
`FlowGraphBuilder.matchEntryPointPattern()`.

The current design exposes a user-facing config option `entryPointTypes` (and CLI flag
`--atlas-entry-points`) that accepts a list of fine-grained type strings:

```
'http-get' | 'http-post' | 'http-put' | 'http-delete' | 'http-patch'
| 'http-handler' | 'grpc-unary' | 'grpc-stream' | 'cli-command'
```

Three problems exist with this design.

---

## Problems

### Problem 1 — `entryPointTypes` is not actually used

`BehaviorAnalyzer.buildFlowGraph()` receives options but names the parameter `_options`
(intentionally unused), and passes nothing to `FlowGraphBuilder`. Similarly,
`FlowGraphBuilder.detectEntryPoints()` returns the full match list without any filtering.
Configuring `--atlas-entry-points` has zero effect on output.

### Problem 2 — HTTP-method granularity is wrong for architecture diagrams

The type taxonomy conflates two orthogonal concerns:

| Concern | Examples | Useful for |
|---------|---------|------------|
| Protocol boundary | `http`, `grpc`, `cli` | Architecture diagrams ✅ |
| HTTP method | `GET`, `POST`, `PUT` | API docs, security audits ✅ |

For the flow graph the relevant question is *"which packages handle which protocol surface?"* —
not *"which routes are POST vs GET?"* HTTP method is metadata on an endpoint, not an architectural
boundary.

### Problem 3 — Detection is framework-oblivious and incomplete

The builder matches method names (`HandleFunc`, `GET`, …) without knowing which framework the call
comes from. Consequences:

1. **False positives**: any receiver with a method named `GET` matches.
2. **Missing frameworks**: gRPC, cobra, message queues, schedulers — not detected at all.
3. **No escape hatch**: projects using internal or unlisted frameworks cannot configure detection.
4. **No graceful degradation**: zero results produce an empty diagram with no diagnostic.

---

## Detection Failure Scenarios

| Scenario | Current behaviour |
|----------|-------------------|
| Known framework (gin, echo) | Partial — method-name match, no receiver check |
| Unknown HTTP framework (beego, hertz, internal) | Missed entirely |
| gRPC service | Missed entirely |
| CLI tool (cobra, urfave/cli) | Missed entirely |
| Message queue consumer (kafka, nats) | Missed entirely |
| Scheduler (cron) | Missed entirely |
| Pure library (no entry points) | Empty graph, no explanation |

---

## Data Available Without Extra Parsing

Before describing the solution, the data already present in `GoRawData` after a normal parse pass:

| Data needed | Available in | Notes |
|-------------|-------------|-------|
| Module dependencies | Requires extending `GoModResolver` | Currently only parses `module` line |
| Imports per package | `GoRawPackage.imports[*].path` | Already extracted by tree-sitter |
| Method parameter types | `GoMethod.parameters[*].type` (string) | Already extracted |
| Call receiver type | `GoCallExpr.receiverType` (optional string) | Extracted when available |
| Function bodies / calls | `GoFunction.body.calls` / `GoMethod.body.calls` | Only when `functionBodyStrategy !== 'none'` |
| Package name (`main`) | `GoRawPackage.name` | Always available |

Layer 3 (import scanning) therefore costs zero additional I/O — it reads
`rawData.packages[*].imports` already in memory.

---

## Proposed Design

### A. Remove `entryPointTypes` from all user-facing surfaces

Removed from:
- `AtlasConfig.entryPointTypes`
- `AtlasGenerationOptions.entryPointTypes`
- `GoAtlasMetadata.generationStrategy.entryPointTypes`
- CLI flag `--atlas-entry-points`

No migration path — the field never had any effect.

### B. Extend `GoModResolver` to parse `require` directives

`GoModResolver.resolveProject()` currently extracts only the `module` declaration. Add a
`requires` field to `ModuleInfo` and parse the `require` block:

```typescript
export interface ModuleInfo {
  moduleName: string;
  moduleRoot: string;
  goModPath: string;
  requires: GoModRequire[];    // NEW
}

export interface GoModRequire {
  path: string;                // e.g. "github.com/gin-gonic/gin"
  version: string;             // e.g. "v1.9.1"
  indirect: boolean;           // true if "// indirect"
}
```

This is the only place go.mod is parsed; all consumers go through `GoModResolver`.

### C. Three-layer automatic detection in `FrameworkDetector`

New file: `src/plugins/golang/atlas/framework-detector.ts`

`FrameworkDetector` is constructed with the result of `GoModResolver.resolveProject()` and
a `GoRawData` reference. It runs once before `FlowGraphBuilder` and returns a
`DetectedFrameworks` value that controls which call patterns are active.

#### Layer 1 — go.mod `require` scan

Match `ModuleInfo.requires[*].path` against a built-in table:

| go.mod path prefix | Framework key | Protocol |
|--------------------|--------------|---------|
| *(unconditional)* | `net/http` | `http` |
| `github.com/gin-gonic/gin` | `gin` | `http` |
| `github.com/labstack/echo` | `echo` | `http` |
| `github.com/go-chi/chi` | `chi` | `http` |
| `github.com/gorilla/mux` | `gorilla/mux` | `http` |
| `github.com/gofiber/fiber` | `fiber` | `http` |
| `google.golang.org/grpc` | `grpc` | `grpc` |
| `github.com/spf13/cobra` | `cobra` | `cli` |
| `github.com/urfave/cli` | `urfave/cli` | `cli` |
| `github.com/segmentio/kafka-go` | `kafka-go` | `message` |
| `github.com/Shopify/sarama` | `sarama` | `message` |
| `github.com/IBM/sarama` | `sarama` | `message` |
| `github.com/nats-io/nats.go` | `nats` | `message` |
| `github.com/robfig/cron` | `cron` | `scheduler` |

`net/http` is unconditional because it is a standard-library package and will never appear
in `require`.

#### Layer 2 — `GoRawData` import scan (zero extra I/O)

`GoRawPackage.imports[*].path` contains the actual sub-packages imported in each file.
This is more precise than go.mod (which lists top-level modules) and catches:

- Frameworks whose go.mod module path differs from their routing sub-package
  (e.g. `github.com/beego/beego/v2/server/web` — go.mod has `github.com/beego/beego/v2`)
- Any package in the extended pattern table matched by sub-path prefix

The import scan supplements Layer 1; it does not replace it.

Extended pattern table for import-path matching (examples):

| Import path prefix | Framework key | Protocol |
|--------------------|--------------|---------|
| `github.com/beego/beego` | `beego` | `http` |
| `github.com/cloudwego/hertz` | `hertz` | `http` |
| `github.com/iris-contrib/` | `iris` | `http` |
| `github.com/confluentinc/confluent-kafka-go` | `confluent-kafka` | `message` |
| `github.com/aws/aws-sdk-go` + sub-path `sqs` | `sqs` | `message` |

#### Layer 3 — Signature-based fallback (framework-agnostic)

Two patterns applied unconditionally, regardless of detected frameworks:

**`ServeHTTP` method signature**

`GoMethod.name === 'ServeHTTP'` AND parameters match
`(http.ResponseWriter, *http.Request)` — detected via `GoMethod.parameters[*].type` string
comparison. Any type implementing Go's `http.Handler` interface is an HTTP handler regardless
of which router or framework registered it. This catches any framework, including internal or
future ones that honour the standard Go HTTP contract.

**`main()` function in package `main`**

`GoRawPackage.name === 'main'` AND `GoFunction.name === 'main'` — always emitted as an entry
point with `protocol: 'cli'`. This provides a universal anchor for call-chain analysis when
no specific framework is detected, and is correct for any Go binary.

This is **not** detected via `GoCallExpr` pattern matching. It requires a dedicated scan in
`detectEntryPoints()` (separate from the FRAMEWORK_PATTERNS dispatch loop) that looks for a
`GoFunction` named `'main'` inside a package whose `name` is `'main'`. The resulting
`EntryPoint` object is fully specified as:

```typescript
{
  id:         `entry-${pkg.fullName}-main`,
  protocol:   'cli',
  method:     undefined,      // no HTTP method for CLI
  framework:  'main',
  path:       '',             // no URL path; CLI tools have no route
  handler:    'main.main',
  middleware: [],
  package:    pkg.fullName,
  location:   { file: func.location.file, line: func.location.startLine },
}
```

Both Layer 3 patterns operate on data already in `GoRawData` and require no function body
(`body` field is not needed for signature detection or package-name detection).

**Important**: `ServeHTTP` detection and call-chain tracing from it DO require
`functionBodyStrategy !== 'none'` for the body-tracing step. Detection of the handler itself
is body-independent; tracing its outbound calls requires the body.

### D. `functionBodyStrategy` linked to requested layers

Currently the strategy defaults to `'selective'` regardless of which layers are requested.
Formalise the dependency:

| Layers requested | Required body strategy |
|-----------------|----------------------|
| `package`, `capability` only | `'none'` (no body needed) |
| `goroutine` or `flow` included | `'selective'` minimum |

When `functionBodyStrategy` is not explicitly set, infer it from the layers list:

```typescript
function inferBodyStrategy(layers: AtlasLayer[]): FunctionBodyStrategy {
  const needsBody = layers.some(l => l === 'goroutine' || l === 'flow');
  return needsBody ? 'selective' : 'none';
}
```

Applied in `GoAtlasPlugin.parseProject()` before calling `generateAtlas()`.

### E. Restructure `EntryPoint` — protocol + method as separate fields

`EntryPointType` (the current closed union) is removed. `EntryPoint` gains three new fields
and loses `type`:

```typescript
// Before (extensions.ts)
export type EntryPointType =
  | 'http-get' | 'http-post' | 'http-put' | 'http-delete' | 'http-patch'
  | 'http-handler' | 'grpc-unary' | 'grpc-stream' | 'cli-command';

export interface EntryPoint {
  id: string;
  type: EntryPointType;
  path: string;
  handler: string;
  middleware: string[];
  package?: string;
  location: { file: string; line: number };
}
```

```typescript
// After (extensions.ts)

/**
 * Protocol surface. Built-in values are documented; open string allows
 * user-defined values via customFrameworks config without requiring a
 * source change to ArchGuard.
 * Built-ins: 'http' | 'grpc' | 'cli' | 'message' | 'scheduler'
 */
export type EntryPointProtocol = string;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';

export interface EntryPoint {
  id: string;
  protocol: EntryPointProtocol;       // replaces `type`
  method?: HttpMethod;                 // only set when protocol === 'http'
  framework: string;                   // which detector produced this (e.g. 'gin', 'net/http')
  path: string;                        // URL path, gRPC method, topic name, etc.
  handler: string;
  middleware: string[];
  package?: string;
  location: { file: string; line: number };
}
```

`EntryPointType` is fully removed from `extensions.ts` and `atlas/types.ts`.

### F. Framework-aware call pattern dispatch in `FlowGraphBuilder`

`FlowGraphBuilder.build()` receives a `FlowBuildOptions` parameter (containing
`DetectedFrameworks` and optional `CustomFrameworkConfig[]`) at **call time** — not at
construction time. This is required because `FrameworkDetector` runs inside
`GoAtlasPlugin.generateAtlas()`, which executes after `BehaviorAnalyzer` (and its builders)
are already constructed.

Active pattern sets selected based on `detectedFrameworks`:

```
net/http active      → HandleFunc / Handle
                       (receiverContains: 'ServeMux' or empty receiver = pkg-level call)
gin active           → GET/POST/PUT/DELETE/PATCH/Any
                       (receiverContains: 'gin.Engine' or 'gin.RouterGroup')
gorilla/mux active   → Handle / HandleFunc
                       (receiverContains: 'mux.Router' — disambiguates from net/http)
echo active          → GET/POST/… (receiverContains: 'echo.Echo' or 'echo.Group')
chi active           → Get/Post/… (receiverContains: 'chi.Router')
grpc active          → Register*Server pattern (methodSuffix: 'Server')
cobra active         → AddCommand call on cobra.Command root object
kafka-go active      → ConsumePartition / ConsumerGroup handler registration
nats active          → Subscribe / QueueSubscribe on *nats.Conn
cron active          → AddFunc / AddJob on *cron.Cron
ServeHTTP fallback   → any method matching (http.ResponseWriter, *http.Request)
main() fallback      → GoRawPackage.name === 'main', GoFunction.name === 'main'
customFrameworks     → user-defined call patterns (§G)
```

The internal `CallPattern` type carries optional disambiguation fields:

```typescript
interface CallPattern {
  method?: string;            // exact functionName match
  methodSuffix?: string;      // suffix match: call.functionName.endsWith(methodSuffix)
  receiverContains?: string;  // substring of GoCallExpr.receiverType for disambiguation
  protocol: string;
  httpMethod?: HttpMethod;
}
```

When `GoCallExpr.receiverType` is absent (sparse — see Open Questions §1), fall back to
method-name-only matching and record a metadata warning when ambiguity exists (e.g., both
`net/http` and `gorilla/mux` detected and a shared method name is encountered).

`main()` is not detected via `GoCallExpr`; it requires a dedicated scan of `GoFunction` names
within packages where `GoRawPackage.name === 'main'`. The resulting `EntryPoint` uses:
```
protocol:  'cli'
method:    undefined
framework: 'main'
path:      ''       (no URL path for a CLI entry anchor)
handler:   'main.main'
middleware: []
location:  from GoFunction.location
```

### G. Manual configuration — two-level escape hatch

#### Level 1 — Custom framework patterns

Declare call patterns for unlisted frameworks in `archguard.config.json`:

```json
{
  "atlas": {
    "customFrameworks": [
      {
        "name": "hertz",
        "protocol": "http",
        "patterns": [
          { "method": "GET",    "pathArgIndex": 0, "handlerArgIndex": 1 },
          { "method": "POST",   "pathArgIndex": 0, "handlerArgIndex": 1 },
          { "method": "Handle", "pathArgIndex": 1, "handlerArgIndex": 2 }
        ]
      },
      {
        "name": "internal-worker",
        "protocol": "message",
        "patterns": [
          { "method": "Subscribe", "topicArgIndex": 0 }
        ]
      }
    ]
  }
}
```

`pathArgIndex` and `handlerArgIndex` are indices into `GoCallExpr.args[]` (already a `string[]`
in the existing type). No new parsing is needed.

#### Level 2 — Explicit entry point list

When pattern matching is infeasible, specify functions directly:

```json
{
  "atlas": {
    "entryPoints": [
      { "function": "internal/server.(*Router).dispatch", "protocol": "http" },
      { "function": "worker.ConsumeLoop",                 "protocol": "message" }
    ]
  }
}
```

`function` uses the fully-qualified Go identifier `package/path.(*ReceiverType).MethodName`
(receiver optional for package-level functions). These entry points are injected directly into
`FlowGraph.entryPoints` and bypass all pattern matching. Call-chain tracing from them still
uses the normal body-scan mechanism.

No annotation-based entry points are supported. This is a static analysis tool; detection
must be derivable from fixed syntactic rules without external annotation systems.

### H. Protocol-level filtering (replaces `entryPointTypes`)

Filtering is applied inside `FlowGraphBuilder.build()` after all detection, before returning
`FlowGraph`. This is the correct location because it must also prune `callChains` that reference
a filtered-out entry point.

```typescript
// Applied at the end of FlowGraphBuilder.build()
if (this.protocols && this.protocols.length > 0) {
  const allowed = new Set(this.protocols);
  graph.entryPoints = graph.entryPoints.filter(e => allowed.has(e.protocol));
  const kept = new Set(graph.entryPoints.map(e => e.id));
  graph.callChains = graph.callChains.filter(c => kept.has(c.entryPoint));
}
```

CLI: `--atlas-protocols http,grpc` (comma-separated; default: all).
Config: `languageSpecific.atlas.protocols?: string[]`.

### I. Graceful degradation when no entry points are found

When all detection layers return zero entry points:

1. `FlowGraph` is set to `{ entryPoints: [], callChains: [] }` (not omitted — keeps the
   layer structure intact for consumers).
2. A warning is added to `GoAtlasMetadata.warnings`.
3. In verbose mode, a diagnostic is printed listing which frameworks were detected and
   which layers produced results.
4. `MermaidTemplates.renderFlowGraph()` emits a comment-only diagram when entry points
   are empty, so the output file still exists but contains only a note.

```
[atlas/flow] No entry points detected.
  Frameworks detected: net/http (unconditional)
  Patterns tried: HandleFunc, Handle, ServeHTTP, main()
  Suggestion: add 'customFrameworks' or 'entryPoints' to archguard.config.json
[atlas/flow] Flow diagram will be empty.
```

### J. Protocol-aware rendering in `MermaidTemplates`

`renderFlowGraph()` currently groups entry points by package but ignores `type` entirely.
After this change it reads `protocol` to assign node shapes and styles:

```
protocol === 'http'      → rectangle with HTTP label
protocol === 'grpc'      → rectangle with gRPC label
protocol === 'cli'       → stadium shape (rounded rectangle)
protocol === 'message'   → trapezoid or cylinder shape
protocol === 'scheduler' → hexagon shape
other                    → default rectangle
```

`method` (GET/POST/…) is shown as a label suffix on the node when present.
`framework` is shown as a tooltip comment.

---

## File Changes

| File | Change | Reviewer note |
|------|--------|---------------|
| `src/plugins/golang/atlas/go-mod-resolver.ts` | Add `requires: GoModRequire[]` to `ModuleInfo`; parse `require` block | Prerequisite for Layer 1 |
| `src/types/extensions.ts` | Remove `EntryPointType`; add `EntryPointProtocol`, `HttpMethod`; update `EntryPoint` | ADR-002 v2.0 |
| `src/plugins/golang/atlas/framework-detector.ts` | **New** — three-layer detector using `ModuleInfo.requires` + `GoRawData.imports` + signature scan | Core new module |
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | Accept `FlowBuildOptions` in `build()` parameter; per-framework dispatch; protocol filter at end of `build()` | Replaces `matchEntryPointPattern`; DetectedFrameworks passed at build-time, not construction-time |
| `src/plugins/golang/atlas/behavior-analyzer.ts` | Remove `_` prefix from `_options`; pass `FlowBuildOptions` (protocols, frameworks) to `FlowGraphBuilder.build()` | Options were intentionally ignored — now active |
| `src/plugins/golang/atlas/index.ts` | Run `FrameworkDetector` after `GoModResolver`; infer `functionBodyStrategy` from layers; remove `entryPointTypes`; wire `customFrameworks` + `entryPoints` + `protocols` from config | `parseProject` and `generateAtlas` |
| `src/plugins/golang/atlas/types.ts` | Remove `entryPointTypes` from `AtlasConfig` and `AtlasGenerationOptions`; add `protocols?`, `customFrameworks?`, `entryPoints?` | Config schema |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Protocol-aware node shapes + styles in `renderFlowGraph()` | Currently ignores `type` entirely |
| `src/cli/commands/analyze.ts` | Remove `--atlas-entry-points`; add `--atlas-protocols` | CLI surface |
| `tests/plugins/golang/atlas/flow-graph-builder.test.ts` | Update fixture expectations; add per-framework test cases | Existing tests will fail on `type` field |
| `tests/plugins/golang/atlas/framework-detector.test.ts` | **New** — unit tests for all three detection layers | |
| `tests/plugins/golang/atlas/go-mod-resolver.test.ts` | Add tests for `require` parsing | |
| `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` | Update metadata mock (`entryPointTypes` → `detectedFrameworks`); update version string | |
| `tests/plugins/golang/atlas/behavior-analyzer.test.ts` | Update `buildFlowGraph` call to use `FlowBuildOptions` instead of `entryPointTypes` | |

---

## Detection Priority Summary

```
Automatic (zero config)
  ├── Layer 1: go.mod require scan          ← mainstream frameworks via ModuleInfo.requires
  ├── Layer 2: import-path scan             ← GoRawData.imports, zero extra I/O
  ├── Layer 3a: ServeHTTP signature         ← GoMethod.parameters[*].type, framework-agnostic
  └── Layer 3b: main() in package main      ← always, universal CLI anchor

Manual (with config — archguard.config.json)
  ├── customFrameworks[]                    ← call-pattern level, for unlisted frameworks
  └── entryPoints[]                         ← function level, final escape hatch

Post-detection
  └── protocols filter                      ← inside FlowGraphBuilder.build(), prunes chains too

Graceful degradation
  └── zero results → empty FlowGraph + warning in metadata + verbose diagnostic
```

---

## What Does Not Change

- 4-layer default output (`package`, `capability`, `goroutine`, `flow`) — no config file needed.
- `excludeTests` default (`true`).
- `package`, `capability`, `goroutine` builders — not touched.
- `followIndirectCalls` — remains accepted in config, remains unimplemented (out of scope).

---

## Non-Goals

- `followIndirectCalls` implementation.
- OpenAPI / REST documentation generation.
- Runtime tracing or dynamic entry point discovery.
- Annotation-based entry point marking (not compatible with static-analysis-only approach).

---

## Open Questions

1. **`GoCallExpr.receiverType` coverage**: tree-sitter extracts receiver type for method
   calls on named variables (e.g. `router.GET(...)`). Chained calls and interface-dispatched
   calls may have `receiverType: undefined`. Acceptable? → Document as known gap; gopls
   resolves it when available.

2. **`message` / `scheduler` node shapes in Mermaid**: Mermaid flowchart supports a fixed
   set of node shapes. Trapezoid (`[/text\]`) and hexagon (`{{text}}`) are available.
   Agree on shape-to-protocol mapping before implementing renderer changes.

3. **`customFrameworks` schema location**: Should it live in `AtlasConfig` (parsed via
   `languageSpecific.atlas`) or at the top-level `Config`? Given it is Go-specific,
   `AtlasConfig` is correct. Confirm.

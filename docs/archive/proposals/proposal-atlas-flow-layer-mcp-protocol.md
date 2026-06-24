# Go Atlas Flow Layer: MCP Protocol and Custom Entry Point Detection

> Status: Draft (rev 2 — architect review applied)
> Scope: Make the Go Atlas Flow layer work for MCP servers and other non-HTTP frameworks
> Branch: `feat/atlas-flow-mcp` (future)

---

## Background

The Go Atlas Flow layer (`FlowGraphBuilder`) traces call chains from entry points through
the call graph. Entry point detection is currently hard-coded to a fixed set of HTTP/gRPC/
messaging frameworks: `net/http`, gin, gorilla/mux, echo, chi, cobra, grpc, kafka-go,
sarama, nats, cron.

When ArchGuard was run against `meta-cc` (a Go MCP server), the Flow layer output
**0 entry points and 0 call chains** — because `meta-cc`'s entry points are registered via
`server.AddTool(mcp.NewTool("name", ...), handler)` rather than any framework in the
detection table.

The Flow layer is the Atlas layer with the highest architectural value for understanding
request handling paths. A blank flow diagram is a missed opportunity for any project that
uses a non-HTTP protocol or a custom framework.

---

## Problem Details

### 1. Entry point detection is closed-set

`FlowGraphBuilder.detectEntryPoints()` only fires for 10 hard-coded framework keys.
A project using `github.com/mark3labs/mcp-go`, `github.com/modelcontextprotocol/go-sdk`,
or any internal tool registration pattern produces zero entry points.

### 2. Manual entry points require config per project

The `AtlasConfig.entryPoints: ManualEntryPoint[]` field exists but:
- Requires the user to know the fully-qualified function name syntax
- Is not surfaced in the CLI or config file documentation
- Has no fallback heuristics when unused

### 3. No generic MCP protocol support

MCP servers follow a clear registration pattern, but the two major Go MCP SDKs have
**different call signatures** that must be handled separately:

**mark3labs/mcp-go** — handler is a method on `*MCPServer`:
```go
// handler at args[1]
server.AddTool(mcp.NewTool("tool_name", ...), handlerFunc)
```
Handler type: `func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error)`

**modelcontextprotocol/go-sdk** — handler is a **package-level generic function**,
not a method call on a receiver:
```go
// handler at args[2] — package-level function, not a method
mcp.AddTool(server, &mcp.Tool{...}, handlerFunc)
```
Handler type: `func(context.Context, *mcp.CallToolRequest, In) (*mcp.CallToolResult, Out, error)`

This distinction is critical: the existing `matchCallPattern()` code extracts the handler
from `call.args?.[1]`. For the `go-sdk` pattern the handler is at `args[2]`, and because
`AddTool` is a package-level function (not a method), it will only be captured if its
import path is also detected.

---

## Goals

- Detect MCP server tool handlers as Flow entry points for both major Go MCP SDKs
- Add a generic `RegisterTool`/`AddTool`-style heuristic for when no specific SDK is detected
- Provide a `--atlas-entry-pattern` CLI flag for regex-based custom entry point detection
- When the Flow layer remains empty after standard detection, emit a diagnostic message
  listing the frameworks that were searched
- Keep the existing protocol infrastructure; this is purely additive

---

## Non-Goals

- Full call graph construction (already implemented; unchanged)
- Inter-service flow tracing (out of scope)
- Dynamic dispatch through interfaces (requires type inference beyond tree-sitter)

---

## Existing Infrastructure (Must Understand Before Implementing)

The following types and classes already exist and must be used/extended — do not duplicate:

### `FrameworkDetector` (`src/plugins/golang/atlas/framework-detector.ts`)

A real, 3-layer detection class:
- **Layer 1** `detectFromGoMod`: scans `go.mod` requires against `GO_MOD_FRAMEWORK_MAP`
- **Layer 2** `detectFromImports`: scans raw import paths against both maps
- **Layer 3** `detectFromSignatures`: structural heuristics (ServeHTTP, main package)

Adding support for a new framework means adding its go.mod path to `GO_MOD_FRAMEWORK_MAP`
and its `FRAMEWORK_PATTERNS` entry in `flow-graph-builder.ts`. Both must be done together.

### `CustomCallPattern` (`src/plugins/golang/atlas/types.ts`)

Already has a `handlerArgIndex?: number` field that indicates which `call.args` slot
holds the handler. The current `matchCallPattern()` implementation **ignores** this field
and always uses `call.args?.[1]`. The implementation must be fixed to respect it:

```typescript
// current (wrong for go-sdk):
const rawHandler = call.args?.[1] ?? '';

// corrected:
const handlerArgIdx = activePattern.pattern.handlerArgIndex ?? 1;
const rawHandler = call.args?.[handlerArgIdx] ?? '';
```

### `AtlasConfig` (`src/plugins/golang/atlas/types.ts`)

Current relevant fields:
```typescript
customFrameworks?: CustomFrameworkConfig[];  // structured per-framework override
entryPoints?: ManualEntryPoint[];            // explicit fully-qualified function names
```

The proposed `entryPointPattern?: string` is a new field at a different level of
abstraction — it is a regex matched against `call.functionName` across all scanned calls,
regardless of receiver or import. Its relationship to `customFrameworks` is:
- `customFrameworks` → structured: user specifies method name, protocol, receiver
- `entryPointPattern` → unstructured: user provides a regex; protocol defaults to `'custom'`

Both fields may be active simultaneously. `entryPointPattern` is the simpler escape hatch;
`customFrameworks` is for cases where protocol labeling or receiver disambiguation matters.

### `CLIOptions` and wiring (`src/types/config-cli.ts`)

Any new CLI flag must be added to `CLIOptions` in `src/types/config-cli.ts` **and** wired
through `src/cli/analyze/normalize-to-diagrams.ts` (the place where CLI options are
translated into `AtlasConfig`). Missing either step silently drops the flag value.

---

## Design

### 1. MCP framework pattern table entries

#### 1a. mark3labs/mcp-go

Add to `GO_MOD_FRAMEWORK_MAP` in `framework-detector.ts`:
```typescript
['github.com/mark3labs/mcp-go', 'mcp-go'],
```

Add to `FRAMEWORK_PATTERNS` in `flow-graph-builder.ts`:
```typescript
'mcp-go': [
  { method: 'AddTool',      protocol: 'mcp', handlerArgIndex: 1 },
  { method: 'RegisterTool', protocol: 'mcp', handlerArgIndex: 1 },
],
```

Handler extraction: `call.args[1]` — the handler is the second argument to the method.

#### 1b. modelcontextprotocol/go-sdk

The `go-sdk` uses a **package-level generic function** `mcp.AddTool(server, tool, handler)`.
In the AST this appears as a call expression with `packageName = 'mcp'` and
`functionName = 'AddTool'` (no receiver), with the handler at `args[2]`.

Add to `GO_MOD_FRAMEWORK_MAP`:
```typescript
['github.com/modelcontextprotocol/go-sdk', 'mcp-gosdk'],
```

Add to `FRAMEWORK_PATTERNS`:
```typescript
'mcp-gosdk': [
  {
    method: 'AddTool',
    receiverContains: '',    // package-level: no receiver
    protocol: 'mcp',
    handlerArgIndex: 2,
  },
],
```

> **Implementation note**: Because `matchCallPattern` currently uses `args[1]` hardcoded,
> this is a prerequisite fix — `handlerArgIndex` must be respected before this entry works.
> See "Existing Infrastructure" section above.

### 2. Generic tool-registration heuristic

When no specific MCP framework is detected and the Flow layer would otherwise be empty,
run a secondary pass scanning for calls matching the following suffix/name patterns
(protocol: `'custom'`):

| `functionName` match | Likely pattern |
|---|---|
| ends with `AddTool` | generic MCP/plugin registration |
| ends with `RegisterTool` | alternative registration naming |
| ends with `AddCommand` | CLI command registration (cobra fallback) |
| ends with `Handle` or `HandleFunc` | HTTP fallback for non-gin frameworks |

This secondary scan only activates when the primary detection finds no entry points, to
avoid false positives in projects that do have recognised frameworks.

The secondary scan result sets `protocol: 'custom'` and emits an `info`-level warning:
```
ℹ Flow: entry points found via generic heuristic (not from a detected framework).
  Verify with --atlas-entry-pattern or --atlas-protocols if results are noisy.
```

### 3. `--atlas-entry-pattern` CLI flag

```
--atlas-entry-pattern <regex>
```

Matches against `call.functionName` during the primary detection scan. Any matching call
is treated as an entry point registration with `protocol: 'custom'`.

Example:
```bash
node dist/cli/index.js analyze --lang go --atlas-entry-pattern 'AddTool|RegisterHandler'
```

#### 3a. `AtlasConfig` change

Add to `AtlasConfig` in `src/plugins/golang/atlas/types.ts`:
```typescript
entryPointPattern?: string; // regex matched against call.functionName; protocol: 'custom'
```

This field is orthogonal to `customFrameworks` (which provides structured protocol/receiver
overrides) and to `entryPoints` (which specifies fully-qualified handler names directly).

#### 3b. `CLIOptions` change

Add to `src/types/config-cli.ts`:
```typescript
atlasEntryPattern?: string;
```

#### 3c. CLI flag registration

Add to `createAnalyzeCommand()` in `src/cli/commands/analyze.ts` after the
`--atlas-protocols` option:
```typescript
.option(
  '--atlas-entry-pattern <pattern>',
  'Regex matched against call.functionName for custom entry point detection'
)
```

#### 3d. Wiring in normalize-to-diagrams.ts

In `src/cli/analyze/normalize-to-diagrams.ts`, where `atlasProtocols` is already mapped,
add:
```typescript
entryPointPattern: cliOptions.atlasEntryPattern,
```

Failure to add this step silently drops the flag value — it is a common mistake in this
codebase.

### 4. Empty flow diagnostic

If `entryPoints.length === 0` after all detection passes (primary + secondary), emit
a structured diagnostic. This should be emitted from the Atlas renderer or
`diagram-processor.ts` where the flow graph is available after build, not from
`FlowGraphBuilder` itself (which has no access to the output channel).

Diagnostic format:
```
ℹ Flow layer: no entry points detected.
  Frameworks searched: net/http, gin, gorilla/mux, echo, chi, cobra, grpc, mcp-go, mcp-gosdk
  Tip: use --atlas-entry-pattern '<regex>' to specify custom entry points.
  Tip: use --atlas-protocols to limit to a specific protocol (http, grpc, cli, mcp, message).
```

---

## Plan

> Implementation plan: `docs/plans/plan-101-107-atlas-flow-mcp-protocol.md`

| Phase (proposal) | Phase (plan) | Work | Files changed |
|---|---|---|---|
| 0 | **101** | **Prerequisite fix**: honour `handlerArgIndex` in `matchCallPattern()` instead of hardcoding `args[1]` | `builders/flow-graph-builder.ts` |
| 1 | **102** | Add `mcp-go` to `GO_MOD_FRAMEWORK_MAP` + `FRAMEWORK_PATTERNS`; add `mcp-gosdk` with `handlerArgIndex: 2` | `framework-detector.ts`, `builders/flow-graph-builder.ts` |
| 2 | **103** | Generic tool-registration secondary scan (only fires when entryPoints is empty after primary) | `builders/flow-graph-builder.ts` |
| 3 | **104** | `entryPointPattern` in `AtlasConfig`; `atlasEntryPattern` in `CLIOptions`; CLI flag + normalize wiring | `types.ts`, `config-cli.ts`, `analyze.ts`, `normalize-to-diagrams.ts` |
| 4 | **105** | Empty flow diagnostic in Atlas renderer (`renderers/atlas-renderer.ts`) | `renderers/atlas-renderer.ts` |
| 5 | **106** | Unit tests: Phase 101 (handlerArgIndex), Phase 102 (mcp-go + gosdk detection), Phase 103 (heuristic), Phase 104 (pattern flag) | `tests/unit/plugins/golang/atlas/` |
| 6 | **107** | Integration test: fixture — minimal Go MCP server with 2–3 `AddTool` calls; assert `flow.entryPoints.length >= 2` and `callChains.length >= 2` | `tests/integration/plugins/golang/atlas/` or `tests/fixtures/go-mcp-server/` |

### Phase 5 test scope (detail)

- **Phase 0**: `matchCallPattern` with `handlerArgIndex: 0`, `1`, `2` — verify correct arg is extracted
- **Phase 1**: `FrameworkDetector.detect()` with a mock `moduleInfo` containing `github.com/mark3labs/mcp-go` → `detectedFrameworks` includes `'mcp-go'`; same for `go-sdk`
- **Phase 1**: `FlowGraphBuilder.build()` with a synthetic `GoRawData` containing an `AddTool` call; verify entry point is created with `protocol: 'mcp'`
- **Phase 2**: same raw data but with an unknown framework; verify heuristic fires and creates `protocol: 'custom'` entry
- **Phase 3**: `FlowBuildOptions` with `entryPointPattern: 'MyRegister'`; verify only matching calls become entry points

### Phase 6 fixture structure

```
tests/fixtures/go-mcp-server/
  go.mod          # requires github.com/mark3labs/mcp-go
  main.go         # calls s.AddTool(tool1, handler1); s.AddTool(tool2, handler2)
  handlers.go     # func handler1(...); func handler2(...)
```

The integration test parses the fixture with the Go plugin (Atlas mode), then asserts:
- `flow.entryPoints.length === 2`
- `flow.callChains.length === 2`
- Both entry points have `protocol === 'mcp'`

---

## Open Questions

1. **`receiverContains` for go-sdk package-level calls**: tree-sitter may emit
   `receiverType: ''` or omit the field for package-level calls. Verify against a real
   parsed AST before finalising the `mcp-gosdk` pattern table entry.

2. **Generic heuristic false-positive rate**: `endsWith('Handle')` is very broad.
   Consider restricting to `endsWith('HandleFunc')` only, or requiring a non-empty
   `path` arg at `args[0]` before creating the entry point.

3. **`entryPointPattern` applied to receiver or full call string**: currently proposed as
   matching only `call.functionName`. Matching `${call.receiverType}.${call.functionName}`
   would be more precise for receiver-scoped patterns. Decide before implementation.

---

> Resolved open questions (plan-101-107):
> - Q1: `receiverContains: ''` falsy semantics already skip receiver check — confirmed correct.
> - Q2: `endsWith('Handle')` excluded; only `HandleFunc`, `AddTool`, `RegisterTool`, `AddCommand` retained.
> - Q3: Pattern matches `call.functionName` only; receiver-scoped matching deferred to `customFrameworks`.
>
> Reviewed: consistent with plan-101-107 (one fix applied: removed `_genericHeuristicFired` state field from Stage 103.1 — replaced by `framework: 'generic-heuristic'` marker as decided in Stage 105.1)

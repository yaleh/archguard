# Go Flow Graph: Framework Detection — Development Plan

> Source proposal: `docs/proposals/go-flow-framework-detection.md` (v2)
> ADR: `docs/refactoring/adr/002-archjson-extensions.md` (v2.0)
> Branch: `feat/go`
> Status: Draft

---

## Overview

The work is split into four sequentially-dependent phases:

| Phase | Content | Nature | Dependency |
|-------|---------|--------|------------|
| **A** | Type foundations + `GoModResolver` extension | Non-breaking additions | — |
| **B** | `FrameworkDetector` (new module) | Pure addition | A |
| **C** | `FlowGraphBuilder` rewrite + renderers + test migration | Breaking schema change | A, B |
| **D** | Wiring, CLI, metadata, graceful degradation | Integration | A, B, C |

Phases A and B can be developed in parallel (they touch disjoint files). Phase C is the
largest single unit of work. Phase D is the integration phase that wires everything together.

`GO_ATLAS_EXTENSION_VERSION` is bumped from `'1.1'` to `'2.0'` in **Phase D** (last), after
all consumers have been updated. The constant in `src/types/extensions.ts` and the string
literal in `src/plugins/golang/atlas/index.ts` must be updated together in the same stage.

### Test baseline

**≥ 1308 tests passing** before starting. All phases must maintain or increase this count.
The 7 pre-existing failures in `tests/integration/mermaid/e2e.test.ts` are unrelated.

### Code budget per stage

- Implementation: ≤ 250 lines changed
- New tests: ≤ 250 lines

---

## Phase A — Type Foundations & `GoModResolver` Extension

### Objectives

- Define all new TypeScript types consumed by later phases: `DetectedFrameworks`,
  `CustomFrameworkConfig`, `ManualEntryPoint`, `EntryPointProtocol`, `HttpMethod`.
- Extend `EntryPoint` with new fields (`protocol`, `method?`, `framework`) **alongside**
  the existing `type` field — additive only, nothing removed yet.
- Extend `AtlasConfig` and `AtlasGenerationOptions` with new config fields.
- Parse `require` directives in `GoModResolver` and expose them via `ModuleInfo.requires`.

**No existing tests break in this phase.**

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `EntryPointProtocol`, `HttpMethod`; add `protocol`, `method?`, `framework` to `EntryPoint`; make `type?: EntryPointType` **optional** (was required) — removed in C-3 |
| `src/plugins/golang/atlas/types.ts` | Add `DetectedFrameworks`, `CustomFrameworkConfig`, `ManualEntryPoint`, `FlowBuildOptions` interfaces; add `protocols?`, `customFrameworks?`, `entryPoints?` to `AtlasConfig` and `AtlasGenerationOptions`; **keep** `entryPointTypes` in both — removal deferred to D-1 |
| `src/plugins/golang/atlas/go-mod-resolver.ts` | Add `GoModRequire` interface; add `requires: GoModRequire[]` to `ModuleInfo`; parse `require` block in `resolveProject()` |
| `tests/plugins/golang/atlas/go-mod-resolver.test.ts` | Add tests for `require` parsing |

---

### Stage A-0 — Type definitions (no logic)

Add the following to `src/types/extensions.ts` and `src/plugins/golang/atlas/types.ts`.
**No runtime logic. Type-check only.**

**`src/types/extensions.ts`** — extend `EntryPoint`, add new type aliases:

```typescript
// New type aliases (add before EntryPointType)
export type EntryPointProtocol = string; // built-ins: 'http'|'grpc'|'cli'|'message'|'scheduler'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';

// Updated EntryPoint — additive; type made OPTIONAL (not removed yet — removed in C-3)
// Making it optional allows Phase C-1 to produce EntryPoint objects without setting it.
export interface EntryPoint {
  id: string;
  type?: EntryPointType;        // OPTIONAL — removed in C-3
  protocol: EntryPointProtocol; // NEW
  method?: HttpMethod;          // NEW
  framework: string;            // NEW — e.g. 'gin', 'net/http', 'cobra'
  path: string;
  handler: string;
  middleware: string[];
  package?: string;
  location: { file: string; line: number };
}
```

> **Why optional?** Phase C-1 rewrites `FlowGraphBuilder` to produce `EntryPoint` objects
> with `protocol/method/framework` but not `type`. If `type` is still required at that point,
> C-1 will not compile. Making it optional here unblocks C-1; C-3 then removes the field
> entirely.

**`src/plugins/golang/atlas/types.ts`** — new config types and updated interfaces:

```typescript
export interface CustomCallPattern {
  method?: string;            // exact AST call functionName to match
  methodSuffix?: string;      // suffix match: call.functionName.endsWith(methodSuffix)
  receiverContains?: string;  // substring of GoCallExpr.receiverType for disambiguation
                              // e.g. 'mux.Router' to distinguish gorilla/mux from net/http
  pathArgIndex?: number;      // index into GoCallExpr.args for path
  handlerArgIndex?: number;   // index into GoCallExpr.args for handler
  topicArgIndex?: number;     // index for message topic
}
// At least one of `method` or `methodSuffix` must be set.

export interface CustomFrameworkConfig {
  name: string;
  protocol: string;
  patterns: CustomCallPattern[];
}

export interface ManualEntryPoint {
  function: string;   // fully-qualified: "pkg/path.(*Receiver).Method"
  protocol: string;
}

// DetectedFrameworks: set of active framework keys
export type DetectedFrameworks = Set<string>;

// FlowBuildOptions: passed to FlowGraphBuilder.build() and BehaviorAnalyzer.buildFlowGraph()
export interface FlowBuildOptions {
  detectedFrameworks: DetectedFrameworks;
  protocols?: string[];
  customFrameworks?: CustomFrameworkConfig[];
  entryPoints?: ManualEntryPoint[];
  followIndirectCalls?: boolean;
}

// AtlasConfig — additive changes only; entryPointTypes kept until D-1
export interface AtlasConfig {
  enabled: boolean;
  functionBodyStrategy?: 'none' | 'selective' | 'full';
  layers?: AtlasLayer[];
  includeTests?: boolean;
  excludeTests?: boolean;
  entryPointTypes?: import('@/types/extensions.js').EntryPointType[]; // kept — removed in D-1
  protocols?: string[];          // NEW
  customFrameworks?: CustomFrameworkConfig[]; // NEW
  entryPoints?: ManualEntryPoint[];           // NEW
  followIndirectCalls?: boolean;
  excludePatterns?: string[];
}

// AtlasGenerationOptions — same additive changes; entryPointTypes kept until D-1
export interface AtlasGenerationOptions {
  functionBodyStrategy?: 'full' | 'selective' | 'none';
  selectiveExtraction?: { triggerNodeTypes?: string[]; excludeTestFiles?: boolean; maxFunctions?: number };
  includeTests?: boolean;
  excludeTests?: boolean;
  excludePatterns?: string[];
  entryPointTypes?: import('@/types/extensions.js').EntryPointType[]; // kept — removed in D-1
  protocols?: string[];          // NEW
  customFrameworks?: CustomFrameworkConfig[]; // NEW
  entryPoints?: ManualEntryPoint[];           // NEW
  followIndirectCalls?: boolean;
}
```

**Acceptance**: `npm run type-check` passes. No test changes needed.

---

### Stage A-1 — `GoModResolver` `require` parsing

Add `GoModRequire` and `requires` parsing to `GoModResolver`.

**`src/plugins/golang/atlas/go-mod-resolver.ts`**:

```typescript
export interface GoModRequire {
  path: string;      // e.g. "github.com/gin-gonic/gin"
  version: string;   // e.g. "v1.9.1"
  indirect: boolean; // true if line ends with "// indirect"
}

export interface ModuleInfo {
  moduleName: string;
  moduleRoot: string;
  goModPath: string;
  requires: GoModRequire[]; // NEW
}
```

Parsing logic: scan lines between `require (` and `)`, or single-line `require X vX.Y.Z`.
Strip `// indirect` comments. Ignore `replace` and `exclude` directives.

**Tests** (`tests/plugins/golang/atlas/go-mod-resolver.test.ts`):

```typescript
// Fixture: go.mod with multi-line require block
const goMod = `
module github.com/example/app

require (
  github.com/gin-gonic/gin v1.9.1
  google.golang.org/grpc v1.60.0 // indirect
  github.com/spf13/cobra v1.8.0
)
`;

it('parses require block', () => {
  // requires has 3 entries
  // gin: indirect=false
  // grpc: indirect=true
  // cobra: indirect=false
});

it('handles single-line require', () => {
  // require github.com/pkg/errors v0.9.1
});

it('returns empty requires when no require block', () => {});
```

**Acceptance**: New tests pass. All existing `go-mod-resolver` tests still pass.

---

## Phase B — `FrameworkDetector`

### Objectives

Implement the three-layer detection logic that produces a `DetectedFrameworks` set.
This is a pure addition — no existing files are modified.

### Files changed

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/framework-detector.ts` | **New** |
| `tests/plugins/golang/atlas/framework-detector.test.ts` | **New** |

---

### Stage B-1 — Layer 1: go.mod `require` scan

**`src/plugins/golang/atlas/framework-detector.ts`**:

```typescript
import type { ModuleInfo } from '../go-mod-resolver.js';
import type { GoRawData } from '../types.js';
import type { DetectedFrameworks } from './types.js';

// Built-in go.mod module-path → framework key mapping
const GO_MOD_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['github.com/gin-gonic/gin',           'gin'],
  ['github.com/labstack/echo',           'echo'],
  ['github.com/go-chi/chi',              'chi'],
  ['github.com/gorilla/mux',             'gorilla/mux'],
  ['github.com/gofiber/fiber',           'fiber'],
  ['google.golang.org/grpc',             'grpc'],
  ['github.com/spf13/cobra',             'cobra'],
  ['github.com/urfave/cli',              'urfave/cli'],
  ['github.com/segmentio/kafka-go',      'kafka-go'],
  ['github.com/Shopify/sarama',          'sarama'],
  ['github.com/IBM/sarama',              'sarama'],
  ['github.com/nats-io/nats.go',         'nats'],
  ['github.com/robfig/cron',             'cron'],
]);

export class FrameworkDetector {
  detect(moduleInfo: ModuleInfo, rawData: GoRawData): DetectedFrameworks {
    const found = new Set<string>();
    found.add('net/http'); // unconditional — standard library
    this.detectFromGoMod(moduleInfo, found);
    this.detectFromImports(rawData, found);
    this.detectFromSignatures(rawData, found);
    return found;
  }

  private detectFromGoMod(moduleInfo: ModuleInfo, found: Set<string>): void {
    for (const req of moduleInfo.requires) {
      for (const [prefix, key] of GO_MOD_FRAMEWORK_MAP) {
        if (req.path === prefix || req.path.startsWith(prefix + '/')) {
          found.add(key);
        }
      }
    }
  }
  // ... (Layers 2 and 3 in subsequent stages)
}
```

**Tests** (`tests/plugins/golang/atlas/framework-detector.test.ts`):

```typescript
it('always includes net/http', () => { ... });
it('detects gin from go.mod require', () => { ... });
it('detects grpc from go.mod require', () => { ... });
it('detects indirect dependencies', () => { ... });
it('ignores unrecognised modules', () => { ... });
```

**Acceptance**: Stage B-1 tests pass. No existing tests affected.

---

### Stage B-2 — Layer 2: `GoRawData` import scan

Add `detectFromImports()` to `FrameworkDetector`. Uses `GoRawPackage.imports[*].path`
already present in `rawData` — zero additional I/O.

Extended import-path prefix table (in addition to go.mod map):

```typescript
const IMPORT_PATH_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['github.com/beego/beego',                      'beego'],
  ['github.com/cloudwego/hertz',                  'hertz'],
  ['github.com/kataras/iris',                     'iris'],
  ['github.com/confluentinc/confluent-kafka-go',  'confluent-kafka'],
]);
```

```typescript
private detectFromImports(rawData: GoRawData, found: Set<string>): void {
  for (const pkg of rawData.packages) {
    for (const imp of pkg.imports) {
      for (const [prefix, key] of IMPORT_PATH_FRAMEWORK_MAP) {
        if (imp.path.startsWith(prefix)) {
          found.add(key);
        }
      }
    }
  }
}
```

**Tests**: fixture with `GoRawPackage.imports` containing beego import path → detects `'beego'`.

**Acceptance**: Stage B-2 tests pass. All Stage B-1 tests still pass.

---

### Stage B-3 — Layer 3: signature fallback + `main()` detection

Add `detectFromSignatures()`. Reads `GoRawPackage.name` and `GoMethod.parameters[*].type`.

```typescript
private detectFromSignatures(rawData: GoRawData, found: Set<string>): void {
  for (const pkg of rawData.packages) {
    // main() anchor
    if (pkg.name === 'main') {
      found.add('main');
    }
    // ServeHTTP(http.ResponseWriter, *http.Request) → any HTTP framework
    for (const struct of pkg.structs) {
      for (const method of struct.methods) {
        if (this.isServeHTTP(method)) {
          found.add('net/http'); // already unconditional, but also flag for ServeHTTP path
          found.add('serve-http'); // distinct key so FlowGraphBuilder knows to scan signatures
        }
      }
    }
  }
}

private isServeHTTP(method: GoMethod): boolean {
  if (method.name !== 'ServeHTTP') return false;
  if (method.parameters.length !== 2) return false;
  const p0 = method.parameters[0].type;
  const p1 = method.parameters[1].type;
  return (p0 === 'http.ResponseWriter' || p0.endsWith('.ResponseWriter')) &&
         (p1 === '*http.Request' || p1.endsWith('.Request'));
}
```

**Tests**:
- Package named `'main'` → `found.has('main')`
- Struct with `ServeHTTP(http.ResponseWriter, *http.Request)` → `found.has('serve-http')`
- Method named `ServeHTTP` but wrong parameter types → not detected

**Acceptance**: All Phase B tests pass. Type-check passes.

---

## Phase C — `FlowGraphBuilder` Rewrite + Renderers + Test Migration

### Objectives

- Replace `matchEntryPointPattern()` with framework-aware dispatch.
- `build()` accepts `DetectedFrameworks` and optional config (protocols filter,
  custom frameworks, manual entry points).
- Rewrite `mermaid-templates.ts` `formatEntryLabel()` and fix sequence diagram.
- Migrate all tests that reference `entry.type` to the new schema.
- Remove `EntryPointType` from `extensions.ts`.

**This phase contains all breaking changes. It must leave zero references to `entry.type`
or `EntryPointType` in source and tests.**

### Files changed

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/builders/flow-graph-builder.ts` | Full rewrite of detection + add `build()` signature |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Rewrite `formatEntryLabel()`; fix `entry.type` in sequence diagram |
| `src/types/extensions.ts` | Remove `EntryPointType`; remove `type` from `EntryPoint` |
| `tests/plugins/golang/atlas/flow-graph-builder.test.ts` | Migrate all `entry.type` assertions to `entry.protocol` + `entry.method` |
| `tests/plugins/golang/atlas/mermaid-templates.test.ts` | Rewrite `makeEntry()` factory; update label assertions |
| `tests/plugins/golang/atlas/atlas-renderer.test.ts` | Migrate `entry.type` fixtures and output assertions |

---

### Stage C-1 — `FlowGraphBuilder` rewrite (detection only)

Change `build()` to accept config, implement per-framework pattern dispatch.
Do NOT wire to `GoAtlasPlugin` yet — that is Phase D.

`FlowBuildOptions` is defined in `atlas/types.ts` (Phase A-0). Import it — do not re-declare here.

New `build()` signature:

```typescript
import type { FlowBuildOptions } from '../types.js';

build(rawData: GoRawData, options: FlowBuildOptions = { detectedFrameworks: new Set(['net/http']) }): Promise<FlowGraph>
```

Framework-to-pattern mapping (internal, not user-facing).
`CallPattern.receiverContains` is a substring match on `GoCallExpr.receiverType` used to
disambiguate frameworks that share method names (e.g. `net/http` and `gorilla/mux` both have
`Handle`/`HandleFunc`). It is optional — when absent, method name alone determines the match.

```typescript
// Internal CallPattern (not the user-facing CustomCallPattern)
interface CallPattern {
  method?: string;            // exact match: call.functionName === method
  methodSuffix?: string;      // suffix match: call.functionName.endsWith(methodSuffix)
  receiverContains?: string;  // substring of GoCallExpr.receiverType; skip if empty/absent
  protocol: string;
  httpMethod?: HttpMethod;
}

// Each pattern: { method?, methodSuffix?, receiverContains?, protocol, httpMethod? }
const FRAMEWORK_PATTERNS: Record<string, CallPattern[]> = {
  'net/http':    [{ method: 'HandleFunc', protocol: 'http' },
                 { method: 'Handle',     protocol: 'http' }],
                 // net/http: no receiverContains — matches pkg-level calls and http.ServeMux
  'gin':         [{ method: 'GET',    protocol: 'http', httpMethod: 'GET' },
                 { method: 'POST',   protocol: 'http', httpMethod: 'POST' },
                 /* PUT, DELETE, PATCH, Any */ ],
  'gorilla/mux': [{ method: 'Handle',     receiverContains: 'mux.Router', protocol: 'http' },
                 { method: 'HandleFunc', receiverContains: 'mux.Router', protocol: 'http' }],
                 // receiverContains disambiguates from net/http
  'echo':        [{ method: 'GET',  protocol: 'http', httpMethod: 'GET' }, /* … */],
  'chi':         [{ method: 'Get',  protocol: 'http', httpMethod: 'GET' }, /* … */],
  'cobra':       [{ method: 'AddCommand', protocol: 'cli' }],
  'grpc':        [{ methodSuffix: 'Server', protocol: 'grpc' }],  // matches Register*Server
  'kafka-go':    [{ method: 'ConsumePartition', protocol: 'message' }],
  'nats':        [{ method: 'Subscribe',       protocol: 'message' },
                 { method: 'QueueSubscribe',   protocol: 'message' }],
  'cron':        [{ method: 'AddFunc', protocol: 'scheduler' },
                 { method: 'AddJob',  protocol: 'scheduler' }],
};
```

**Pattern matching predicate** (applied for each call expression against each active pattern):

```typescript
function matchesPattern(call: GoCallExpr, p: CallPattern): boolean {
  // method: exact match
  if (p.method && call.functionName !== p.method) return false;
  // methodSuffix: suffix match (for gRPC Register*Server)
  if (p.methodSuffix && !call.functionName.endsWith(p.methodSuffix)) return false;
  // receiverContains: substring of receiverType (empty receiverType = skip check)
  if (p.receiverContains && call.receiverType) {
    if (!call.receiverType.includes(p.receiverContains)) return false;
  }
  return true;
}
```

When `GoCallExpr.receiverType` is absent (sparse — see Open Questions §1) and both `net/http`
and `gorilla/mux` are active, the match is attributed to `net/http` (first in iteration order)
and a metadata warning is recorded.

**`main()` entry point injection** (separate from FRAMEWORK_PATTERNS loop):

```typescript
// Dedicated scan — not via GoCallExpr
for (const pkg of rawData.packages) {
  if (pkg.name !== 'main') continue;
  for (const func of pkg.functions) {
    if (func.name !== 'main') continue;
    entryPoints.push({
      id:         `entry-${pkg.fullName}-main`,
      protocol:   'cli',
      method:     undefined,
      framework:  'main',
      path:       '',          // no URL path for a CLI binary anchor
      handler:    'main.main',
      middleware: [],
      package:    pkg.fullName,
      location:   { file: func.location.file, line: func.location.startLine },
    });
  }
}
```

Protocol filter (applied at end of `build()`):

```typescript
if (options.protocols && options.protocols.length > 0) {
  const allowed = new Set(options.protocols);
  graph.entryPoints = graph.entryPoints.filter(e => allowed.has(e.protocol));
  const kept = new Set(graph.entryPoints.map(e => e.id));
  graph.callChains = graph.callChains.filter(c => kept.has(c.entryPoint));
}
```

**Tests** (update `flow-graph-builder.test.ts`):

```typescript
// old: expect(result.entryPoints[0].type).toBe('http-get')
// new:
expect(result.entryPoints[0].protocol).toBe('http');
expect(result.entryPoints[0].method).toBe('GET');
expect(result.entryPoints[0].framework).toBe('gin');

// new: protocol filter
it('filters entry points by protocol', async () => {
  const opts = {
    detectedFrameworks: new Set(['gin', 'cobra']),
    protocols: ['http'],
  };
  const result = await builder.build(rawData, opts);
  expect(result.entryPoints.every(e => e.protocol === 'http')).toBe(true);
});
```

**Acceptance**: All `flow-graph-builder.test.ts` tests pass. `type-check` passes.

---

### Stage C-2 — `mermaid-templates.ts` + renderer test migration

**Rewrite `formatEntryLabel()`** using new `EntryPoint` fields:

```typescript
// Before:
private static formatEntryLabel(entry: EntryPoint): string {
  if (entry.type === 'http-handler') { return entry.path; }
  const methodMap = { 'http-get': 'GET', 'http-post': 'POST', ... };
  const method = methodMap[entry.type] ?? entry.type.toUpperCase();
  return `${method} ${entry.path}`;
}

// After:
private static formatEntryLabel(entry: EntryPoint): string {
  if (entry.protocol === 'http') {
    const m = entry.method ?? 'HTTP';
    return `${m} ${entry.path}`;
  }
  if (entry.protocol === 'grpc')      return `gRPC ${entry.path}`;
  if (entry.protocol === 'cli')       return `CMD ${entry.path || entry.handler}`;
  if (entry.protocol === 'message')   return `MSG ${entry.path}`;
  if (entry.protocol === 'scheduler') return `CRON ${entry.path}`;
  return entry.path || entry.id;
}
```

**Fix sequence diagram** (line 556):

```typescript
// Before:
output += `\n  Note over ${handlerId}: ${entry.type} ${pathLabel}\n`;
// After:
const label = MermaidTemplates.formatEntryLabel(entry);
output += `\n  Note over ${handlerId}: ${label}\n`;
```

**Protocol-aware node shapes** in `renderFlowGraph()` flowchart mode:

```typescript
// Map protocol to Mermaid node shape syntax
function entryNodeShape(entry: EntryPoint): string {
  const label = MermaidTemplates.formatEntryLabel(entry);
  switch (entry.protocol) {
    case 'http':      return `["${label}"]`;           // rectangle
    case 'grpc':      return `["${label}"]`;           // rectangle (with gRPC label)
    case 'cli':       return `(["${label}"])`;          // stadium (rounded)
    case 'message':   return `[/"${label}"\\]`;        // trapezoid
    case 'scheduler': return `{{"${label}"}}`;         // hexagon
    default:          return `["${label}"]`;
  }
}
```

**`tests/plugins/golang/atlas/mermaid-templates.test.ts`** — update `makeEntry()` factory:

```typescript
// Before:
function makeEntry(overrides: Partial<EntryPoint> & { id: string }): EntryPoint {
  return { type: 'http-get', path: '/api/resource', ... };
}

// After:
function makeEntry(overrides: Partial<EntryPoint> & { id: string }): EntryPoint {
  return {
    protocol: 'http',
    method: 'GET',
    framework: 'gin',
    path: '/api/resource',
    handler: 'pkg.Handler',
    middleware: [],
    location: { file: 'server.go', line: 1 },
    ...overrides,
  };
}
```

Update all label-format tests:

```typescript
// Before: it('http-get type uses "GET /path" format', ...)
// After:
it('http GET uses "GET /path" format', () => {
  const entry = makeEntry({ id: 'ep1', protocol: 'http', method: 'GET', path: '/api/users' });
  const result = MermaidTemplates.renderFlowGraph(makeFlowGraph([entry]));
  expect(result).toContain('GET /api/users');
});

it('cli protocol uses "CMD" prefix', () => {
  const entry = makeEntry({ id: 'ep2', protocol: 'cli', framework: 'cobra', path: 'serve' });
  expect(result).toContain('CMD serve');
});
```

**`tests/plugins/golang/atlas/atlas-renderer.test.ts`** — update fixture and output:

```typescript
// Before:
{ id: 'ep1', type: 'http-get', path: '/api/users', ... }
expect(output).toContain('http-get /api/users');

// After:
{ id: 'ep1', protocol: 'http', method: 'GET', framework: 'net/http', path: '/api/users', ... }
expect(output).toContain('GET /api/users');
```

**Acceptance**: All Phase C tests pass. Zero `entry.type` or `EntryPointType` references remain.

---

### Stage C-3 — Remove `EntryPointType` from type system

Remove the optional `type?: EntryPointType` from `EntryPoint` in `extensions.ts` (it was made
optional in A-0; here it is deleted entirely along with the `EntryPointType` union). Remove
the `EntryPointType` import and any re-export from `atlas/types.ts`.

**Files changed in this stage**:

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Delete `EntryPointType` union; delete `type?: EntryPointType` field from `EntryPoint` |
| `src/plugins/golang/atlas/types.ts` | Remove `EntryPointType` from import list and any re-export |

```typescript
// extensions.ts — REMOVE entirely:
export type EntryPointType = 'http-get' | ... | 'cli-command';
// Also remove from EntryPoint:
type?: EntryPointType;   // delete this line

// atlas/types.ts — REMOVE from import:
import type { ..., EntryPointType, ... } from '@/types/extensions.js';
// REMOVE any re-export such as:
export type { EntryPointType };
```

**Acceptance**: `npm run type-check` passes with zero errors. All tests pass.

---

## Phase D — Wiring, CLI, Metadata, Graceful Degradation

### Objectives

- Wire `FrameworkDetector` into `GoAtlasPlugin.generateAtlas()`.
- Pass `DetectedFrameworks` through `BehaviorAnalyzer.buildFlowGraph()`.
- Implement `inferBodyStrategy()`.
- Update `GoAtlasMetadata` (replace `entryPointTypes` with `detectedFrameworks`).
- Update CLI flags.
- Implement graceful degradation for zero entry points.
- Bump `GO_ATLAS_EXTENSION_VERSION` to `'2.0'`.

### Files changed

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/index.ts` | Wire `FrameworkDetector`; `inferBodyStrategy()`; remove `entryPointTypes` usage; update metadata |
| `src/plugins/golang/atlas/behavior-analyzer.ts` | Remove `_` from `_options`; pass `FlowBuildOptions` |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Empty flow graph diagnostic comment |
| `src/plugins/golang/atlas/types.ts` | Remove `entryPointTypes` from `AtlasConfig` and `AtlasGenerationOptions` |
| `src/types/extensions.ts` | Update `GoAtlasMetadata`; bump `GO_ATLAS_EXTENSION_VERSION` to `'2.0'` |
| `src/types/config.ts` | Remove `atlasEntryPoints?: string` from `CLIOptions`; add `atlasProtocols?: string` |
| `src/cli/commands/analyze.ts` | Remove `--atlas-entry-points`; add `--atlas-protocols` |
| `tests/unit/cli/commands/analyze.test.ts` | Update CLI flag tests |
| `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` | Update metadata mock: replace `entryPointTypes: []` with `detectedFrameworks: []` |
| `tests/plugins/golang/atlas/behavior-analyzer.test.ts` | Replace `buildFlowGraph(rawData, { entryPointTypes: [...] })` with `FlowBuildOptions` shape |

---

### Stage D-1 — Wire `FrameworkDetector` in `GoAtlasPlugin`

**`inferBodyStrategy()`** — add to `GoAtlasPlugin`:

```typescript
function inferBodyStrategy(
  layers: AtlasLayer[],
  explicit?: 'none' | 'selective' | 'full'
): 'none' | 'selective' | 'full' {
  if (explicit) return explicit;
  const needsBody = layers.some(l => l === 'goroutine' || l === 'flow');
  return needsBody ? 'selective' : 'none';
}
```

**`GoAtlasPlugin.generateAtlas()`** — replace `entryPointTypes` path with framework detection:

```typescript
// After resolveProject():
const detectedFrameworks = new FrameworkDetector().detect(
  this.goModResolver.getModuleInfo(),
  rawData
);

// Pass to buildFlowGraph via BehaviorAnalyzer:
this.behaviorAnalyzer.buildFlowGraph(rawData, {
  detectedFrameworks,
  protocols: options.protocols,
  customFrameworks: options.customFrameworks,
  entryPoints: options.entryPoints,
  followIndirectCalls: options.followIndirectCalls,
}),
```

**`GoAtlasPlugin.parseProject()`** — wire `inferBodyStrategy()`:

```typescript
const layers = atlasConfig?.layers ?? ['package', 'capability', 'goroutine', 'flow'];
const functionBodyStrategy = inferBodyStrategy(
  layers as AtlasLayer[],
  atlasConfig?.functionBodyStrategy
);
```

**`GoModResolver`** — expose `getModuleInfo()`:

```typescript
getModuleInfo(): ModuleInfo {
  if (!this.moduleInfo) throw new Error('GoModResolver not initialized');
  return this.moduleInfo;
}
```

**`BehaviorAnalyzer.buildFlowGraph()`** — remove `_` prefix, pass options:

```typescript
// Before:
async buildFlowGraph(rawData, _options = {}) {
  return this.flowGraphBuilder.build(rawData);
}

// After:
async buildFlowGraph(rawData: GoRawData, options: FlowBuildOptions = { detectedFrameworks: new Set(['net/http']) }) {
  return this.flowGraphBuilder.build(rawData, options);
}
```

**`tests/plugins/golang/atlas/behavior-analyzer.test.ts`** — update the test that passes `entryPointTypes`:

```typescript
// Before (line ~178):
await analyzer.buildFlowGraph(rawData, {
  entryPointTypes: ['http-handler'],   // no longer in FlowBuildOptions
  followIndirectCalls: true,
});

// After:
await analyzer.buildFlowGraph(rawData, {
  detectedFrameworks: new Set(['net/http']),
  followIndirectCalls: true,
});
```

Also update test description from `'accepts options param (entryPointTypes, followIndirectCalls)'`
to `'accepts FlowBuildOptions (detectedFrameworks, followIndirectCalls)'`.

**Remove `entryPointTypes` from `atlas/types.ts`** — this was deferred from Phase A-0:

```typescript
// AtlasConfig — REMOVE:
entryPointTypes?: EntryPointType[]; // remove this field

// AtlasGenerationOptions — REMOVE:
entryPointTypes?: EntryPointType[]; // remove this field
```

**`atlas/index.ts`** — remove the two remaining `entryPointTypes` references:

```typescript
// Line ~126 — REMOVE:
entryPointTypes: atlasConfig?.entryPointTypes,

// Line ~197 — REMOVE:
entryPointTypes: options.entryPointTypes ?? [],
```

**`GoAtlasMetadata`** — update `generationStrategy` in `extensions.ts`:

```typescript
// extensions.ts — replace entryPointTypes with detectedFrameworks:
generationStrategy: {
  functionBodyStrategy: 'none' | 'selective' | 'full';
  selectiveConfig?: {                     // KEEP — unchanged
    triggerNodeTypes: string[];
    excludedTestFiles: boolean;
    extractedFunctionCount: number;
    totalFunctionCount: number;
  };
  detectedFrameworks: string[];           // NEW — e.g. ['gin', 'net/http']
  protocols?: string[];                   // NEW — undefined = not filtered
  followIndirectCalls: boolean;
  goplsEnabled: boolean;
}
```

**`tests/plugins/golang/atlas/go-atlas-plugin.test.ts`** — update metadata mock:

```typescript
// Before (line ~197):
generationStrategy: {
  functionBodyStrategy: 'none',
  entryPointTypes: [],               // deleted from GoAtlasMetadata
  followIndirectCalls: false,
  goplsEnabled: false,
},

// After:
generationStrategy: {
  functionBodyStrategy: 'none',
  detectedFrameworks: [],            // new field
  followIndirectCalls: false,
  goplsEnabled: false,
},
```

**Acceptance**: `npm run build` passes. Integration test
`tests/integration/archguard-self-test.test.ts` passes.

---

### Stage D-2 — CLI flags + graceful degradation

**`src/types/config.ts`** — update `CLIOptions`:

```typescript
// CLIOptions — REMOVE:
atlasEntryPoints?: string;  // was: comma-separated EntryPointType values

// CLIOptions — ADD:
atlasProtocols?: string;    // comma-separated protocol filter, e.g. 'http,grpc'
```

**`src/cli/commands/analyze.ts`** — remove old flag, add new:

```typescript
// REMOVE:
.option('--atlas-entry-points <types>', '...', 'http-get,http-post')

// ADD:
.option(
  '--atlas-protocols <protocols>',
  'Protocol surfaces to include in flow graph (comma-separated: http,grpc,cli,message,scheduler)',
)
```

Remove line 68 (`entryPointTypes: cliOptions.atlasEntryPoints?.split(...)`).
Add `protocols: cliOptions.atlasProtocols?.split(',').map(s => s.trim())`.

**Graceful degradation** in `MermaidTemplates.renderFlowGraph()`:

```typescript
if (graph.entryPoints.length === 0) {
  return '%% No entry points detected. Use customFrameworks or entryPoints in archguard.config.json\n';
}
```

**Warning in `GoAtlasPlugin.generateAtlas()`** when flow graph is empty:

```typescript
if (flowGraph.entryPoints.length === 0) {
  warnings.push(
    `Flow graph: no entry points detected. Frameworks found: ${[...detectedFrameworks].join(', ')}. ` +
    `Add 'customFrameworks' or 'entryPoints' to archguard.config.json to configure detection.`
  );
}
```

**Tests** (`tests/unit/cli/commands/analyze.test.ts`):
- `--atlas-protocols http,grpc` → `atlas.protocols = ['http', 'grpc']`
- `--atlas-entry-points` → unrecognised flag error (or silently ignored by commander — verify)

**Acceptance**: All CLI tests pass. `npm run lint` passes.

---

### Stage D-3 — Version bump + final validation

Bump `GO_ATLAS_EXTENSION_VERSION` in `src/types/extensions.ts`:

```typescript
export const GO_ATLAS_EXTENSION_VERSION = '2.0';
```

Update the string literal in `src/plugins/golang/atlas/index.ts` to reference the constant:

```typescript
// Ensure this uses the constant, not a hardcoded string:
version: GO_ATLAS_EXTENSION_VERSION,
```

Update the hardcoded `version: '1.1'` in `tests/plugins/golang/atlas/go-atlas-plugin.test.ts`:

```typescript
// Before:
version: '1.1',
// After:
version: GO_ATLAS_EXTENSION_VERSION,   // import from atlas/types.ts
// or simply:
version: '2.0',
```

All three changes must be in the same commit.

**Self-validation**:

```bash
npm run build
node dist/cli/index.js analyze -s ./src --lang go -v
# Verify output contains:
#   Frameworks detected: net/http (+ any others found in ArchGuard's own go.mod — it has none)
#   Flow diagram generated OR "No entry points detected" warning
```

**Full test run**:

```bash
npm test
# Expect: ≥ 1308 passing, same 7 pre-existing failures in e2e.test.ts
```

**Acceptance**: All tests pass. `GO_ATLAS_EXTENSION_VERSION` is `'2.0'` in JSON output.

---

## Dependency Graph

```
Phase A (A-0, A-1) ──┐
                      ├──► Phase B (B-1, B-2, B-3) ──┐
                      │                                ├──► Phase C (C-1, C-2, C-3) ──► Phase D (D-1, D-2, D-3)
                      └────────────────────────────────┘
```

A-0 and A-1 can be committed separately. B-1, B-2, B-3 are sequential within Phase B.
C-1 must precede C-2 (tests need new `EntryPoint` schema). C-3 can only run after C-1 and
C-2 have removed all `entry.type` references. D stages are sequential.

---

## Open Questions (must resolve before implementation)

1. **`receiverType` population**: Verify in `tree-sitter-bridge.ts` that `GoCallExpr.receiverType`
   is populated for chained calls like `router.GET(...)`. If sparse, document which call patterns
   reliably have it and which fall back to method-name-only matching.

2. **Mermaid node shapes**: Confirm `[/"${label}"\\]` (trapezoid) and `{{"${label}"}}` (hexagon)
   render correctly in the isomorphic-mermaid version pinned in `package.json`. Test in Stage C-2.

3. **`customFrameworks` config location**: Confirmed as `AtlasConfig` (nested under
   `languageSpecific.atlas` in config file), not top-level `Config`.

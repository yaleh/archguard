## Problem Statement

`src/plugins/golang/tree-sitter-bridge.ts` is 884 lines. It is the second-largest file in the project, exceeded only by `src/mermaid/generator.ts` (960 lines). The file parses Go source files via tree-sitter-go and extracts four categories of AST constructs:

| Category | Key methods | Approximate lines |
|---|---|---|
| Structs and types | `extractStructs`, `extractTypeAliases` | ~210 |
| Interfaces | `extractInterfaces`, `matchInterfacesWithGopls` | ~185 |
| Functions and methods | `extractFunctions`, `extractMethods`, `extractParameters` | ~230 |
| Goroutine detection | `extractGoroutineCalls`, `classifySpawnPattern` | ~160 |
| Shared utilities | node traversal, visibility, source location | ~100 |

Each category maps to a distinct Go language construct. Changes to Go struct handling never affect goroutine detection, and vice versa — but a developer editing either must open and scroll through the entire 884-line file.

A direct analogue exists in the C++ plugin: `src/plugins/cpp/tree-sitter-bridge.ts` delegates to focused builder modules (`src/plugins/cpp/builders/class-builder.ts`, `src/plugins/cpp/builders/header-merger.ts`) rather than concentrating all extraction in one file. The Kotlin plugin follows the same builder pattern.

---

## Goals

- Split `src/plugins/golang/tree-sitter-bridge.ts` into focused modules under `src/plugins/golang/builders/`, one per AST construct category.
- Keep `TreeSitterBridge` as the public façade so `src/plugins/golang/index.ts` and all existing call sites continue to work unchanged.
- Match the builder pattern already established by the C++ and Kotlin plugins.

## Non-Goals

- Changing the `TreeSitterBridge` public API or constructor signature.
- Modifying `src/plugins/golang/index.ts`, `src/plugins/golang/gopls-client.ts`, or any atlas builder.
- Changing the Go plugin's output format or ArchJSON mapping.

---

## Design

### New files under `src/plugins/golang/builders/`

| File | Extracted from | Responsibility |
|---|---|---|
| `struct-builder.ts` | `extractStructs`, `extractTypeAliases` | Go structs, type aliases, embedded fields |
| `interface-builder.ts` | `extractInterfaces`, `matchInterfacesWithGopls` | Go interfaces, method sets, gopls enrichment |
| `function-builder.ts` | `extractFunctions`, `extractMethods`, `extractParameters` | Top-level functions, method receivers, parameter types |
| `goroutine-builder.ts` | `extractGoroutineCalls`, `classifySpawnPattern` | `go` statements, channel operations, spawn patterns |
| `node-utils.ts` | node traversal helpers, text extraction, source location | Shared low-level tree-sitter node utilities |

### Façade contract

`TreeSitterBridge` becomes a thin coordinator:

```typescript
import { StructBuilder } from './builders/struct-builder.js';
import { InterfaceBuilder } from './builders/interface-builder.js';
import { FunctionBuilder } from './builders/function-builder.js';
import { GoroutineBuilder } from './builders/goroutine-builder.js';

export class TreeSitterBridge {
  private structBuilder: StructBuilder;
  private interfaceBuilder: InterfaceBuilder;
  private functionBuilder: FunctionBuilder;
  private goroutineBuilder: GoroutineBuilder;

  constructor(parser: Parser) {
    const utils = new NodeUtils(parser);
    this.structBuilder = new StructBuilder(utils);
    this.interfaceBuilder = new InterfaceBuilder(utils);
    this.functionBuilder = new FunctionBuilder(utils);
    this.goroutineBuilder = new GoroutineBuilder(utils);
  }

  parseFile(filePath: string, source: string): RawGoFile {
    return {
      structs: this.structBuilder.extract(filePath, source),
      interfaces: this.interfaceBuilder.extract(filePath, source),
      functions: this.functionBuilder.extract(filePath, source),
      goroutines: this.goroutineBuilder.extract(filePath, source),
    };
  }

  // ... existing public methods delegate to the builders
}
```

### Test file moves

Existing tests that mock or directly exercise tree-sitter extraction logic should be reorganized in parallel:

| Current location | New location |
|---|---|
| Tests for struct extraction in `golang-plugin.test.ts` | `tests/plugins/golang/builders/struct-builder.test.ts` |
| Tests for interface extraction | `tests/plugins/golang/builders/interface-builder.test.ts` |
| Tests for function/method extraction | `tests/plugins/golang/builders/function-builder.test.ts` |
| Tests for goroutine detection | `tests/plugins/golang/builders/goroutine-builder.test.ts` |

Integration-level tests that call `TreeSitterBridge.parseFile()` stay in their current location; only tests that exercise individual extraction logic move.

---

## Execution steps (TDD order)

1. Create `src/plugins/golang/builders/node-utils.ts` with the shared traversal helpers; add a minimal test to confirm node traversal works.
2. For each builder category (struct → interface → function → goroutine):
   a. Write failing tests importing from the new builder path.
   b. Create the builder file with extracted logic.
   c. Update `TreeSitterBridge` to delegate to it.
   d. Confirm new tests pass and existing `golang-plugin.test.ts` tests are unaffected.
3. After all four builders are wired in, `tree-sitter-bridge.ts` should be under 150 lines.
4. Run full test suite; confirm 0 regressions.

---

## Expected outcome

| File | Before | After |
|---|---|---|
| `tree-sitter-bridge.ts` | 884 lines | ~150 lines (façade + wiring) |
| `builders/struct-builder.ts` | — | ~220 lines |
| `builders/interface-builder.ts` | — | ~195 lines |
| `builders/function-builder.ts` | — | ~240 lines |
| `builders/goroutine-builder.ts` | — | ~170 lines |
| `builders/node-utils.ts` | — | ~110 lines |

---

## Alternatives

- **Leave as-is**: Rejected. At 884 lines and growing with each Go language feature added, the file is already past the point where focused editing is practical.
- **Split by file type (AST node kind) rather than construct category**: Less aligned with the Go language model. Go's struct and type alias extractions share traversal patterns more closely than, say, struct vs. method.
- **Use a different abstraction (e.g. Visitor pattern)**: Heavier than needed. The C++ and Kotlin builder pattern is already established in this codebase and requires no new abstractions.

---

## Open Questions

- Whether `matchInterfacesWithGopls` belongs in `interface-builder.ts` or should stay in `TreeSitterBridge` because it requires the gopls client reference. The gopls client could be injected into `InterfaceBuilder` at construction time.
- Whether `goroutine-builder.ts` should eventually merge with the Go Atlas goroutine topology builder (`src/plugins/golang/atlas/builders/goroutine-topology-builder.ts`), or whether static extraction and atlas-level analysis should remain separate. Out of scope for this proposal.

## Background

Three small, independent issues were identified during the June 2026 post-Plan-58 self-analysis:

1. `tests/unit/core/query/query-engine.test.ts` contains two `it.todo` tests for `QueryEngine.findByAttr` and `QueryEngine.findByTypeAndAttr`, each annotated "pending until Plan 58 is merged". Plan 58 is merged. The implementation at `src/core/query/query-engine.ts:208–240` is untested at the unit level.

2. `src/mermaid/diagram-generator.ts` contains 12 bare `console.log` calls (lines 220–237, 353–360) for quality metrics output and generated-file listings. Every other output site in the project uses `ProgressReporter` from `src/cli/progress.ts`. The bare logs bypass the spinner lifecycle, cannot be silenced in JSON/MCP output modes, and include emoji-decorated text that is hard to parse programmatically.

3. `tests/plugins/golang/atlas/mermaid-templates.test.ts` is 3311 lines — the largest test file in the project. It tests the `MermaidTemplates` façade class against all four atlas layers. Four new direct-import renderer test files were added in Plan 58's follow-up work (`goroutine-renderer.test.ts`, `flow-renderer.test.ts`, `capability-renderer.test.ts`, `package-renderer.test.ts`). The façade test now duplicates structural assertions already covered by the layer-specific files, which increases the cost of every template change.

---

## Goals

- Complete the two `findByAttr` todo tests so the Plan 58 attribute query surface has unit-level coverage.
- Replace `console.log` in `diagram-generator.ts` with `ProgressReporter` calls so output is gated by the same verbose flag and MCP-quiet mode as the rest of the CLI.
- Slim `mermaid-templates.test.ts` to a thin integration smoke-test after verifying that layer-specific tests cover each assertion category.

## Non-Goals

- Changing `findByAttr` / `findByTypeAndAttr` semantics.
- Redesigning `ProgressReporter` to support structured metrics reporting.
- Removing `MermaidTemplates` façade or changing its public API.

---

## Design

### 1. Complete `findByAttr` todo tests

Fill the two `it.todo` placeholders in `tests/unit/core/query/query-engine.test.ts`:

```typescript
it('finds entities with a given attribute key (no value filter)', () => {
  const entities = [
    makeEntity('a.Foo', 'Foo', { attributes: { deprecated: true, version: '2' } }),
    makeEntity('b.Bar', 'Bar', { attributes: { version: '2' } }),
    makeEntity('c.Baz', 'Baz', {}),
  ];
  const engine = makeEngine(entities);

  const results = engine.findByAttr('deprecated');
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('Foo');
});

it('finds entities matching a specific attribute value', () => {
  const entities = [
    makeEntity('a.Foo', 'Foo', { attributes: { version: '2' } }),
    makeEntity('b.Bar', 'Bar', { attributes: { version: '3' } }),
  ];
  const engine = makeEngine(entities);

  const results = engine.findByAttr('version', '2');
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('Foo');
});
```

### 2. Replace `console.log` in `diagram-generator.ts`

`ProgressReporter` already has `info(text)` and `log(text)` methods that respect the verbose flag. The metrics output block (lines 220–237) and the generated-files block (lines 353–360) should be converted:

```typescript
// Before
console.log('\n📊 Quality Metrics:');
console.log(`  Overall Score: ${metrics.score?.toFixed(1) || 'N/A'}/100`);

// After
this.progress.info(`Quality Metrics — Overall: ${metrics.score?.toFixed(1) || 'N/A'}/100`);
```

If `DiagramGenerator` does not yet hold a `ProgressReporter` reference, inject one via the constructor using the existing pattern from `AnalyzeCommand`.

The files listing (✨ Generated files) is user-facing output that should remain visible at normal verbosity. Map it to `progress.succeed()` with a multi-line string, or emit each path as a `progress.info()` call under a `verbose` guard.

### 3. Slim `mermaid-templates.test.ts`

Audit each `describe` block in `mermaid-templates.test.ts` against the four layer-specific test files:

| Façade describe block | Covered by |
|---|---|
| `renderPackageGraph — *` | `package-renderer.test.ts` |
| `renderCapabilityGraph — *` | `capability-renderer.test.ts` |
| `renderGoroutineTopology — *` | `goroutine-renderer.test.ts` |
| `renderFlowGraph — *` | `flow-renderer.test.ts` |

For each assertion already present in a layer test, remove the duplicate from the façade test. Keep only:

- One round-trip test per layer that calls `MermaidTemplates.renderXxx()` (not the direct function) to verify the façade delegation is wired correctly.
- Any cross-layer tests that exercise interactions the individual layer tests cannot cover.

Expected result: `mermaid-templates.test.ts` shrinks from ~3300 lines to ~200 lines.

---

## Alternatives

- **Leave `console.log` as-is**: Rejected. In `--format json` or MCP mode the logs pollute stdout and interfere with consumers that parse the JSON output directly.
- **Delete `mermaid-templates.test.ts` entirely**: Rejected. The façade delegation itself should remain tested; the goal is deduplication, not deletion.

---

## Open Questions

- Whether `ProgressReporter` needs a new `metric(label, value)` method to make structured quality metrics first-class output, or whether free-text `info()` calls are sufficient for now.

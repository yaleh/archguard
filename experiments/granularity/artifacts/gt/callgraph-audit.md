# Callgraph Audit (Phase 64.1)

**Date**: 2026-06-11
**Seed**: 64 (mulberry32)
**Auditor**: Human + LSP verification

## 10 Randomly Sampled Call Edges — Manual Verification

| # | Source | Target | Line | Verdict |
|---|--------|--------|------|---------|
| 1 | ClassExtractor.extractMembers | ClassExtractor.extractConstructor | class-extractor.ts:116 | ✅ `this.extractConstructor(constructor)` — call |
| 2 | renderTsModuleGraph | emitTreeNode | ts-module-graph-renderer.ts:257 | ✅ `emitTreeNode(root, lines, 2, ...)` — call |
| 3 | MermaidValidationPipeline.validateFull | MermaidValidationPipeline.calculateOverall | validation-pipeline.ts:122 | ✅ `this.calculateOverall({...})` — call |
| 4 | QualityValidator.calculateMetrics | QualityValidator.calculateComplexity | validator-quality.ts:37 | ✅ `this.calculateComplexity(...)` — call |
| 5 | RenderValidator.validate | RenderValidator.checkSize | validator-render.ts:23 | ✅ `this.checkSize(mermaidCode)` — call |
| 6 | ArchJSONAggregator.extractPackageFromEntity | ArchJSONAggregator.extractPackageFromFile | archjson-aggregator.ts:210 | ✅ `this.extractPackageFromFile(...)` — call |
| 7 | MermaidDiagramGenerator.generateAndRender | IProgressReporter.start | diagram-generator.ts:318 | ✅ `progress.start('...')` — call, viaInterface |
| 8 | ArchJSONAggregator.aggregateToPackageLevel | ArchJSONAggregator.extractPackageFromEntity | archjson-aggregator.ts:86 | ✅ `this.extractPackageFromEntity(e, ...)` — call |
| 9 | validateGeneratorInput | isExternalDependency | generator-validation.ts:40 | ✅ `isExternalDependency(relation.source)` — call |
| 10 | ValidatedMermaidGenerator.generateClassDiagrams | ValidatedMermaidGenerator.escapeId | generator.ts:906 | ✅ `this.escapeId(group.name)` — call |

**Result**: 10/10 verified as genuine call sites. Zero false positives.

## Interface Dispatch Statistics

- Total call edges with `viaInterface: true`: **40**
- Unique interface targets: **6**
  - `IProgressReporter` (start/succeed/fail)
  - `ILanguagePlugin` (parseProject/supportedLevels etc.)
  - `IMermaidValidator` (validate)
  - Others from the ArchGuard plugin architecture

## Dynamic Call Miss Rate Estimate

- Reference (non-call) edges: **1** (`diagram-generator.ts:345` — class name used as value, not callee)
- Miss rate: **0.3%** (1 / 376)
- **Well under 10% threshold** → B-class downgrade NOT triggered
- Known limitation: `findReferences()` cannot detect runtime dynamic dispatch (`this[name]()`, `obj[expr]()`). These are inherently invisible to static analysis. Manual scan of the 56 source files confirms the codebase uses predominantly static method calls (TypeScript idiomatic style); event/callback patterns are limited to `Array.map(callback)` which callgraph correctly classifies as `reference` edges.

## Interface Dispatch — Primary View Decision

**Decision: EXPANDED view** (as expected per proposal §1 R1)

Rationale: Edge #7 above illustrates the pattern — `progress.start()` dispatches through `IProgressReporter`. The interface-member view reports this as `→ IProgressReporter.start`; the expanded view reports it as `→ CliProgressReporter.start` (the concrete implementation). The expanded view matches what a developer would understand as "which function actually runs", and B-class tasks ("which functions are affected by changing method X") require the concrete implementation targets.

Both views remain in the output. The `gtVariant` field in task schema will be set to `"expanded"`.

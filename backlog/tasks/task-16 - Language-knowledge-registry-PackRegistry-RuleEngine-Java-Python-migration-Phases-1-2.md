---
id: TASK-16
title: >-
  Language knowledge registry: PackRegistry + RuleEngine + Java/Python migration
  (Phases 1-2)
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:32'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/proposals/proposal-language-knowledge-registry.md
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Language knowledge registry (Phases 1-2 only) — Phase 1: rule engine foundation (PackRegistry, RuleEngine, Zod schema validators for language packs); Phase 2: migrate Java and Python plugins to use declarative knowledge packs (YAML-based grammar/, rules/, patterns/). Phase 3 (online registry) and Phase 4 (community packs) explicitly deferred.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Language knowledge registry — PackRegistry + RuleEngine + Java/Python migration (Phases 1-2)

## Background

ArchGuard currently supports six languages through hard-coded TypeScript plugin classes
(`src/plugins/java/`, `src/plugins/python/`, etc.). Every new language or framework
requires writing imperative TypeScript, updating the plugin registry, and shipping a
release. This creates two compounding problems:

1. **Maintenance burden**: Java and Python plugins contain bespoke extraction logic
   duplicated across `tree-sitter-bridge.ts`, `archjson-mapper.ts`, and
   `dependency-extractor.ts`. Fixing a parsing rule means touching multiple TypeScript
   files across multiple plugins.
2. **Contribution barrier**: External contributors cannot add language support without
   understanding ArchGuard internals, the ILanguagePlugin interface, and build tooling.

Phases 3–4 (online registry, community packs) address the contribution barrier but
depend on Phases 1–2 being complete first. This task delivers the internal foundation:
a schema-validated `PackRegistry`, a `RuleEngine` that interprets YAML knowledge packs,
and a migration of the Java and Python plugins to use declarative packs—proving the
engine is production-ready before any external surface is exposed.

## Goals

1. `PackRegistry` loads a `KnowledgePack` from a local directory, validates it with Zod,
   and returns a typed `LoadedPack` object—verified by unit tests in `src/core/`.
2. `RuleEngine` consumes a `LoadedPack` and produces `Entity[]` + `Relation[]` equivalent
   to the current Java plugin output for a known fixture project—verified by a golden-file
   integration test.
3. `RuleEngine` produces output equivalent to the current Python plugin output for a known
   Python fixture—verified by a golden-file integration test.
4. Existing `npm test` suite passes without regression (3141+ tests, 0 failures).
5. Zod schema rejects a malformed manifest (missing `language` field) with a descriptive
   error message—verified by a unit test.

## Proposed Approach

**Phase 1 — Foundation (`src/core/`)**

Define a `KnowledgePackSchema` using Zod covering `manifest.json`,
`rules/modules.yaml`, `rules/dependencies.yaml`, and `patterns/architectural.yaml`.
Implement `PackRegistry` (loads packs from `src/plugins/packs/<lang>/`) and `RuleEngine`
(interprets the loaded pack to extract entities and relations from a parsed AST).
Add a `RuleBasedLanguagePlugin` adapter implementing `ILanguagePlugin` so the existing
`PluginRegistry` can instantiate it transparently.

**Phase 2 — Java + Python knowledge packs (`src/plugins/packs/`)**

Author `src/plugins/packs/java/` and `src/plugins/packs/python/` as YAML knowledge packs.
Run existing fixture comparisons to confirm output parity. The imperative plugins remain
as fallback; the packs are loaded preferentially when present. No user-visible CLI change.

## Trade-offs and Risks

- **Phases 3–4 deferred**: Online registry, network fetch, `~/.archguard/packs/` cache,
  community contributions, Kotlin/Rust/C# packs are explicitly out of scope for this task.
- **YAML expressiveness ceiling**: Some Java constructs (Maven multi-module cross-project
  inheritance, annotation processors) may require imperative logic. The imperative plugin
  stays in place as a fallback; this is acceptable for Phase 2 parity.
- **Grammar WASM**: Built-in packs for Java and Python reuse the tree-sitter WASM
  grammars already loaded by the existing plugins—no additional binary size impact.
- **Zod dependency**: Already used in the project (`package.json`). No new dependency
  added.

---

# Plan: Language knowledge registry — PackRegistry + RuleEngine + Java/Python migration (Phases 1-2)

Proposal: docs/proposals/proposal-language-knowledge-registry.md

---

## Phase A: KnowledgePack schema + Zod validators + PackRegistry

### Tests (write first)

File: `tests/unit/core/pack-registry.test.ts`

Test cases:
- `PackRegistry.load(validDir)` returns `LoadedPack` with typed manifest fields
- `PackRegistry.load(dir)` with missing `language` field throws `ZodError` containing "language"
- `PackRegistry.load(dir)` with missing `manifest.json` throws `PackNotFoundError`
- `PackRegistry.resolve('java')` returns the built-in java pack from `src/plugins/packs/java/`
- `PackRegistry.resolve('nonexistent')` returns `undefined`
- `KnowledgePackSchema.parse(validManifest)` succeeds for a minimal valid manifest
- `KnowledgePackSchema.parse({})` throws Zod error with field-level messages

### Implementation

Files to create:
- `src/core/pack-registry/knowledge-pack-schema.ts` — Zod schemas for `ManifestSchema`, `ModuleRulesSchema`, `DependencyRulesSchema`, `PatternsSchema`, `KnowledgePackSchema`
- `src/core/pack-registry/pack-registry.ts` — `PackRegistry` class: `load(dir): LoadedPack`, `resolve(language): LoadedPack | undefined`; built-in pack root = `src/plugins/packs/`
- `src/core/pack-registry/types.ts` — `LoadedPack`, `PackManifest`, `ModuleRules`, `DependencyRules`, `ArchitecturalPatterns` TypeScript types (inferred from Zod schemas)
- `src/core/pack-registry/errors.ts` — `PackNotFoundError`, `PackValidationError`
- `src/core/pack-registry/index.ts` — barrel export
- `src/core/index.ts` — re-export `PackRegistry`, `KnowledgePackSchema`, `LoadedPack`
- Run `npm install js-yaml @types/js-yaml` to add YAML parsing as an explicit direct dependency

### DoD

- [ ] `npm test -- --run tests/unit/core/pack-registry.test.ts`
- [ ] `npm run type-check`

---

## Phase B: RuleEngine — interprets packs → Entity[] + Relation[]

### Tests (write first)

File: `tests/unit/core/rule-engine.test.ts`

Test cases:
- `RuleEngine.extractEntities(ast, pack)` maps a class node to `Entity` with correct `name`, `type`, `sourceFile`
- `RuleEngine.extractRelations(entities, ast, pack)` produces `Relation` for an import statement matching `modules.yaml` pattern
- `RuleEngine.detectFramework(files, pack)` returns `'spring'` when `pom.xml` contains `spring-boot`
- `RuleEngine.extractEntities(ast, packWithFrameworkRules)` adds `stereotype: 'controller'` to class annotated `@Controller`
- Empty AST produces empty `Entity[]` and `Relation[]`

File: `tests/unit/core/rule-based-plugin.test.ts`

Test cases:
- `RuleBasedLanguagePlugin` implements `ILanguagePlugin` (duck-type check on metadata, initialize, canHandle, parseProject, dispose)
- `plugin.metadata.language` equals `pack.manifest.language`
- `plugin.supportedLevels` equals `['package', 'class']`
- `plugin.canHandle('/project/src/Foo.java')` returns `true` when pack extensions include `.java`

### Implementation

Files to create:
- `src/core/rule-engine/ast-node.ts` — minimal `AstNode` interface used by the engine (language-agnostic)
- `src/core/rule-engine/rule-engine.ts` — `RuleEngine` class: `extractEntities()`, `extractRelations()`, `detectFramework()`; pure functions, no I/O
- `src/core/rule-engine/rule-based-plugin.ts` — `RuleBasedLanguagePlugin implements ILanguagePlugin`; `initialize()` loads WASM grammar via existing `wasm-loader.ts`; `parseProject()` globs files by extension, parses each with tree-sitter, calls RuleEngine
- `src/core/rule-engine/index.ts` — barrel export
- Update `src/core/index.ts` — re-export `RuleEngine`, `RuleBasedLanguagePlugin`

### DoD

- [ ] `npm test -- --run tests/unit/core/rule-engine.test.ts`
- [ ] `npm test -- --run tests/unit/core/rule-based-plugin.test.ts`
- [ ] `npm run type-check`

---

## Phase C: Java knowledge pack (grammar/, rules/, patterns/ YAML)

### Tests (write first)

File: `tests/unit/plugins/java/java-pack.test.ts`

Test cases:
- `PackRegistry.resolve('java')` returns a `LoadedPack` (pack directory exists and is valid)
- Loaded Java pack manifest has `language: 'java'`, `extensions: ['.java']`
- `KnowledgePackSchema.parse(javaManifest)` succeeds without throwing
- `RuleEngine.extractEntities(javaClassAst, javaPack)` returns entity with `type: 'class'` for a simple Java class fixture
- `RuleEngine.extractRelations(entities, javaImportAst, javaPack)` produces `type: 'dependency'` for a `import com.example.Foo` statement

File: `tests/integration/plugins/java/java-pack-parity.test.ts`

Test cases:
- For fixture `tests/fixtures/java-simple/` (a minimal Spring controller + service project), `RuleBasedLanguagePlugin.parseProject()` produces entity count and package count within ±10% of current `JavaPlugin.parseProject()` output (golden values recorded by running current plugin once)

### Implementation

Files to create:
- `src/plugins/packs/java/manifest.json`
- `src/plugins/packs/java/rules/modules.yaml`
- `src/plugins/packs/java/rules/dependencies.yaml`
- `src/plugins/packs/java/rules/frameworks/spring.yaml`
- `src/plugins/packs/java/patterns/architectural.yaml`
- `tests/fixtures/java-simple/` — minimal two-file Java fixture (Controller + Service class)
- Update `src/core/plugin-registry.ts` — try `PackRegistry.resolve(lang)` first; if found, return `new RuleBasedLanguagePlugin(pack)`

### DoD

- [ ] `npm test -- --run tests/unit/plugins/java/java-pack.test.ts`
- [ ] `npm test -- --run tests/integration/plugins/java/java-pack-parity.test.ts`
- [ ] `npm run type-check`

---

## Phase D: Python knowledge pack migration

### Tests (write first)

File: `tests/unit/plugins/python/python-pack.test.ts`

Test cases:
- `PackRegistry.resolve('python')` returns a `LoadedPack` with `language: 'python'`, `extensions: ['.py']`
- `KnowledgePackSchema.parse(pythonManifest)` succeeds
- `RuleEngine.extractEntities(pythonClassAst, pythonPack)` returns entity with `type: 'class'` for a simple class fixture
- `RuleEngine.extractRelations(entities, pythonImportAst, pythonPack)` recognises `import foo` and `from foo import Bar` patterns

File: `tests/integration/plugins/python/python-pack-parity.test.ts`

Test cases:
- For fixture `tests/fixtures/python-simple/` (a minimal FastAPI app), `RuleBasedLanguagePlugin.parseProject()` produces entity count and package count within ±10% of current `PythonPlugin.parseProject()` output

### Implementation

Files to create:
- `src/plugins/packs/python/manifest.json`
- `src/plugins/packs/python/rules/modules.yaml`
- `src/plugins/packs/python/rules/dependencies.yaml`
- `src/plugins/packs/python/rules/frameworks/django.yaml`
- `src/plugins/packs/python/rules/frameworks/fastapi.yaml`
- `src/plugins/packs/python/patterns/architectural.yaml`
- `tests/fixtures/python-simple/` — minimal two-file Python fixture (FastAPI router + service)

### DoD

- [ ] `npm test -- --run tests/unit/plugins/python/python-pack.test.ts`
- [ ] `npm test -- --run tests/integration/plugins/python/python-pack-parity.test.ts`
- [ ] `npm run type-check`

---

## Constraints

- Phases 3–4 (online registry, network fetch, cache, community packs, Kotlin/Rust/C# packs) are explicitly out of scope
- The existing Java and Python imperative plugins are NOT removed; they remain as fallback when no pack is found
- `js-yaml` must be added as an explicit direct dependency (`npm install js-yaml @types/js-yaml`)
- No CLI flag changes; the pack system is transparent to end users in Phases 1–2
- Each Phase must leave `npm test` green before the next Phase begins

## Acceptance Gate

- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `node dist/cli/index.js analyze -s tests/fixtures/java-simple/ --lang java` exits 0
- [ ] `node dist/cli/index.js analyze -s tests/fixtures/python-simple/ --lang python` exits 0
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved (self-review pass). Starting plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 5 goals mapped to Phases A/B/C/D and Acceptance Gate
[E] TDD structure: every Phase has Tests + Implementation sections in order
[E] DoD executability: all DoD items are shell commands; constraints section holds non-executable criteria
[E] Acceptance gate: first item is npm test
[C] file paths exist: src/core/, tests/unit/core/, tests/unit/plugins/java/, tests/unit/plugins/python/ verified via shell
[H] parity ±10% threshold: what constitutes acceptable parity judged from background knowledge
GCL-self-report: E=4 C=1 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/core/pack-registry.test.ts
- [ ] #2 npm test -- --run tests/unit/core/rule-engine.test.ts
- [ ] #3 npm test -- --run tests/unit/core/rule-based-plugin.test.ts
- [ ] #4 npm test -- --run tests/unit/plugins/java/java-pack.test.ts
- [ ] #5 npm test -- --run tests/integration/plugins/java/java-pack-parity.test.ts
- [ ] #6 npm test -- --run tests/unit/plugins/python/python-pack.test.ts
- [ ] #7 npm test -- --run tests/integration/plugins/python/python-pack-parity.test.ts
- [ ] #8 npm test
- [ ] #9 npm run type-check
- [ ] #10 npm run lint
- [ ] #11 node dist/cli/index.js analyze -s tests/fixtures/java-simple/ --lang java
- [ ] #12 node dist/cli/index.js analyze -s tests/fixtures/python-simple/ --lang python
<!-- DOD:END -->

---
id: TASK-63
title: "TASK-63: Language knowledge registry — PackRegistry + RuleEngine + Java/Python migration (Phases 1-2)"
status: ready
labels:
  - core
  - language-support
  - plugin
  - java
  - python
parent: null
children: []
extra:
  schema: v1
  source: quay-tasks/TASK-16
---
# TASK-63: Language knowledge registry — PackRegistry + RuleEngine + Java/Python migration (Phases 1-2)

## Proposal

> source: quay-tasks/TASK-16（2026-08-05 经 git 历史核实为「真新」后搬入 tasks/，编号从 TASK-62 起；
> 仅有 `1b1cb37`（2026-03-05）提交的 `docs/proposals/proposal-language-knowledge-registry.md` 设计稿，
> `src/core/pack-registry/` 与 `src/plugins/packs/` 均不存在 —— 设计已审，实现未落地）

Language knowledge registry (Phases 1-2 only). Phase 1: rule engine foundation (`PackRegistry`,
`RuleEngine`, Zod schema validators for language packs). Phase 2: migrate Java and Python plugins to
use declarative knowledge packs (YAML-based `grammar/`, `rules/`, `patterns/`). Phases 3 (online
registry) and 4 (community packs) are explicitly deferred.

**Background**: ArchGuard supports six languages through hard-coded TypeScript plugin classes
(`src/plugins/java/`, `src/plugins/python/`, etc.). Every new language/framework requires writing
imperative TypeScript, updating the plugin registry, and shipping a release. Java and Python plugins
contain bespoke extraction logic duplicated across `tree-sitter-bridge.ts`, `archjson-mapper.ts`, and
`dependency-extractor.ts`; fixing a parsing rule means touching multiple TypeScript files across
multiple plugins. External contributors cannot add language support without understanding internals.

**Goals**:
1. `PackRegistry` loads a `KnowledgePack` from a local directory, validates it with Zod, and returns
   a typed `LoadedPack` — unit-tested in `src/core/`.
2. `RuleEngine` consumes a `LoadedPack` and produces `Entity[]` + `Relation[]` equivalent to the
   current Java plugin output for a known fixture (golden-file integration test).
3. `RuleEngine` produces output equivalent to the current Python plugin output for a Python fixture.
4. Existing `npm test` suite passes without regression.
5. Zod schema rejects a malformed manifest (missing `language` field) with a descriptive error.

**Proposed approach**: `KnowledgePackSchema` (Zod) covers `manifest.json`, `rules/modules.yaml`,
`rules/dependencies.yaml`, `patterns/architectural.yaml`. `PackRegistry` loads packs from
`src/plugins/packs/<lang>/`; `RuleEngine` interprets the loaded pack to extract entities/relations
from a parsed AST; a `RuleBasedLanguagePlugin` adapter implements `ILanguagePlugin` so the existing
`PluginRegistry` can instantiate it transparently. Java and Python packs are authored as YAML; the
imperative plugins remain as fallback; packs load preferentially. No user-visible CLI change.

**Risks**: YAML expressiveness ceiling (Maven multi-module inheritance, annotation processors may
need imperative logic — the fallback covers this); built-in Java/Python packs reuse the tree-sitter
WASM grammars already loaded (no binary-size impact); `js-yaml` must be added as an explicit direct
dependency (Zod is already present).

## Plan

### Phase A: KnowledgePack schema + Zod validators + PackRegistry

Tests first, in `tests/unit/core/pack-registry.test.ts`: `load(validDir)` returns typed `LoadedPack`;
missing `language` field throws `ZodError` containing "language"; missing `manifest.json` throws
`PackNotFoundError`; `resolve('java')` returns the built-in java pack; `resolve('nonexistent')`
returns `undefined`; `KnowledgePackSchema.parse` succeeds/fails per field-level schema.

Implementation: create `src/core/pack-registry/knowledge-pack-schema.ts`, `pack-registry.ts`,
`types.ts`, `errors.ts`, `index.ts`; re-export from `src/core/index.ts`. Run
`npm install js-yaml @types/js-yaml`.

DoD: `npm test -- --run tests/unit/core/pack-registry.test.ts`, `npm run type-check`.

### Phase B: RuleEngine — interprets packs → Entity[] + Relation[]

Tests first, in `tests/unit/core/rule-engine.test.ts` (extractEntities/extractRelations/
detectFramework/empty-AST) and `tests/unit/core/rule-based-plugin.test.ts` (ILanguagePlugin
duck-type, metadata.language, supportedLevels, canHandle).

Implementation: create `src/core/rule-engine/ast-node.ts`, `rule-engine.ts`, `rule-based-plugin.ts`,
`index.ts`; update `src/core/index.ts`. `RuleBasedLanguagePlugin.initialize()` loads WASM grammar via
the existing `wasm-loader.ts`; `parseProject()` globs files by extension, parses with tree-sitter,
calls RuleEngine.

DoD: `npm test -- --run tests/unit/core/rule-engine.test.ts`,
`npm test -- --run tests/unit/core/rule-based-plugin.test.ts`, `npm run type-check`.

### Phase C: Java knowledge pack (grammar/, rules/, patterns/ YAML)

Tests first, in `tests/unit/plugins/java/java-pack.test.ts` (resolve('java') → valid LoadedPack;
manifest `language: 'java'`, `extensions: ['.java']`; schema parse succeeds; class/import extraction)
and `tests/integration/plugins/java/java-pack-parity.test.ts` (fixture `tests/fixtures/java-simple/`
— RuleBasedLanguagePlugin.parseProject() within ±10% of current JavaPlugin output).

Implementation: create `src/plugins/packs/java/{manifest.json, rules/modules.yaml,
rules/dependencies.yaml, rules/frameworks/spring.yaml, patterns/architectural.yaml}` and
`tests/fixtures/java-simple/`; update `src/core/plugin-registry.ts` to prefer `PackRegistry.resolve()`
and return `new RuleBasedLanguagePlugin(pack)` when found.

DoD: `npm test -- --run tests/unit/plugins/java/java-pack.test.ts`,
`npm test -- --run tests/integration/plugins/java/java-pack-parity.test.ts`, `npm run type-check`.

### Phase D: Python knowledge pack migration

Tests first, in `tests/unit/plugins/python/python-pack.test.ts` (resolve('python') → valid LoadedPack;
class/import extraction, `import foo` + `from foo import Bar`) and
`tests/integration/plugins/python/python-pack-parity.test.ts` (fixture `tests/fixtures/python-simple/`
— FastAPI app, ±10% parity).

Implementation: create `src/plugins/packs/python/{manifest.json, rules/modules.yaml,
rules/dependencies.yaml, rules/frameworks/django.yaml, rules/frameworks/fastapi.yaml,
patterns/architectural.yaml}` and `tests/fixtures/python-simple/`.

DoD: `npm test -- --run tests/unit/plugins/python/python-pack.test.ts`,
`npm test -- --run tests/integration/plugins/python/python-pack-parity.test.ts`, `npm run type-check`.

## Touches

- src/core/pack-registry/knowledge-pack-schema.ts (new)
- src/core/pack-registry/pack-registry.ts (new)
- src/core/pack-registry/types.ts (new)
- src/core/pack-registry/errors.ts (new)
- src/core/pack-registry/index.ts (new)
- src/core/rule-engine/ast-node.ts (new)
- src/core/rule-engine/rule-engine.ts (new)
- src/core/rule-engine/rule-based-plugin.ts (new)
- src/core/rule-engine/index.ts (new)
- src/core/index.ts (re-export PackRegistry/RuleEngine)
- src/core/plugin-registry.ts (prefer pack-resolved plugin)
- src/plugins/packs/java/manifest.json (new)
- src/plugins/packs/java/rules/modules.yaml (new)
- src/plugins/packs/java/rules/dependencies.yaml (new)
- src/plugins/packs/java/rules/frameworks/spring.yaml (new)
- src/plugins/packs/java/patterns/architectural.yaml (new)
- src/plugins/packs/python/manifest.json (new)
- src/plugins/packs/python/rules/modules.yaml (new)
- src/plugins/packs/python/rules/dependencies.yaml (new)
- src/plugins/packs/python/rules/frameworks/django.yaml (new)
- src/plugins/packs/python/rules/frameworks/fastapi.yaml (new)
- src/plugins/packs/python/patterns/architectural.yaml (new)
- tests/unit/core/pack-registry.test.ts (new)
- tests/unit/core/rule-engine.test.ts (new)
- tests/unit/core/rule-based-plugin.test.ts (new)
- tests/unit/plugins/java/java-pack.test.ts (new)
- tests/unit/plugins/python/python-pack.test.ts (new)
- tests/integration/plugins/java/java-pack-parity.test.ts (new)
- tests/integration/plugins/python/python-pack-parity.test.ts (new)
- tests/fixtures/java-simple/ (new)
- tests/fixtures/python-simple/ (new)
- docs/proposals/proposal-language-knowledge-registry.md (reference — exists)
- tasks/TASK-63.md

## Acceptance Criteria

- [ ] `PackRegistry` loads + Zod-validates knowledge packs; missing `language` / missing manifest produce descriptive errors
- [ ] `RuleEngine` interprets a loaded pack into `Entity[]` + `Relation[]`; `RuleBasedLanguagePlugin` implements `ILanguagePlugin` and is instantiable via `PluginRegistry`
- [ ] Java and Python packs achieve ±10% output parity vs the current imperative plugins on the fixture projects
- [ ] Existing imperative Java/Python plugins remain as fallback; no user-visible CLI change; Phases 3-4 (online registry, community packs) not implemented
- [ ] Full `npm test` suite green; `npm run type-check` and `npm run lint` clean

## Contract

measure pack-registry = `npm test -- --run tests/unit/core/pack-registry.test.ts` passed-count
measure rule-engine = `npm test -- --run tests/unit/core/rule-engine.test.ts` passed-count
measure rule-based-plugin = `npm test -- --run tests/unit/core/rule-based-plugin.test.ts` passed-count
measure java-pack = `npm test -- --run tests/unit/plugins/java/java-pack.test.ts` passed-count
measure java-parity = `npm test -- --run tests/integration/plugins/java/java-pack-parity.test.ts` deviation-pct, 10pct-band
measure python-pack = `npm test -- --run tests/unit/plugins/python/python-pack.test.ts` passed-count
measure python-parity = `npm test -- --run tests/integration/plugins/python/python-pack-parity.test.ts` deviation-pct, 10pct-band
band all-green = `npm run type-check` exit-code-0, `npm run lint` exit-code-0
invariant 不删除现有 Java/Python 命令式插件（作 fallback）；不实现 Phase 3-4（在线注册表/社区包）；js-yaml 必须显式加依赖
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
control 若 src/core/pack-registry/ 已存在实现 ⇒ 判定「已覆盖」而非「真新」（不得重复搬入）
resume 每完成一个 Phase 即跑该 Phase 的 DoD 命令落盘；被打断可从已通过的 Phase 续

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 由 quay-tasks/TASK-16 搬入 tasks/（TASK-63）时写就；Contract 每 measure 行自带命令；AC 阈值（±10%）引用 parity 字段

## Definition of Done

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

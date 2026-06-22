## Overview

This plan implements the approved structural refactor proposal in four sequential phases:

1. shared ArchJSON mapper foundation
2. `ValidatedMermaidGenerator` decomposition
3. Go Atlas Mermaid template split
4. config type split with compatibility exports

The sequence is intentional. The mapper and Mermaid generator changes touch behavior-heavy code with the clearest existing test coverage, so they go first and establish reusable patterns. The Atlas and config changes then build on that reduced risk surface.

## Phases

### Phase 1: Shared mapper foundation

Objectives:

- Introduce `BaseArchJsonMapper` in `src/plugins/shared/mapper-utils.ts`.
- Remove duplicated entity/member/relation mapping mechanics from the C++, Go, Java, and Python ArchJSON mappers.
- Eliminate `uuid`-based relation IDs from the Python mapper.

Stages:

1. Add or extend mapper-focused tests before implementation.
   Acceptance criteria:
   - New or updated tests pin shared behavior for source locations, relation de-duplication, and relation ID generation.
   - Tests demonstrate Python relations use deterministic IDs and that Go/Java/C++ behavior remains intact.
   Dependencies:
   - existing mapper tests in `tests/plugins/cpp/archjson-mapper.test.ts`
   - existing mapper tests in `tests/plugins/golang/archjson-mapper.test.ts`
   - existing mapper tests in `tests/plugins/java/archjson-mapper.test.ts`

2. Implement the base mapper helpers in `src/plugins/shared/mapper-utils.ts`.
   Acceptance criteria:
   - `generateEntityId()` and `createRelation()` remain exported and backward-compatible.
   - A `BaseArchJsonMapper` abstract class provides protected helpers for visibility, parameters, source locations, and unique relation/entity insertion.
   Dependencies:
   - stage 1 tests must fail or cover missing behavior first

3. Refactor language mappers onto the base.
   Acceptance criteria:
   - `src/plugins/golang/archjson-mapper.ts`, `src/plugins/java/archjson-mapper.ts`, `src/plugins/python/archjson-mapper.ts`, and `src/plugins/cpp/archjson-mapper.ts` compile and preserve public method signatures.
   - Python no longer imports `uuid`.
   - Mapper tests pass for all affected languages.
   Dependencies:
   - stage 2 complete

Test strategy:

- Run targeted Vitest suites for C++, Go, Java, and Python mapper coverage.

### Phase 2: `ValidatedMermaidGenerator` decomposition

Objectives:

- Move formatting, grouping, validation, and split-diagram internals out of `src/mermaid/generator.ts`.
- Keep the public `ValidatedMermaidGenerator` API stable for tests and callers.

Stages:

1. Add regression tests around current generator behaviors that will move.
   Acceptance criteria:
   - Tests cover split-diagram generation, relation rendering, and sanitizer behavior through the public class.
   - Existing `tests/unit/mermaid/enhanced-type-sanitizer.test.ts` and render-separation tests remain green before the refactor.
   Dependencies:
   - none

2. Extract focused helper modules under `src/mermaid/`.
   Acceptance criteria:
   - New modules own grouping, formatting, validation, and split assembly responsibilities.
   - `src/mermaid/generator.ts` shrinks materially and acts as orchestration glue.
   - External imports continue to target `ValidatedMermaidGenerator` without changes.
   Dependencies:
   - stage 1 tests in place

3. Re-run existing Mermaid unit/integration coverage and repair regressions.
   Acceptance criteria:
   - Mermaid generator and render-separation tests pass.
   - No caller in `src/mermaid/diagram-generator.ts` or CLI processors requires API change.
   Dependencies:
   - stage 2 complete

Test strategy:

- Run targeted Mermaid unit and integration suites plus `npm run type-check`.

### Phase 3: Go Atlas Mermaid template split

Objectives:

- Split the large Atlas renderer template file by layer while keeping `MermaidTemplates` as the compatibility surface.
- Resolve the renderer TODO for subgraph ID collision handling.
- Formalize the goroutine pattern-detection TODO into tracked backlog metadata if it is not implemented.

Stages:

1. Add layer-level rendering regression tests or expand existing Atlas renderer coverage.
   Acceptance criteria:
   - Tests assert that package, capability, goroutine, and flow rendering still route through the façade and produce stable content signatures.
   Dependencies:
   - identify existing Atlas renderer coverage

2. Extract layer modules and shared helpers.
   Acceptance criteria:
   - `src/plugins/golang/atlas/renderers/mermaid-templates.ts` becomes a thin façade.
   - Shared ID sanitization and tree helpers live in a shared module.
   - Collision handling is implemented instead of left as TODO.
   Dependencies:
   - stage 1 tests in place

3. Close or formalize TODO/FIXME items.
   Acceptance criteria:
   - The template collision TODO is removed because the behavior exists in code.
   - The goroutine pattern-detection TODO is either implemented or converted into a repository-tracked issue reference/comment with explicit backlog status.
   Dependencies:
   - stage 2 complete

Test strategy:

- Run targeted Atlas tests and `npm run type-check`.

### Phase 4: Config type split

Objectives:

- Split `src/types/config.ts` by concern without breaking existing imports.
- Keep `src/types/index.ts` and `src/types/config.ts` as compatibility entrypoints.

Stages:

1. Add type/import compatibility coverage if current tests do not already pin it.
   Acceptance criteria:
   - Tests verify that consumers importing from `@/types/config.js` or `@/types/config` still resolve `DiagramConfig`, `GlobalConfig`, `CLIOptions`, and metadata-related types.
   Dependencies:
   - existing config tests under `tests/unit/types/`

2. Extract focused config modules and convert `src/types/config.ts` into a barrel.
   Acceptance criteria:
   - `config-mermaid.ts`, `config-diagram.ts`, `config-global.ts`, and `config-cli.ts` exist.
   - `defaultMermaidConfig` remains exported from `src/types/config.ts`.
   - No call site changes are required unless they simplify imports locally.
   Dependencies:
   - stage 1 tests in place

3. Run broad validation.
   Acceptance criteria:
   - Config unit tests pass.
   - `npm run type-check` and a build-equivalent validation pass.
   Dependencies:
   - stage 2 complete

Test strategy:

- Run config/unit suites, `npm run type-check`, and final build/test validation.

## Dependencies

- Phase 1 must finish before later phases because it changes the shared mapper utility module.
- Phase 2 should finish before Phase 4 broad validation because Mermaid generator coverage is a major type-check consumer.
- Phase 3 and Phase 4 can be implemented in either order after Phase 2, but this plan keeps Atlas first because the TODO cleanup is part of the user request.

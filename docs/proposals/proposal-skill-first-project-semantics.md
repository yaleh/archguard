# Proposal: Skill-First Project Semantics Integration

**Status**: Draft (v2 — reviewed)
**Date**: 2026-04-01
**Related**: `docs/proposals/proposal-llm-semantic-exploration.md`, `docs/plans/plan-51-llm-semantic-exploration.md`, `docs/proposals/proposal-test-analysis.md`

---

## Architect Review Notes (v2)

> **Reviewer**: Architect review
> **Date**: 2026-04-01
>
> 结论：方向正确，但 v1 有三个必须明确的点，否则迁移时会继续留下模糊边界。
>
> 1. 外部 authoring 格式不能继续复用完整 `ProjectSemantics`，否则 `confidence`、`_dirTreeHash`、`_generatedAt` 这些 discovery-era 字段会污染稳定配置契约。
> 2. `.archguard/project-semantics.json` 必须明确为“与 `archguard.config.json.projectSemantics` 相同 shape 的裸对象”，而不是旧探索缓存格式。
> 3. proposal 必须定义旧 discovery 代码的兼容与移除策略，否则 plan 会无法切分成可执行阶段。
>
> 以上问题已直接整合到正文。

---

## Background

ArchGuard already has a useful `ProjectSemantics` consumption layer:

- `src/analysis/test-analyzer.ts` reads `additionalTestPatterns` and `customAssertionPatterns`
- `src/mermaid/generator.ts` and `src/mermaid/ts-module-graph-renderer.ts` read `architecturalLayers`
- `src/analysis/fim/fim-analysis.ts` reads `nonProductionPatterns`, `barrelFiles`, and `suggestedDepth`
- `src/cli/config-loader.ts` validates `projectSemantics` in config

What is still architecturally unstable is the **knowledge discovery path**. The current design introduced an internal exploration pipeline:

- `src/analysis/project-semantics-explorer.ts`
- `src/analysis/project-semantics-cache.ts`
- `src/cli/analyze/run-analysis.ts` → `resolveProjectSemantics()`
- `src/cli/commands/analyze.ts` → `--explore` / `--no-explore`

That design made ArchGuard responsible for both:

1. discovering knowledge
2. consuming knowledge

This mixes responsibilities. The user requirement is stricter: knowledge discovery should be **skill-led**, while ArchGuard should act only as the product that **loads, validates, merges, and consumes** that knowledge.

The consequence is important:

- ArchGuard should not own a built-in discovery orchestrator
- CLI / MCP should not be the main discovery workflow
- new ArchGuard discovery tools should be minimized
- the main contract should be the **knowledge format**, preferably integrated into existing config

---

## Goals

- Make skills the primary owner of project knowledge discovery
- Keep ArchGuard focused on schema validation, merge rules, and analysis-time consumption
- Reuse the existing `projectSemantics` integration points already wired into test analysis, Mermaid grouping, and FIM
- Minimize ArchGuard tool surface area for discovery
- Make malformed skill-produced knowledge fail fast during analysis
- Prefer an existing configuration format over introducing a new product-specific discovery protocol

---

## Non-Goals

- Do not design a new built-in semantic discovery engine inside ArchGuard
- Do not add a new family of ArchGuard discovery tools such as package summarizers, assertion extractors, or architecture inference tools
- Do not require ArchGuard to understand how a skill performed discovery
- Do not define model-specific invocation flows in the product
- Do not expand `ProjectSemantics` into a general-purpose agent protocol

---

## Design

### 1. Product boundary: ArchGuard consumes, skills discover

The authoritative responsibility split becomes:

- **Skills**
  - inspect the repository
  - decide what evidence to collect
  - use whatever host/system tools they need
  - write `projectSemantics` data

- **ArchGuard**
  - load `projectSemantics`
  - validate schema
  - merge sources
  - inject semantics into analysis
  - fail clearly when the format is invalid

ArchGuard no longer owns a discovery workflow.

### 2. Stable authoring contract vs internal resolved contract

The main product contract is the semantics format itself, but it should be split into two layers:

1. **Authoring / persistence contract** — used by users and skills
2. **Resolved runtime contract** — used internally after merge/defaulting

The authoring contract should be a new explicit schema, for example:

```typescript
export interface ProjectSemanticsInput {
  nonProductionPatterns?: string[];
  barrelFiles?: string[];
  additionalTestPatterns?: string[];
  customAssertionPatterns?: string[];
  architecturalLayers?: Record<string, string>;
  suggestedDepth?: number;
}
```

This shape already exists semantically in `src/cli/config-loader.ts`, but today it is modeled indirectly via `PartialProjectSemanticsSchema`. That is too loose for a stable product boundary because the full `ProjectSemantics` type also contains discovery-era metadata fields.

The internal resolved contract may remain versioned and complete:

```typescript
export interface ProjectSemantics {
  version: '1.0';
  nonProductionPatterns: string[];
  barrelFiles: string[];
  additionalTestPatterns: string[];
  customAssertionPatterns: string[];
  architecturalLayers?: Record<string, string>;
  suggestedDepth?: number;
}
```

The product should treat `ProjectSemanticsInput` as the stable authoring format for both:

- hand-written config in `archguard.config.json`
- skill-produced sidecar data

Fields such as `confidence`, `_dirTreeHash`, and `_generatedAt` should not remain part of the long-term authoring contract.

### 3. Preferred storage locations

The preferred storage model is:

1. `archguard.config.json` → durable user-maintained semantics
2. `.archguard/project-semantics.json` → skill-produced or ephemeral semantics
3. built-in defaults → last fallback

Priority:

```text
archguard.config.json.projectSemantics
  > .archguard/project-semantics.json
  > built-in defaults
```

The sidecar file must use the **same object shape** as `archguard.config.json.projectSemantics`, not a wrapper object and not the old exploration cache payload.

Example:

```json
{
  "nonProductionPatterns": ["examples", "scripts"],
  "additionalTestPatterns": ["tests/**/*.ts"],
  "architecturalLayers": {
    "src/analysis": "analysis",
    "src/cli": "cli"
  },
  "suggestedDepth": 2
}
```

This keeps the current sidecar pattern available while still making the main contract compatible with the existing config file.

### 4. Strict validation and error behavior

ArchGuard should fail fast if semantics input is malformed.

Required behavior:

- invalid `projectSemantics` in `archguard.config.json` → configuration load failure
- invalid `.archguard/project-semantics.json` → analysis startup failure if the file is present and selected for loading
- unsafe values such as `..`, absolute paths, and null bytes → validation failure with a targeted error message

The product should not silently ignore a malformed semantics file, because that would make skill-generated knowledge non-deterministic and hard to debug.

### 5. No discovery-specific tools inside ArchGuard

The following kinds of tools should **not** be added to ArchGuard:

- barrel verification tools for agents
- package summarization tools
- candidate layer boundary discovery tools
- assertion wrapper extraction tools
- test convention extraction tools

These are discovery concerns, and discovery belongs to skills.

If a skill needs mechanical access to files, it should use host-provided filesystem/search capabilities rather than routing discovery back through ArchGuard.

### 6. Keep consumption code, remove discovery orchestration

The consumption side remains valid and should stay:

- `src/analysis/test-analyzer.ts`
- `src/mermaid/generator.ts`
- `src/mermaid/ts-module-graph-renderer.ts`
- `src/analysis/fim/fim-analysis.ts`
- `src/types/extensions/project-semantics.ts`
- `src/cli/config-loader.ts`

The discovery orchestration side should be deprecated and then removed:

- `src/analysis/project-semantics-explorer.ts`
- `src/analysis/project-semantics-cache.ts`
- `resolveProjectSemantics()` exploration branch in `src/cli/analyze/run-analysis.ts`
- exploration-oriented CLI flags in `src/cli/commands/analyze.ts`

The migration must happen in two steps:

1. stop using discovery orchestration in the runtime path
2. remove deprecated code and flags after compatibility notice and fixture updates

### 7. Minimal runtime loading model

The runtime loading flow should become:

```text
load config
  -> load optional sidecar semantics file
  -> validate both inputs
  -> merge with defaults
  -> inject into analysis pipeline
```

There is no product-owned "discover semantics" step in this flow.

### 8. Barrel file handling remains a consumption concern

`barrelFiles` is still a valid field, but it must stay a **consumption-time hint**.

That means:

- skills may write `barrelFiles`
- ArchGuard may minimally verify them at the point of FIM consumption
- ArchGuard does not discover them itself

This preserves the current verified-consumption design in `src/analysis/fim/fim-analysis.ts` without turning ArchGuard into a barrel discovery product.

### 9. Compatibility and migration

This proposal supersedes the discovery architecture in `proposal-llm-semantic-exploration.md` while preserving the already-correct consumption paths.

Migration rules:

- existing `projectSemantics` in `archguard.config.json` keeps working
- existing sidecar files produced by the old exploration flow should either:
  - be migrated to the new `ProjectSemanticsInput` shape, or
  - fail with a clear upgrade error
- deprecated exploration flags should first warn, then be removed in a follow-up compatibility window

The key point is that **knowledge consumption is preserved; discovery ownership changes**.

---

## Tradeoffs

### Benefits

- clear ownership boundary
- lower product complexity
- fewer moving parts inside ArchGuard
- no duplication of discovery logic across CLI, MCP, and tools
- easier debugging because the contract is a concrete file shape

### Costs

- skills must take more responsibility for evidence collection
- users need a documented convention for where skill-generated knowledge is stored
- malformed sidecar semantics become visible product errors rather than hidden fallbacks

### Accepted tradeoff

This proposal intentionally prefers **architectural clarity over product convenience**. It is acceptable that discovery happens outside ArchGuard if that keeps ArchGuard small, deterministic, and easier to maintain.

---

## Risks

### Risk 1 — Two writable sources can drift

If users edit `archguard.config.json` while skills also write `.archguard/project-semantics.json`, the effective result may be surprising.

Mitigation:

- keep priority explicit in docs and errors
- surface the source priority in logs when `verbose` is enabled

### Risk 2 — Existing exploration users lose a convenience path

Some current workflows may rely on the built-in exploration branch.

Mitigation:

- deprecate before removal
- document that discovery is now skill-managed
- keep sidecar loading so skill output can still be consumed without editing config

### Risk 3 — Overly strict validation may break existing ad hoc files

If older sidecar files contain fields from the previous exploration implementation, strict validation could reject them.

Mitigation:

- define a migration path
- either ignore deprecated metadata fields explicitly or emit a targeted upgrade error

---

## Alternatives Considered

### Alternative A — Keep internal discovery orchestration and only swap the backend

Rejected. This still leaves ArchGuard owning discovery. It changes the transport but not the architecture.

### Alternative B — Build a rich ArchGuard tool suite for skills

Rejected. This would reintroduce discovery logic into product code through another interface surface.

### Alternative C — Only allow `archguard.config.json`, no sidecar file

Not chosen for now. It is the cleanest model, but a sidecar file remains useful for skill-generated or ephemeral semantics. The important constraint is that both locations share the same schema.

### Alternative D — Keep the old exploration cache format as the sidecar contract

Rejected. That would preserve discovery-era metadata in the public contract and make the new skill boundary harder to reason about.

---

## Proposed Outcome

After this change, ArchGuard should be described as:

> a consumer of externally discovered project semantics, not a discoverer of project semantics

That is the correct product boundary for the next iteration.

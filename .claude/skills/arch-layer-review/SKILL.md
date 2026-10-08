---
name: arch-layer-review
description: Run the Phase D1 Semantic Architecture Review loop over ArchGuard's mechanical facts plus declared layer rules and emit evidence-backed, four-state semantic judgments (converged / cosmetic / regressed / not-evaluated). Use when the question is whether a refactor genuinely moved a responsibility to its declared layer rather than only relocating files. Advisory only — this skill is never a deterministic gate.
argument-hint: <goal-id-or-refactor-slice>
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# Arch Layer Review (Phase D1 — Semantic Architecture Review)

Answer the question a deterministic layer-direction check cannot answer: **did a
refactor genuinely move ownership of a responsibility to its declared layer, or
did it only relocate files and rename functions?**

This skill is the "thin semantic layer" of the A4 proposal
(`docs/proposals/proposal-architecture-layer-check.md`, §"Phase D1"). It adds
**no new deterministic checker, no CLI command, and no MCP tool** — it is pure
orchestration over artifacts that already exist.

## What this skill consumes (never rewrites)

- The mechanical facts layer: ArchGuard's `extensions.tsAnalysis.moduleGraph`
  (directory-level edges, `cycles`, node stats) plus package-level metrics. Run
  `node dist/cli/index.js analyze -f json` and read `moduleGraph` directly — do
  not route through the `detect_cycles` MCP tool.
- The declared architecture rules layer: a `layers.yml` declaration plus the
  deterministic verdict produced by
  `docs/experiments/layer-map/check-layers.mjs`. **Call `check-layers.mjs`
  verbatim; do not modify it and do not write a second checker.** Its three-state
  result (`pass` / `fail` / `not-evaluated`) is the only authoritative verdict in
  this whole skill.
- Optional before/after diff: two independently evaluated trees, so the judgment
  can say whether a change moved the structure toward or away from the
  declaration.
- Optional repo docs: the proposal / plan / ADR under review, and a human-approved
  acceptance protocol (a checklist of traps, e.g. the GOAL-030 protocol below).

## Three physical partitions (never merged into one table)

| Layer | Produced by | Who decides | Replayability |
|-------|-------------|-------------|---------------|
| **mechanical facts** | ArchGuard `analyze` output (`moduleGraph` edges, cycles, metrics) | ArchGuard, sole truth | byte-identical for identical input |
| **declared architecture rules** | `layers.yml` + `check-layers.mjs` `pass` / `fail` / `not-evaluated` | the human-reviewed declaration + the deterministic checker — **authority lives here; this skill never touches it** | byte-identical for identical input |
| **LLM semantic interpretation** | this skill's four-state judgment + cited `evidence` items | the LLM, **advisory only, not a gate**; a human or a task gate decides whether to accept it | `evidence` citations replay; prose is allowed to vary |

`check-layers.mjs` keeps its authority: this skill **reads and cites** its
`pass` / `fail` / `not-evaluated` result, it never recomputes, overrides, or
re-emits it. A `not-evaluated` from `check-layers.mjs` stays `not-evaluated`
here — it is never quietly upgraded to "looks fine".

## MVP scope — only these four judgments

1. **ownership convergence** — does a responsibility's decision + execution logic
   live in exactly one implementation, inside the layer declared to own it (e.g.
   kernel), rather than the old layer keeping one copy and the new layer adding
   another ("a third implementation")?
2. **responsibility migration** — did a responsibility declared "this belongs in
   layer X" actually disappear from layer Y, rather than Y keeping a
   "looks-unused-but-still-called" implementation?
3. **orchestrator domain state** — does the orchestrator / driver layer still
   directly do all three of *read state, decide legality, write state*, or has it
   become "pass the intent to the domain layer, let the domain layer decide and
   execute"?
4. **shell move vs. real move** (`搬文件` / `搬壳`) — are the new modules just
   copies of the old bodies with a reversed import path, while the old callers
   and the old file's semantic role are unchanged (e.g. the new module's body
   still imports the old write primitives back)?

### NOT in the MVP (deliberately excluded, not "forgotten")

- full **DDD** modeling (no aggregate roots / value objects / domain events)
- **OOD** review (no class-responsibility, inheritance, or composition advice)
- **架构风格** diagnosis (no "is this hexagonal / layered / microservices")
- global **评分** / scoring (no architecture health score or ranking)

These are out of scope because their evidence base (domain model, team
conventions, non-functional requirements) is wider than "ArchGuard mechanical
output + declared-layer artifacts". The MVP only answers what those two evidence
sources can directly or indirectly support.

## Workflow

### Step 1 — Probe (collect deterministic signals only)

1. Run `node dist/cli/index.js analyze -f json` from a neutral directory (do not
   inherit the repo under review's own `archguard.config.json` exclusions).
2. Read `extensions.tsAnalysis.moduleGraph`: directory-level edges, `cycles`,
   per-node stats. Record the raw edge strengths and the `cycles` count — these
   are facts, not judgments.
3. Run `check-layers.mjs` on the moduleGraph JSON plus `layers.yml`; capture its
   `status` (`pass` / `fail` / `not-evaluated`), `violations`, and `gaps`.
4. Read any acceptance protocol / trap checklist supplied with the review.

### Step 2 — Focus (localize the claim)

For each of the four MVP questions, name the concrete declaration at stake (which
layer is declared to own the responsibility) and the concrete file/symbol that
currently holds it. Read the new modules' own `import` statements, not just the
directory-level edges — the edge count can rise while the "heart" stays put.

### Step 3 — Judge (four-state, evidence-backed)

For each question emit a conclusion object with a `verdict` in exactly one of:

- `converged` — the responsibility really lives only in the declared layer.
- `cosmetic` — it looks moved but the old implementation is still load-bearing.
- `regressed` — the change moved structure *away* from the declaration.
- `not-evaluated` — the evidence is insufficient (e.g. a before-only snapshot
  where the change has not landed yet).

Every conclusion must cite a non-empty `evidence` array of concrete items (a
`moduleGraph` edge reading, an entity-count delta, a specific line from the
`check-layers.mjs` report, a specific symbol location). Never conclude without an
`evidence` reference.

Also walk the acceptance protocol's `trapChecklist`: for each trap record whether
it is `hit` (`true` / `false`) plus a `reason` citing the reading that decided it.

### Step 4 — Synthesize

Emit the output contract below. Keep the three layers physically separate — never
merge facts, declared rules, and interpretation into one table. Verdicts are
**advisory semantic labels, not exit codes and not booleans**: the output must
contain no `pass`/`fail`/exit-code-shaped field that a downstream consumer could
mistake for a mechanical verdict.

## Output contract

A JSON document with three top-level keys, one per layer:

- `facts` — the mechanical readings (edge strengths, cycles, symbol locations).
  Pure data, no verdict words.
- `declaredRules` — what `check-layers.mjs` returned, verbatim: `status`
  (`pass` / `fail` / `not-evaluated`), `violations`, coverage gaps, and an
  explicit `authority` note that this layer is the sole verdict-holder.
- `judgment` — the semantic interpretation: an array of conclusion objects (the
  four MVP questions) each with `question`, `verdict` (four-state), non-empty
  `evidence`, and a `trapChecklist` covering the acceptance protocol traps.

Rules for the `judgment` block:

- No conclusion is emitted without a non-empty `evidence` array.
- Do **not** emit `exitCode`, `pass`, or `fail` field names/values under
  `judgment` — the four-state vocabulary (`converged` / `cosmetic` /
  `regressed` / `not-evaluated`) exists precisely so a semantic read is never
  mistaken for a mechanical PASS/FAIL.
- The verdict is advisory: it does not change any state machine, gate result, or
  the `check-layers.mjs` verdict.

See `references/goal-030-example-output.json` for a worked example — the quay
GOAL-030 "promotion writes converge to kernel transition decision" slice, whose
acceptance protocol enumerates the three traps (shell-move, third implementation,
unchanged interface shape).

## Boundary rule

If answering a judgment seems to require **writing a new deterministic checker**,
stop. That is a signal the question belongs to a later phase (A4 stages 2–4), not
to this thin semantic layer. Do not add deterministic code here.

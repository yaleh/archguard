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
4. **Prefer the checker's structured modes over re-deriving their content by hand**
   (both are optional flags; the checker is still called verbatim, its authority
   unchanged — this skill never recomputes either):
   - two independently evaluated trees in hand (a before/after slice) ⇒ pass
     `--before <before/overview/package.json>`. Read its `driftReport`: each
     cross-layer edge is classified `new-and-undeclared` / `new-and-declared` /
     `preexisting-and-undeclared` from a real comparison of the two trees' edge
     sets. Cite the record, do not eyeball a manual diff.
   - asking about cycles (including the single-tree questions below) ⇒ pass
     `--classify-cycles`. Read its `cycleClassification` (`intra-layer` /
     `cross-layer-declared` / `cross-layer-undeclared`) and its
     `bidirectionalAllowedPairs`. Same reading, no hand-set arithmetic.
   Omitting both flags keeps `check-layers.mjs` byte-identical to its previous
   output, so this is additive, never a replacement.
5. Read any acceptance protocol / trap checklist supplied with the review.

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

#### `declarationStatus` — an annotation on the declaration, not a fifth verdict

A `driftReport` record and a semantic verdict answer different questions, and a
change can be semantically right while the *declaration* is out of date. To say
that without inventing a new outcome, each conclusion may carry an **independent
annotation field** `declarationStatus` (`"current"` | `"stale"` | `"not-evaluated"`)
plus `recommendedDeclarationUpdate` (a concrete suggestion string, or `null`):

- **Do NOT add a fifth `verdict` state.** The four-state vocabulary
  (`converged` / `cosmetic` / `regressed` / `not-evaluated`) is unchanged and
  `declarationStatus` is **not** another verdict — it only says whether the
  declaration has kept up with the implementation.
- `driftReport` shows a `new-and-undeclared` edge ⇒ ask whether the *change* is
  what the declaration's intent already implies (e.g. the goal / acceptance
  protocol names that direction as expected). If yes, keep the semantic `verdict`
  honest (often `converged` — the structure moved toward the declared owner) and
  mark `declarationStatus: "stale"` with a specific
  `recommendedDeclarationUpdate` (e.g. "add `core-gate -> core-kernel` to
  `layers.yml`'s `allowed`"). Do **not** blanket-declare `regressed` just because
  the checker now reports a violation.
- A `preexisting-and-undeclared` edge is **not** this change's fault: annotate it
  as pre-existing debt and never attribute it to the reviewed change.
- `not-evaluated` when the declaration layer structurally cannot judge it (e.g. an
  intra-layer cycle, which the cross-layer direction check cannot see).

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
  `evidence` (every evidence item is an object carrying a required `confidence`
  field — see below), and a `trapChecklist` covering the acceptance protocol
  traps.
  Optionally also `declarationStatus` (`"current"` | `"stale"` | `"not-evaluated"`)
  and `recommendedDeclarationUpdate` — a **supplementary annotation on the
  declaration layer, never a fifth verdict state** (see Step 3).

Rules for the `judgment` block:

- No conclusion is emitted without a non-empty `evidence` array.
- Do **not** emit `exitCode`, `pass`, or `fail` field names/values under
  `judgment` — the four-state vocabulary (`converged` / `cosmetic` /
  `regressed` / `not-evaluated`) exists precisely so a semantic read is never
  mistaken for a mechanical PASS/FAIL.
- The verdict is advisory: it does not change any state machine, gate result, or
  the `check-layers.mjs` verdict.
- Every `evidence` item carries a required `confidence` field, and a
  `proxy-metric` item with a missing or empty `caveat` is a contract violation
  (see below).

### `evidence[]` — every item carries a required `confidence` field

Each item in an `evidence` array — both a conclusion's `evidence` and a
`trapChecklist` entry's `evidence` — is an object with two keys:

- `statement` — the concrete reading being cited (a `moduleGraph` edge reading, an
  entity-count delta, a specific line from the `check-layers.mjs` report, a
  symbol location). This is the string an earlier contract allowed inline.
- `confidence` — an object with exactly two keys:
  - `source` — one of exactly four values:
    - `deterministic` — read directly from ArchGuard's mechanical output
      (`moduleGraph` edges / cycles / metrics) or a `check-layers.mjs` verdict
      (its three-state result, a `driftReport` record). `caveat` is normally
      `null`.
    - `proxy-metric` — the cited number is a **proxy** indicator, not a direct
      measurement of the question at stake (e.g. a `get_cluster_boundary`
      `silhouetteScore` standing in for "is this grouping sound"). `caveat` is
      **required non-empty**: name the proxy's specific limitation.
    - `single-reading` — one reading with no cross-check (a single `analyze` run
      on one ref / environment). `caveat` should name what was not cross-checked.
    - `corroborated-by-2-methods` — at least two independent methods / data
      sources reconcile to the same conclusion (e.g. directory-level edges plus
      an independent grep). `caveat` is normally `null`.
  - `caveat` — `string | null`. **Required non-empty whenever `source` is
    `proxy-metric`.**

**A tool's own confidence warning is never swallowed.** When a tool or underlying
data source *itself declares* a confidence caveat — a self-reported metric such
as `get_cluster_boundary`'s `silhouetteScore`, which can ship with an explicit
`warning` like `"no clear cluster structure detected"`, or any output containing
"low confidence" / "低置信度" / "heuristic" — citing it as evidence **requires**
`caveat` to be non-empty and to restate that warning. The whole point of
`confidence` is that a low-confidence reading must never silently enter the
report looking as strong as a `deterministic` one.

See `references/goal-030-example-output.json` for a worked example — the quay
GOAL-030 "promotion writes converge to kernel transition decision" slice, whose
acceptance protocol enumerates the three traps (shell-move, third implementation,
unchanged interface shape).

See `references/goal-030-drift-and-stale-declaration-example.json` for the
drift-consumption worked example — the same GOAL-030 slice, before (fork point)
vs. after (branch tip), where `check-layers.mjs --before` really classifies
`gate/lifecycle.ts -> kernel/task-transition.ts` (layer edge
`core-gate -> core-kernel`) as `new-and-undeclared`: the verdict stays
`converged` (the direction is the one the goal intends) while
`declarationStatus: "stale"` records that `layers.yml`'s `allowed` has not caught
up, with a concrete `recommendedDeclarationUpdate`.

## Single-tree / Architecture-Health Mode (2026-10-08)

The four MVP questions above all assume **one concrete change** — an old
implementation vs. a new one — so they can only judge a before/after refactor
slice. When you only have **a single tree** and want to ask "is this
architecture healthy as it stands right now?", two of them (orchestrator domain
state, shell move vs. real move) are structurally unanswerable: there is no
compared object, so the honest verdict is `not-evaluated`, not "the evidence was
thin". The 2026-10-08 ArchGuard self-review measured this directly, and alongside
it a second gap: `check-layers.mjs`'s `pass` is **structurally blind to
intra-layer cycles** — it compares cross-layer directions only, so a `pass` means
"no cross-layer direction violation", never "there are no cycles".

This mode adds a **second question set** that **coexists with the before/after
four questions — it does not replace them**. Both sets run under the same
three-layer output contract (`facts` / `declaredRules` / `judgment`), the same
four-state vocabulary, the same non-empty-`evidence` rule, and the same ban on
`pass`/`fail`/`exitCode` field names. The caller picks the set by scenario:
before/after refactor comparison uses the four MVP questions; a single-tree health
check uses the four below. This is **not a new mechanism** — it consumes the same
artifacts (`moduleGraph`, `check-layers.mjs`, `layers.yml`) and adds no new
deterministic checker and changes no authority.

Run `check-layers.mjs --classify-cycles` first and read its `cycleClassification`
+ `bidirectionalAllowedPairs`: questions 1 and 2 below are exactly that pure
set-arithmetic, so **cite the checker's record per cycle instead of recomputing
"are all members the same layer / is each adjacent direction declared" by hand**.
`bidirectionalAllowedPairs` (a layer pair listed `A -> B` *and* `B -> A` in
`allowed`) is worth surfacing on its own: such a declaration says "these two layers
depend on each other by design" and should be human-reviewed rather than drowned
in the violation list.

The four single-tree questions:

1. **cross-layer cycle coverage** (跨层环覆盖) — for every **cross-layer**
   directory cycle, read `cycleClassification`'s `cross-layer-declared` /
   `cross-layer-undeclared` rather than re-deriving it. Declared ⇒ this is a
   design choice (e.g. ArchGuard's own `plugin-runtime <-> plugins`
   dynamic-assembly edges), annotate it — it is not a violation. Undeclared yet
   `check-layers.mjs` still says `pass` (because that pair happened not to hit a
   violation rule) ⇒ name it explicitly as a **coverage gap** that `pass` must not
   paper over. The checker's `cross-layer-declared` is the deterministic form of
   this judgment; the LLM only explains it.
2. **intra-layer cycle exposure** (同层环暴露) — read the cycles
   `cycleClassification` marks `intra-layer`: it is a cycle `check-layers.mjs`
   structurally cannot see (the cross-layer direction check does not evaluate it),
   and it must never silently disappear from `cycleClassification`. List each one
   and annotate it **"declared rules 对此环未评估"** — never skip it just because
   `check-layers.mjs` reports `pass`.
3. **leaf-layer purity** (叶子层纯净度) — for layers/directories that the
   declaration treats as leaves (the most-depended-upon ones; typical names
   `utils` / `types` / `shared`), does any out-edge point **back into the cycle of
   its callers**? (2026-10-08: `src/cli/utils -> src/cli/analyze` value edge and
   `src/cli/utils -> src/cli/processors` type-only edge — the same class of
   judgment, generalized so it can be re-run on any project.)
4. **declaration coverage gap** (声明覆盖缺口) — `check-layers.mjs`'s
   unmapped-directory list plus those directories' `entityCount` share of the
   whole tree's `entityCount` — so "the declaration covers only a sliver but looks
   all-green" cannot hide.

Single-tree reading of the four-state verdict: `converged` reads as "currently
conforms to the declaration", `regressed` reads as "a real coupling exists
outside the declaration", and `not-evaluated` covers "the declaration layer
structurally cannot evaluate this" (the intra-layer-cycle case). Every conclusion
still requires a non-empty `evidence` array, exactly as above.

See `references/archguard-selfreview-example-output.json` for a worked single-tree
example — ArchGuard's own 2026-10-08 self-review.

## Boundary rule

If answering a judgment seems to require **writing a new deterministic checker**,
stop. That is a signal the question belongs to a later phase (A4 stages 2–4), not
to this thin semantic layer. Do not add deterministic code here.

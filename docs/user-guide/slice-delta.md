# Refactor Slice / Expected Delta

Answer exactly one question: **if I apply *this explicitly-declared* cut, what is the
architecture delta of this tree?**

It does **not** answer "should I cut this way". **The cut is supplied by the caller —
ArchGuard never invents, ranks, or selects a slice.** It is also **not a gate**: the
report says `evaluated` / `not-evaluated` and `guards.clean`; it never emits `pass` /
`fail` field names.

The semantics were prototyped and verified in the frozen layer-map experiment and are
now on the stable product surface: a deterministic library API, a CLI subcommand
(`archguard slice-delta`), and an MCP tool
(`archguard_simulate_refactor_slice`). All three are reachable from ArchGuard's release
artifacts — consumers never depend on an `docs/experiments/**` source path.

## What the report contains

- `current` — the subject's SCC before the cut (`sccMembers` / `sccSize` / `subjectFanIn`).
- `computedDelta` — computed **only** from `(graph, proposedCut, mustNotChange, negativeControl)`:
  `removedEdges` / `addedEdges` / `strengthenedEdges` / `sccBefore` / `sccAfter` / `sccLeft` /
  `sccRemaining` / `whyLeft`.
- `negativeControl` — restoring the declared edges must restore the before-SCC membership,
  otherwise the expected delta is not falsifiable and the guard fires.
- `guards` — `{ clean, violations, negativeControlFalsified }`.
- `declaredPrediction` / `observedDelta` / `predictionComparison` — two *independent*
  readings compared against the computed one. They are **physically partitioned**: neither
  ever feeds back into `computedDelta` or `negativeControl` (an anti-stuffing reverse test
  guarantees the two sections are byte-identical no matter what `observed` says).

Three states, never conflated:

| state | meaning | CLI exit code |
|---|---|---|
| evaluated & guards clean | a trustworthy reading, no guard tripped | `0` |
| evaluated, guard tripped | a reading where `must-not-change` fired or the negative control was not falsifiable | `1` |
| not evaluated | not enough signal — **no** partial delta is produced | `2` |

## Diagnostics: `accounting` and `unknowns`

Two additive report sections make the tool's uncertainty explicit instead of rejecting on it:

- **`accounting[]`** — one entry per affected directory edge:
  `{ edge, names, moving:[{name,to}], staying, unaccounted, destinations, barrel, certainty }`.
  It turns an under-specified cut's rejection into *information*: you can see exactly which
  co-traveling symbols move, which were declared staying, and which (if any) are unaccounted.
- **`unknowns`** — `{ unresolvedAliasRefs, unevaluatedDynamicImports, barrelEdges, nameCollisionEdges?,
  unreferencedSymbols?, unreferencedSymbolsNote? }`.
  These are the couplings the directory graph cannot fully see. **None of it feeds `computedDelta`.** An
  added or removed edge that is a barrel/re-export edge carries `certainty: "unknown"`; a deterministic
  edge omits the field (its absence means deterministic — it is never emitted as a fake value).
  `nameCollisionEdges` (present only when non-empty) lists edges that carry a moved symbol's **name**
  but neither enter a moved-from dir nor structurally re-export from one: they are left unchanged and
  named here rather than silently removed.
  `unreferencedSymbols` (present only when non-empty) names every symbol declared in `moves[].symbols`
  or `stays[].symbols` that appears on **no** edge's `importedNames`. The set operation is exact and
  self-contained:

  ```text
  referenced          := ⋃ { e.importedNames : e ∈ moduleGraph.edges }   // internal AND external
  unreferencedSymbols := declaredNames \ referenced                      // sorted; non-empty only
  ```

  **It includes** every edge of the graph — internal (dir→dir) and external (dir→package). **It
  excludes** same-directory imports, which a directory graph does not represent as edges at all. It is
  a precise, recomputable set difference — never a heuristic such as "is the name on a cross-directory
  edge?", which is the coarser proxy the downstream repair loop had to approximate with (a proxy that
  cannot see the external edges). Its companion `unreferencedSymbolsNote` states the same set operation
  and boundary in the report.

  ⚠️ **`unreferencedSymbols` is a fact, not a verdict — this is the "does not exist"
  misconception it must NOT be read as: "not referenced by any edge" ≠ existence.** A directory graph
  does not represent same-directory imports, so a symbol that is real but
  imported only within its **own** directory — or that this cut simply does not route through any
  reconciled edge — lands in `unreferencedSymbols` exactly as a name that is on no edge at all does.
  The tool cannot tell these apart at directory granularity. Read it as "these declared names the graph
  cannot corroborate", never as an existence check; the caller decides.

`accounting` is emitted only when the declaration exercises a partial-migration feature (a `stays`
clause, a multi-destination edge, an unknown/barrel edge, or a name collision). `unknowns` is emitted
whenever it carries content — the partial-migration features above **or** a non-empty
`unreferencedSymbols`. A cut with neither keeps a report identical to the pre-extension output.

`not-evaluated` is returned (never "best effort") when: the recomputed SCCs disagree with
`moduleGraph.cycles` (self-check failure); a **reconciled** edge carrying a moved name has an
`importedNames` name that is neither moved nor declared by `stays` (a partial migration was not
declared); an edge entering a moved-from dir has no `importedNames`; a `move.to` is neither an
internal dir node nor declared in `newDirs` (the reason lists the legal internal dirs and both
fixes); a `newDirs` entry names an existing node; an **unresolved alias ref**'s `from` dir
participates in the cut (moved-from / destination / subject — the edge set itself is incomplete);
`proposedCut.moves` is empty; a move has `from === to`; or `negativeControl.restoreEdges` is
missing/empty.

## Library API

```ts
import { simulateRefactorSlice } from '@yalehwang/archguard';
import type { TsModuleGraph } from '@yalehwang/archguard';

const report = simulateRefactorSlice({
  graph,            // TsModuleGraph (extensions.tsAnalysis.moduleGraph)
  slice,            // your explicit RefactorSliceDeclaration
  observed,         // optional posterior reading — comparison section only
});

if (report.status === 'evaluated') {
  console.log(report.computedDelta.sccAfter, report.guards.clean);
} else {
  console.log(report.reason); // not-evaluated: why
}
```

The core is pure: it imports no `fs` / `path` / `child_process`. Provenance and git
consistency are injected by the adapters, never read by the library.

## CLI

```bash
# Reading from an explicit package-level ArchJSON:
archguard slice-delta --slice ./slice.json --arch ./.archguard/output/pkg/overview/package.json \
                      --observed ./observed.json --json ./report.json

# Or resolve the graph from <projectRoot>/.archguard/query by scope (same resolution
# every other MCP tool uses). An unresolvable scope is exit 2 — never an empty graph.
archguard slice-delta --slice ./slice.json --scope <scope-key> --project-root /path/to/project

# Exit: 0 = evaluated & clean | 1 = evaluated, guard tripped | 2 = not evaluated
echo $?
```

`--root <dir>` is the workspace root used for provenance and git consistency
(`match` / `mismatch` / `not-checked`); a root that is not a git work tree is honestly
reported as `not-checked`. `provenance.tool.archguardVersion` is read from the shipped
`package.json`, so any report can be traced to the build that produced it.

## MCP tool

```jsonc
// archguard_simulate_refactor_slice
{
  "projectRoot": "/path/to/project",   // optional
  "scope": "<scope-key>",              // optional
  "slice": { /* the explicit cut OBJECT, not a file path */ },
  "observed": { /* optional posterior reading object */ }
}
```

Returns the report JSON as text. If the scope cannot be resolved (or carries no
`extensions.tsAnalysis.moduleGraph`), it returns `isError` with an actionable hint:
run `archguard_analyze` first.

## The slice object (complete schema)

```jsonc
{
  "subject": "",                 // internal dir node id, OR a file path (normalized to its dir)
  "concern": "...",
  "provenance": { "commit": "..." },
  "proposedCut": {
    "moves": [
      // file relocation intent: these symbols move from `from` to `to` (to ≠ from)
      { "file": "cli/driver.ts", "from": "cli", "to": "", "symbols": ["runDriver"], "note": "..." }
    ],
    "stays": [
      // NEW: these names were inspected and stay put in `dir` (partial migration)
      { "dir": "modules/settings/hooks", "symbols": ["useWebPush"], "note": "..." }
    ],
    "newDirs": [
      // NEW: destinations declared to be NEWLY CREATED (absent from the graph)
      "gate/runtime"
    ],
    "consumers": [
      // graph-invisible consumers (same-directory imports) that become cross-directory
      { "file": "cli/server.ts", "dir": "cli", "imports": ["runDriver"] }
    ]
  },
  "mustNotChange": {
    "forbiddenNewEdges": [{ "from": "", "to": "fan-in" }],
    "untouchedDirs": ["gate", "kernel"]
  },
  "negativeControl": { "restoreEdges": [{ "from": "", "to": "cli" }] },
  "declaredPrediction": { "sccSize": 5, "sccMembers": ["", "gate"] }
}
```

### `moves[]` / `stays[]` field names

- A **move** declares *which file's which symbols move from directory `from` to directory `to`* —
  there is **no** edge-level "delete A -> B" instruction. `symbols: string[]` (not an entity name).
  `file` is documentation only; `from`/`to` are directory node ids.
- **`stays`** is the partial-migration vocabulary: "these names I checked and they stay in `dir`".
  When one directory edge's `importedNames` mixes symbols that move with symbols that stay, declare
  the stayers here. `stays` is a **declaration, not a fallback**: a name that is neither moved nor
  declared staying is still `not-evaluated`. There is **no** path that defaults an undeclared name
  to "stays". This is the whole safety of the extension.
- `from === to` on a move is an **error** (use `stays`).

### Newly-created destination directories (`newDirs`)

A move's `to` must be a directory the graph already contains — **unless** the caller
explicitly declares it new:

```jsonc
"proposedCut": {
  "moves": [
    { "file": "gate/types.ts", "from": "gate", "to": "gate/runtime", "symbols": ["GateFn"] }
  ],
  "newDirs": ["gate/runtime"]
}
```

A directory named in `newDirs` becomes a **new node of the simulated graph** even though
it is absent from the input graph (the "extract a new module / domain object" intervention).
Edges that carried a moved symbol into the moved-from dir are retargeted to the new node, so
it appears in `accounting[].destinations`, in `computedDelta.addedEdges`, and — if it
participates in a cycle — in `sccAfter`. (On a directory graph a new node has only incoming
edges from this cut, so it is normally a sink and not in any cycle.)

**The two invariants that make this safe:**

1. **Declaration, not a fallback.** The ONLY path that treats an absent directory as new is an
   explicit entry in `newDirs`. A `move.to` that is neither an internal node nor declared new is
   still `not-evaluated` (exit 2), and the reason names both the legal internal dirs and the two
   fixes — "retarget to an existing node" or "declare it new". Declaring an *existing* node as new
   is itself rejected.
2. **No fabricated readings.** A new node has **no readings of its own**: `computedDelta.syntheticNodes`
   reports each one with `fileCount: null`, `stats: null` and a note. It is never `0`, never a
   guessed number — the tool has not inspected that directory. Its `inboundEdges` are exactly the
   edges this cut creates; its outbound edges are not listed because the directory graph cannot
   see the moved files' own imports (that is "not inspected", not "zero").

Everything else still applies unchanged: coverage (every `importedNames` name must be moved or
declared by `stays`), the destination-conflict rule, `unknowns`, and the mandatory negative control
(an empty `restoreEdges` is still `not-evaluated`). Declaring a new dir does **not** weaken
fail-closed.

### Destination & coverage rule

Reconciliation is scoped to the edges the directory graph **structurally ties to a move**:

- an edge **entering a moved-from dir** (`A -> B`, `B` is a move's `from`), or
- an edge **entering a structural re-export from a moved-from dir** (`A -> B`, `B` itself imports
  from a moved-from dir — a barrel edge).

For each such edge, every name in `importedNames` gets a **declared** destination, never guessed:

- moved by a move → that move's `to`; declared by `stays` → stays in its `dir`.
- A name accounted by **neither** ⇒ `not-evaluated` (naming the edge and the uncovered names).
- Multiple destinations on **one** edge are legal: an added edge per destination, and the original
  edge **survives** if any of its names stay. A surviving edge's strength increment is **not**
  computed (`strength: null`) — the directory graph carries no symbol→file localization.
- A single **symbol** declared to two different destinations (two moves, or moved + stayed) is a
  conflict ⇒ `not-evaluated`.
- Edges that re-export a moved name from another directory (barrel edges) are reconciled too
  (recorded as `barrel: true` / `certainty: "unknown"`), so co-traveling symbols on a barrel are
  named rather than silently skipped.
- **Every other edge is NOT reconciled.** A directory edge carries no symbol→file localization, so a
  shared **name** is not proof that two same-named symbols are one entity. An edge that merely carries
  a moved name — without either structural tie — is left **unchanged** (never removed, never
  retargeted) and listed in `unknowns.nameCollisionEdges`. This is the tool's remaining limitation at
  directory granularity; `nameCollisionEdges` is its explicit exit, not a silent drop. (`moves`/
  `stays` same-symbol conflicts still fail-closed as above — those are declaration errors, not graph
  ambiguity.)
- Same-directory imports are invisible on a directory graph; a cut that turns such an import
  cross-directory must declare it under `consumers`.

See the frozen reference implementation and its worked GOAL-033 example in
`docs/experiments/layer-map/` (kept only as a frozen record; use the product surface above).

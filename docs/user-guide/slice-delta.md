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
- **`unknowns`** — `{ unresolvedAliasRefs, unevaluatedDynamicImports, barrelEdges }`. These are the
  couplings the directory graph cannot fully see. **None of it feeds `computedDelta`.** An added or
  removed edge that is a barrel/re-export edge carries `certainty: "unknown"`; a deterministic edge
  omits the field (its absence means deterministic — it is never emitted as a fake value).

Both sections are emitted only when the declaration actually exercises a partial-migration feature
(a `stays` clause, a multi-destination edge, or an unknown/barrel edge); a plain fully-covered cut
keeps a report identical to the pre-extension output.

`not-evaluated` is returned (never "best effort") when: the recomputed SCCs disagree with
`moduleGraph.cycles` (self-check failure); an edge carrying a moved name has an `importedNames` name
that is neither moved nor declared by `stays` (a partial migration was not declared); an edge
entering a moved-from dir has no `importedNames`; an **unresolved alias ref**'s `from` dir
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

### Destination & coverage rule

Every directory edge whose `importedNames` contains a **moved** name is reconciled. For each name,
the destination is **declared**, never guessed:

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
- Same-directory imports are invisible on a directory graph; a cut that turns such an import
  cross-directory must declare it under `consumers`.

See the frozen reference implementation and its worked GOAL-033 example in
`docs/experiments/layer-map/` (kept only as a frozen record; use the product surface above).

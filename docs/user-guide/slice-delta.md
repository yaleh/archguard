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

`not-evaluated` is returned (never "best effort") when: the recomputed SCCs disagree with
`moduleGraph.cycles` (self-check failure); a moved-from edge's `importedNames` are only
partly covered by the cut's `symbols`; an edge entering a moved-from dir has no
`importedNames`; or `negativeControl.restoreEdges` is missing/empty.

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

## The slice object

```jsonc
{
  "subject": "",                 // internal dir node id that is the concern
  "proposedCut": {
    "moves": [
      { "file": "cli/driver.ts", "from": "cli", "to": "", "symbols": ["runDriver"] }
    ],
    "consumers": [
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

- A move declares *which file's which symbols move from directory A to directory B* — there
  is **no** edge-level "delete A -> B" instruction.
- `importedNames` on directory-level edges are treated as a **set**: an edge entering a
  moved-from dir is explained only when its names are *fully* covered by a move's `symbols`;
  partial coverage is `not-evaluated` (no proportional guessing).
- Same-directory imports are invisible on a directory graph; a cut that turns such an import
  cross-directory must declare it under `consumers`.

See the frozen reference implementation and its worked GOAL-033 example in
`docs/experiments/layer-map/` (kept only as a frozen record; use the product surface above).

---
id: TASK-40
title: Bound WASM overhead with parser reuse and a long-lived worker pool
status: needs-human
labels:
  - performance
  - parser
  - wasm
  - workers
parent: TASK-31
children: []
extra: {}
---
## Proposal

Reduce the user-visible cost of the WASM fallback through process-lifetime
initialization caches, parser reuse, and a dedicated source-parsing worker pool.
The existing worker pool handles Mermaid rendering; `Promise.all()` around file
reads does not move synchronous `parser.parse()` CPU work off the main thread.

Target the investigated envelope: parser-only WASM may remain near 3x native,
but complete ArchGuard analysis should normally stay within 1.3-2x native on
representative projects and must not regress beyond 2.5x without an explicit
decision.

## Blocked

Blocked by TASK-39 so both backends share the same worker/session protocol.

## Plan

1. Add repeatable parser-only and complete-analysis benchmarks for small,
   medium, and large representative projects.
2. Cache WASM runtime initialization and language modules for the lifetime of
   the CLI/MCP process.
3. Reuse parser sessions safely; use one parser per worker/language rather than
   sharing non-transferable parser/tree objects across worker boundaries.
4. Add a bounded, long-lived parsing worker pool separate from Mermaid render
   workers.
5. Decide runtime in the parent and pass the selected kind to workers so one
   analysis cannot mix choices accidentally.
6. Measure startup, warm-run throughput, memory high-water mark, and worker
   shutdown behavior.
7. Keep a serial path for small inputs where worker startup would cost more
   than it saves.

## Acceptance Criteria

- [ ] Benchmarks report parser-only and full-analysis native/WASM ratios.
- [ ] Warm MCP analyses reuse runtime/language initialization.
- [ ] Parsing CPU work runs in a bounded worker pool for workloads above a
      measured threshold.
- [ ] Workers release trees and terminate cleanly on success, error, and MCP
      shutdown.
- [ ] Representative full-analysis WASM performance is normally within 1.3-2x
      native and never exceeds 2.5x without documented approval.
- [ ] Output remains deterministic across concurrency levels and backends.
- [ ] Memory remains bounded across repeated long-lived MCP analyses.

## Definition of Done

- [ ] Performance, determinism, error-path, and leak tests pass.
- [ ] Before/after benchmark evidence and chosen thresholds are committed.

## Coordination

This task follows TASK-39. It improves the npm plugin delivered by TASK-31 but
does not change runtime fallback correctness.

---
id: TASK-24
title: "Refactor: split arch-metrics.ts by metric domain"
status: todo
labels:
  - refactor
  - source:backlog-TASK-24
parent: null
children: []
extra: {}
---
Split `src/core/query/arch-metrics.ts` (583 lines — the largest file in the project) into metric-domain-focused modules (structure / quality / cognitive). Keep `core/query/index.ts` re-exports for compatibility; do NOT change the public API.

Source: archguard backlog TASK-24 (kind:basic). Seeded 2026-07-20 as a real quay-native task to bootstrap a quay-loop board on archguard (DIR-036-B plumbing).
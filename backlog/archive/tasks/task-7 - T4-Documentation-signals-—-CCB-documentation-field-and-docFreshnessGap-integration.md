---
id: TASK-7
title: >-
  T4: Documentation signals — CCB documentation field and docFreshnessGap
  integration
status: 'Basic: Proposal'
assignee: []
parent_task_id: TASK-3
created_date: '2026-06-22 16:04'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend Cognitive Context Bundle with documentation signals (BLOCKED on meta-cc external dependency).
When meta-cc ships proposal-doc-session-signals.md with CoAccessedDocs, DocVoid, SpecPrecisionGap fields:
- Extend CognitiveContextBundle with documentation field (docFreshnessGap, coAccessedDocs, docVoid, specPrecisionGap, guidance)
- Implement computeDocFreshnessGap() in ccb-assembler.ts using git co-change data from .archguard/query/git-history/file-metrics.json
- Consume meta-cc signals when available; generate LLM-driven guidance text when any doc flag is set
Unit tests: computeDocFreshnessGap with synthetic git history data.
NOTE: Do not start implementation until meta-cc ships the required external signals.
<!-- SECTION:DESCRIPTION:END -->

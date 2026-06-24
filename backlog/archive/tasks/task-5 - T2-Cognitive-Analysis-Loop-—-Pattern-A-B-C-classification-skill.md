---
id: TASK-5
title: 'T2: Cognitive Analysis Loop — Pattern A/B/C classification skill'
status: 'Basic: Proposal'
assignee: []
parent_task_id: TASK-3
created_date: '2026-06-22 16:04'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Cognitive Analysis Loop as an executable Claude Code skill at .claude/skills/cognitive-analysis/SKILL.md.
The skill executes a 5-step loop: Probe (archguard_summary) -> Focus (archguard_get_cognitive_summary
on top-complexity entities) -> Deep Dive (archguard_get_dependencies for Pattern B candidates) ->
Synthesize (classify each file as Pattern A/B/C using R/E ratios from meta-cc + structural signals) ->
Cache (write CCB for each classified file).
Validation: run skill on archguard codebase, produce classifications for at least 5 files including
query-engine.ts (expect Pattern A) and flow-graph-builder.ts (expect Pattern B).
<!-- SECTION:DESCRIPTION:END -->

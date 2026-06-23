---
id: TASK-6
title: >-
  T3: Cognitive Context Bundle — CCB schema, writer, reader, MCP tool, and
  /cognitive-prep skill
status: 'Basic: Proposal'
assignee: []
parent_task_id: TASK-3
created_date: '2026-06-22 16:04'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Cognitive Context Bundle infrastructure:
- src/cli/cognitive/ccb-schema.ts: CognitiveContextBundle interface (schemaVersion, fileHash, filePath, behavior, structure, risk fields)
- src/cli/cognitive/ccb-writer.ts: writes CCB JSON to .archguard/cognitive/<sha256>.json
- src/cli/cognitive/ccb-reader.ts: reads CCB, validates freshness via SHA-256 file hash comparison
- src/cli/cognitive/ccb-assembler.ts: orchestrates writer/reader, calls archguard_get_cognitive_summary + meta-cc data
- archguard_get_ccb MCP tool: returns CCB for a file, assembling on demand if absent or stale
- /cognitive-prep skill: assembles CCBs for all files in a planned edit set
- Add .archguard/cognitive/ to .gitignore
Integration test: verify freshness invalidation when file content changes.
<!-- SECTION:DESCRIPTION:END -->

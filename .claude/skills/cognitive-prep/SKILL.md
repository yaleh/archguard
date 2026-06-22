---
name: cognitive-prep
description: Assemble Cognitive Context Bundles (CCBs) in parallel for all files in a planned edit set. Call before starting a multi-file editing session to pre-load cognitive load scores and edit precautions.
argument-hint: <space-separated file paths>
allowed-tools:
  - mcp__archguard__archguard_get_ccb
  - Read
---

# Cognitive Prep

Before editing multiple files, assemble their CCBs in parallel so the agent enters each edit with full cognitive context pre-loaded.

## Steps

1. **List target files**: parse the argument as space-separated file paths (or use the current task's planned edit files if no argument given).

2. **Assemble CCBs in parallel**: for each file, call `archguard_get_ccb` with `{ filePath: "<path>" }`. Run all calls concurrently.

3. **Display summary table**:

| File | Pattern | Cognitive Load | Top Edit Precaution |
|------|---------|---------------|---------------------|
| ... | A/B/C | 0.0–1.0 | ... |

4. **Highlight high-risk files**: any file with cognitiveLoad >= 0.7 or Pattern B — flag with WARNING and display all editPrecautions.

5. **Proceed**: the agent now has full CCB context for each planned edit and can begin work with minimal redundant exploration.

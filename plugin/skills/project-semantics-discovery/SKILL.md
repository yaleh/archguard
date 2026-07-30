---
name: project-semantics-discovery
description: Discover repository-specific project semantics and write them as `ProjectSemanticsInput` into `.archguard/project-semantics.json` or `archguard.config.json.projectSemantics`. Use when the task is to identify test discovery conventions, assertion wrapper patterns, Mermaid package-layer grouping, or other evidence-backed semantics that ArchGuard should consume.
---

# Project Semantics Discovery

Use this skill when a repository needs stable `projectSemantics` knowledge for ArchGuard.

## Output contract

Write only fields supported by the current `ProjectSemanticsInput` schema:

- `nonProductionPatterns`
- `barrelFiles`
- `additionalTestPatterns`
- `customAssertionPatterns`
- `architecturalLayers`
- `suggestedDepth`

Preferred output target:

1. `.archguard/project-semantics.json`
2. `archguard.config.json.projectSemantics`

Do not invent wrapper objects, confidence fields, timestamps, cache hashes, or tool-specific metadata.

## Workflow

1. Inspect the repository layout before writing anything.
2. Collect evidence for the three priority knowledge areas:
   - test discovery
   - assertion wrapper recognition
   - package-level Mermaid grouping
3. Only emit fields justified by repository evidence.
4. Keep the payload minimal; omit fields that add no value.
5. If the requested target file already exists, merge carefully instead of discarding user-owned knowledge.

## Evidence checklist

### Test discovery

- enumerate first-party test files
- compare actual locations against ArchGuard defaults
- add `additionalTestPatterns` only when defaults would miss real tests
- do not learn conventions from vendored or third-party `node_modules` content

### Assertion wrapper recognition

- search for first-party assertion helper APIs or wrappers around framework assertions
- only write `customAssertionPatterns` when important assertions are not already covered by plugin defaults
- if the repo mostly uses built-in framework assertions such as `expect(...)`, omit this field

### Mermaid package grouping

- inspect top-level and second-level source packages
- map stable package prefixes to human-meaningful layer labels using `architecturalLayers`
- prefer broad, durable groupings over file-level micro-taxonomy

## ArchGuard-specific guidance

For this repository, review `references/archguard-evidence.md` and `references/archguard-project-semantics.json`.

That reference shows the expected kind of knowledge this skill should discover:

- test discovery focused on first-party `tests/**/*.test.ts` and in-source `__tests__`
- no mandatory custom assertion wrapper additions unless new wrappers appear
- Mermaid grouping knowledge centered on `src/analysis`, `src/cli`, and `src/mermaid`

## Validation

After writing semantics:

1. validate the JSON shape against the current schema
2. run ArchGuard analysis on the real project
3. confirm the intended consumer changed:
   - test file discovery
   - assertion counting
   - package-level Mermaid grouping
   - FIM hints

If validation fails, fix the semantics file rather than weakening the schema.

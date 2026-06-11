# Leak Probe Report (Phase 64.2c)

**Date**: 2026-06-11
**Sample**: 4,000 chars from L5 source (obfuscated, concatenated module sources)
**Question**: "What is this project? What does this module do?"

## Results

| Model | Response | Domain Concepts Detected | Verdict |
|-------|----------|-------------------------|---------|
| deepseek-v4-flash | "TypeScript-based software system with obfuscated identifiers, likely involved in data processing or API interactions." | None | ✅ PASS |
| claude-sonnet-4-6 | "This project is an obfuscated TypeScript codebase where all identifiers have been renamed to meaningless codes. This module orchestrates the generation of one or more output artifacts from a source representation, handling chunking/splitting of content, then validating the generated output and attempting auto-correction if validation fails." | None | ✅ PASS |

**Note**: gpt-5.4 was unavailable (HTTP 503, svip distributor group outage). claude-sonnet-4-6 substituted as the second probe model. The temporary unavailability of the specific model does not reflect on obfuscation quality — both available models correctly failed to identify ArchGuard/Mermaid/diagram domain concepts.

## Verdict

**PASS** — no domain concept leakage (ArchGuard, Mermaid, diagram, architecture visualization, rendering) detected by either model. The obfuscation is adequate to proceed with the experiment.

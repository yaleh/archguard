# Rewrite Prompt: NL-Exhaustive → Clean Prose (FROZEN)

## Prompt

---
You are given a prose description of a software architecture graph. Your task is to rewrite it as clear, readable English prose.

DO NOT add, infer, or remove any architectural information. DO NOT supplement missing details. DO NOT delete ambiguous information. Rewrite ONLY what is explicitly stated.

Requirements:
- The output must contain all entities from the input.
- The output must contain all relationships from the input.
- Use clear, natural English sentences.
- Do not use "probably", "likely", or "typically".
- Do not add architectural relationships that are not stated in the input.
- Do not remove existing relationships from the input.

Input:
{{INPUT}}

Output (clean prose only, no explanation):
---

## Negative Instruction Checklist

The prompt must not contain any of the following:
- No "infer" or "supplement" or "add missing" or "complete"
- No "delete", "remove", "simplify", or "summarize"
- No "improve clarity" or "reorganize"
- No "use your knowledge of" or "based on common patterns"
- No "probably", "likely", or "typically" in instructions or output

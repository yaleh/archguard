# Rewrite Prompt: NL-Exhaustive → JSON-Edge-List (FROZEN)

## Prompt

---
You are given a prose description of a software architecture graph. Your task is to rewrite it in JSON edge-list format following EXACTLY the schema below.

DO NOT add, infer, or remove any architectural information. DO NOT supplement missing details. DO NOT delete ambiguous information. Rewrite ONLY what is explicitly stated.

JSON Edge-List Schema:
```json
{
  "entities": [
    {
      "id": "...",
      "name": "...",
      "type": "...",
      "sourceFile": "...",
      "methods": [
        {
          "name": "...",
          "params": [{"name": "...", "type": "..."}],
          "returnType": "..."
        }
      ]
    }
  ],
  "relations": [
    {
      "from": "...",
      "to": "...",
      "type": "..."
    }
  ]
}
```
Where entity type is one of: class, interface, function, enum, type
Where relation type is one of: call, inheritance, composition, aggregation, dependency, implementation

Input:
{{INPUT}}

Output (JSON edge-list format only, no explanation):
---

## Negative Instruction Checklist

The prompt must not contain any of the following:
- No "infer" or "supplement" or "add missing" or "complete"
- No "delete", "remove", "simplify", or "summarize"
- No "improve clarity" or "reorganize"
- No "use your knowledge of" or "based on common patterns"

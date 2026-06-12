# Rewrite Prompt: NL-Exhaustive → Haskell-ADT (FROZEN)

## Prompt

---
You are given a prose description of a software architecture graph. Your task is to rewrite it in Haskell-ADT format following EXACTLY the schema below.

DO NOT add, infer, or remove any architectural information. DO NOT supplement missing details. DO NOT delete ambiguous information. Rewrite ONLY what is explicitly stated.

Haskell-ADT Schema:
```
-- | id: <entity_id>
-- | name: <entity_original_name>
-- | source: <source_file>
data <EntityName> :: <EntityType> = <EntityName>
  { _method_<methodName> :: "<param1:type1, param2:type2> -> <returnType>"
  , _rel_<relationType> :: [<targetId>, ...]
  }
```
Where EntityType is one of: class, interface, function, enum, type
Where relationType is one of: call, inheritance, composition, aggregation, dependency, implementation
Methods with no parameters use "() -> <returnType>"
The `-- | name:` annotation MUST contain the exact original name from the input (preserve capitalization).

Input:
{{INPUT}}

Output (Haskell-ADT format only, no explanation):
---

## Negative Instruction Checklist

The prompt must not contain any of the following:
- No "infer" or "supplement" or "add missing" or "complete"
- No "delete", "remove", "simplify", or "summarize"
- No "improve clarity" or "reorganize"
- No "use your knowledge of" or "based on common patterns"

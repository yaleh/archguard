# 03 - Composition

## Purpose

Tests composition patterns across languages:
- 2 classes/structs
- One class contains another as a field
- Composition relationship detection

## Expected Output

All language plugins should extract:
- 2 entities (Address, Person)
- 3 total methods
- 4 total fields
- 1 composition/has-a relation

## Language Differences

| Language | Pattern | Keyword |
|----------|---------|---------|
| TypeScript | Composition | Field with class type |
| Go | Composition | Struct field or embedding |

## Notes

- Go supports "embedding" which promotes fields/methods
- TypeScript uses explicit field declarations

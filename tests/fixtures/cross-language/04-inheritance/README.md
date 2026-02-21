# 04 - Inheritance

## Purpose

Tests inheritance patterns across languages:
- 2 classes/structs
- One class extends another
- Inheritance relationship detection

## Expected Output

All language plugins should extract:
- 2 entities (Animal, Dog)
- 4 total methods (2 base + 2 derived, counting overrides)
- 4 total fields (2 base + 1 derived + inherited)
- 1 inheritance/extends relation

## Language Differences

| Language | Pattern | Keyword |
|----------|---------|---------|
| TypeScript | Classical inheritance | `extends` |
| Go | Struct embedding | Anonymous field |

## Notes

- Go does not have classical inheritance
- Go uses struct embedding for composition-based inheritance
- Method overriding in Go works through embedding and shadowing
- TypeScript supports true inheritance with `extends` and `super`

# 02 - Interface Implementation

## Purpose

Tests interface/implementation detection across languages:
- 1 interface with 2 methods
- 1 concrete implementation
- Implementation relationship detection

## Expected Output

All language plugins should extract:
- 2 entities (1 interface, 1 class/struct)
- 4 total methods (2 interface, 2 implementation)
- 1 field in implementation class
- 1 "implements" relation

## Language Differences

| Language | Interface Keyword | Explicit Implements |
|----------|-------------------|---------------------|
| TypeScript | `interface` | Yes (`implements`) |
| Go | `interface` | No (implicit duck typing) |

## Notes

- Go uses structural typing (implicit interface implementation)
- TypeScript uses nominal typing with explicit `implements`

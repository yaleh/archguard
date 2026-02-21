# 01 - Simple Class

## Purpose

Tests basic entity extraction across languages - parsing a simple class/struct with:
- 2 fields (1 private, 1 public)
- 2 methods (both public)

## Expected Output

All language plugins should extract:
- 1 entity (User class/struct)
- 2 fields
- 2 methods
- 0 relations

## Language Differences

| Language | Type | Visibility Support |
|----------|------|-------------------|
| TypeScript | class | Full (public/private) |
| Go | struct | Limited (exported/unexported) |

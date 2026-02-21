# Cross-Language Consistency Test Fixtures

This directory contains standardized test fixtures for validating cross-language consistency in ArchGuard's plugin system.

## Purpose

These fixtures test that different language plugins (TypeScript, Go, Java, Python) produce consistent ArchJSON output when parsing semantically equivalent code structures.

## Directory Structure

```
cross-language/
  |-- 01-simple-class/         # Basic class with methods and fields
  |-- 02-interface-implementation/  # Interface with implementation
  |-- 03-composition/          # Class composition/embedding
  |-- 04-inheritance/          # Inheritance relationships
  |-- README.md               # This file
```

## Fixture Format

Each fixture contains:

- `spec.json` - Test specification with expected metrics
- `typescript.ts` - TypeScript implementation
- `go.go` - Go implementation
- `expected.json` - Expected ArchJSON structure (baseline)

## spec.json Format

```json
{
  "name": "Test case name",
  "description": "What this test validates",
  "languages": ["typescript", "go"],
  "expectedMetrics": {
    "entityCount": 1,
    "methodCount": 2,
    "fieldCount": 1,
    "relationCount": 0
  }
}
```

## Running Tests

```bash
npm test -- tests/cross-language.test.ts
```

## Adding New Fixtures

1. Create a new numbered directory (e.g., `05-feature-name/`)
2. Add `spec.json` with test specification
3. Add language implementation files (e.g., `typescript.ts`, `go.go`)
4. Optionally add `expected.json` for detailed validation
5. Add tests in `tests/cross-language.test.ts`

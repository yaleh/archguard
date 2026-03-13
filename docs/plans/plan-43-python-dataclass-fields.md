# Plan 43: Python Dataclass Field Extraction

**Proposal**: `docs/proposals/proposal-python-dataclass-fields.md`
**Priority**: HIGH (all Python dataclass entities appear as empty boxes in class diagrams)
**Estimated total changes**: ~60 lines source + ~70 test lines across 4 files

---

## Overview

Two coordinated changes that together enable extraction and rendering of Python dataclass fields:

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | `classAttributes: []` always empty | `extractClass()` doesn't handle `annotated_assignment` nodes | HIGH |
| 2 | `classAttributes` not mapped to `Member[]` | `mapClass()` skips `cls.classAttributes` entirely | HIGH |

---

## Phase A — Extract annotated_assignment Nodes in TreeSitterBridge

**Files**: `src/plugins/python/tree-sitter-bridge.ts`, `tests/unit/plugins/python/python-plugin.test.ts`
**Estimated lines**: ~35 source + ~40 test

### Stage A1 — Add annotated_assignment extraction in extractClass()

**File**: `src/plugins/python/tree-sitter-bridge.ts`, `extractClass()` method (lines 128–157)

**Current class body loop** (line 129):

```typescript
if (body) {
  for (const child of body.namedChildren) {
    try {
      if (child.type === 'function_definition') {
        const method = this.extractMethod(child, code);
        if (method) methods.push(method);
      } else if (child.type === 'decorated_definition') {
        // ... decorated methods/properties
      }
    } catch (error) {
      console.warn(`Error parsing method in class ${className}:`, error);
    }
  }
}
```

**Add `annotated_assignment` handling** inside the `for` loop, after the `decorated_definition` branch:

```typescript
} else if (child.type === 'annotated_assignment') {
  const attr = this.extractAnnotatedAssignment(child, code);
  if (attr) classAttributes.push(attr);
}
```

And declare `classAttributes` at the top of `extractClass()` alongside `methods`:

```typescript
const methods: PythonRawMethod[] = [];
const classAttributes: PythonRawAttribute[] = [];   // add this line
```

Update the returned `PythonRawClass` to include the extracted attributes:

```typescript
return {
  name: className,
  moduleName,
  baseClasses,
  methods,
  properties: [],
  classAttributes,               // was: classAttributes: []
  decorators: [],
  docstring,
  filePath,
  startLine: node.startPosition.row + 1,
  endLine: node.endPosition.row + 1,
};
```

### Stage A2 — Add extractAnnotatedAssignment() private method

**File**: `src/plugins/python/tree-sitter-bridge.ts`

Add a new private method to `TreeSitterBridge`:

```typescript
/**
 * Extract a class-level annotated assignment (AnnAssign) as a PythonRawAttribute.
 *
 * Tree-sitter node structure for `field: Optional[int] = 0`:
 *   annotated_assignment
 *     left: identifier       → 'field'
 *     type: ...              → 'Optional[int]'  (subscript, identifier, or complex type)
 *     right: ...             → '0'              (optional; absent for bare annotations)
 *
 * Returns null for malformed nodes (missing name).
 */
private extractAnnotatedAssignment(
  node: Parser.SyntaxNode,
  code: string
): PythonRawAttribute | null {
  try {
    // Extract field name from 'left' field
    const leftNode = node.childForFieldName('left');
    if (!leftNode) return null;

    const name = code.substring(leftNode.startIndex, leftNode.endIndex).trim();
    // Skip names that are not simple identifiers (e.g., 'self.x' — these are instance attrs)
    if (name.includes('.')) return null;

    // Extract type annotation from 'type' field
    const typeNode = node.childForFieldName('type');
    const fieldType = typeNode
      ? code.substring(typeNode.startIndex, typeNode.endIndex).trim()
      : undefined;

    return {
      name,
      type: fieldType,
      isPrivate: name.startsWith('_'),
    };
  } catch {
    return null;
  }
}
```

**Note on tree-sitter field names**: In tree-sitter-python, the `annotated_assignment` node uses:
- `child.childForFieldName('left')` → the target identifier
- `child.childForFieldName('type')` → the type annotation
- `child.childForFieldName('right')` → the default value (optional)

The `PythonRawAttribute` type (from `types.ts` lines 67–72) has `name: string`, `type?: string`, and `isPrivate: boolean` — all of which map directly.

**Acceptance**: A class body containing `max_tokens: int = 512` produces `classAttributes = [{ name: 'max_tokens', type: 'int', isPrivate: false }]`.

### Stage A3 — Add unit tests for annotated_assignment extraction

**File**: `tests/unit/plugins/python/python-plugin.test.ts`

Add test group: `describe('Python TreeSitterBridge — annotated_assignment field extraction')`:

```typescript
it('extracts simple annotated assignment as classAttribute', () => {
  const code = `
class Config:
    max_tokens: int = 512
    temperature: float = 0.8
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'config.py');
  expect(module.classes).toHaveLength(1);
  const cls = module.classes[0];
  expect(cls.classAttributes).toHaveLength(2);
  expect(cls.classAttributes[0]).toMatchObject({ name: 'max_tokens', type: 'int', isPrivate: false });
  expect(cls.classAttributes[1]).toMatchObject({ name: 'temperature', type: 'float', isPrivate: false });
});

it('extracts Optional and generic type annotations', () => {
  const code = `
class Model:
    top_p: Optional[float] = None
    stop_words: List[str] = []
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'model.py');
  const cls = module.classes[0];
  expect(cls.classAttributes[0]).toMatchObject({ name: 'top_p', type: 'Optional[float]' });
  expect(cls.classAttributes[1]).toMatchObject({ name: 'stop_words', type: 'List[str]' });
});

it('marks _private fields correctly', () => {
  const code = `
class Engine:
    _cache: dict = {}
    _timeout: int = 30
    public_field: str = ''
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'engine.py');
  const cls = module.classes[0];
  expect(cls.classAttributes[0]).toMatchObject({ name: '_cache', isPrivate: true });
  expect(cls.classAttributes[1]).toMatchObject({ name: '_timeout', isPrivate: true });
  expect(cls.classAttributes[2]).toMatchObject({ name: 'public_field', isPrivate: false });
});

it('extracts annotated fields without default value (bare annotations)', () => {
  const code = `
class Schema:
    name: str
    value: int
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'schema.py');
  const cls = module.classes[0];
  expect(cls.classAttributes).toHaveLength(2);
  expect(cls.classAttributes[0]).toMatchObject({ name: 'name', type: 'str' });
});

it('does not confuse instance attribute assignments (self.x = y) with class attributes', () => {
  const code = `
class Foo:
    class_field: int = 0
    def __init__(self):
        self.instance_field = 42
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'foo.py');
  const cls = module.classes[0];
  // Only the class-level annotated_assignment is extracted
  expect(cls.classAttributes).toHaveLength(1);
  expect(cls.classAttributes[0].name).toBe('class_field');
});

it('extracts both methods and class attributes from the same class', () => {
  const code = `
from dataclasses import dataclass

@dataclass
class GenerationConfig:
    max_new_tokens: int = 512
    temperature: float = 0.8

    def validate(self):
        pass
`;
  const bridge = new TreeSitterBridge();
  const module = bridge.parseCode(code, 'gen_config.py');
  const cls = module.classes[0];
  expect(cls.classAttributes).toHaveLength(2);
  expect(cls.methods).toHaveLength(1);
  expect(cls.methods[0].name).toBe('validate');
});
```

**Dependencies**: A1, A2

---

## Phase B — Map classAttributes to Entity Members in ArchJsonMapper

**Files**: `src/plugins/python/archjson-mapper.ts`, `tests/unit/plugins/python/archjson-mapper.test.ts`
**Estimated lines**: ~25 source + ~30 test

### Stage B1 — Add classAttributes → Member[] mapping in mapClass()

**File**: `src/plugins/python/archjson-mapper.ts`, `mapClass()` method (lines 145–179)

**Current `mapClass()` populates members from methods and properties only** (lines 148–156):

```typescript
// Map methods
for (const method of cls.methods) {
  members.push(this.mapMethod(method));
}

// Map properties
for (const prop of cls.properties) {
  members.push(this.mapProperty(prop));
}
```

**Add classAttributes loop** after the properties loop:

```typescript
// Map class-level annotated fields (dataclass fields, type annotations)
for (const attr of cls.classAttributes) {
  members.push(this.mapClassAttribute(attr));
}
```

Add a private `mapClassAttribute()` method:

```typescript
/**
 * Map a PythonRawAttribute (class-level annotated assignment) to a Member.
 *
 * Visibility is inferred from the leading underscore convention:
 *   _name → private, __name → private (dunder-private), name → public
 */
private mapClassAttribute(attr: PythonRawAttribute): Member {
  const visibility: Visibility = attr.isPrivate ? 'private' : 'public';

  return {
    name: attr.name,
    type: 'field',
    visibility,
    fieldType: attr.type,
  };
}
```

**Import**: `PythonRawAttribute` is already defined in `./types.js` and imported at the top of `archjson-mapper.ts` alongside `PythonRawClass` (line 18). Confirm it is in the import list; add if absent.

**Acceptance**: An entity mapped from a class with `classAttributes = [{ name: 'max_tokens', type: 'int', isPrivate: false }]` has `members` containing `{ name: 'max_tokens', type: 'field', visibility: 'public', fieldType: 'int' }`.

### Stage B2 — Add unit tests for classAttributes mapping

**File**: `tests/unit/plugins/python/archjson-mapper.test.ts`

Add test group: `describe('ArchJsonMapper (Python) — mapClass classAttributes')`:

```typescript
it('maps classAttributes to field Members', () => {
  const rawModule: PythonRawModule = {
    name: 'config',
    filePath: '/project/config.py',
    classes: [{
      name: 'Config',
      moduleName: 'config',
      baseClasses: [],
      methods: [],
      properties: [],
      classAttributes: [
        { name: 'max_tokens', type: 'int', isPrivate: false },
        { name: 'temperature', type: 'float', isPrivate: false },
      ],
      decorators: [],
      filePath: '/project/config.py',
      startLine: 1,
      endLine: 5,
    }],
    functions: [],
    imports: [],
  };

  const mapper = new ArchJsonMapper();
  const result = mapper.mapModules([rawModule], '/project');

  expect(result.entities).toHaveLength(1);
  const entity = result.entities[0];
  const fieldMembers = entity.members.filter((m) => m.type === 'field');
  expect(fieldMembers).toHaveLength(2);
  expect(fieldMembers[0]).toMatchObject({ name: 'max_tokens', type: 'field', visibility: 'public', fieldType: 'int' });
  expect(fieldMembers[1]).toMatchObject({ name: 'temperature', type: 'field', visibility: 'public', fieldType: 'float' });
});

it('sets visibility: private for _private attributes', () => {
  const rawModule: PythonRawModule = makeModule({
    classAttributes: [{ name: '_cache', type: 'dict', isPrivate: true }],
  });
  const mapper = new ArchJsonMapper();
  const result = mapper.mapModules([rawModule], '/project');
  const fieldMembers = result.entities[0].members.filter((m) => m.type === 'field');
  expect(fieldMembers[0]).toMatchObject({ name: '_cache', visibility: 'private' });
});

it('maps fieldType from type annotation', () => {
  const rawModule: PythonRawModule = makeModule({
    classAttributes: [{ name: 'top_p', type: 'Optional[float]', isPrivate: false }],
  });
  const mapper = new ArchJsonMapper();
  const result = mapper.mapModules([rawModule], '/project');
  const field = result.entities[0].members.find((m) => m.name === 'top_p');
  expect(field?.fieldType).toBe('Optional[float]');
});

it('produces both field members and method members', () => {
  const rawModule: PythonRawModule = makeModule({
    classAttributes: [{ name: 'value', type: 'int', isPrivate: false }],
    methods: [makeMethod('compute')],
  });
  const mapper = new ArchJsonMapper();
  const result = mapper.mapModules([rawModule], '/project');
  const entity = result.entities[0];
  expect(entity.members.filter((m) => m.type === 'field')).toHaveLength(1);
  expect(entity.members.filter((m) => m.type === 'method')).toHaveLength(1);
});
```

**Dependencies**: B1

---

## Dependency Graph

```
Phase A — tree-sitter extraction (independent of Phase B in production code)
Phase B — mapper translation (depends on A for full end-to-end; testable independently)
A2 depends on A1 (method is called from extractClass)
A3 depends on A1, A2
B1 is independent (mapClass can be tested with hand-crafted classAttributes)
B2 depends on B1
```

---

## Testing Strategy

- **TDD**: Write A3 tests first, then implement A1 + A2. Write B2 tests, then implement B1.
- **Real Python code**: Use actual Python dataclass syntax in test strings (not mock AST nodes) for A3 tests to ensure tree-sitter parsing is correct end-to-end.
- **Existing test suite**: Must remain green (2787+ tests passing) after all phases.
- **lmdeploy validation**: Run `node dist/cli/index.js analyze -s /path/to/lmdeploy/lmdeploy --lang python` and verify that `GenerationConfig` entity has field members in the class diagram.

---

## Acceptance Criteria

| Phase | Criterion |
|---|---|
| A | Class with 10 annotated fields produces `classAttributes.length === 10` in raw data |
| A | `Optional[float]` type annotation is preserved verbatim (not truncated) |
| A | Private fields (`_name`) have `isPrivate: true` |
| A | `self.x = y` inside `__init__` is NOT extracted as a class attribute |
| B | Entity from mapped class has `members` with one `{ type: 'field' }` per classAttribute |
| B | `fieldType` on the Member matches the annotation string |
| B | Private attributes map to `visibility: 'private'` |
| B | Classes with no annotated fields still work (empty `classAttributes: []`) |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `childForFieldName('left')` returns null for complex left-hand side (e.g., tuple unpacking) | `extractAnnotatedAssignment` returns null on missing left; graceful no-op |
| Type annotation spans multiple lines (rare in dataclasses) | `code.substring(typeNode.startIndex, typeNode.endIndex)` captures the full span regardless of newlines |
| Performance: extra loop over class body nodes | O(n) where n = class body statements; negligible for typical class sizes |
| `classAttributes` empty array in existing tests that don't set it | Existing tests pass empty `classAttributes: []`; the new mapper loop runs 0 iterations — no change |

---

## Validation

```bash
npm run build
node dist/cli/index.js analyze -s /path/to/lmdeploy/lmdeploy --lang python

# Check that GenerationConfig has field members in the class diagram:
grep -A5 "GenerationConfig" .archguard/class/all-classes.mmd | head -20
# Expected: field entries like +max_new_tokens: int, +temperature: float, etc.

# Check field count via JSON output:
node dist/cli/index.js analyze -s /path/to/lmdeploy/lmdeploy --lang python -f json
node -e "
  const j = require('.archguard/class/all-classes.json');
  const gen = j.entities.find(e => e.name === 'GenerationConfig');
  console.log('GenerationConfig fields:', gen?.members.filter(m => m.type === 'field').length);
"
# Expected: 29 (or close, depending on Python version of lmdeploy)
```

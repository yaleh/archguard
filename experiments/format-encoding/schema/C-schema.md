# C Schema — Canonical Method-Level Typed Entity-Relation Graph

> **Status: FROZEN** (Phase 73, Stage 73.1)
> This document is the authoritative specification for structure C used across all renderers,
> parsers, and diff logic in the format-encoding experiment (plan-73-81).
> No field, enum value, or default rule may be changed after Phase 76 freeze tag.

---

## 1. Overview

Structure **C** is the canonical intermediate representation of a method-level, typed
entity-relation graph derived from ArchGuard ArchJSON (method-level parse output).
All 8 renderers produce output *from* C; all 8 parsers produce C *from* rendered output.
The diff function in `lib/diff.ts` operates on two C instances.

C is intentionally minimal: it captures only the fields required to reconstruct the
architecture graph and evaluate task accuracy. No display metadata, no confidence scores,
no tooling-specific extensions.

---

## 2. TypeScript Type Definitions

```typescript
/** Normalised identifier: fullyQualifiedName.toLowerCase().trim() */
type EntityId = string;

/** A single parameter of a method */
interface CParam {
  name: string;
  type: string;
}

/** A method (function member) declared on an entity */
interface CMethod {
  name: string;
  /** null is equivalent to [] — see Section 5 */
  params: CParam[] | null;
  /** null is equivalent to "void" — see Section 5 */
  returnType: string | null;
}

/** A typed code entity (class, interface, function, enum, or type alias) */
interface CEntity {
  /** Normalised id — see Section 4 */
  id: EntityId;
  /** Short name (unqualified), e.g. "UserService" */
  name: string;
  /** Entity kind — see Section 3.1 for enum justification */
  type: 'class' | 'interface' | 'function' | 'enum' | 'type';
  /** Relative path from workspace root, e.g. "src/services/UserService.ts" */
  /** null is equivalent to "unknown" — see Section 5 */
  sourceFile: string | null;
  /** null is equivalent to [] — see Section 5 */
  methods: CMethod[] | null;
}

/** A directed typed relation between two entities */
interface CRelation {
  /** id of the source entity */
  from: EntityId;
  /** id of the target entity */
  to: EntityId;
  /** Relation kind — see Section 3.2 for enum justification */
  type: 'call' | 'inheritance' | 'composition' | 'aggregation' | 'dependency' | 'implementation';
}

/** Top-level structure C */
interface C {
  entities: CEntity[];
  relations: CRelation[];
}
```

---

## 3. Field Specifications

### 3.1 Entity Fields

| Field | TypeScript Type | Required | Description |
|---|---|---|---|
| `id` | `EntityId` (string) | Yes | Normalised identifier. Derivation rule: see Section 4. |
| `name` | `string` | Yes | Short (unqualified) name of the entity. |
| `type` | enum (see below) | Yes | Entity kind. |
| `sourceFile` | `string \| null` | No | Relative path from workspace root. `null` ≡ `"unknown"`. |
| `methods` | `CMethod[] \| null` | No | List of declared methods. `null` ≡ `[]`. |

#### Entity `type` Enum Values

| Value | Meaning |
|---|---|
| `class` | A concrete or abstract class definition. |
| `interface` | A structural interface / trait / protocol definition. |
| `function` | A top-level function or standalone callable (not a class method). |
| `enum` | An enumeration type. |
| `type` | A type alias or type synonym (e.g. TypeScript `type`, Haskell `type`, `newtype`). |

**Enum justification.**
These five values cover the entity kinds consistently present across the languages
targeted by this experiment (TypeScript, Go, Java, Python, Haskell-ADT notation):

- `class` and `interface` are universal in OO languages and map cleanly to Go structs
  and interfaces, Java/Kotlin class hierarchies, and Python classes.
- `function` captures top-level callables that carry architectural weight (Go functions,
  Python module-level functions, Haskell functions) without conflating them with methods.
- `enum` is present in TypeScript, Java, Kotlin, Python (`Enum` subclasses), and can be
  modelled in Haskell as a sum type with no-argument constructors.
- `type` captures type aliases (`type Foo = ...` in TypeScript, `type` in Go, Haskell
  `type`/`newtype`) whose architectural role is referential rather than behavioral.
- Values deliberately excluded: `module`, `namespace`, `package` — these are container
  scopes, not typed entities; they are expressed structurally by the `id` path prefix.
- Values deliberately excluded: `method` — methods are nested inside `CEntity.methods`,
  not top-level entities in C.

### 3.2 Relation Fields

| Field | TypeScript Type | Required | Description |
|---|---|---|---|
| `from` | `EntityId` | Yes | Source entity id (normalised). |
| `to` | `EntityId` | Yes | Target entity id (normalised). |
| `type` | enum (see below) | Yes | Relation kind. |

#### Relation `type` Enum Values

| Value | Meaning |
|---|---|
| `call` | A direct call from one entity (or its methods) to another entity (or its methods). |
| `inheritance` | A class extends another class (`extends` in Java/TypeScript, `:` in Go struct embedding). |
| `composition` | An entity holds an owned reference to another entity (strong ownership, lifecycle-tied). |
| `aggregation` | An entity holds a non-owning reference to another entity (pointer, weak ref, container). |
| `dependency` | An entity uses another entity in a method parameter or return type without field ownership. |
| `implementation` | A class implements an interface or satisfies a structural protocol. |

**Enum justification and mapping from ArchGuard ArchJSON relation types.**

ArchGuard ArchJSON uses the following relation types at the method level:

| ArchJSON relation type | C relation type | Mapping rationale |
|---|---|---|
| `call` | `call` | Direct 1-to-1 mapping. |
| `extend` | `inheritance` | "extends" is the implementation of inheritance. |
| `implement` | `implementation` | "implements" maps to structural conformance. |
| `composition` | `composition` | Direct 1-to-1 mapping. |
| `aggregation` | `aggregation` | Direct 1-to-1 mapping. |
| `dependency` | `dependency` | Parameter/return-type usage without ownership. |
| `import` | `dependency` | Module-level import is treated as a dependency edge in C. |
| `cmake` | `dependency` | Build-system dependency is modelled as dependency in C. |

**Additional notes:**
- `inheritance` and `implementation` are kept separate because their architectural
  implications differ: `inheritance` implies behavioral reuse; `implementation` implies
  interface conformance with independent behavioral definition.
- `composition` vs `aggregation` follows the UML distinction: composition implies
  lifecycle ownership (the composed object cannot outlive the composer); aggregation
  implies a reference without ownership transfer.
- A single `(from, to)` pair may appear with multiple different `type` values (e.g. a
  class both `call`s and `composition`-owns another class). Each `(from, to, type)`
  triple is an independent relation entry.

### 3.3 Method Fields

| Field | TypeScript Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Method name (unqualified). |
| `params` | `CParam[] \| null` | No | Parameter list. `null` ≡ `[]`. |
| `returnType` | `string \| null` | No | Return type as a string. `null` ≡ `"void"`. |

### 3.4 Param Fields

| Field | TypeScript Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Parameter name. |
| `type` | `string` | Yes | Parameter type as a string (no further normalisation required). |

---

## 4. ID Normalisation

### 4.1 Rule

An entity's `id` is derived from its fully-qualified name by applying the following
transformation:

```
normalise(fullyQualifiedName: string): EntityId {
  return fullyQualifiedName.toLowerCase().trim()
}
```

**Fully-qualified name** means the canonical dotted path of the entity in its module or
package hierarchy, using `.` as the separator, e.g.:

- TypeScript: `"src/services/UserService.UserService"`
- Go: `"github.com/org/repo/pkg.Handler"`
- Java: `"com.example.services.UserService"`

**All renderers and all parsers MUST use this same normalisation function.** A renderer
that stores the raw FQN and a parser that lowercases on read will produce identical `id`
values, satisfying the diff contract.

### 4.2 Examples

| Input fullyQualifiedName | Normalised id |
|---|---|
| `"UserService"` | `"userservice"` |
| `"com.example.UserService"` | `"com.example.userservice"` |
| `"  src/api.Handler  "` | `"src/api.handler"` |
| `"HTTP_CLIENT"` | `"http_client"` |
| `"MyPkg.MyType"` | `"mypkg.mytype"` |

### 4.3 Pseudocode (language-agnostic)

```
function normaliseId(fullyQualifiedName):
    s = fullyQualifiedName
    s = trim(s)           // remove leading and trailing whitespace
    s = toLower(s)        // convert all characters to lowercase
    return s
```

No further transformation (e.g. slug replacement of `/` or `.`) is applied.
Separators are preserved as-is.

---

## 5. Nullable Field Default Values

The following table defines equivalences for nullable fields. Fields NOT listed here
follow the **conservative rule**: `null` and absent are NOT equivalent; a diff between
a C with an explicit `null` and one with a missing field is a non-zero diff.

| Field path | `null` equivalent to | Notes |
|---|---|---|
| `CEntity.params` | `[]` (empty array) | Applies in Haskell-ADT and DSL contexts where params may be omitted for zero-param methods. |
| `CMethod.params` | `[]` (empty array) | A method with no parameters and `params: null` is identical to one with `params: []`. |
| `CMethod.returnType` | `"void"` | A method with `returnType: null` is treated as returning void. Renderers MUST output `"void"` or the format-native void token; parsers MUST produce `null` or `"void"` for absent return types. |
| `CEntity.sourceFile` | `"unknown"` | When source location is unavailable. Renderers MAY omit the field; parsers MUST produce `null` or `"unknown"` for absent source locations. |
| `CEntity.methods` | `[]` (empty array) | An entity with `methods: null` is identical to one with `methods: []`. |

**Conservative rule (for all other fields):** If a field is absent in one C instance and
present (even as `null`) in another, the diff function treats this as a mismatch and
records a deviation.

---

## 6. Complete JSON Example

The following example illustrates a minimal valid C instance with 3 entities and 5
relations. It serves as the canonical small fixture (`C_fixture`) for renderer and parser
tests.

```json
{
  "entities": [
    {
      "id": "com.example.userservice",
      "name": "UserService",
      "type": "class",
      "sourceFile": "src/services/UserService.ts",
      "methods": [
        {
          "name": "getUser",
          "params": [{ "name": "id", "type": "string" }],
          "returnType": "User"
        },
        {
          "name": "deleteUser",
          "params": [{ "name": "id", "type": "string" }],
          "returnType": "void"
        }
      ]
    },
    {
      "id": "com.example.user",
      "name": "User",
      "type": "class",
      "sourceFile": "src/models/User.ts",
      "methods": []
    },
    {
      "id": "com.example.iuserrepository",
      "name": "IUserRepository",
      "type": "interface",
      "sourceFile": "src/repositories/IUserRepository.ts",
      "methods": [
        {
          "name": "findById",
          "params": [{ "name": "id", "type": "string" }],
          "returnType": "User | null"
        }
      ]
    }
  ],
  "relations": [
    {
      "from": "com.example.userservice",
      "to": "com.example.iuserrepository",
      "type": "dependency"
    },
    {
      "from": "com.example.userservice",
      "to": "com.example.user",
      "type": "composition"
    },
    {
      "from": "com.example.userservice",
      "to": "com.example.iuserrepository",
      "type": "implementation"
    },
    {
      "from": "com.example.userservice",
      "to": "com.example.user",
      "type": "call"
    },
    {
      "from": "com.example.iuserrepository",
      "to": "com.example.user",
      "type": "dependency"
    }
  ]
}
```

Note: this fixture contains two distinct relations from the same `(from, to)` pair
(`userservice → user`: both `composition` and `call`). This is valid; each triple
`(from, to, type)` is an independent relation.

---

## 7. Invariants

The following invariants MUST hold for any valid C instance. Violations are schema
errors, not diff deviations.

1. **Entity id uniqueness**: No two entities in `C.entities` share the same `id`.
2. **Relation referential integrity (soft)**: Each `from` and `to` id in `C.relations`
   SHOULD correspond to an entity id in `C.entities`. Dangling relation endpoints are
   allowed (some relations cross corpus boundaries) but MUST be noted in the corpus
   loader when they occur.
3. **Id normalisation**: Every entity `id` MUST equal `normaliseId(fullyQualifiedName)`
   for the entity's FQN. Renderers derive `id` from FQN; parsers reconstruct `id` from
   whatever the format encodes as the entity identifier by applying the same normalisation.
4. **Enum membership**: `CEntity.type` MUST be one of the five enum values. `CRelation.type`
   MUST be one of the six enum values. Enum comparison is case-insensitive (a parser that
   encounters `"Class"` MUST normalise it to `"class"` before storing).
5. **Non-empty entity set restriction (soft)**: A C with zero entities is valid but will
   produce trivially empty renderer output. Corpus loader tests MUST exercise at least one
   non-empty instance.

---

## 8. Out of Scope

The following are deliberately NOT part of C schema:

- **Visibility modifiers** (`public`/`private`/`protected`): not required for
  architectural analysis at the granularity used in the experiment task set.
- **Generic type parameters**: stored as raw strings in `CParam.type` and
  `CMethod.returnType` without structural decomposition.
- **File line numbers or byte offsets**: not needed; `sourceFile` provides enough
  traceability.
- **Cyclomatic complexity, LOC, or other metrics**: out of scope for C.
- **Package/module membership beyond the id path prefix**: container scopes are implicit
  in the dotted id.
- **Multiple inheritance disambiguation**: multiple `inheritance` edges from the same
  `from` to different targets are all valid C relations; C makes no statement about MRO.

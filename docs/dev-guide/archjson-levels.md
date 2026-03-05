# ArchJSONAggregator - Three Detail Levels

This document visualizes how the ArchJSONAggregator transforms ArchJSON at different detail levels.

## Input: Original ArchJSON

```
Entities (5 classes):
├── src.services.UserService
│   ├── getUser (public)
│   ├── createUser (public)
│   ├── validateUserData (private)
│   └── userRepository (private property)
├── src.services.AuthService
│   ├── login (public)
│   ├── logout (public)
│   └── hashPassword (private)
├── src.repositories.UserRepository
│   ├── findById (public)
│   ├── save (public)
│   └── dbConnection (private property)
├── src.repositories.SessionRepository
│   ├── create (public)
│   └── delete (public)
└── src.models.User
    ├── id (public property)
    ├── email (public property)
    └── name (public property)

Relations (4):
├── src.services.UserService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.SessionRepository
└── src.repositories.UserRepository → src.models.User
```

---

## Level 1: Method Level (Full Detail)

**Use Case**: Deep technical analysis, implementation reference

**Transformation**: None (passthrough)

```
aggregator.aggregate(archJSON, 'method')
```

### Output

```
Entities (5 classes):
├── src.services.UserService (4 members)
│   ├── getUser (public)           ✅ All members visible
│   ├── createUser (public)        ✅ Including private
│   ├── validateUserData (private) ✅ Implementation details
│   └── userRepository (private)   ✅ Internal state
├── src.services.AuthService (3 members)
│   ├── login (public)
│   ├── logout (public)
│   └── hashPassword (private)
├── src.repositories.UserRepository (3 members)
│   ├── findById (public)
│   ├── save (public)
│   └── dbConnection (private)
├── src.repositories.SessionRepository (2 members)
│   ├── create (public)
│   └── delete (public)
└── src.models.User (3 members)
    ├── id (public)
    ├── email (public)
    └── name (public)

Relations (4): [Unchanged]
├── src.services.UserService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.SessionRepository
└── src.repositories.UserRepository → src.models.User
```

**Diagram Characteristics**:
- Maximum detail
- Shows all implementation
- Best for: Code review, refactoring, debugging
- Diagram size: Large (verbose)

---

## Level 2: Class Level (Default - Public API Only)

**Use Case**: API documentation, component interfaces

**Transformation**: Filter out private members

```
aggregator.aggregate(archJSON, 'class')
```

### Output

```
Entities (5 classes):
├── src.services.UserService (2 members)     ⬇️ 4 → 2 members
│   ├── getUser (public)                     ✅ Public API visible
│   └── createUser (public)                  ✅ Interface clear
├── src.services.AuthService (2 members)     ⬇️ 3 → 2 members
│   ├── login (public)
│   └── logout (public)
├── src.repositories.UserRepository (2 members) ⬇️ 3 → 2 members
│   ├── findById (public)
│   └── save (public)
├── src.repositories.SessionRepository (2 members) ✅ No change
│   ├── create (public)
│   └── delete (public)
└── src.models.User (3 members)              ✅ No change
    ├── id (public)
    ├── email (public)
    └── name (public)

Relations (4): [Unchanged]
├── src.services.UserService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.UserRepository
├── src.services.AuthService → src.repositories.SessionRepository
└── src.repositories.UserRepository → src.models.User
```

**Diagram Characteristics**:
- Moderate detail
- Shows class structure
- Hides implementation details
- Best for: System design, API documentation
- Diagram size: Medium (readable)

---

## Level 3: Package Level (High-Level Overview)

**Use Case**: Architecture overview, stakeholder presentations

**Transformation**: Aggregate classes into packages, merge relations

```
aggregator.aggregate(archJSON, 'package')
```

### Output

```
Entities (3 packages):                        ⬇️ 5 classes → 3 packages
├── src.models (0 members)                    📦 Package abstraction
├── src.repositories (0 members)              📦 Logical grouping
└── src.services (0 members)                  📦 High-level view

Relations (2):                                ⬇️ 4 relations → 2 relations
├── src.repositories → src.models             ⬆️ Aggregated from UserRepository → User
└── src.services → src.repositories           ⬆️ Aggregated from:
                                                  - UserService → UserRepository
                                                  - AuthService → UserRepository
                                                  - AuthService → SessionRepository
```

**Transformation Details**:
1. **Package Extraction**:
   - `src.services.UserService` → package `src.services`
   - `src.services.AuthService` → package `src.services` (deduplicated)
   - `src.repositories.*` → package `src.repositories`
   - `src.models.*` → package `src.models`

2. **Relation Aggregation**:
   - Multiple class-level relations between same packages → single package-level relation
   - Self-relations within same package → filtered out
   - Relation types preserved (dependency, composition, etc.)

**Diagram Characteristics**:
- Minimal detail
- Shows system structure
- Hides implementation completely
- Best for: Executive summaries, architecture decisions
- Diagram size: Small (concise)

---

## Comparison Table

| Aspect            | Method Level        | Class Level         | Package Level        |
|-------------------|---------------------|---------------------|----------------------|
| **Entities**      | 5 classes           | 5 classes           | 3 packages           |
| **Members**       | 18 total            | 11 public           | 0 (hidden)           |
| **Relations**     | 4                   | 4                   | 2 (aggregated)       |
| **Detail**        | Maximum             | Moderate            | Minimum              |
| **Audience**      | Developers          | Architects/Devs     | Executives/PMs       |
| **Use Case**      | Implementation      | API Design          | Architecture Review  |
| **Diagram Size**  | Large (complex)     | Medium (balanced)   | Small (overview)     |
| **Readability**   | Low (overwhelming)  | High (clear)        | Very High (simple)   |
| **Traceability**  | Direct              | Direct              | Indirect             |

---

## Real-World Example

### Scenario: Presenting to Different Audiences

**1. To Executive (Package Level)**
```
"Our system has 3 layers:
- Services layer handles business logic
- Repositories layer manages data access
- Models layer defines data structures

Services depend on repositories, repositories use models.
Clean separation of concerns."
```

**2. To Product Manager (Class Level)**
```
"The UserService provides two APIs:
- getUser() - retrieve user by ID
- createUser() - register new user

It uses UserRepository for data persistence."
```

**3. To Developer (Method Level)**
```
"The UserService has a private validateUserData() method
that's called before createUser(). It depends on the
private userRepository field for database access."
```

---

## Implementation Highlights

### Key Algorithms

#### 1. Package Extraction
```typescript
// Extract package from entity ID: "src.services.UserService" → "src.services"
const lastDot = entityId.lastIndexOf('.');
const packageName = entityId.substring(0, lastDot);
```

#### 2. Public Member Filtering
```typescript
// Keep only public members (undefined treated as public)
members.filter(m => m.visibility === 'public' || m.visibility === undefined)
```

#### 3. Relation Aggregation
```typescript
// Map class relations to package relations and deduplicate
const key = `${sourcePackage}:${targetPackage}:${relationType}`;
packageRelations.set(key, {...});
```

---

## Performance Characteristics

| Operation              | Time Complexity | Space Complexity |
|------------------------|-----------------|------------------|
| Method Level           | O(1)            | O(1)             |
| Class Level            | O(n×m)          | O(n×m)           |
| Package Level          | O(n×r)          | O(p×r)           |

Where:
- n = number of entities
- m = average members per entity
- r = number of relations
- p = number of packages

---

## Future Enhancements

1. **Configurable Visibility Threshold**
   - Allow filtering by visibility level (public, protected, private)
   - Use case: Show protected methods for inheritance documentation

2. **Custom Package Depth**
   - Support configurable package depth (e.g., 2 levels: `src.services`)
   - Use case: Multi-module monorepos

3. **Relation Type Filtering**
   - Show only certain relation types at package level
   - Use case: Focus on inheritance hierarchy, hide dependencies

4. **Member Count Annotations**
   - Show member counts in package entities
   - Example: `src.services (2 classes, 5 methods)`

---

## Conclusion

The ArchJSONAggregator enables **adaptive visualization** - generate the right level of detail for the right audience, all from a single codebase analysis.

**Key Innovation**: Automatic abstraction without losing traceability - you can always drill down from package → class → method level.

**Next Step**: Integrate with DiagramProcessor (Phase 2, Task 5) to generate multi-level diagrams.

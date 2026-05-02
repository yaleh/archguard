# Kotlin Tree-Sitter AST Node Reference

Verified with `@tree-sitter-grammars/tree-sitter-kotlin` against real Kotlin code.
Generated during Stage 1.1 (2026-05-02).

## Top-Level Structure

| Plan Assumption | Actual Node Name | Status |
|----------------|-----------------|--------|
| `package_header` | `package_header` | CORRECT |
| `import_list` | **no such node** — imports are individual `import` nodes directly under `source_file` | WRONG — use `import` |
| `class_declaration` | `class_declaration` | CORRECT |
| `object_declaration` | `object_declaration` | CORRECT |
| `enum_class_body` | `enum_class_body` | CORRECT (body node; enum modifier is `class_modifier` containing `enum`) |
| `function_declaration` | `function_declaration` | CORRECT |
| `primary_constructor` | `primary_constructor` | CORRECT |
| `annotation` | `annotation` | CORRECT |
| supertype list | `delegation_specifiers` (children: `delegation_specifier`) | Plan called it "supertype list" — actual name is `delegation_specifiers` |

## Import Nodes

```
[source_file]
  [import] "import com.example.foo.*"
    [import]   <- keyword
    [qualified_identifier] "com.example.foo"
    [.] "."
    [*] "*"           <- wildcard present only for star imports
  [import] "import com.example.bar.Baz"
    [import]
    [qualified_identifier] "com.example.bar.Baz"
```

- No `import_list` wrapper exists; each import is a direct child of `source_file`.
- Wildcard `.*` imports: node after `qualified_identifier` is `[*]`.
- To get import path: use `node.text` on the `import` node, strip leading `"import "`.

## Class Declaration

```
[class_declaration]
  [modifiers]?           <- e.g. "data", "sealed", "abstract", "enum"
    [class_modifier]     <- data/sealed/enum
      [data|sealed|enum]
    [inheritance_modifier]  <- abstract/open/final
      [abstract|open|final]
    [visibility_modifier]   <- public/private/protected/internal
  [class|interface]      <- keyword
  [identifier]           <- class name
  [primary_constructor]? <- "(val param: Type, ...)"
    [class_parameters]
      [class_parameter]+
        [modifiers]?     <- val/var + visibility
        [val|var]?
        [identifier]     <- param name
        [:]
        [user_type]      <- param type
  [:]?                   <- present when supertypes exist
  [delegation_specifiers]?   <- superclass and interfaces
    [delegation_specifier]+
      [constructor_invocation]  <- for classes: "ViewModel()"
        [user_type]  <- class name
        [value_arguments]
      [user_type]               <- for interfaces: "IObserver"
  [class_body]?
    [{]
    [property_declaration]*    <- fields
    [function_declaration]*    <- methods
    [companion_object]?        <- companion object block
    [class_declaration]*       <- nested classes
    [}]
```

## Object Declaration

```
[object_declaration]
  [object]               <- keyword
  [identifier]           <- object name
  [class_body]?
```

## Companion Object (inside class_body)

```
[companion_object]
  [companion]
  [object]
  [class_body]
```

## Enum Class

```
[class_declaration]
  [modifiers]
    [class_modifier]
      [enum]
  [class]
  [identifier]           <- enum name
  [enum_class_body]
    [{]
    [enum_entry]+
      [identifier]       <- entry name
    [}]
```

## Interface Declaration

Same structure as `class_declaration` but uses `[interface]` keyword instead of `[class]`.

## Property Declaration (field)

```
[property_declaration]
  [modifiers]?
    [visibility_modifier]   <- private/public/etc
    [member_modifier]       <- lateinit
  [val|var]
  [variable_declaration]
    [identifier]            <- field name
    [:]
    [user_type]             <- field type (or [nullable_type] for T?)
  [=]?
  <initializer expression>?
```

## Function Declaration

```
[function_declaration]
  [modifiers]?
    [annotation]*           <- @Composable, @Provides
    [function_modifier]?    <- suspend
    [inheritance_modifier]? <- abstract/override
    [visibility_modifier]?
  [fun]
  [identifier]              <- function name
  [function_value_parameters]
    [(]
    [parameter]*
      [identifier]          <- param name
      [:]
      [user_type]           <- param type
    [)]
  [:]?
  [user_type|nullable_type]?  <- return type
  [function_body]?
```

## Annotations

```
[annotation]
  [@]
  [user_type]             <- simple: @Module → "Module"
    [identifier]
  -- OR --
  [constructor_invocation]  <- with args: @InstallIn(X::class)
    [user_type]
    [value_arguments]
```

## Type Nodes

- `[user_type]` — simple or generic type: `String`, `List<Item>`, `UserRepository`
  - Generic: has `[type_arguments]` child
- `[nullable_type]` — nullable: `User?`
  - child: `[user_type]` + `[?]`
- `[function_type]` — lambda: `(String) -> Unit`

## Type Alias

```
[type_alias]
  [typealias]
  [identifier]            <- alias name
  [=]
  <type node>
```

## Delegation Specifiers (Supertypes)

```
[delegation_specifiers]
  [delegation_specifier]+
    [constructor_invocation]   <- when calling with (): BaseClass()
      [user_type]
      [value_arguments]
    -- OR --
    [user_type]                <- interface without (): IObserver
```

To extract supertype names:
- If child is `constructor_invocation`: get `user_type` → `identifier` text
- If child is `user_type`: get `identifier` text directly

## Key Corrections vs Plan Assumptions

1. **`import_list` does not exist** — use `node.type === 'import'` direct children of `source_file`
2. **Supertypes node** is `delegation_specifiers` not a generic "supertype list"
3. **Enum modifier** lives in `modifiers > class_modifier > enum` — the body node is `enum_class_body`
4. **Annotations** can be `[annotation]` (simple) or contain `[constructor_invocation]` (with args)
5. **Fields** use `property_declaration` with `variable_declaration` child (not `field_declaration`)
6. **Wildcard imports** have `[*]` after `[.]` after `qualified_identifier` (no `import_alias` involved)

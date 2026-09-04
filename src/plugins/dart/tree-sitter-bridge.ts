/**
 * TreeSitterBridge — parses Dart source files via tree-sitter and produces
 * RawDartFile structures consumed by the ArchJsonMapper.
 *
 * Verified AST facts (tree-sitter-dart 1.0.0, probed against web-tree-sitter):
 *   - Root node type is `program`.
 *   - Imports: `import_or_export` → `library_import` → `import_specification`
 *       → `configurable_uri` → `uri` → `string_literal` (the module path).
 *   - `class_definition` fields: `name` (identifier), `superclass` (→
 *       type_identifier), `interfaces` (→ type_identifier, excluding nested
 *       type_arguments), `body` (class_body).
 *   - `enum_declaration` fields: `name`, `body` (enum_body → enum_constant).
 *   - `extension_declaration` fields: `name`, `class` (extended type), `body`.
 *   - `mixin_declaration`: NO `name` field — name is the first `identifier`
 *       named child; body is a `class_body` named child.
 *   - Members live in `class_body`:
 *       * `method_signature` wraps a nested signature node
 *         (`function_signature` / `getter_signature` / `setter_signature`) that
 *         carries the `name` field.
 *       * `declaration` nodes are either fields
 *         (`initialized_identifier_list` → `initialized_identifier` → identifier)
 *         or constructors (`constructor_signature`).
 */

import type { ParserSession, SyntaxNodeLike } from '../shared/syntax-tree.js';
import type {
  RawDartClass,
  RawDartFile,
  RawDartImport,
  RawDartMember,
  RawDartParameter,
  DartVisibility,
} from './types.js';

export class TreeSitterBridge {
  private readonly parser: ParserSession;

  constructor(parser: ParserSession) {
    this.parser = parser;
  }

  /**
   * Parse Dart source text and return a RawDartFile.
   *
   * Never silently converts a failure into an empty success: a tree-sitter
   * ERROR node (partial parse) records a `syntax_error` diagnostic, and an
   * extractor exception records an `extract_error` diagnostic. Both flow into
   * ArchJSON.diagnostics so CLI/MCP can surface the degradation instead of
   * pretending the analysis was complete.
   */
  parseCode(code: string, filePath: string): RawDartFile {
    const tree = this.parser.parse(code);
    try {
      const file = this.extractFile(tree.rootNode, filePath);
      if (tree.rootNode.hasError) {
        file.diagnostics = [
          {
            filePath,
            kind: 'syntax_error',
            message: 'Dart source has tree-sitter ERROR nodes (partial parse)',
          },
        ];
      }
      return file;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dart] Failed to parse ${filePath}:`, error);
      return {
        filePath,
        packageName: '',
        imports: [],
        classes: [],
        diagnostics: [{ filePath, kind: 'extract_error', message }],
      };
    } finally {
      tree.dispose();
    }
  }

  // ─── private extraction ────────────────────────────────────────────────────

  private extractFile(rootNode: SyntaxNodeLike, filePath: string): RawDartFile {
    const packageName = this.extractLibraryName(rootNode);
    const imports = this.extractImports(rootNode);
    const classes = this.extractClasses(rootNode, filePath);
    return { filePath, packageName, imports, classes };
  }

  /** Library name from a (rare) `library foo.bar;` directive; '' when absent. */
  private extractLibraryName(rootNode: SyntaxNodeLike): string {
    for (const child of rootNode.namedChildren) {
      if (child.type !== 'library_directive') continue;
      const identifier = child.descendantsOfType('identifier')[0];
      if (identifier) return identifier.text;
    }
    return '';
  }

  private extractImports(rootNode: SyntaxNodeLike): RawDartImport[] {
    const imports: RawDartImport[] = [];

    for (const child of rootNode.namedChildren) {
      if (child.type !== 'import_or_export') continue;
      const uriNode = child.descendantsOfType('uri')[0];
      if (!uriNode) continue;
      const stringLiteral = uriNode.namedChildren.find((c) => c.type === 'string_literal');
      const raw = stringLiteral?.text ?? uriNode.text;
      const path = raw.replace(/^['"]|['"]$/g, '').trim();
      if (!path) continue;

      // Optional `as <alias>` — the alias is the identifier immediately after
      // the `as` token inside `import_specification`. We must NOT use the first
      // descendant identifier: `import 'x' show Foo;` has `Foo` (a show
      // combinator) as its first identifier and has no alias at all.
      const alias = this.extractImportAlias(child);
      imports.push({ path, ...(alias ? { alias } : {}) });
    }

    return imports;
  }

  /**
   * Extract the `as <alias>` from an `import_or_export` node, or undefined when
   * there is no alias. The alias is the identifier directly after the `as`
   * anonymous token inside `import_specification`; `show`/`hide` combinators
   * live in a separate `combinator` node and must not be mistaken for an alias.
   * A block comment may sit between `as` and the alias (e.g. `import 'x' as a;`
   * with a comment before `a`), so skip grammar extras before accepting the
   * identifier.
   */
  private extractImportAlias(importNode: SyntaxNodeLike): string | undefined {
    const spec = importNode.descendantsOfType('import_specification')[0];
    if (!spec) return undefined;
    const children = spec.children;
    for (let i = 0; i < children.length; i++) {
      if (!children[i].isNamed && children[i].type === 'as') {
        for (let j = i + 1; j < children.length; j++) {
          const child = children[j];
          if (
            child.isNamed &&
            (child.type === 'comment' || child.type === 'documentation_comment')
          ) {
            continue;
          }
          if (child.isNamed && child.type === 'identifier') return child.text;
          // combinator (show/hide), statement terminator, or any other node
          // immediately after `as` — never cross into another structure.
          break;
        }
        return undefined;
      }
    }
    return undefined;
  }

  private extractClasses(rootNode: SyntaxNodeLike, filePath: string): RawDartClass[] {
    const classes: RawDartClass[] = [];

    for (const child of rootNode.namedChildren) {
      switch (child.type) {
        case 'class_definition':
          classes.push(this.extractClassDefinition(child, filePath));
          break;
        case 'enum_declaration':
          classes.push(this.extractEnum(child, filePath));
          break;
        case 'extension_declaration':
          classes.push(this.extractExtension(child, filePath));
          break;
        case 'mixin_declaration':
          classes.push(this.extractMixin(child, filePath));
          break;
        default:
          break;
      }
    }

    return classes;
  }

  private extractClassDefinition(node: SyntaxNodeLike, filePath: string): RawDartClass {
    const name = this.fieldText(node, 'name');
    // `abstract` may be an anonymous token (tree-sitter-dart 1.0.0) or a named
    // `abstract` node (newer grammar); either way its node type is `abstract`.
    // Check DIRECT children only — an `abstract` method inside the body must not
    // mark the class abstract.
    const isAbstract = node.children.some((c) => c.type === 'abstract');
    const superClass = this.superClassOf(node);
    const mixins = this.mixinsOf(node);
    const interfaces = this.interfacesOf(node);
    const members = this.extractMembers(node.childForFieldName('body'));

    return {
      name,
      kind: isAbstract ? 'abstract_class' : 'class',
      visibility: this.visibility(name),
      ...(superClass ? { superClass } : {}),
      mixins,
      interfaces,
      members,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractEnum(node: SyntaxNodeLike, filePath: string): RawDartClass {
    const name = this.fieldText(node, 'name');
    const body = node.childForFieldName('body');
    const members: RawDartMember[] = [];

    if (body) {
      // Enum constants (`red`, `green(1)`) — static-final fields.
      for (const constant of body.descendantsOfType('enum_constant')) {
        const identifier = constant.namedChildren.find((c) => c.type === 'identifier');
        if (!identifier) continue;
        members.push({
          name: identifier.text,
          kind: 'field',
          visibility: this.visibility(identifier.text),
          parameters: [],
          isStatic: true,
          isFinal: true,
          startLine: constant.startPosition.row + 1,
        });
      }

      // Enhanced enums: after the `;`, the enum body may declare fields,
      // constructors, getters, and methods — extract those too. `extractMembers`
      // only matches `method_signature` / `declaration` children, so the
      // `enum_constant` nodes above are naturally skipped.
      members.push(...this.extractMembers(body));
    }

    return {
      name,
      kind: 'enum',
      visibility: this.visibility(name),
      mixins: [],
      interfaces: [],
      members,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractExtension(node: SyntaxNodeLike, filePath: string): RawDartClass {
    const extendedType = this.fieldText(node, 'class');
    // A named extension (`extension Foo on T`) carries a `name` field; an
    // anonymous one (`extension on T`) does NOT (name field is null). Give
    // anonymous extensions a stable synthetic identity keyed on the extended
    // type plus source line, so multiple anonymous `extension on String`
    // blocks never collapse during deduplication.
    let name = this.fieldText(node, 'name');
    if (!name) {
      name = extendedType ? `on_${extendedType}` : 'anonymous_extension';
      name = `${name}_L${node.startPosition.row + 1}`;
    }
    const members = this.extractMembers(node.childForFieldName('body'));

    return {
      name,
      kind: 'extension',
      visibility: this.visibility(name),
      mixins: [],
      // The `on <Type>` target is recorded as a composition relation by the
      // mapper (extension `on` type is lateral reuse, distinct from `implements`).
      interfaces: extendedType ? [extendedType] : [],
      members,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractMixin(node: SyntaxNodeLike, filePath: string): RawDartClass {
    const nameNode = node.namedChildren.find((c) => c.type === 'identifier');
    const name = nameNode?.text ?? 'unknown';
    const bodyNode = node.namedChildren.find((c) => c.type === 'class_body');
    const members = bodyNode ? this.extractMembers(bodyNode) : [];

    return {
      name,
      kind: 'mixin',
      visibility: this.visibility(name),
      mixins: [],
      interfaces: [],
      members,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /** Simple superclass name from a class_definition's `superclass` field (`extends`). */
  private superClassOf(node: SyntaxNodeLike): string | undefined {
    const superclass = node.childForFieldName('superclass');
    if (!superclass) return undefined;
    // A `with` clause also lives under the `superclass` field but wraps its
    // types in a `mixins` node; only a direct type_identifier is `extends`.
    const direct = superclass.namedChildren.find((c) => c.type === 'type_identifier');
    return direct?.text;
  }

  /** Applied mixin names from a class_definition's `superclass` → `mixins` (`with`). */
  private mixinsOf(node: SyntaxNodeLike): string[] {
    const superclass = node.childForFieldName('superclass');
    if (!superclass) return [];
    const mixinsNode = superclass.namedChildren.find((c) => c.type === 'mixins');
    if (!mixinsNode) return [];
    return this.directTypeNames(mixinsNode);
  }

  /** Implemented interface names from a class_definition's `interfaces` field. */
  private interfacesOf(node: SyntaxNodeLike): string[] {
    const interfaces = node.childForFieldName('interfaces');
    if (!interfaces) return [];
    return this.directTypeNames(interfaces);
  }

  /** Direct `type_identifier` children (excludes those nested in type_arguments). */
  private directTypeNames(node: SyntaxNodeLike): string[] {
    return node.namedChildren.filter((c) => c.type === 'type_identifier').map((c) => c.text);
  }

  private extractMembers(bodyNode: SyntaxNodeLike | null): RawDartMember[] {
    if (!bodyNode) return [];
    const members: RawDartMember[] = [];

    for (const child of bodyNode.namedChildren) {
      if (child.type === 'method_signature') {
        const method = this.extractMethod(child);
        if (method) members.push(method);
        continue;
      }
      if (child.type === 'declaration') {
        const constructor = child.descendantsOfType([
          'constructor_signature',
          'factory_constructor_signature',
          'constant_constructor_signature',
        ])[0];
        if (constructor) {
          const ctor = this.extractConstructor(child, constructor);
          if (ctor) members.push(ctor);
        } else {
          members.push(...this.extractFields(child));
        }
      }
    }

    return members;
  }

  private extractMethod(node: SyntaxNodeLike): RawDartMember | null {
    // method_signature has NO `name` field; the signature node (first named
    // child) carries the name.
    const inner = node.namedChildren[0];
    if (!inner) return null;

    const kind = this.signatureKind(inner.type);
    // Constructors (including named factories) carry the class name as the
    // first identifier and the constructor name as the LAST identifier:
    //   `A.named(...)`     → identifiers [A, named]
    //   `factory A.fromJson` → identifiers [A, fromJson]
    // Non-constructor signatures have a `name` field.
    const nameNode =
      inner.childForFieldName('name') ??
      (kind === 'constructor' ? this.lastIdentifier(inner) : this.firstIdentifier(inner));
    const name = nameNode?.text;
    if (!name) return null;

    const isStatic = /\bstatic\b/.test(node.text);
    const isFinal = /\b(final|const)\b/.test(node.text);

    return {
      name,
      kind,
      visibility: this.visibility(name),
      ...(kind !== 'constructor' && kind !== 'setter' ? { type: this.returnType(inner) } : {}),
      parameters: this.extractParameters(inner),
      isStatic,
      isFinal,
      startLine: node.startPosition.row + 1,
    };
  }

  private signatureKind(type: string): RawDartMember['kind'] {
    switch (type) {
      case 'getter_signature':
        return 'getter';
      case 'setter_signature':
        return 'setter';
      case 'constructor_signature':
      case 'factory_constructor_signature':
        return 'constructor';
      default:
        return 'method';
    }
  }

  /**
   * Return the full type expression that precedes the member name in a field
   * declaration or method signature, e.g. `a.Widget<T>?`, `List<String>`,
   * `void`.
   *
   * tree-sitter-dart models a qualified type as adjacent `type_identifier`
   * siblings separated by an anonymous `.` token, with `type_arguments` and a
   * named `nullable_type` (`?`) node following. Field/member modifiers
   * (`final`, `const`, `var`, `static`, `late`, `covariant`) may precede the
   * type, so we skip them until the first real type node. Once collecting, any
   * non-type child (the field/method name, a parameter list, an initializer)
   * ends the scan. A declaration with no explicit type (e.g. `final x = 1`)
   * has no type node and yields `undefined`, so the member name is never
   * mistaken for a type.
   */
  private returnType(node: SyntaxNodeLike): string | undefined {
    // Named modifiers that precede the type (final/const/var are *_builtin).
    const namedModifiers = new Set(['final_builtin', 'const_builtin', 'var_builtin']);
    // Anonymous keyword modifiers that precede the type.
    const anonModifiers = new Set(['static', 'late', 'covariant', 'abstract']);
    const typeNodes = new Set(['type_identifier', 'type_arguments', 'nullable_type', 'void_type']);

    const parts: string[] = [];
    let inType = false;
    for (const child of node.children) {
      if (child.isNamed) {
        if (typeNodes.has(child.type)) {
          inType = true;
          parts.push(child.text);
        } else if (inType || !namedModifiers.has(child.type)) {
          // In a type: the field/method name ends it. Before any type: a
          // non-modifier named node means there is no explicit type.
          break;
        }
        // else: a named modifier before the type — skip it.
      } else if (child.type === '.' || child.type === '?') {
        parts.push(child.text);
      } else if (inType || !anonModifiers.has(child.type)) {
        // An anonymous token other than `.`/`?`: stop once in a type; before a
        // type, stop on anything that is not a keyword modifier.
        break;
      }
    }
    return parts.length > 0 ? parts.join('') : undefined;
  }

  private extractConstructor(
    declaration: SyntaxNodeLike,
    signature: SyntaxNodeLike
  ): RawDartMember | null {
    // `constructor_signature` carries a `name` field, but it points at the
    // CLASS name (`Animal`), not the constructor name. Named constructors
    // (`Animal.named`) and factories (`Dog.fromJson`) put the constructor name
    // in the LAST identifier, so prefer that; it degrades to the class name
    // for unnamed constructors (single identifier).
    const name = this.lastIdentifier(signature)?.text ?? 'constructor';
    const isFactory = signature.type === 'factory_constructor_signature';

    return {
      name,
      kind: 'constructor',
      visibility: this.visibility(name),
      parameters: this.extractParameters(signature),
      isStatic: isFactory || /\bstatic\b/.test(declaration.text),
      isFinal: /\bconst\b/.test(declaration.text),
      startLine: declaration.startPosition.row + 1,
    };
  }

  private extractFields(declaration: SyntaxNodeLike): RawDartMember[] {
    const type = this.returnType(declaration) ?? 'dynamic';
    const isStatic = /\bstatic\b/.test(declaration.text);
    const isFinal = /\b(final|const)\b/.test(declaration.text);
    const fields: RawDartMember[] = [];
    const seen = new Set<string>();

    for (const container of declaration.descendantsOfType([
      'initialized_identifier',
      'static_final_declaration',
    ])) {
      const identifier = container.namedChildren.find((c) => c.type === 'identifier');
      if (!identifier || seen.has(identifier.text)) continue;
      seen.add(identifier.text);
      fields.push({
        name: identifier.text,
        kind: 'field',
        visibility: this.visibility(identifier.text),
        type,
        parameters: [],
        isStatic,
        isFinal,
        startLine: container.startPosition.row + 1,
      });
    }

    return fields;
  }

  private extractParameters(node: SyntaxNodeLike): RawDartParameter[] {
    const params: RawDartParameter[] = [];
    // `formal_parameter` nodes may be nested inside optional_formal_parameters
    // ({named} / [positional]) containers, so use descendantsOfType to reach
    // them instead of only direct children.
    for (const formal of node.descendantsOfType('formal_parameter')) {
      const param = this.extractParameter(formal);
      if (param) params.push(param);
    }
    return params;
  }

  private extractParameter(formal: SyntaxNodeLike): RawDartParameter | null {
    const isRequired = this.hasRequiredModifier(formal);

    // `this.name` constructor params wrap the name in a `constructor_param`.
    const constructorParam = formal.descendantsOfType('constructor_param')[0];
    if (constructorParam) {
      const identifier = constructorParam.namedChildren.find((c) => c.type === 'identifier');
      if (identifier) {
        return {
          name: identifier.text,
          type: 'this',
          ...(isRequired ? { isRequired: true } : {}),
          ...this.defaultValueOf(formal),
        };
      }
    }

    const typeNode = formal.namedChildren.find((c) => c.type === 'type_identifier');
    const nameNode = formal.namedChildren.find((c) => c.type === 'identifier');
    if (!nameNode) return null;
    return {
      name: nameNode.text,
      type: typeNode?.text ?? 'dynamic',
      ...(isRequired ? { isRequired: true } : {}),
      ...this.defaultValueOf(formal),
    };
  }

  /**
   * Detect the `required` modifier on a named formal parameter. The keyword is
   * an anonymous sibling token preceding the formal_parameter inside the
   * `optional_formal_parameters` container (it does NOT appear in
   * `formal_parameter.text`), so scan the parent's anonymous children for a
   * `required` token immediately before this formal.
   */
  private hasRequiredModifier(formal: SyntaxNodeLike): boolean {
    const parent = formal.parent;
    if (!parent) return false;
    const siblings = parent.children;
    for (let i = 0; i < siblings.length; i++) {
      // Compare by stable node id — children may be fresh wrappers, not the
      // same object reference as `formal`.
      if (siblings[i].id !== formal.id) continue;
      const prev = siblings[i - 1];
      if (prev && !prev.isNamed && prev.type === 'required') return true;
      break;
    }
    return false;
  }

  /**
   * Default value text after `=` for a formal parameter, e.g. `this.age = 1`
   * → { defaultValue: '1' }. The `=` and value are siblings of the formal
   * (not its children), so scan the parent's children after the formal.
   */
  private defaultValueOf(formal: SyntaxNodeLike): { defaultValue?: string } {
    const parent = formal.parent;
    if (!parent) return {};
    const siblings = parent.children;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].id !== formal.id) continue;
      // Find the `=` immediately after the formal.
      const eq = siblings[i + 1];
      if (!eq || eq.isNamed || eq.type !== '=') return {};
      // Collect the value: the next sibling(s) until a comma or closing brace.
      const parts: string[] = [];
      for (let j = i + 2; j < siblings.length; j++) {
        const tok = siblings[j];
        if (!tok.isNamed && (tok.type === ',' || tok.type === '}')) break;
        parts.push(tok.text);
      }
      const value = parts.join(' ').trim();
      return value ? { defaultValue: value } : {};
    }
    return {};
  }

  // ─── shared helpers ────────────────────────────────────────────────────────

  private fieldText(node: SyntaxNodeLike, field: string): string {
    const child = node.childForFieldName(field);
    return child?.text ?? '';
  }

  private firstIdentifier(node: SyntaxNodeLike): SyntaxNodeLike | null {
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') return child;
    }
    return null;
  }

  private lastIdentifier(node: SyntaxNodeLike): SyntaxNodeLike | null {
    for (let i = node.namedChildren.length - 1; i >= 0; i--) {
      if (node.namedChildren[i].type === 'identifier') return node.namedChildren[i];
    }
    return null;
  }

  private visibility(name: string): DartVisibility {
    return name.startsWith('_') ? 'private' : 'public';
  }
}

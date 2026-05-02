/**
 * Kotlin ClassBuilder — extracts RawKotlinClass[] from a tree-sitter rootNode.
 *
 * Caller (TreeSitterBridge) is responsible for parsing the source text and
 * passing in the rootNode.  ClassBuilder only traverses the already-parsed AST.
 *
 * Key AST facts (verified in AST_NODES.md):
 *   - class / interface → `class_declaration`
 *   - singleton         → `object_declaration`
 *   - companion object  → `companion_object` inside `class_body`
 *   - enum entries      → `enum_class_body` > `enum_entry`
 *   - fields            → `property_declaration` > `variable_declaration`
 *   - methods           → `function_declaration`
 *   - supertypes        → `delegation_specifiers` > `delegation_specifier`
 *     - class (with ()) → child `constructor_invocation` > `user_type`
 *     - interface       → direct `user_type` child
 *   - modifiers         → `modifiers` > `class_modifier` | `inheritance_modifier` | `visibility_modifier`
 *   - annotations       → `annotation` nodes (before or inside modifiers)
 */

import type { RawKotlinClass, RawKotlinMember, KotlinClassKind, KotlinVisibility } from '../types.js';

export class ClassBuilder {
  /**
   * Walk the entire rootNode tree and collect every class/object declaration.
   *
   * @param rootNode  tree-sitter SyntaxNode for the whole file
   * @param packageName  package extracted by the caller (may be '')
   * @param filePath  absolute path of the source file
   */
  extractClasses(rootNode: any, packageName: string, filePath: string): RawKotlinClass[] {
    const results: RawKotlinClass[] = [];
    this.visitNode(rootNode, packageName, filePath, false, results);
    return results;
  }

  // ─── private traversal ───────────────────────────────────────────────────

  private visitNode(
    node: any,
    packageName: string,
    filePath: string,
    insideCompanion: boolean,
    results: RawKotlinClass[]
  ): void {
    if (node.type === 'class_declaration') {
      const cls = this.buildClass(node, packageName, filePath, false);
      if (cls) results.push(cls);
      // Also recurse into nested classes inside the body
      this.visitChildren(node, packageName, filePath, false, results);
      return;
    }

    if (node.type === 'object_declaration') {
      const obj = this.buildObject(node, packageName, filePath, false);
      if (obj) results.push(obj);
      this.visitChildren(node, packageName, filePath, false, results);
      return;
    }

    if (node.type === 'companion_object') {
      const comp = this.buildCompanionObject(node, packageName, filePath);
      if (comp) results.push(comp);
      // companion bodies do not typically contain further classes, but recurse anyway
      this.visitChildren(node, packageName, filePath, true, results);
      return;
    }

    this.visitChildren(node, packageName, filePath, insideCompanion, results);
  }

  private visitChildren(
    node: any,
    packageName: string,
    filePath: string,
    insideCompanion: boolean,
    results: RawKotlinClass[]
  ): void {
    for (const child of node.namedChildren ?? []) {
      this.visitNode(child, packageName, filePath, insideCompanion, results);
    }
  }

  // ─── class_declaration builder ───────────────────────────────────────────

  private buildClass(
    node: any,
    packageName: string,
    filePath: string,
    _insideCompanion: boolean
  ): RawKotlinClass | null {
    const name = this.extractIdentifier(node);
    if (!name) return null;

    const modifiers = this.findChild(node, 'modifiers');
    const visibility = this.extractVisibility(modifiers);
    const decorators = this.extractAnnotations(modifiers);

    // Determine keyword: `class` vs `interface`
    const isInterface = node.children.some((c: any) => c.type === 'interface');
    const classModifiers = this.extractClassModifiers(modifiers);
    const inheritanceModifiers = this.extractInheritanceModifiers(modifiers);

    const kind = this.determineClassKind(isInterface, classModifiers, inheritanceModifiers);
    const superTypes = this.extractSuperTypes(node);

    // Members from primary constructor parameters (data class fields)
    const primaryCtorMembers = this.extractPrimaryCtorMembers(node);

    // Members from class body
    const bodyNode = this.findChild(node, 'class_body') ?? this.findChild(node, 'enum_class_body');
    const bodyMembers = bodyNode ? this.extractBodyMembers(bodyNode, false) : [];
    // enum entries
    const enumMembers = bodyNode ? this.extractEnumEntries(bodyNode) : [];

    const members = [...primaryCtorMembers, ...bodyMembers, ...enumMembers];

    return {
      name,
      kind,
      visibility,
      packageName,
      superTypes,
      members,
      decorators,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  // ─── object_declaration builder ──────────────────────────────────────────

  private buildObject(
    node: any,
    packageName: string,
    filePath: string,
    _insideCompanion: boolean
  ): RawKotlinClass | null {
    const name = this.extractIdentifier(node);
    if (!name) return null;

    const modifiers = this.findChild(node, 'modifiers');
    const visibility = this.extractVisibility(modifiers);
    const decorators = this.extractAnnotations(modifiers);
    const superTypes = this.extractSuperTypes(node);

    const bodyNode = this.findChild(node, 'class_body');
    const members = bodyNode ? this.extractBodyMembers(bodyNode, false) : [];

    return {
      name,
      kind: 'object',
      visibility,
      packageName,
      superTypes,
      members,
      decorators,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  // ─── companion_object builder ─────────────────────────────────────────────

  private buildCompanionObject(
    node: any,
    packageName: string,
    filePath: string
  ): RawKotlinClass | null {
    // companion object may have a name or be anonymous → use 'Companion' as fallback
    const nameNode = node.namedChildren.find((c: any) => c.type === 'identifier');
    const name = nameNode?.text ?? 'Companion';

    const modifiers = this.findChild(node, 'modifiers');
    const visibility = this.extractVisibility(modifiers);
    const decorators = this.extractAnnotations(modifiers);

    const bodyNode = this.findChild(node, 'class_body');
    // All companion members are static
    const members = bodyNode ? this.extractBodyMembers(bodyNode, true) : [];

    return {
      name,
      kind: 'companion_object',
      visibility,
      packageName,
      superTypes: [],
      members,
      decorators,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  // ─── kind determination ───────────────────────────────────────────────────

  private determineClassKind(
    isInterface: boolean,
    classModifiers: string[],
    inheritanceModifiers: string[]
  ): KotlinClassKind {
    const hasSealed = classModifiers.includes('sealed');
    const hasData = classModifiers.includes('data');
    const hasEnum = classModifiers.includes('enum');
    const hasAbstract = inheritanceModifiers.includes('abstract');

    if (isInterface) {
      return hasSealed ? 'sealed_interface' : 'interface';
    }
    if (hasEnum) return 'enum_class';
    if (hasData) return 'data_class';
    if (hasSealed) return 'sealed_class';
    if (hasAbstract) return 'abstract_class';
    return 'class';
  }

  // ─── supertype extraction ─────────────────────────────────────────────────

  private extractSuperTypes(node: any): string[] {
    const delegationSpecifiers = this.findChild(node, 'delegation_specifiers');
    if (!delegationSpecifiers) return [];

    const superTypes: string[] = [];
    for (const specifier of delegationSpecifiers.namedChildren) {
      if (specifier.type !== 'delegation_specifier') continue;

      // constructor_invocation → class with ()
      const ctorInvocation = this.findChild(specifier, 'constructor_invocation');
      if (ctorInvocation) {
        const userType = this.findChild(ctorInvocation, 'user_type');
        const name = this.extractUserTypeName(userType);
        if (name) superTypes.push(name);
        continue;
      }

      // user_type directly → interface without ()
      const userType = this.findChild(specifier, 'user_type');
      if (userType) {
        const name = this.extractUserTypeName(userType);
        if (name) superTypes.push(name);
      }
    }

    return superTypes;
  }

  // ─── primary constructor parameter extraction ─────────────────────────────

  private extractPrimaryCtorMembers(node: any): RawKotlinMember[] {
    const primaryCtor = this.findChild(node, 'primary_constructor');
    if (!primaryCtor) return [];

    const classParams = this.findChild(primaryCtor, 'class_parameters');
    if (!classParams) return [];

    const members: RawKotlinMember[] = [];
    for (const param of classParams.namedChildren) {
      if (param.type !== 'class_parameter') continue;

      // Only val/var parameters become fields; plain parameters don't
      const hasValVar = param.children.some(
        (c: any) => c.type === 'val' || c.type === 'var'
      );
      if (!hasValVar) continue;

      const nameNode = param.namedChildren.find((c: any) => c.type === 'identifier');
      if (!nameNode) continue;

      const typeText = this.extractTypeFromParam(param);
      const modifiers = this.findChild(param, 'modifiers');
      const visibility = this.extractVisibility(modifiers);
      const decorators = this.extractAnnotations(modifiers);

      members.push({
        name: nameNode.text,
        kind: 'field',
        visibility,
        type: typeText,
        isStatic: false,
        decorators,
        startLine: param.startPosition.row + 1,
        endLine: param.endPosition.row + 1,
      });
    }

    return members;
  }

  // ─── class body member extraction ────────────────────────────────────────

  private extractBodyMembers(bodyNode: any, forceStatic: boolean): RawKotlinMember[] {
    const members: RawKotlinMember[] = [];

    for (const child of bodyNode.namedChildren) {
      if (child.type === 'property_declaration') {
        const member = this.buildFieldMember(child, forceStatic);
        if (member) members.push(member);
        continue;
      }

      if (child.type === 'function_declaration') {
        const member = this.buildMethodMember(child, forceStatic);
        if (member) members.push(member);
        continue;
      }

      // companion_object members are collected separately via visitNode
      // nested class_declaration / object_declaration also collected separately
    }

    return members;
  }

  private buildFieldMember(node: any, forceStatic: boolean): RawKotlinMember | null {
    const varDecl = this.findChild(node, 'variable_declaration');
    if (!varDecl) return null;

    const nameNode = varDecl.namedChildren.find((c: any) => c.type === 'identifier');
    if (!nameNode) return null;

    // Type: look for user_type or nullable_type inside variable_declaration
    const typeNode =
      this.findChild(varDecl, 'user_type') ??
      this.findChild(varDecl, 'nullable_type');
    const typeText = typeNode ? this.extractUserTypeName(typeNode) ?? typeNode.text : undefined;

    const modifiers = this.findChild(node, 'modifiers');
    const visibility = this.extractVisibility(modifiers);
    const decorators = this.extractAnnotations(modifiers);

    return {
      name: nameNode.text,
      kind: 'field',
      visibility,
      type: typeText,
      isStatic: forceStatic,
      decorators,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private buildMethodMember(node: any, forceStatic: boolean): RawKotlinMember | null {
    const nameNode = node.namedChildren.find((c: any) => c.type === 'identifier');
    if (!nameNode) return null;

    const modifiers = this.findChild(node, 'modifiers');
    const visibility = this.extractVisibility(modifiers);
    const decorators = this.extractAnnotations(modifiers);

    return {
      name: nameNode.text,
      kind: 'method',
      visibility,
      isStatic: forceStatic,
      decorators,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  // ─── enum entry extraction ────────────────────────────────────────────────

  private extractEnumEntries(bodyNode: any): RawKotlinMember[] {
    if (bodyNode.type !== 'enum_class_body') return [];

    const members: RawKotlinMember[] = [];
    for (const child of bodyNode.namedChildren) {
      if (child.type !== 'enum_entry') continue;
      const nameNode = child.namedChildren.find((c: any) => c.type === 'identifier');
      if (!nameNode) continue;

      members.push({
        name: nameNode.text,
        kind: 'field', // enum entries modelled as static fields
        visibility: 'public',
        isStatic: true,
        decorators: [],
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });
    }
    return members;
  }

  // ─── modifier helpers ─────────────────────────────────────────────────────

  /** Returns the text tokens inside `class_modifier` children of modifiers node */
  private extractClassModifiers(modifiers: any): string[] {
    if (!modifiers) return [];
    const result: string[] = [];
    for (const child of modifiers.namedChildren) {
      if (child.type === 'class_modifier') {
        // child has a single keyword child: data | sealed | enum | inner | etc.
        const kw = child.namedChildren[0]?.text ?? child.text;
        if (kw) result.push(kw);
      }
    }
    return result;
  }

  /** Returns the text tokens inside `inheritance_modifier` children */
  private extractInheritanceModifiers(modifiers: any): string[] {
    if (!modifiers) return [];
    const result: string[] = [];
    for (const child of modifiers.namedChildren) {
      if (child.type === 'inheritance_modifier') {
        const kw = child.namedChildren[0]?.text ?? child.text;
        if (kw) result.push(kw);
      }
    }
    return result;
  }

  private extractVisibility(modifiers: any): KotlinVisibility {
    if (!modifiers) return 'public';
    for (const child of modifiers.namedChildren) {
      if (child.type === 'visibility_modifier') {
        const text = (child.namedChildren[0]?.text ?? child.text).toLowerCase();
        if (text === 'private') return 'private';
        if (text === 'protected') return 'protected';
        if (text === 'internal') return 'internal';
        return 'public';
      }
    }
    return 'public';
  }

  // ─── annotation helpers ───────────────────────────────────────────────────

  private extractAnnotations(modifiers: any): string[] {
    if (!modifiers) return [];
    const names: string[] = [];
    for (const child of modifiers.namedChildren) {
      if (child.type === 'annotation') {
        const name = this.extractAnnotationName(child);
        if (name) names.push(name);
      }
    }
    return names;
  }

  private extractAnnotationName(annotationNode: any): string | null {
    // Simple: @Module → annotation > user_type > identifier
    const userType = this.findChild(annotationNode, 'user_type');
    if (userType) return this.extractUserTypeName(userType);

    // With args: @InstallIn(X::class) → annotation > constructor_invocation > user_type
    const ctorInvocation = this.findChild(annotationNode, 'constructor_invocation');
    if (ctorInvocation) {
      const ut = this.findChild(ctorInvocation, 'user_type');
      return this.extractUserTypeName(ut);
    }
    return null;
  }

  // ─── type helpers ─────────────────────────────────────────────────────────

  /**
   * Extract a simple name from a `user_type` node.
   * For `List<String>` returns `List`; for `Map.Entry` returns `Map.Entry`.
   */
  private extractUserTypeName(userTypeNode: any): string | null {
    if (!userTypeNode) return null;
    // user_type may have multiple `type_identifier` children separated by `.`
    const identifiers = userTypeNode.namedChildren
      .filter((c: any) => c.type === 'type_identifier')
      .map((c: any) => c.text as string);
    if (identifiers.length > 0) return identifiers.join('.');

    // fallback: direct identifier child
    const ident = userTypeNode.namedChildren.find((c: any) => c.type === 'identifier');
    if (ident) return ident.text as string;

    // last resort: raw text stripped of generics
    return userTypeNode.text.replace(/<.*>/, '').trim() || null;
  }

  /** Extract type text from a `class_parameter` node (primary ctor param) */
  private extractTypeFromParam(paramNode: any): string | undefined {
    const userType = this.findChild(paramNode, 'user_type');
    if (userType) return this.extractUserTypeName(userType) ?? undefined;
    const nullableType = this.findChild(paramNode, 'nullable_type');
    if (nullableType) return nullableType.text;
    return undefined;
  }

  // ─── general AST helpers ─────────────────────────────────────────────────

  /** Find the first direct named child with the given type */
  private findChild(node: any, type: string): any | null {
    if (!node) return null;
    return node.namedChildren?.find((c: any) => c.type === type) ?? null;
  }

  /** Extract the `identifier` that represents the declaration's name */
  private extractIdentifier(node: any): string | null {
    const identNode = node.namedChildren?.find((c: any) => c.type === 'identifier');
    return identNode?.text ?? null;
  }
}

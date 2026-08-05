/**
 * RuleEngine — interprets a LoadedPack against a parsed AST and produces
 * ArchJSON Entity[] + Relation[] (TASK-63, Phase B).
 *
 * The engine is deliberately generic: the pack's `entity_nodes` rules describe
 * which tree-sitter node types declare entities and where their members live,
 * so Java and Python (and, later, other languages) share one interpreter.
 * Language-specific quirks (package extraction, Python module IDs, visibility
 * conventions) are keyed off the pack's `manifest.language`.
 */

import fs from 'fs-extra';
import path from 'path';
import type { Decorator, Entity, Member, Parameter, Relation, Visibility } from '@/types/index.js';
import type {
  ParserSession,
  SyntaxNodeLike,
  SyntaxTreeLike,
} from '@/plugins/shared/syntax-tree.js';
import type { EntityNodeRule, LoadedPack } from '../pack-registry/types.js';
import { childrenOfType, nodeText } from './ast-node.js';

/** Result of analyzing one source file. */
export interface RuleEngineFileResult {
  entities: Entity[];
  relations: Relation[];
}

export interface RuleEngineOptions {
  /** Project root used to derive Python module IDs (relative to file paths). */
  workspaceRoot?: string;
}

const JAVA_PRIMITIVES = new Set([
  'void',
  'boolean',
  'byte',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'Boolean',
  'Byte',
  'Character',
  'Short',
  'Integer',
  'Long',
  'Float',
  'Double',
  'String',
  'Object',
]);

/** Common JDK type names used unqualified that are not project entities. */
const JDK_COMMON_NAMES = new Set([
  'List',
  'Map',
  'Set',
  'Collection',
  'Queue',
  'Deque',
  'Iterator',
  'Iterable',
  'Optional',
  'Stream',
  'Future',
  'Callable',
  'Runnable',
  'Comparator',
  'Exception',
  'RuntimeException',
  'Error',
  'Throwable',
  'Thread',
  'Logger',
  'Class',
  'Enum',
  'Number',
  'Math',
  'StringBuilder',
  'StringBuffer',
  'ByteBuffer',
  'CharBuffer',
  'IntBuffer',
  'ShortBuffer',
  'LongBuffer',
  'FloatBuffer',
  'DoubleBuffer',
  'Path',
  'File',
  'URI',
  'URL',
  'InputStream',
  'OutputStream',
  'Reader',
  'Writer',
  'Closeable',
  'AutoCloseable',
  'Serializable',
  'Comparable',
  'Cloneable',
  'Override',
  'Deprecated',
  'FunctionalInterface',
  'SuppressWarnings',
  'Builder',
  'Response',
  'Request',
]);

const JAVA_MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'synchronized',
  'volatile',
  'transient',
  'native',
  'strictfp',
]);

export class RuleEngine {
  constructor(
    private readonly pack: LoadedPack,
    private readonly session: ParserSession,
    private readonly options: RuleEngineOptions = {}
  ) {}

  /** Parse source into a disposable tree. */
  parse(code: string): SyntaxTreeLike {
    return this.session.parse(code);
  }

  /**
   * Analyze one source file: parse + extract entities and relations.
   *
   * @param moduleIndex Known project module IDs (Python import resolution);
   *   undefined disables cross-module import resolution.
   */
  analyzeFile(
    code: string,
    filePath: string,
    moduleIndex?: ReadonlySet<string>
  ): RuleEngineFileResult {
    const tree = this.session.parse(code);
    try {
      return this.extractFromTree(tree.rootNode, filePath, code, moduleIndex);
    } finally {
      tree.dispose();
    }
  }

  /** Extract entities from a source string (parses internally). */
  extractEntities(code: string, filePath: string): Entity[] {
    const tree = this.session.parse(code);
    try {
      return this.extractEntitiesFromTree(tree.rootNode, filePath, code);
    } finally {
      tree.dispose();
    }
  }

  /** Extract relations from a source string (parses internally). */
  extractRelations(code: string, filePath: string, moduleIndex?: ReadonlySet<string>): Relation[] {
    const tree = this.session.parse(code);
    try {
      return this.extractRelationsFromTree(tree.rootNode, filePath, code, moduleIndex);
    } finally {
      tree.dispose();
    }
  }

  /**
   * Extract import relations from a source string.
   *
   * Independent of the pack's `relations.importDependency` flag — this is the
   * raw import-extraction capability (exercised by pack unit tests); the
   * flag only controls whether `extractRelations` includes them.
   */
  extractImportRelations(
    code: string,
    filePath: string,
    moduleIndex?: ReadonlySet<string>
  ): Relation[] {
    const sourceId = this.moduleIdFor(filePath);
    if (!sourceId) return [];
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const pattern of this.pack.modules.importPatterns) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern.pattern, 'gm');
      } catch {
        continue; // malformed pack pattern — skip rather than crash
      }
      let match: RegExpExecArray | null;
      while ((match = regex.exec(code)) !== null) {
        const modulePath = match[pattern.moduleGroup ?? 1];
        if (!modulePath) continue;
        const target = this.resolveImport(modulePath, moduleIndex);
        if (!target || target === sourceId) continue;
        const key = `dependency:${sourceId}:${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({
          id: `${sourceId}_dependency_${target}`,
          type: 'dependency',
          source: sourceId,
          target,
          confidence: 1.0,
          inferenceSource: 'explicit',
        });
      }
    }
    return relations;
  }

  /**
   * Detect which framework (if any) is active for a project root.
   * Evaluates file-based `detect` stanzas (file_match + content_contains).
   * Annotation-based detection is handled during entity extraction.
   */
  async detectFramework(projectRoot: string): Promise<string | null> {
    for (const framework of this.pack.frameworks) {
      for (const detect of framework.detect) {
        if (detect.fileMatch && detect.contentContains) {
          const filePath = path.join(projectRoot, detect.fileMatch);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            if (content.includes(detect.contentContains)) {
              return framework.name;
            }
          } catch {
            // Missing/unreadable marker file — try the next rule.
          }
        }
      }
    }
    return null;
  }

  /**
   * Module ID for a file path, used as the source of import relations.
   * Python: dotted module path relative to workspaceRoot (matching the
   * imperative Python plugin). Other languages: file basename without ext.
   */
  moduleIdFor(filePath: string): string | null {
    if (this.pack.manifest.language === 'python') {
      return this.pythonModuleId(filePath);
    }
    const base = path.basename(filePath).replace(/\.[^.]+$/, '');
    return base || null;
  }

  /** Extract entities + relations from an already-parsed tree. */
  extractFromTree(
    rootNode: SyntaxNodeLike,
    filePath: string,
    code: string,
    moduleIndex?: ReadonlySet<string>
  ): RuleEngineFileResult {
    const entities = this.extractEntitiesFromTree(rootNode, filePath, code);
    const relations = this.extractRelationsFromTree(rootNode, filePath, code, moduleIndex);
    return { entities, relations };
  }

  // ---------------------------------------------------------------------
  // Entity extraction
  // ---------------------------------------------------------------------

  private extractEntitiesFromTree(
    rootNode: SyntaxNodeLike,
    filePath: string,
    code: string
  ): Entity[] {
    const entities: Entity[] = [];
    const packageName = this.extractPackageName(rootNode, code);

    for (const rule of this.pack.modules.entityNodes) {
      for (const node of rootNode.namedChildren) {
        const { target, outer } = this.unwrapDecorated(node);
        if (target.type !== rule.nodeType) continue;
        const entity = this.extractEntity(target, rule, packageName, filePath, code);
        if (entity) {
          if (outer) {
            const outerDecorators = this.extractAnnotations(outer, code);
            if (outerDecorators.length > 0) entity.decorators = outerDecorators;
          }
          entities.push(entity);
        }
      }
    }
    return entities;
  }

  /**
   * Decorated definitions (e.g. `@app.get(...)` in Python) wrap the real
   * class/function declaration in a `decorated_definition` node. Returns the
   * underlying declaration plus the outer node when present.
   */
  private unwrapDecorated(node: SyntaxNodeLike): {
    target: SyntaxNodeLike;
    outer?: SyntaxNodeLike;
  } {
    if (node.type === 'decorated_definition') {
      const definition = node.childForFieldName('definition');
      if (definition) return { target: definition, outer: node };
    }
    return { target: node };
  }

  private extractEntity(
    node: SyntaxNodeLike,
    rule: EntityNodeRule,
    packageName: string,
    filePath: string,
    code: string
  ): Entity | undefined {
    const nameNode = node.childForFieldName(rule.nameField);
    if (!nameNode) return undefined;
    const name = nodeText(nameNode, code);

    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const isAbstract = modifiers.includes('abstract');
    const extendsList = this.extractExtends(node, rule, code);
    const implementsList = this.extractImplements(node, rule, code);
    const members = this.extractMembers(node, rule, code);

    return {
      id: this.generateEntityId(packageName, name, filePath),
      name,
      type: isAbstract && rule.abstractEntityType ? rule.abstractEntityType : rule.entityType,
      visibility: this.mapVisibility(name, modifiers),
      members,
      sourceLocation: {
        file: filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
      ...(annotations.length > 0 ? { decorators: annotations } : {}),
      ...(isAbstract ? { isAbstract: true } : {}),
      ...(extendsList.length > 0 ? { extends: extendsList } : {}),
      ...(implementsList.length > 0 ? { implements: implementsList } : {}),
    };
  }

  private extractMembers(node: SyntaxNodeLike, rule: EntityNodeRule, code: string): Member[] {
    const members: Member[] = [];
    const bodyNode = rule.bodyField ? node.childForFieldName(rule.bodyField) : undefined;
    if (!bodyNode) return members;

    if (rule.methodNode) {
      for (const child of childrenOfType(bodyNode, rule.methodNode)) {
        const method = this.extractMethod(child, code);
        if (method) members.push(method);
      }
    }
    if (rule.fieldNode) {
      for (const child of childrenOfType(bodyNode, rule.fieldNode)) {
        members.push(...this.extractFields(child, code));
      }
    }
    if (rule.constructorNode) {
      for (const child of childrenOfType(bodyNode, rule.constructorNode)) {
        const constructor = this.extractConstructor(child, code, node, rule);
        if (constructor) members.push(constructor);
      }
    }
    return members;
  }

  private extractMethod(node: SyntaxNodeLike, code: string): Member | undefined {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return undefined;
    const name = nodeText(nameNode, code);
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const parameters = this.extractParameters(node, code);

    let returnType: string | undefined;
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      returnType = nodeText(typeNode, code);
    } else {
      const returnTypeNode = node.childForFieldName('return_type');
      returnType = returnTypeNode ? nodeText(returnTypeNode, code) : undefined;
    }

    const isAsync = this.isAsyncFunction(node, code);

    return {
      name,
      type: 'method',
      visibility: this.mapVisibility(name, modifiers),
      ...(returnType ? { returnType } : {}),
      parameters,
      ...(modifiers.includes('static') ? { isStatic: true } : {}),
      ...(modifiers.includes('abstract') ? { isAbstract: true } : {}),
      ...(isAsync ? { isAsync: true } : {}),
      ...(annotations.length > 0 ? { decorators: annotations } : {}),
    };
  }

  private extractFields(node: SyntaxNodeLike, code: string): Member[] {
    const members: Member[] = [];
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const typeNode = node.childForFieldName('type');
    const type = typeNode ? nodeText(typeNode, code) : 'unknown';

    for (const declarator of node.descendantsOfType('variable_declarator')) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;
      members.push({
        name: nodeText(nameNode, code),
        type: 'field',
        visibility: this.mapVisibility(nodeText(nameNode, code), modifiers),
        fieldType: type,
        ...(annotations.length > 0 ? { decorators: annotations } : {}),
      });
    }
    return members;
  }

  private extractConstructor(
    node: SyntaxNodeLike,
    code: string,
    enclosing: SyntaxNodeLike,
    rule: EntityNodeRule
  ): Member | undefined {
    const enclosingNameNode = enclosing.childForFieldName(rule.nameField);
    const name = enclosingNameNode ? nodeText(enclosingNameNode, code) : 'constructor';
    const modifiers = this.extractModifiers(node, code);
    const annotations = this.extractAnnotations(node, code);
    const parameters = this.extractParameters(node, code);

    return {
      name,
      type: 'constructor',
      visibility: this.mapVisibility(name, modifiers),
      parameters,
      ...(annotations.length > 0 ? { decorators: annotations } : {}),
    };
  }

  private extractParameters(node: SyntaxNodeLike, code: string): Parameter[] {
    const parametersNode = node.childForFieldName('parameters');
    if (!parametersNode) return [];
    const parameters: Parameter[] = [];

    if (this.pack.manifest.language === 'python') {
      for (const param of parametersNode.namedChildren) {
        const nameNode = param.childForFieldName('name') ?? this.firstIdentifier(param);
        if (!nameNode) continue;
        const name = nodeText(nameNode, code);
        const typeNode = param.childForFieldName('type');
        parameters.push({
          name,
          type: typeNode ? nodeText(typeNode, code) : 'any',
        });
      }
      return parameters;
    }

    for (const param of parametersNode.descendantsOfType('formal_parameter')) {
      const typeNode = param.childForFieldName('type');
      const nameNode = param.childForFieldName('name');
      if (!typeNode || !nameNode) continue;
      parameters.push({
        name: nodeText(nameNode, code),
        type: nodeText(typeNode, code),
      });
    }
    return parameters;
  }

  private firstIdentifier(node: SyntaxNodeLike): SyntaxNodeLike | null {
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') return child;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Relation extraction
  // ---------------------------------------------------------------------

  private extractRelationsFromTree(
    rootNode: SyntaxNodeLike,
    filePath: string,
    code: string,
    moduleIndex?: ReadonlySet<string>
  ): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();
    const packageName = this.extractPackageName(rootNode, code);
    const emit = this.pack.modules.relations;

    for (const rule of this.pack.modules.entityNodes) {
      for (const node of rootNode.namedChildren) {
        const { target: decl } = this.unwrapDecorated(node);
        if (decl.type !== rule.nodeType) continue;
        const nameNode = decl.childForFieldName(rule.nameField);
        if (!nameNode) continue;
        const name = nodeText(nameNode, code);
        const sourceId = this.generateEntityId(packageName, name, filePath);

        if (emit.inheritance) {
          for (const ext of this.extractExtends(decl, rule, code)) {
            const target = this.resolveTypeId(ext, packageName);
            this.pushRelation(relations, seen, 'inheritance', sourceId, target);
          }
        }
        if (emit.implementation) {
          for (const impl of this.extractImplements(decl, rule, code)) {
            const target = this.resolveTypeId(impl, packageName);
            this.pushRelation(relations, seen, 'implementation', sourceId, target);
          }
        }
        if (emit.fieldDependency) {
          const bodyNode = rule.bodyField ? decl.childForFieldName(rule.bodyField) : undefined;
          if (bodyNode && rule.fieldNode) {
            for (const fieldNode of childrenOfType(bodyNode, rule.fieldNode)) {
              const typeNode = fieldNode.childForFieldName('type');
              if (!typeNode) continue;
              const rawType = nodeText(typeNode, code);
              const baseType = this.extractTypeName(rawType);
              if (this.isUserDefinedType(baseType)) {
                this.pushRelation(
                  relations,
                  seen,
                  'dependency',
                  sourceId,
                  this.resolveTypeId(baseType, packageName)
                );
              }
            }
          }
        }
        if (emit.parameterDependency) {
          const bodyNode = rule.bodyField ? decl.childForFieldName(rule.bodyField) : undefined;
          if (bodyNode && rule.methodNode) {
            for (const methodNode of childrenOfType(bodyNode, rule.methodNode)) {
              for (const param of this.extractParameters(methodNode, code)) {
                const baseType = this.extractTypeName(param.type);
                if (this.isUserDefinedType(baseType)) {
                  this.pushRelation(
                    relations,
                    seen,
                    'dependency',
                    sourceId,
                    this.resolveTypeId(baseType, packageName)
                  );
                }
              }
            }
          }
        }
      }
    }

    if (emit.importDependency) {
      relations.push(...this.extractImportRelations(code, filePath, moduleIndex));
    }

    return relations;
  }

  private pushRelation(
    relations: Relation[],
    seen: Set<string>,
    type: 'inheritance' | 'implementation' | 'dependency',
    source: string,
    target: string
  ): void {
    const key = `${type}:${source}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({
      id: `${source}_${type}_${target}`,
      type,
      source,
      target,
      confidence: 1.0,
      inferenceSource: 'explicit',
    });
  }

  // ---------------------------------------------------------------------
  // Language helpers
  // ---------------------------------------------------------------------

  private extractPackageName(rootNode: SyntaxNodeLike, code: string): string {
    if (this.pack.manifest.language !== 'java') return '';
    const packageDecl = rootNode.namedChildren.find((c) => c.type === 'package_declaration');
    if (!packageDecl) return '';
    const scoped = packageDecl.descendantsOfType('scoped_identifier')[0];
    if (scoped) return nodeText(scoped, code);
    const identifier = packageDecl.descendantsOfType('identifier')[0];
    if (identifier) return nodeText(identifier, code);
    return '';
  }

  private extractModifiers(node: SyntaxNodeLike, _code: string): string[] {
    if (this.pack.manifest.language !== 'java') return [];
    const modifiers: string[] = [];
    for (const child of node.children) {
      if (child.type !== 'modifiers') continue;
      for (const mod of child.children) {
        if (JAVA_MODIFIERS.has(mod.type)) modifiers.push(mod.type);
      }
    }
    return modifiers;
  }

  private extractAnnotations(node: SyntaxNodeLike, code: string): Decorator[] {
    if (this.pack.manifest.language === 'python') {
      const decorators: Decorator[] = [];
      for (const child of node.namedChildren) {
        if (child.type === 'decorator') {
          const name = this.pythonDecoratorName(child, code);
          if (name) decorators.push({ name });
        }
      }
      return decorators;
    }

    const decorators: Decorator[] = [];
    for (const child of node.children) {
      if (child.type !== 'modifiers') continue;
      for (const mod of child.children) {
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
        const nameNode = mod.childForFieldName('name');
        if (!nameNode) continue;
        const raw = nodeText(nameNode, code);
        decorators.push({ name: raw.startsWith('@') ? raw.substring(1) : raw });
      }
    }
    return decorators;
  }

  private pythonDecoratorName(node: SyntaxNodeLike, code: string): string | undefined {
    const call = node.namedChildren.find((c) => c.type === 'call');
    if (call) {
      const fn = call.childForFieldName('function');
      if (fn) return nodeText(fn, code).replace(/^@/, '');
    }
    const target = node.namedChildren.find(
      (c) => c.type === 'identifier' || c.type === 'attribute'
    );
    if (target) return nodeText(target, code).replace(/^@/, '');
    return undefined;
  }

  private extractExtends(node: SyntaxNodeLike, rule: EntityNodeRule, code: string): string[] {
    if (rule.baseClassField) {
      return this.extractPythonBaseClasses(node, rule.baseClassField, code);
    }
    if (!rule.extendsField) return [];
    const extendsNode = node.childForFieldName(rule.extendsField);
    if (!extendsNode) return [];
    const typeIds = rule.typeIdentifierNode
      ? extendsNode.descendantsOfType(rule.typeIdentifierNode)
      : extendsNode.descendantsOfType('identifier');
    return [...new Set(typeIds.map((t) => nodeText(t, code)))];
  }

  private extractImplements(node: SyntaxNodeLike, rule: EntityNodeRule, code: string): string[] {
    if (!rule.implementsField) return [];
    const implementsNode = node.childForFieldName(rule.implementsField);
    if (!implementsNode) return [];
    const typeList = implementsNode.childForFieldName('type_list') ?? implementsNode;
    const typeIds = rule.typeIdentifierNode
      ? typeList.descendantsOfType(rule.typeIdentifierNode)
      : typeList.descendantsOfType('identifier');
    return [...new Set(typeIds.map((t) => nodeText(t, code)))];
  }

  private extractPythonBaseClasses(node: SyntaxNodeLike, field: string, code: string): string[] {
    const superNode = node.childForFieldName(field);
    if (!superNode) return [];
    const argList = superNode.namedChildren.find((c) => c.type === 'argument_list') ?? superNode;
    const attrs = argList.descendantsOfType('attribute');
    if (attrs.length > 0) {
      return [...new Set(attrs.map((a) => nodeText(a, code)))];
    }
    const ids = argList.descendantsOfType('identifier');
    return [...new Set(ids.map((i) => nodeText(i, code)))];
  }

  private isAsyncFunction(node: SyntaxNodeLike, code: string): boolean {
    if (this.pack.manifest.language !== 'python') return false;
    const prefix = code.substring(node.startIndex, Math.min(node.startIndex + 8, node.endIndex));
    return prefix.startsWith('async');
  }

  private mapVisibility(name: string, modifiers: string[]): Visibility {
    if (this.pack.manifest.language === 'python') {
      return name.startsWith('_') ? 'private' : 'public';
    }
    if (modifiers.includes('private')) return 'private';
    if (modifiers.includes('protected')) return 'protected';
    return 'public';
  }

  private generateEntityId(packageName: string, name: string, filePath: string): string {
    if (this.pack.manifest.language === 'python') {
      const moduleId = this.pythonModuleId(filePath);
      return moduleId ? `${moduleId}.${name}` : name;
    }
    return packageName ? `${packageName}.${name}` : name;
  }

  private pythonModuleId(filePath: string): string | null {
    const root = this.options.workspaceRoot;
    if (root) {
      const rel = path.relative(root, filePath);
      if (rel.startsWith('..')) return this.basenameModuleId(filePath);
      const withoutExt = rel.replace(/\.py$/, '');
      const normalised = withoutExt.replace(/(\/|^)__init__$/, '');
      const dotted = normalised.replace(/\//g, '.');
      return dotted || null;
    }
    return this.basenameModuleId(filePath);
  }

  private basenameModuleId(filePath: string): string | null {
    const base = path.basename(filePath).replace(/\.py$/, '');
    if (base === '__init__') return path.basename(path.dirname(filePath)) || null;
    return base || null;
  }

  private resolveTypeId(typeName: string, currentPackage: string): string {
    if (typeName.includes('.')) return typeName;
    return currentPackage ? `${currentPackage}.${typeName}` : typeName;
  }

  private extractTypeName(type: string): string {
    const genericIndex = type.indexOf('<');
    if (genericIndex > 0) return type.substring(0, genericIndex);
    const arrayIndex = type.indexOf('[');
    if (arrayIndex > 0) return type.substring(0, arrayIndex);
    return type.trim();
  }

  private isUserDefinedType(type: string): boolean {
    if (this.pack.manifest.language !== 'java') return false;
    if (JAVA_PRIMITIVES.has(type)) return false;
    if (type.startsWith('java.')) return false;
    if (type.length === 1 && /[A-Z]/.test(type)) return false;
    if (/^[A-Z][0-9]$/.test(type)) return false;
    if (JDK_COMMON_NAMES.has(type)) return false;
    return true;
  }

  private resolveImport(modulePath: string, moduleIndex?: ReadonlySet<string>): string | null {
    if (modulePath.startsWith('.')) return null; // relative import — skip in engine
    if (!moduleIndex) return modulePath; // standalone mode: keep the literal module path

    const parts = modulePath.split('.');
    for (let leftStrip = 0; leftStrip < parts.length; leftStrip++) {
      const remaining = parts.slice(leftStrip);
      for (let rightLen = remaining.length; rightLen > 0; rightLen--) {
        const candidate = remaining.slice(0, rightLen).join('.');
        if (moduleIndex.has(candidate)) return candidate;
      }
    }
    return null; // not a known project module (stdlib/third-party) — drop
  }
}

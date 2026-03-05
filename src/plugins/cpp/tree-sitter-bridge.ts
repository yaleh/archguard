/**
 * Tree-sitter bridge for C++ language parsing
 */
import Parser from 'tree-sitter';
// @ts-ignore - tree-sitter-cpp doesn't have proper type definitions
import Cpp from 'tree-sitter-cpp';
import { ClassBuilder } from './builders/class-builder.js';
import type { RawCppFile, RawClass, RawEnum, RawFunction } from './types.js';

export class TreeSitterBridge {
  private parser: Parser;
  private classBuilder: ClassBuilder;

  constructor() {
    this.parser = new Parser();
    // @ts-ignore - tree-sitter-cpp language definition compatibility
    this.parser.setLanguage(Cpp);
    this.classBuilder = new ClassBuilder();
  }

  parseCode(code: string, filePath: string): RawCppFile {
    const tree = this.parser.parse(code);
    const root = tree.rootNode;

    const namespace = this.extractTopLevelNamespace(root);

    return {
      filePath,
      namespace,
      classes: this.extractClasses(root, filePath, namespace),
      enums: this.extractEnums(root, namespace),
      functions: this.extractTopLevelFunctions(root, filePath, namespace),
      includes: this.extractIncludes(root),
    };
  }

  private extractTopLevelNamespace(root: Parser.SyntaxNode): string {
    for (const child of root.namedChildren) {
      if (child.type === 'namespace_definition') {
        const nameNode = child.childForFieldName('name');
        return nameNode?.text ?? '';
      }
    }
    return '';
  }

  private extractClasses(
    root: Parser.SyntaxNode,
    filePath: string,
    fileNamespace: string
  ): RawClass[] {
    const classes: RawClass[] = [];
    this.visitForClasses(root, filePath, fileNamespace, '', classes);
    return classes;
  }

  private visitForClasses(
    node: Parser.SyntaxNode,
    filePath: string,
    fileNamespace: string,
    currentNs: string,
    out: RawClass[]
  ): void {
    for (const child of node.namedChildren) {
      if (child.type === 'namespace_definition') {
        const nameNode = child.childForFieldName('name');
        const nsName = nameNode?.text ?? '';
        const newNs = currentNs ? `${currentNs}::${nsName}` : nsName;
        const body = child.childForFieldName('body');
        if (body) this.visitForClasses(body, filePath, fileNamespace, newNs, out);
        continue;
      }

      if (child.type === 'template_declaration') {
        const templateParams = this.extractTemplateParams(child);
        const innerClass = child.namedChildren.find(
          (n) => n.type === 'class_specifier' || n.type === 'struct_specifier'
        );
        if (innerClass) {
          const cls = this.extractOneClass(innerClass, filePath, currentNs);
          if (cls) {
            cls.templateParams = templateParams;
            cls.name = `${cls.name}<${templateParams.join(', ')}>`;
            out.push(cls);
          }
        }
        continue;
      }

      if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
        const cls = this.extractOneClass(child, filePath, currentNs);
        if (cls) out.push(cls);
        continue;
      }
    }
  }

  private extractOneClass(
    node: Parser.SyntaxNode,
    filePath: string,
    currentNs: string
  ): RawClass | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;
    const kind: 'class' | 'struct' = node.type === 'struct_specifier' ? 'struct' : 'class';
    const qualifiedName = currentNs ? `${currentNs}::${name}` : name;

    const bases = this.extractBases(node);
    const bodyNode = node.childForFieldName('body');
    const defaultVis: 'public' | 'private' = kind === 'struct' ? 'public' : 'private';
    const { fields, methods } = bodyNode
      ? this.classBuilder.extractMembers(bodyNode, filePath, defaultVis)
      : { fields: [], methods: [] };

    return {
      name,
      qualifiedName,
      kind,
      bases,
      fields,
      methods,
      sourceFile: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractBases(classNode: Parser.SyntaxNode): RawClass['bases'] {
    const bases: RawClass['bases'] = [];
    const baseClause = classNode.namedChildren.find((n) => n.type === 'base_class_clause');
    if (!baseClause) return bases;

    // Walk all children (including anonymous tokens like access specifier keywords)
    let currentAccess: 'public' | 'private' | 'protected' = 'private';
    for (const child of baseClause.children) {
      const text = child.text.toLowerCase();
      if (text === 'public' || text === 'private' || text === 'protected') {
        currentAccess = text as 'public' | 'private' | 'protected';
      } else if (
        child.type === 'type_identifier' ||
        child.type === 'qualified_identifier' ||
        child.type === 'template_type'
      ) {
        bases.push({ name: child.text, access: currentAccess });
        // Reset to default for next base (class default is private)
        currentAccess = 'private';
      }
    }

    return bases;
  }

  private extractEnums(root: Parser.SyntaxNode, namespace: string): RawEnum[] {
    const enums: RawEnum[] = [];
    this.visitForEnums(root, namespace, enums);
    return enums;
  }

  private visitForEnums(
    node: Parser.SyntaxNode,
    namespace: string,
    out: RawEnum[]
  ): void {
    for (const child of node.namedChildren) {
      if (child.type === 'namespace_definition') {
        const nsName = child.childForFieldName('name')?.text ?? '';
        const newNs = namespace ? `${namespace}::${nsName}` : nsName;
        const body = child.childForFieldName('body');
        if (body) this.visitForEnums(body, newNs, out);
        continue;
      }

      if (child.type === 'enum_specifier') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;
        const name = nameNode.text;
        const qualifiedName = namespace ? `${namespace}::${name}` : name;

        // Check for scoped enum: look for 'class' or 'struct' keyword token among children
        const isScoped = child.children.some(
          (n) => !n.isNamed && (n.text === 'class' || n.text === 'struct')
        );

        const bodyNode = child.childForFieldName('body');
        const members = bodyNode
          ? bodyNode.namedChildren
              .filter((n) => n.type === 'enumerator')
              .map((n) => n.childForFieldName('name')?.text ?? n.text)
          : [];

        out.push({
          name,
          qualifiedName,
          isScoped,
          members,
          sourceFile: node.toString(),
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        });
      }
    }
  }

  private extractTopLevelFunctions(
    root: Parser.SyntaxNode,
    filePath: string,
    namespace: string
  ): RawFunction[] {
    const fns: RawFunction[] = [];
    for (const child of root.namedChildren) {
      if (child.type === 'namespace_definition') {
        const nsName = child.childForFieldName('name')?.text ?? '';
        const body = child.childForFieldName('body');
        const newNs = namespace ? `${namespace}::${nsName}` : nsName;
        if (body) fns.push(...this.extractTopLevelFunctions(body, filePath, newNs));
        continue;
      }
      if (child.type === 'function_definition') {
        const fn = this.extractFunction(child, filePath, namespace);
        if (fn) fns.push(fn);
      }
    }
    return fns;
  }

  private extractFunction(
    node: Parser.SyntaxNode,
    filePath: string,
    namespace: string
  ): RawFunction | null {
    const declarator = this.findDescendant(node, 'function_declarator');
    if (!declarator) return null;

    const nameNode = declarator.childForFieldName('declarator');
    if (!nameNode) return null;
    const name = nameNode.text;

    // Skip qualified names (class methods defined outside class body)
    if (name.includes('::')) return null;

    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text ?? 'void';
    const qualifiedName = namespace ? `${namespace}::${name}` : name;

    return {
      name,
      qualifiedName,
      returnType,
      parameters: [],
      isStatic: node.text.startsWith('static'),
      sourceFile: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractIncludes(root: Parser.SyntaxNode): string[] {
    const includes: string[] = [];
    for (const child of root.children) {
      if (child.type === 'preproc_include') {
        // path node is a named child (string_literal or system_lib_string)
        const pathNode = child.namedChildren.find(
          (n) => n.type === 'string_literal' || n.type === 'system_lib_string'
        );
        if (pathNode) {
          // Strip surrounding " " or < >
          const raw = pathNode.text.replace(/^["<]|[">]$/g, '');
          includes.push(raw);
        }
      }
    }
    return includes;
  }

  private extractTemplateParams(templateNode: Parser.SyntaxNode): string[] {
    const paramList = templateNode.namedChildren.find(
      (n) => n.type === 'template_parameter_list'
    );
    if (!paramList) return [];
    return paramList.namedChildren
      .filter((n) => n.type === 'type_parameter_declaration')
      .map((n) => {
        const nameNode = n.namedChildren.find((c) => c.type === 'type_identifier');
        return nameNode?.text ?? 'T';
      });
  }

  private findDescendant(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
    if (node.type === type) return node;
    for (const child of node.namedChildren) {
      const found = this.findDescendant(child, type);
      if (found) return found;
    }
    return null;
  }
}

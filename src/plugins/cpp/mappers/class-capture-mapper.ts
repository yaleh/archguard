/**
 * CppClassMapper — maps `classes.scm` captures to RawClass entities.
 *
 * Namespace-qualified names are derived by walking the matched node's ancestor
 * chain; template parameters are read from an enclosing template_declaration;
 * members are split between the query-based CppFieldMapper (fields) and
 * ClassBuilder (methods, preserving access-specifier visibility).
 */
import { CaptureMapper, collectNamespace, type CaptureGroup } from '../../shared/capture-mapper.js';
import type { ParserQueryLike, SyntaxNodeLike } from '../../shared/syntax-tree.js';
import type { ClassBuilder } from '../builders/class-builder.js';
import type { RawClass } from '../types.js';
import { CppFieldMapper } from './field-capture-mapper.js';

type Base = RawClass['bases'];

export class CppClassMapper extends CaptureMapper<RawClass> {
  constructor(
    query: ParserQueryLike,
    private readonly classBuilder: ClassBuilder,
    private readonly fieldMapper: CppFieldMapper
  ) {
    super(query);
  }

  protected mapCapture(group: CaptureGroup, filePath: string): RawClass | null {
    const node = group['class.specifier'];
    if (!node) return null;
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;

    // Skip forward declarations (no body): the canonical definition survives.
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return null;

    const kind: RawClass['kind'] = node.type === 'struct_specifier' ? 'struct' : 'class';
    const defaultVis: 'public' | 'private' = kind === 'struct' ? 'public' : 'private';

    let clsName = name;
    let templateParams: string[] | undefined;
    if (node.parent?.type === 'template_declaration') {
      templateParams = this.extractTemplateParams(node.parent);
      clsName = `${name}<${templateParams.join(', ')}>`;
    }

    const namespace = collectNamespace(node);
    const qualifiedName = namespace ? `${namespace}::${name}` : name;

    return {
      name: clsName,
      qualifiedName,
      kind,
      bases: this.extractBases(node),
      fields: this.fieldMapper.extractFromBody(bodyNode, filePath, defaultVis),
      methods: this.classBuilder.extractMethods(bodyNode, filePath, defaultVis),
      templateParams,
      sourceFile: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractBases(classNode: SyntaxNodeLike): Base {
    const bases: Base = [];
    const baseClause = classNode.namedChildren.find((n) => n.type === 'base_class_clause');
    if (!baseClause) return bases;

    // Walk all children (including anonymous tokens like access specifier keywords).
    let currentAccess: Base[number]['access'] = 'private';
    for (const child of baseClause.children) {
      const text = child.text.toLowerCase();
      if (text === 'public' || text === 'private' || text === 'protected') {
        currentAccess = text;
      } else if (
        child.type === 'type_identifier' ||
        child.type === 'qualified_identifier' ||
        child.type === 'template_type'
      ) {
        bases.push({ name: child.text, access: currentAccess });
        currentAccess = 'private';
      }
    }
    return bases;
  }

  private extractTemplateParams(templateNode: SyntaxNodeLike): string[] {
    const paramList = templateNode.namedChildren.find((n) => n.type === 'template_parameter_list');
    if (!paramList) return [];
    return paramList.namedChildren
      .filter((n) => n.type === 'type_parameter_declaration')
      .map((n) => {
        const nameNode = n.namedChildren.find((c) => c.type === 'type_identifier');
        return nameNode?.text ?? 'T';
      });
  }
}

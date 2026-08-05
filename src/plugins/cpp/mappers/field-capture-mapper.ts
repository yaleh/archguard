/**
 * CppFieldMapper — maps `fields.scm` captures to RawField entities.
 *
 * `extractFromBody` is the class-body entry: the query selects the
 * field_declaration nodes, and the body's named children are walked in order so
 * access-specifier visibility is preserved (public/private/protected).
 */
import { CaptureMapper, type CaptureGroup } from '../../shared/capture-mapper.js';
import type { ParserQueryLike, SyntaxNodeLike } from '../../shared/syntax-tree.js';
import type { RawField } from '../types.js';

type Visibility = 'public' | 'private' | 'protected';

export class CppFieldMapper extends CaptureMapper<RawField> {
  constructor(query: ParserQueryLike) {
    super(query);
  }

  /** Extract fields from a class/struct body, honoring access specifiers. */
  extractFromBody(bodyNode: SyntaxNodeLike, filePath: string, defaultVis: Visibility): RawField[] {
    // Match field_declaration nodes by stable tree id (node objects are
    // re-created by the binding on each access, so identity is unreliable).
    const fieldNodeIds = new Set<number>();
    for (const match of this.query.matches(bodyNode)) {
      const cap = match.captures.find((c) => c.name === 'field.node');
      if (cap) fieldNodeIds.add(cap.node.id);
    }

    const fields: RawField[] = [];
    let currentVis = defaultVis;
    for (const child of bodyNode.namedChildren) {
      if (child.type === 'access_specifier') {
        const text = child.text.replace(':', '').trim().toLowerCase();
        if (text === 'public' || text === 'private' || text === 'protected') {
          currentVis = text;
        }
        continue;
      }
      if (fieldNodeIds.has(child.id)) {
        const field = this.mapFieldNode(child, filePath, currentVis);
        if (field) fields.push(field);
      }
    }
    return fields;
  }

  protected mapCapture(group: CaptureGroup, filePath: string): RawField | null {
    const node = group['field.node'];
    return node ? this.mapFieldNode(node, filePath, 'private') : null;
  }

  private mapFieldNode(
    node: SyntaxNodeLike,
    filePath: string,
    visibility: Visibility
  ): RawField | null {
    const typeNode = node.childForFieldName('type');
    const declarator = node.childForFieldName('declarator');
    if (!typeNode || !declarator) return null;

    const nameNode =
      findDescendant(declarator, 'field_identifier') ?? findDescendant(declarator, 'identifier');
    if (!nameNode) return null;

    // tree-sitter puts pointer/reference sigils in the declarator node, not the
    // type node (e.g. `Foo *bar_` → type="Foo", declarator=pointer_declarator).
    let fieldType = typeNode.text;
    if (declarator.type === 'pointer_declarator') fieldType += ' *';
    else if (declarator.type === 'reference_declarator') fieldType += ' &';

    return {
      name: nameNode.text,
      fieldType,
      visibility,
      isStatic: node.text.includes('static'),
    };
  }
}

function findDescendant(node: SyntaxNodeLike, type: string): SyntaxNodeLike | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

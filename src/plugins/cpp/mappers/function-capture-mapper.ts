/**
 * CppFuncMapper — maps `functions.scm` captures to RawFunction entities.
 *
 * The query already excludes class methods (field_identifier declarators) and
 * out-of-class qualified definitions (qualified_identifier declarators); the
 * namespace prefix is derived from the ancestor chain.
 */
import { CaptureMapper, collectNamespace, type CaptureGroup } from '../../shared/capture-mapper.js';
import type { RawFunction } from '../types.js';

export class CppFuncMapper extends CaptureMapper<RawFunction> {
  protected mapCapture(group: CaptureGroup, filePath: string): RawFunction | null {
    const node = group['function.node'];
    const nameNode = group['function.name'];
    if (!node || !nameNode) return null;

    const name = nameNode.text;
    // Defensive: skip qualified names (class methods defined outside the class
    // body) should the grammar change its declarator shape.
    if (name.includes('::')) return null;

    const namespace = collectNamespace(node);
    const qualifiedName = namespace ? `${namespace}::${name}` : name;

    return {
      name,
      qualifiedName,
      returnType: node.childForFieldName('type')?.text ?? 'void',
      parameters: [],
      isStatic: node.text.startsWith('static'),
      sourceFile: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }
}

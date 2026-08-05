/**
 * CppEnumMapper — maps `enums.scm` captures to RawEnum entities.
 */
import { CaptureMapper, collectNamespace, type CaptureGroup } from '../../shared/capture-mapper.js';
import type { RawEnum } from '../types.js';

export class CppEnumMapper extends CaptureMapper<RawEnum> {
  protected mapCapture(group: CaptureGroup, filePath: string): RawEnum | null {
    const node = group['enum.specifier'];
    if (!node) return null;
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;

    const namespace = collectNamespace(node);
    const qualifiedName = namespace ? `${namespace}::${name}` : name;

    // Scoped enum: an anonymous 'class'/'struct' keyword token among children.
    const isScoped = node.children.some(
      (n) => !n.isNamed && (n.text === 'class' || n.text === 'struct')
    );

    const bodyNode = node.childForFieldName('body');
    const members = bodyNode
      ? bodyNode.namedChildren
          .filter((n) => n.type === 'enumerator')
          .map((n) => n.childForFieldName('name')?.text ?? n.text)
      : [];

    return {
      name,
      qualifiedName,
      isScoped,
      members,
      sourceFile: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }
}

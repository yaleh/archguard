/**
 * CppIncludeMapper — maps `includes.scm` captures to include path strings.
 */
import { CaptureMapper, type CaptureGroup } from '../../shared/capture-mapper.js';

export class CppIncludeMapper extends CaptureMapper<string> {
  protected mapCapture(group: CaptureGroup, _filePath: string): string | null {
    const node = group['include.path'];
    if (!node) return null;
    // Strip surrounding " " or < >
    return node.text.replace(/^["<]|[">]$/g, '');
  }
}

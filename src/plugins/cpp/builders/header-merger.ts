import path from 'path';
import type { RawCppFile, RawClass, RawMethod, MergedCppEntity } from '../types.js';

export class HeaderMerger {
  private static readonly HEADER_EXTS = new Set(['.h', '.hpp', '.hxx', '.h++']);

  merge(files: RawCppFile[]): MergedCppEntity[] {
    const headers = files.filter(f => this.isHeader(f.filePath));
    const impls = files.filter(f => !this.isHeader(f.filePath));

    // Index header classes by qualifiedName
    const headerIndex = new Map<string, { entity: RawClass; file: RawCppFile }>();
    for (const hFile of headers) {
      for (const cls of hFile.classes) {
        headerIndex.set(cls.qualifiedName || cls.name, { entity: cls, file: hFile });
      }
    }

    const result: MergedCppEntity[] = [];
    const consumed = new Set<string>(); // qualifiedNames matched with impl

    // Process impl files: try to pair with header
    for (const iFile of impls) {
      for (const cls of iFile.classes) {
        const key = cls.qualifiedName || cls.name;
        const headerMatch = headerIndex.get(key);

        if (headerMatch) {
          // Merge: declaration from header, body methods from impl
          const merged = this.mergeEntities(
            headerMatch.entity, headerMatch.file.filePath,
            cls, iFile.filePath,
          );
          result.push(merged);
          consumed.add(key);
        } else {
          // Impl-only
          result.push({
            ...cls,
            declarationFile: iFile.filePath,
            implementationFile: undefined,
          });
          consumed.add(key);
        }
      }
    }

    // Header-only classes (no impl file matched)
    for (const [key, { entity, file }] of headerIndex) {
      if (!consumed.has(key)) {
        result.push({
          ...entity,
          declarationFile: file.filePath,
          implementationFile: undefined,
        });
      }
    }

    return result;
  }

  private mergeEntities(
    headerCls: RawClass, headerFile: string,
    implCls: RawClass, implFile: string,
  ): MergedCppEntity {
    // Union of methods by name; header entry wins on collision (preserves declaration metadata)
    const methodMap = new Map<string, RawMethod>();
    for (const m of headerCls.methods) methodMap.set(m.name, m);
    for (const m of implCls.methods) {
      if (!methodMap.has(m.name)) methodMap.set(m.name, m);
    }

    return {
      ...headerCls,
      methods: Array.from(methodMap.values()),
      fields: headerCls.fields.length > 0 ? headerCls.fields : implCls.fields,
      declarationFile: headerFile,
      implementationFile: implFile,
    };
  }

  private isHeader(filePath: string): boolean {
    return HeaderMerger.HEADER_EXTS.has(path.extname(filePath).toLowerCase());
  }
}

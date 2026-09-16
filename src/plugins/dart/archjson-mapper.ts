/**
 * ArchJSON Mapper — converts RawDartFile[] → ArchJSON.
 *
 * Relation surface mirrors the Kotlin imperative plugin:
 *   - `superClass` (extends)      → inheritance
 *   - `interfaces` (implements)   → implementation
 *   - extension `on` type         → composition
 *   - field types                 → composition
 *
 * Entity IDs are `<package>.<Name>` where the package is derived from the
 * file path relative to workspaceRoot (Dart has no `package` declaration
 * keyword; the rare `library` directive is honored when present).
 */

import path from 'node:path';
import { BaseArchJsonMapper, createRelation } from '@/plugins/shared/mapper-utils.js';
import { resolveImportUri } from './pubspec-resolver.js';
import type { RawDartFile, RawDartMember, DartClassKind } from './types.js';
import type {
  ArchJSON,
  Entity,
  Member,
  MemberType,
  Relation,
  RelationType,
  Decorator,
} from '@/types/index.js';
import { ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';

const KIND_TO_ENTITY_TYPE: Record<DartClassKind, string> = {
  class: 'class',
  abstract_class: 'abstract_class',
  enum: 'enum',
  extension: 'class',
  mixin: 'class',
};

function kindDecorator(kind: DartClassKind): Decorator[] {
  switch (kind) {
    case 'extension':
      return [{ name: 'extension' }];
    case 'mixin':
      return [{ name: 'mixin' }];
    default:
      return [];
  }
}

export class ArchJsonMapper extends BaseArchJsonMapper<RawDartFile> {
  // ── Public API ───────────────────────────────────────────────────────────

  mapEntities(
    files: RawDartFile[],
    workspaceRoot: string,
    packageMap: ReadonlyMap<string, string> = new Map()
  ): Entity[] {
    const entities: Entity[] = [];
    const seenIds = new Set<string>();

    for (const file of files) {
      const packageName = this.packageFor(file, workspaceRoot, packageMap);
      for (const cls of file.classes) {
        const id = this.createEntityId(packageName, cls.name);
        const entity: Entity = {
          id,
          name: cls.name,
          type: KIND_TO_ENTITY_TYPE[cls.kind],
          visibility: cls.visibility,
          members: this.mapMembers(cls.members),
          sourceLocation: this.createSourceLocation(cls.filePath, cls.startLine, cls.endLine),
          ...(cls.kind === 'abstract_class' ? { isAbstract: true } : {}),
          ...(cls.superClass ? { extends: [cls.superClass] } : {}),
          ...(cls.interfaces.length > 0 ? { implements: cls.interfaces } : {}),
        };
        const decorators = kindDecorator(cls.kind);
        if (decorators.length > 0) entity.decorators = decorators;

        this.pushUniqueEntity(entities, seenIds, entity);
      }
    }

    return entities;
  }

  mapRelations(
    files: RawDartFile[],
    allEntities: Entity[],
    workspaceRoot: string,
    packageMap: ReadonlyMap<string, string> = new Map()
  ): Relation[] {
    const entityById = new Map<string, Entity>();
    for (const entity of allEntities) {
      entityById.set(entity.id, entity);
    }

    // package name → (class name → entity). Duplicate class names within one
    // package are a Dart compile error, so first-wins is safe.
    const byPackageName = new Map<string, Map<string, Entity>>();
    const packageByFile = new Map<string, string>();
    for (const file of files) {
      const pkg = this.packageFor(file, workspaceRoot, packageMap);
      packageByFile.set(path.resolve(file.filePath), pkg);
      let nameMap = byPackageName.get(pkg);
      if (!nameMap) {
        nameMap = new Map();
        byPackageName.set(pkg, nameMap);
      }
      for (const cls of file.classes) {
        const entity = entityById.get(this.createEntityId(pkg, cls.name));
        if (entity && !nameMap.has(cls.name)) nameMap.set(cls.name, entity);
      }
    }

    // Resolve an import URI to the package name of the imported file, or
    // undefined for external deps (dart:, unknown package:) / excluded files.
    const resolveImportPackage = (
      importPath: string,
      currentFilePath: string
    ): string | undefined => {
      const abs = resolveImportUri(packageMap, importPath, currentFilePath);
      if (!abs) return undefined;
      return packageByFile.get(path.resolve(abs));
    };

    // Per-file type resolver. Resolution order (most specific first):
    //   1. Alias-qualified `alias.Type` — resolved via the matching import.
    //   2. Fully-qualified ID when typeName already carries dots.
    //   3. Same-package qualified name (shared directory package).
    //   4. Import-resolved — unique match among the file's imports (this is
    //      what makes a class in a.dart bind a type explicitly imported from
    //      b.dart even when other packages define the same simple name).
    //   5. Simple-name match ONLY when unambiguous across the whole scope
    //      (last resort for cases the import capture can't see, e.g. part files).
    const resolverFor = (file: RawDartFile): ((typeName: string) => Entity | undefined) => {
      const pkg = packageByFile.get(path.resolve(file.filePath)) ?? '';
      return (typeName: string): Entity | undefined => {
        const dot = typeName.indexOf('.');
        if (dot > 0) {
          const prefix = typeName.slice(0, dot);
          const rest = typeName.slice(dot + 1);
          const aliasImport = file.imports.find((imp) => imp.alias === prefix);
          if (aliasImport) {
            const targetPkg = resolveImportPackage(aliasImport.path, file.filePath);
            return targetPkg !== undefined ? byPackageName.get(targetPkg)?.get(rest) : undefined;
          }
          if (entityById.has(typeName)) return entityById.get(typeName);
        }

        const samePackage = byPackageName.get(pkg);
        if (samePackage?.has(typeName)) {
          return samePackage.get(typeName);
        }

        const candidates = new Set<string>();
        for (const imp of file.imports) {
          const targetPkg = resolveImportPackage(imp.path, file.filePath);
          if (targetPkg === undefined) continue;
          const entity = byPackageName.get(targetPkg)?.get(typeName);
          if (entity) candidates.add(entity.id);
        }
        if (candidates.size === 1) return entityById.get([...candidates][0]);

        const matches = allEntities.filter((e) => e.name === typeName);
        return matches.length === 1 ? matches[0] : undefined;
      };
    };

    const seen = new Set<string>();
    const relations: Relation[] = [];

    const addRelation = (type: RelationType, source: string, target: string): void => {
      if (source === target) return;
      const key = `${type}:${source}:${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      relations.push({ ...createRelation(type, source, target), inferenceSource: 'explicit' });
    };

    for (const file of files) {
      const packageName = packageByFile.get(path.resolve(file.filePath)) ?? '';
      const resolve = resolverFor(file);
      for (const cls of file.classes) {
        const sourceId = this.createEntityId(packageName, cls.name);

        // extends → inheritance
        if (cls.superClass) {
          const target = resolve(cls.superClass);
          if (target) addRelation('inheritance', sourceId, target.id);
        }

        // `with` mixin application → composition (lateral reuse, distinct from extends)
        for (const mixinName of cls.mixins) {
          const target = resolve(mixinName);
          if (target) addRelation('composition', sourceId, target.id);
        }

        // implements → implementation; extension `on` → composition
        const interfaceRelation: RelationType =
          cls.kind === 'extension' ? 'composition' : 'implementation';
        for (const interfaceName of cls.interfaces) {
          const target = resolve(interfaceName);
          if (target) addRelation(interfaceRelation, sourceId, target.id);
        }

        // field types → composition
        for (const member of cls.members) {
          if (member.kind !== 'field' || !member.type) continue;
          const baseType = this.extractTypeName(member.type);
          const target = resolve(baseType);
          if (target) addRelation('composition', sourceId, target.id);
        }
      }
    }

    return relations;
  }

  map(
    files: RawDartFile[],
    _moduleRoot: string,
    workspaceRoot: string,
    packageMap: ReadonlyMap<string, string> = new Map()
  ): ArchJSON {
    const entities = this.mapEntities(files, workspaceRoot, packageMap);
    const relations = this.mapRelations(files, entities, workspaceRoot, packageMap);

    // Surface per-file parse degradation (extract_error / syntax_error) so CLI/
    // MCP consumers can tell a partial result from a clean one.
    const diagnostics = files.flatMap((f) => f.diagnostics ?? []);

    return {
      version: ARCHJSON_SCHEMA_VERSION,
      language: 'dart',
      timestamp: new Date().toISOString(),
      sourceFiles: files.map((f) => f.filePath),
      entities,
      relations,
      workspaceRoot,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Dotted package ID derived from the file's DIRECTORY (not the full path):
   * `lib/foo.dart` and `lib/bar.dart` share package `lib`, so a class in
   * `foo.dart` can resolve a type defined in `bar.dart` via `lib.<TypeName>`.
   * A `library foo.bar;` directive (rare) overrides this. The filename is
   * deliberately excluded — including it made every file its own package and
   * broke cross-file type resolution within the same directory.
   */
  private packageFor(
    file: RawDartFile,
    workspaceRoot: string,
    packageMap: ReadonlyMap<string, string>
  ): string {
    if (file.packageName) return file.packageName;
    const filePath = path.resolve(file.filePath);
    let best: { name: string; dir: string } | undefined;
    for (const [name, packageDir] of packageMap) {
      const dir = path.resolve(packageDir);
      if (filePath === dir || filePath.startsWith(`${dir}${path.sep}`)) {
        if (!best || dir.length > best.dir.length) best = { name, dir };
      }
    }
    if (best) return best.name;
    if (!workspaceRoot) return '';
    const rel = path.relative(workspaceRoot, file.filePath);
    if (!rel || rel.startsWith('..')) return '';
    const dir = path.dirname(rel);
    if (dir === '.' || dir === '') return '';
    const dotted = dir.replace(/[\\/]/g, '.');
    return dotted.replace(/^\.+|\.+$/g, '');
  }

  protected override createEntityId(packageName: string, entityName: string): string {
    return packageName ? `${packageName}.${entityName}` : entityName;
  }

  private mapMembers(rawMembers: RawDartMember[]): Member[] {
    return rawMembers.map((m) => this.mapMember(m));
  }

  private mapMember(m: RawDartMember): Member {
    const memberType: MemberType =
      m.kind === 'field' ? 'field' : m.kind === 'constructor' ? 'constructor' : 'method';

    const base: Member = {
      name: m.name,
      type: memberType,
      visibility: m.visibility,
      ...(m.isStatic ? { isStatic: true } : {}),
      ...(m.isFinal ? { isReadonly: true } : {}),
    };

    const mappedParams =
      m.parameters.length > 0
        ? m.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            ...(p.isRequired ? { isOptional: false } : {}),
            ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
          }))
        : undefined;

    if (m.kind === 'field' && m.type) {
      return { ...base, fieldType: m.type };
    }
    if ((m.kind === 'method' || m.kind === 'getter' || m.kind === 'setter') && m.type) {
      return { ...base, returnType: m.type, ...(mappedParams ? { parameters: mappedParams } : {}) };
    }
    if (m.kind === 'constructor') {
      return { ...base, ...(mappedParams ? { parameters: mappedParams } : {}) };
    }
    return base;
  }

  private extractTypeName(type: string): string {
    const genericIndex = type.indexOf('<');
    if (genericIndex > 0) return type.slice(0, genericIndex);
    const nullableIndex = type.indexOf('?');
    if (nullableIndex > 0) return type.slice(0, nullableIndex);
    return type.trim();
  }
}

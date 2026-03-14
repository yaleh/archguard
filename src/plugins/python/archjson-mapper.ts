/**
 * ArchJsonMapper for Python
 *
 * Maps Python raw AST data to ArchJSON format
 */

import path from 'path';
import type { ArchJSON, Entity, Member, Relation, Decorator, Visibility } from '@/types/index.js';
import type {
  PythonRawModule,
  PythonRawClass,
  PythonRawFunction,
  PythonRawMethod,
  PythonRawParameter,
  PythonRawImport,
  PythonRawAttribute,
} from './types.js';
import { BaseArchJsonMapper } from '@/plugins/shared/mapper-utils.js';
import type { ImportRelation } from './import-extractor.js';

/**
 * Maps Python raw AST data to ArchJSON format
 */
export class ArchJsonMapper extends BaseArchJsonMapper<PythonRawModule> {
  /**
   * Map multiple Python modules to ArchJSON.
   *
   * @param workspaceRoot - Absolute path of the project root. When provided,
   *   entity IDs use the dotted Python module path relative to this root
   *   (e.g. `myapp.engine.utils.MyClass`), and the value is written to the
   *   returned `workspaceRoot` field so downstream tools can resolve paths.
   * @param importRelations - Additional import relations from PythonImportExtractor.
   *   These are merged with the mapper-level relations (deduped).
   */
  mapModules(
    modules: PythonRawModule[],
    workspaceRoot?: string,
    importRelations: ImportRelation[] = []
  ): ArchJSON {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Pre-pass: build index of all known module IDs for import resolution
    const modulePathIndex = new Map<string, string>();
    for (const m of modules) {
      const modId = this.generateModuleId(m.name, m.filePath, workspaceRoot);
      modulePathIndex.set(modId, modId);
    }

    // Dedup set spanning all modules (keyed on "dependency:source:target")
    const seenDeps = new Set<string>();

    for (const module of modules) {
      const moduleResult = this.mapModule(module, workspaceRoot, modulePathIndex, seenDeps);
      entities.push(...moduleResult.entities);
      relations.push(...moduleResult.relations);
    }

    // Add additional import relations from PythonImportExtractor (deduplicated)
    for (const ir of importRelations) {
      const key = `dependency:${ir.sourceModuleId}:${ir.targetModuleId}`;
      if (!seenDeps.has(key)) {
        seenDeps.add(key);
        relations.push(
          this.createExplicitRelation('dependency', ir.sourceModuleId, ir.targetModuleId, {
            confidence: 1.0,
            inferenceSource: 'explicit',
          })
        );
      }
    }

    return {
      version: '1.0',
      language: 'python',
      timestamp: new Date().toISOString(),
      sourceFiles: modules.map((m) => m.filePath),
      entities,
      relations,
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
    };
  }

  /**
   * Map a single Python module to partial ArchJSON
   */
  mapModule(
    module: PythonRawModule,
    workspaceRoot?: string,
    modulePathIndex?: Map<string, string>,
    seenDeps?: Set<string>
  ): { entities: Entity[]; relations: Relation[] } {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Map classes
    for (const cls of module.classes) {
      const entity = this.mapClass(cls, module.name, workspaceRoot);
      entities.push(entity);

      // Create inheritance relations
      for (const baseClass of cls.baseClasses) {
        relations.push(this.createInheritanceRelation(entity.id, baseClass, cls.filePath));
      }
    }

    // Map module-level functions as entities
    for (const func of module.functions) {
      const entity = this.mapFunction(func, workspaceRoot);
      entities.push(entity);
    }

    // Map imports as dependency relations (only when module index is available)
    if (modulePathIndex) {
      for (const imp of module.imports) {
        const depRelation = this.createImportDependency(
          imp,
          module.filePath,
          module.name,
          workspaceRoot,
          modulePathIndex
        );
        if (depRelation) {
          const key = `dependency:${depRelation.source}:${depRelation.target}`;
          if (!seenDeps || !seenDeps.has(key)) {
            seenDeps?.add(key);
            relations.push(depRelation);
          }
        }
      }
    }

    return { entities, relations };
  }

  /**
   * Map Python class to Entity
   */
  private mapClass(cls: PythonRawClass, moduleName: string, workspaceRoot?: string): Entity {
    const members: Member[] = [];

    // Map methods
    for (const method of cls.methods) {
      members.push(this.mapMethod(method));
    }

    // Map properties
    for (const prop of cls.properties) {
      members.push(this.mapProperty(prop));
    }

    // Map class-level annotated fields (dataclass fields, type annotations)
    for (const attr of cls.classAttributes) {
      members.push(this.mapClassAttribute(attr));
    }

    // Determine visibility (Python doesn't have true access modifiers, but we can infer from naming)
    const visibility: Visibility = cls.name.startsWith('_') ? 'private' : 'public';

    // Map decorators
    const decorators: Decorator[] | undefined =
      cls.decorators.length > 0
        ? cls.decorators.map((d) => ({
            name: d.name,
            arguments: d.arguments,
          }))
        : undefined;

    return {
      id: this.generateEntityId(cls.name, moduleName, cls.filePath, workspaceRoot),
      name: cls.name,
      type: 'class',
      visibility,
      members,
      sourceLocation: this.createSourceLocation(cls.filePath, cls.startLine, cls.endLine),
      decorators,
      extends: cls.baseClasses.length > 0 ? cls.baseClasses : undefined,
    };
  }

  /**
   * Map Python method to Member
   */
  private mapMethod(method: PythonRawMethod): Member {
    const visibility: Visibility = method.isPrivate ? 'private' : 'public';

    const parameters = method.parameters.map((p) => this.mapParameter(p));

    const decorators: Decorator[] | undefined =
      method.decorators.length > 0
        ? method.decorators.map((d) => ({
            name: d.name,
            arguments: d.arguments,
          }))
        : undefined;

    return {
      name: method.name,
      type: 'method',
      visibility,
      returnType: method.returnType,
      parameters,
      isStatic: method.isStaticMethod,
      isAsync: method.isAsync,
      decorators,
    };
  }

  /**
   * Map Python property to Member
   */
  private mapProperty(prop: {
    name: string;
    type?: string;
    decorators: Array<{ name: string }>;
  }): Member {
    const decorators: Decorator[] | undefined =
      prop.decorators.length > 0 ? prop.decorators.map((d) => ({ name: d.name })) : undefined;

    return {
      name: prop.name,
      type: 'property',
      visibility: 'public',
      returnType: prop.type,
      decorators,
    };
  }

  /**
   * Map a PythonRawAttribute (class-level annotated assignment) to a Member.
   *
   * Visibility is inferred from the leading underscore convention:
   *   _name → private, __name → private (dunder-private), name → public
   */
  private mapClassAttribute(attr: PythonRawAttribute): Member {
    const visibility: Visibility = attr.isPrivate ? 'private' : 'public';

    return {
      name: attr.name,
      type: 'field',
      visibility,
      fieldType: attr.type,
    };
  }

  /**
   * Map Python function to Entity (module-level function)
   */
  private mapFunction(func: PythonRawFunction, workspaceRoot?: string): Entity {
    const visibility: Visibility = func.name.startsWith('_') ? 'private' : 'public';

    const parameters = func.parameters.map((p) => this.mapParameter(p));

    const decorators: Decorator[] | undefined =
      func.decorators.length > 0
        ? func.decorators.map((d) => ({
            name: d.name,
            arguments: d.arguments,
          }))
        : undefined;

    // Module-level functions are represented as entities with a single member.
    // Decorators are intentionally omitted from the member to avoid double-counting
    // when callers aggregate decorators across both entity and member levels (P0.3).
    const member: Member = {
      name: func.name,
      type: 'method',
      visibility,
      returnType: func.returnType,
      parameters,
      isAsync: func.isAsync,
    };

    return {
      id: this.generateEntityId(func.name, func.moduleName, func.filePath, workspaceRoot),
      name: func.name,
      type: 'function',
      visibility,
      members: [member],
      sourceLocation: this.createSourceLocation(func.filePath, func.startLine, func.endLine),
      decorators,
    };
  }

  /**
   * Map Python parameter to Parameter
   */
  private mapParameter(param: PythonRawParameter) {
    return this.mapParameters(
      [
        {
          name: param.name,
          type: param.type,
          isOptional: param.defaultValue !== undefined,
          defaultValue: param.defaultValue,
        },
      ],
      'any'
    )[0];
  }

  /**
   * Create inheritance relation
   */
  private createInheritanceRelation(
    sourceId: string,
    baseClassName: string,
    _filePath: string
  ): Relation {
    return this.createExplicitRelation('inheritance', sourceId, baseClassName, {
      confidence: 1.0,
      inferenceSource: 'explicit',
    });
  }

  /**
   * Create dependency relation from import, resolving the target against
   * the known module index. Returns null when the import cannot be resolved
   * to a known project module (stdlib, third-party, unresolvable relative).
   */
  private createImportDependency(
    imp: PythonRawImport,
    filePath: string,
    moduleName: string,
    workspaceRoot: string | undefined,
    modulePathIndex: Map<string, string>
  ): Relation | null {
    // Strip " as <alias>" suffix emitted verbatim by tree-sitter for "import X as Y"
    const rawModule = imp.module.replace(/ as \w+$/, '');

    // Resolve to a known module ID
    let targetId: string | null;
    if (rawModule.startsWith('.')) {
      targetId = this.resolveRelativeImport(rawModule, filePath, workspaceRoot, modulePathIndex);
    } else {
      targetId = this.resolveAbsoluteImport(rawModule, modulePathIndex);
    }
    if (!targetId) return null;

    const sourceId = this.generateModuleId(moduleName, filePath, workspaceRoot);
    if (sourceId === targetId) return null; // self-import guard

    return this.createExplicitRelation('dependency', sourceId, targetId, {
      confidence: 1.0,
      inferenceSource: 'explicit',
    });
  }

  /**
   * Resolve an absolute dotted import path to a known module ID.
   *
   * Uses two-dimensional fallback:
   *   1. Right-side truncation: "lmdeploy.models.MyClass" → "lmdeploy.models" → "lmdeploy"
   *   2. Left-side prefix stripping (project root removal): when sources are at
   *      /project/mypackage/, known IDs lack the "mypackage." prefix, so
   *      "mypackage.sub.module" → try "sub.module" → "sub"
   *
   * This fixes missing cross-package arrows when code uses absolute imports
   * including the project root package name (e.g. `from lmdeploy.pytorch import X`)
   * but module IDs are relative to the sources directory (e.g. `pytorch`).
   */
  private resolveAbsoluteImport(
    dottedPath: string,
    modulePathIndex: Map<string, string>
  ): string | null {
    const parts = dottedPath.split('.');
    // Try all left-prefix strip levels (0 = no strip, 1 = strip first component, etc.)
    for (let leftStrip = 0; leftStrip < parts.length; leftStrip++) {
      const remaining = parts.slice(leftStrip);
      // Try all right-side truncations
      for (let rightLen = remaining.length; rightLen > 0; rightLen--) {
        const candidate = remaining.slice(0, rightLen).join('.');
        if (modulePathIndex.has(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * Resolve a relative import path (starts with ".") to a known module ID.
   * Returns null when workspaceRoot is absent.
   */
  private resolveRelativeImport(
    rawModule: string,
    sourceFilePath: string,
    workspaceRoot: string | undefined,
    modulePathIndex: Map<string, string>
  ): string | null {
    if (!workspaceRoot) return null;

    const dots = rawModule.match(/^\.+/)?.[0] ?? '.';
    const dotCount = dots.length;
    const suffix = rawModule.slice(dotCount); // "" for ".", "utils" for ".utils"

    // Start at sourceFile's directory; move up (dotCount-1) levels
    let baseDir = path.dirname(sourceFilePath);
    for (let i = 1; i < dotCount; i++) {
      baseDir = path.dirname(baseDir);
    }

    const resolvedDir = suffix ? path.join(baseDir, ...suffix.split('.')) : baseDir;
    const relDir = path.relative(workspaceRoot, resolvedDir).replace(/\\/g, '/');
    const dottedDir = relDir.replace(/\//g, '.');

    if (modulePathIndex.has(dottedDir)) return dottedDir;
    return null;
  }

  /**
   * Generate unique entity ID.
   *
   * When `workspaceRoot` is provided, derives a stable dotted Python module
   * path from the file path relative to the root, e.g.
   *   `/project/myapp/models/user.py`  →  `myapp.models.user.User`
   *   `/project/myapp/engine/__init__.py` → `myapp.engine.Engine`
   *
   * Falls back to the bare `moduleName.entityName` format when no root is set.
   */
  private generateEntityId(
    name: string,
    moduleName: string,
    filePath: string,
    workspaceRoot?: string
  ): string {
    if (!workspaceRoot) {
      return `${moduleName}.${name}`;
    }
    const rel = path.relative(workspaceRoot, filePath); // e.g. myapp/models/user.py
    const withoutExt = rel.replace(/\.py$/, ''); // myapp/models/user
    // __init__ → use parent directory (myapp/engine/__init__ → myapp/engine)
    const normalised = withoutExt.replace(/(\/|^)__init__$/, '');
    const dotted = normalised.replace(/\//g, '.');
    return `${dotted}.${name}`;
  }

  /**
   * Generate module ID for dependency relations.
   *
   * Uses the same dotted-path derivation as generateEntityId (without the
   * entity name suffix) so that relation source IDs are consistent with entity
   * IDs and cycle detection can traverse the graph correctly.
   */
  private generateModuleId(moduleName: string, filePath: string, workspaceRoot?: string): string {
    if (!workspaceRoot) {
      return moduleName;
    }
    const rel = path.relative(workspaceRoot, filePath);
    const withoutExt = rel.replace(/\.py$/, '');
    const normalised = withoutExt.replace(/(\/|^)__init__$/, '');
    return normalised.replace(/\//g, '.');
  }
}

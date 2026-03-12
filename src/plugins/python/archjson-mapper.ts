/**
 * ArchJsonMapper for Python
 *
 * Maps Python raw AST data to ArchJSON format
 */

import path from 'path';
import type {
  ArchJSON,
  Entity,
  Member,
  Relation,
  Decorator,
  Visibility,
} from '@/types/index.js';
import type {
  PythonRawModule,
  PythonRawClass,
  PythonRawFunction,
  PythonRawMethod,
  PythonRawParameter,
  PythonRawImport,
} from './types.js';
import { BaseArchJsonMapper } from '@/plugins/shared/mapper-utils.js';

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
   */
  mapModules(modules: PythonRawModule[], workspaceRoot?: string): ArchJSON {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    for (const module of modules) {
      const moduleResult = this.mapModule(module, workspaceRoot);
      entities.push(...moduleResult.entities);
      relations.push(...moduleResult.relations);
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
    workspaceRoot?: string
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

    // Map imports as dependency relations
    for (const imp of module.imports) {
      const depRelation = this.createImportDependency(imp, module.filePath, module.name, workspaceRoot);
      if (depRelation) {
        relations.push(depRelation);
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
   * Create dependency relation from import
   */
  private createImportDependency(
    imp: PythonRawImport,
    filePath: string,
    moduleName: string,
    workspaceRoot?: string
  ): Relation | null {
    // Create a relation for the module itself
    // The source is a pseudo-entity representing the module
    const sourceId = this.generateModuleId(moduleName, filePath, workspaceRoot);

    return this.createExplicitRelation('dependency', sourceId, imp.module, {
      confidence: 1.0,
      inferenceSource: 'explicit',
    });
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
    const withoutExt = rel.replace(/\.py$/, '');        // myapp/models/user
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

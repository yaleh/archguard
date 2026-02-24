/**
 * ArchJsonMapper for Python
 *
 * Maps Python raw AST data to ArchJSON format
 */

import type {
  ArchJSON,
  Entity,
  Member,
  Relation,
  SourceLocation,
  Decorator,
  Parameter,
  Visibility,
  RelationType,
} from '@/types/index.js';
import type {
  PythonRawModule,
  PythonRawClass,
  PythonRawFunction,
  PythonRawMethod,
  PythonRawParameter,
  PythonRawImport,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Maps Python raw AST data to ArchJSON format
 */
export class ArchJsonMapper {
  /**
   * Map multiple Python modules to ArchJSON
   */
  mapModules(modules: PythonRawModule[]): ArchJSON {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    for (const module of modules) {
      const moduleResult = this.mapModule(module);
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
    };
  }

  /**
   * Map a single Python module to partial ArchJSON
   */
  mapModule(module: PythonRawModule): { entities: Entity[]; relations: Relation[] } {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Map classes
    for (const cls of module.classes) {
      const entity = this.mapClass(cls, module.name);
      entities.push(entity);

      // Create inheritance relations
      for (const baseClass of cls.baseClasses) {
        relations.push(this.createInheritanceRelation(entity.id, baseClass, cls.filePath));
      }
    }

    // Map module-level functions as entities
    for (const func of module.functions) {
      const entity = this.mapFunction(func);
      entities.push(entity);
    }

    // Map imports as dependency relations
    for (const imp of module.imports) {
      const depRelation = this.createImportDependency(imp, module.filePath, module.name);
      if (depRelation) {
        relations.push(depRelation);
      }
    }

    return { entities, relations };
  }

  /**
   * Map Python class to Entity
   */
  private mapClass(cls: PythonRawClass, moduleName: string): Entity {
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
      id: this.generateEntityId(cls.name, moduleName, cls.filePath),
      name: cls.name,
      type: 'class',
      visibility,
      members,
      sourceLocation: {
        file: cls.filePath,
        startLine: cls.startLine,
        endLine: cls.endLine,
      },
      decorators,
      extends: cls.baseClasses.length > 0 ? cls.baseClasses : undefined,
    };
  }

  /**
   * Map Python method to Member
   */
  private mapMethod(method: PythonRawMethod): Member {
    const visibility: Visibility = method.isPrivate ? 'private' : 'public';

    const parameters: Parameter[] = method.parameters.map((p) => this.mapParameter(p));

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
  private mapFunction(func: PythonRawFunction): Entity {
    const visibility: Visibility = func.name.startsWith('_') ? 'private' : 'public';

    const parameters: Parameter[] = func.parameters.map((p) => this.mapParameter(p));

    const decorators: Decorator[] | undefined =
      func.decorators.length > 0
        ? func.decorators.map((d) => ({
            name: d.name,
            arguments: d.arguments,
          }))
        : undefined;

    // Module-level functions are represented as entities with a single member
    const member: Member = {
      name: func.name,
      type: 'method',
      visibility,
      returnType: func.returnType,
      parameters,
      isAsync: func.isAsync,
      decorators,
    };

    return {
      id: this.generateEntityId(func.name, func.moduleName, func.filePath),
      name: func.name,
      type: 'function',
      visibility,
      members: [member],
      sourceLocation: {
        file: func.filePath,
        startLine: func.startLine,
        endLine: func.endLine,
      },
      decorators,
    };
  }

  /**
   * Map Python parameter to Parameter
   */
  private mapParameter(param: PythonRawParameter): Parameter {
    return {
      name: param.name,
      type: param.type || 'any',
      isOptional: param.defaultValue !== undefined,
      defaultValue: param.defaultValue,
    };
  }

  /**
   * Create inheritance relation
   */
  private createInheritanceRelation(
    sourceId: string,
    baseClassName: string,
    filePath: string
  ): Relation {
    return {
      id: uuidv4(),
      type: 'inheritance' as RelationType,
      source: sourceId,
      target: baseClassName, // Will be resolved to full ID later if the base class is in scope
      confidence: 1.0,
      inferenceSource: 'explicit',
    };
  }

  /**
   * Create dependency relation from import
   */
  private createImportDependency(
    imp: PythonRawImport,
    filePath: string,
    moduleName: string
  ): Relation | null {
    // Create a relation for the module itself
    // The source is a pseudo-entity representing the module
    const sourceId = this.generateModuleId(moduleName, filePath);

    return {
      id: uuidv4(),
      type: 'dependency' as RelationType,
      source: sourceId,
      target: imp.module,
      confidence: 1.0,
      inferenceSource: 'explicit',
    };
  }

  /**
   * Generate unique entity ID
   */
  private generateEntityId(name: string, moduleName: string, filePath: string): string {
    // Use module.name format for unique identification
    return `${moduleName}.${name}`;
  }

  /**
   * Generate module ID for dependency relations
   */
  private generateModuleId(moduleName: string, filePath: string): string {
    return `module:${moduleName}`;
  }
}

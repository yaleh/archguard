/**
 * ClassExtractor - Extracts class information from TypeScript source code
 * Story 1: Basic Class Extraction
 */

import {
  Project,
  type ClassDeclaration,
  type MethodDeclaration,
  type PropertyDeclaration,
  type ConstructorDeclaration,
  type Decorator as TsMorphDecorator,
  SyntaxKind,
} from 'ts-morph';
import type { Entity, Visibility, Member, Parameter, Decorator } from '@/types';

/**
 * Extracts class entities from TypeScript code using ts-morph
 */
export class ClassExtractor {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
  }

  /**
   * Extract class entity from TypeScript code
   * @param code - TypeScript source code string
   * @param filePath - Source file path (default: 'test.ts')
   * @returns Entity representing the class
   * @throws Error if no class found in the code
   */
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const classDecl = sourceFile.getClasses()[0];

    if (!classDecl) {
      throw new Error('No class found in code');
    }

    return this.extractClass(classDecl, filePath);
  }

  /**
   * Extract entity information from a ClassDeclaration node
   * @param classDecl - ts-morph ClassDeclaration node
   * @param filePath - Source file path
   * @returns Entity object
   */
  private extractClass(classDecl: ClassDeclaration, filePath: string): Entity {
    const name = classDecl.getName() || 'Anonymous';

    return {
      id: name,
      name,
      type: 'class',
      visibility: this.getVisibility(classDecl),
      isAbstract: classDecl.isAbstract(),
      members: this.extractMembers(classDecl),
      decorators: this.extractDecorators(classDecl.getDecorators()),
      genericParams: this.extractGenericParams(classDecl),
      sourceLocation: {
        file: filePath,
        startLine: classDecl.getStartLineNumber(),
        endLine: classDecl.getEndLineNumber(),
      },
    };
  }

  /**
   * Determine visibility of a class
   * TypeScript classes are public by default
   * Export modifier makes them accessible outside the module
   * @returns Visibility level
   */
  private getVisibility(_classDecl: ClassDeclaration): Visibility {
    // In TypeScript, all classes are essentially public
    // Export keyword controls module-level accessibility but doesn't change class visibility
    return 'public';
  }

  /**
   * Extract generic type parameters from a class
   * @param classDecl - ClassDeclaration node
   * @returns Array of generic parameter names, or undefined if none
   */
  private extractGenericParams(classDecl: ClassDeclaration): string[] | undefined {
    const typeParams = classDecl.getTypeParameters();

    if (typeParams.length === 0) {
      return undefined;
    }

    return typeParams.map((param) => param.getName());
  }

  /**
   * Extract all members (properties, methods, constructors) from a class
   * @param classDecl - ClassDeclaration node
   * @returns Array of Member objects
   */
  private extractMembers(classDecl: ClassDeclaration): Member[] {
    const members: Member[] = [];

    // Extract properties
    for (const property of classDecl.getProperties()) {
      members.push(this.extractProperty(property));
    }

    // Extract methods
    for (const method of classDecl.getMethods()) {
      members.push(this.extractMethod(method));
    }

    // Extract constructors
    for (const constructor of classDecl.getConstructors()) {
      members.push(this.extractConstructor(constructor));
    }

    return members;
  }

  /**
   * Extract property information
   * @param property - PropertyDeclaration node
   * @returns Member object representing the property
   */
  private extractProperty(property: PropertyDeclaration): Member {
    const initializer = property.getInitializer();

    return {
      name: property.getName(),
      type: 'property',
      visibility: this.getMemberVisibility(property),
      fieldType: property.getType().getText(),
      isStatic: property.isStatic(),
      isReadonly: property.isReadonly(),
      defaultValue: initializer?.getText(),
      decorators: this.extractDecorators(property.getDecorators()),
    };
  }

  /**
   * Extract method information
   * @param method - MethodDeclaration node
   * @returns Member object representing the method
   */
  private extractMethod(method: MethodDeclaration): Member {
    return {
      name: method.getName(),
      type: 'method',
      visibility: this.getMemberVisibility(method),
      isStatic: method.isStatic(),
      isAsync: method.isAsync(),
      isAbstract: method.isAbstract(),
      parameters: this.extractParameters(method),
      returnType: method.getReturnType().getText(),
      decorators: this.extractDecorators(method.getDecorators()),
    };
  }

  /**
   * Extract constructor information
   * @param constructor - ConstructorDeclaration node
   * @returns Member object representing the constructor
   */
  private extractConstructor(constructor: ConstructorDeclaration): Member {
    return {
      name: 'constructor',
      type: 'constructor',
      visibility: this.getConstructorVisibility(constructor),
      parameters: this.extractParameters(constructor),
    };
  }

  /**
   * Extract parameters from a method or constructor
   * @param node - MethodDeclaration or ConstructorDeclaration
   * @returns Array of Parameter objects
   */
  private extractParameters(node: MethodDeclaration | ConstructorDeclaration): Parameter[] {
    return node.getParameters().map((param) => {
      const initializer = param.getInitializer();

      return {
        name: param.getName(),
        type: param.getType().getText(),
        isOptional: param.isOptional() || param.hasInitializer(),
        defaultValue: initializer?.getText(),
      };
    });
  }

  /**
   * Determine visibility of a class member
   * @param node - Property or Method declaration
   * @returns Visibility level
   */
  private getMemberVisibility(node: PropertyDeclaration | MethodDeclaration): Visibility {
    const modifiers = node.getModifiers();

    for (const modifier of modifiers) {
      const kind = modifier.getKind();
      if (kind === SyntaxKind.PrivateKeyword) return 'private';
      if (kind === SyntaxKind.ProtectedKeyword) return 'protected';
      if (kind === SyntaxKind.PublicKeyword) return 'public';
    }

    // Default visibility in TypeScript is public
    return 'public';
  }

  /**
   * Determine visibility of a constructor
   * @param constructor - ConstructorDeclaration
   * @returns Visibility level
   */
  private getConstructorVisibility(constructor: ConstructorDeclaration): Visibility {
    const modifiers = constructor.getModifiers();

    for (const modifier of modifiers) {
      const kind = modifier.getKind();
      if (kind === SyntaxKind.PrivateKeyword) return 'private';
      if (kind === SyntaxKind.ProtectedKeyword) return 'protected';
      if (kind === SyntaxKind.PublicKeyword) return 'public';
    }

    return 'public';
  }

  /**
   * Extract decorators from a node
   * @param decorators - Array of ts-morph Decorator nodes
   * @returns Array of Decorator objects
   */
  private extractDecorators(decorators: TsMorphDecorator[]): Decorator[] {
    if (decorators.length === 0) {
      return [];
    }

    return decorators.map((decorator) => {
      const name = decorator.getName();
      const args = decorator.getArguments();

      const result: Decorator = {
        name,
      };

      if (args.length > 0) {
        result.arguments = args.map((arg) => arg.getText());
      }

      return result;
    });
  }
}

/**
 * InterfaceExtractor - Extracts interface information from TypeScript source code
 * Story 3: Interface & Enum Support
 */

import {
  Project,
  type InterfaceDeclaration,
  type PropertySignature,
  type MethodSignature,
} from 'ts-morph';
import type { Entity, Member, Parameter } from '@/types';

/**
 * Extracts interface entities from TypeScript code using ts-morph
 */
export class InterfaceExtractor {
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
   * Extract interface entity from TypeScript code
   * @param code - TypeScript source code string
   * @param filePath - Source file path (default: 'test.ts')
   * @returns Entity representing the interface
   * @throws Error if no interface found in the code
   */
  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    const interfaceDecl = sourceFile.getInterfaces()[0];

    if (!interfaceDecl) {
      throw new Error('No interface found in code');
    }

    return this.extractInterface(interfaceDecl, filePath);
  }

  /**
   * Extract entity information from an InterfaceDeclaration node
   * @param interfaceDecl - ts-morph InterfaceDeclaration node
   * @param filePath - Source file path
   * @returns Entity object
   */
  extractInterface(interfaceDecl: InterfaceDeclaration, filePath: string): Entity {
    const name = interfaceDecl.getName();

    return {
      id: name,
      name,
      type: 'interface',
      visibility: 'public',
      members: this.extractMembers(interfaceDecl),
      decorators: [],
      extends: this.extractExtends(interfaceDecl),
      genericParams: this.extractGenericParams(interfaceDecl),
      sourceLocation: {
        file: filePath,
        startLine: interfaceDecl.getStartLineNumber(),
        endLine: interfaceDecl.getEndLineNumber(),
      },
    };
  }

  /**
   * Extract extends clause from interface
   * @param interfaceDecl - InterfaceDeclaration node
   * @returns Array of extended interface names, or undefined if none
   */
  private extractExtends(interfaceDecl: InterfaceDeclaration): string[] | undefined {
    const extendsExpressions = interfaceDecl.getExtends();

    if (extendsExpressions.length === 0) {
      return undefined;
    }

    return extendsExpressions.map((expr) => expr.getExpression().getText());
  }

  /**
   * Extract generic type parameters from an interface
   * @param interfaceDecl - InterfaceDeclaration node
   * @returns Array of generic parameter names, or undefined if none
   */
  private extractGenericParams(interfaceDecl: InterfaceDeclaration): string[] | undefined {
    const typeParams = interfaceDecl.getTypeParameters();

    if (typeParams.length === 0) {
      return undefined;
    }

    return typeParams.map((param) => param.getName());
  }

  /**
   * Extract all members (properties and method signatures) from an interface
   * @param interfaceDecl - InterfaceDeclaration node
   * @returns Array of Member objects
   */
  private extractMembers(interfaceDecl: InterfaceDeclaration): Member[] {
    const members: Member[] = [];

    // Extract property signatures
    for (const property of interfaceDecl.getProperties()) {
      members.push(this.extractPropertySignature(property));
    }

    // Extract method signatures
    for (const method of interfaceDecl.getMethods()) {
      members.push(this.extractMethodSignature(method));
    }

    return members;
  }

  /**
   * Extract property signature information
   * @param property - PropertySignature node
   * @returns Member object representing the property
   */
  private extractPropertySignature(property: PropertySignature): Member {
    const member: Member = {
      name: property.getName(),
      type: 'property',
      visibility: 'public',
      fieldType: property.getType().getText(),
      isReadonly: property.isReadonly(),
    };

    if (property.hasQuestionToken()) {
      member.isOptional = true;
    }

    return member;
  }

  /**
   * Extract method signature information
   * @param method - MethodSignature node
   * @returns Member object representing the method
   */
  private extractMethodSignature(method: MethodSignature): Member {
    return {
      name: method.getName(),
      type: 'method',
      visibility: 'public',
      parameters: this.extractParameters(method),
      returnType: method.getReturnType().getText(),
    };
  }

  /**
   * Extract parameters from a method signature
   * @param method - MethodSignature
   * @returns Array of Parameter objects
   */
  private extractParameters(method: MethodSignature): Parameter[] {
    return method.getParameters().map((param) => {
      const initializer = param.getInitializer();

      return {
        name: param.getName(),
        type: param.getType().getText(),
        isOptional: param.isOptional() || param.hasInitializer(),
        defaultValue: initializer?.getText(),
      };
    });
  }
}

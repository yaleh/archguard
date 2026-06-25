/**
 * Tree-sitter bridge for Python language parsing
 *
 * Uses tree-sitter-python to parse Python source code into raw AST data
 */

import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import path from 'path';
import type {
  PythonRawModule,
  PythonRawClass,
  PythonRawFunction,
  PythonRawMethod,
  PythonRawParameter,
  PythonRawDecorator,
  PythonRawImport,
  PythonRawAttribute,
  PythonRawCallSite,
} from './types.js';

export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    // @ts-expect-error -- tree-sitter language definition type incompatibility
    this.parser.setLanguage(Python);
  }

  /**
   * Parse a single Python source file
   */
  parseCode(code: string, filePath: string): PythonRawModule {
    const tree = this.parser.parse(code);
    const rootNode = tree.rootNode;

    // Extract module name from file path
    const moduleName = this.extractModuleName(filePath);

    // Extract declarations
    const classes: PythonRawClass[] = [];
    const functions: PythonRawFunction[] = [];
    const imports: PythonRawImport[] = [];

    // Process all top-level declarations
    for (const child of rootNode.namedChildren) {
      try {
        if (child.type === 'class_definition') {
          const cls = this.extractClass(child, moduleName, code, filePath);
          if (cls) classes.push(cls);
        } else if (child.type === 'function_definition') {
          const func = this.extractFunction(child, moduleName, code, filePath);
          if (func) functions.push(func);
        } else if (child.type === 'decorated_definition') {
          // Decorated class or function
          const decorators = this.extractDecorators(child, code);
          const definition = child.childForFieldName('definition');

          if (definition?.type === 'class_definition') {
            const cls = this.extractClass(definition, moduleName, code, filePath);
            if (cls) {
              cls.decorators = decorators;
              classes.push(cls);
            }
          } else if (definition?.type === 'function_definition') {
            const func = this.extractFunction(definition, moduleName, code, filePath);
            if (func) {
              func.decorators = decorators;
              functions.push(func);
            }
          }
        } else if (child.type === 'import_statement' || child.type === 'import_from_statement') {
          const imp = this.extractImport(child, code);
          if (imp) imports.push(imp);
        }
      } catch (error) {
        // Skip errors in individual declarations
        console.warn(`Error parsing declaration in ${filePath}:`, error);
      }
    }

    return {
      name: moduleName,
      filePath,
      classes,
      functions,
      imports,
    };
  }

  /**
   * Extract module name from file path
   */
  private extractModuleName(filePath: string): string {
    const fileName = path.basename(filePath, '.py');
    return fileName;
  }

  /**
   * Extract class definition
   */
  private extractClass(
    node: Parser.SyntaxNode,
    moduleName: string,
    code: string,
    filePath: string
  ): PythonRawClass | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const className = code.substring(nameNode.startIndex, nameNode.endIndex);

    // Extract base classes
    const baseClasses: string[] = [];
    const superclasses = node.childForFieldName('superclasses');
    if (superclasses) {
      for (const arg of superclasses.namedChildren) {
        if (arg.type === 'identifier' || arg.type === 'attribute') {
          baseClasses.push(code.substring(arg.startIndex, arg.endIndex));
        }
      }
    }

    // Extract class body
    const body = node.childForFieldName('body');
    const methods: PythonRawMethod[] = [];
    const classAttributes: PythonRawAttribute[] = [];

    if (body) {
      for (const child of body.namedChildren) {
        try {
          if (child.type === 'function_definition') {
            const method = this.extractMethod(child, code);
            if (method) methods.push(method);
          } else if (child.type === 'decorated_definition') {
            const decorators = this.extractDecorators(child, code);
            const definition = child.childForFieldName('definition');

            if (definition?.type === 'function_definition') {
              const method = this.extractMethod(definition, code);
              if (method) {
                method.decorators = decorators;
                // Check for special decorators
                for (const dec of decorators) {
                  if (dec.name === 'property') method.isProperty = true;
                  if (dec.name === 'classmethod') method.isClassMethod = true;
                  if (dec.name === 'staticmethod') method.isStaticMethod = true;
                }
                methods.push(method);
              }
            }
          } else if (child.type === 'expression_statement') {
            // Annotated assignment: `field: Type [= default]`
            // In tree-sitter-python these appear as expression_statement > assignment (with type field)
            const inner = child.namedChildCount > 0 ? child.namedChild(0) : null;
            if (inner?.type === 'assignment') {
              const attr = this.extractAnnotatedAssignment(inner, code);
              if (attr) classAttributes.push(attr);
            }
          }
        } catch (error) {
          // Skip errors in individual methods
          console.warn(`Error parsing method in class ${className}:`, error);
        }
      }
    }

    // Extract docstring
    const docstring = this.extractDocstring(body, code);

    return {
      name: className,
      moduleName,
      baseClasses,
      methods,
      properties: [],
      classAttributes,
      decorators: [],
      docstring,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Extract method definition
   */
  private extractMethod(node: Parser.SyntaxNode, code: string): PythonRawMethod | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const methodName = code.substring(nameNode.startIndex, nameNode.endIndex);

    // Extract parameters
    const parameters = this.extractParameters(node, code);

    // Extract return type
    const returnType = this.extractReturnType(node, code);

    // Check if async
    const isAsync = node.children.some((c) => c.type === 'async');

    // Check if private (__ prefix)
    const isPrivate = methodName.startsWith('__') && !methodName.endsWith('__');

    // Extract docstring
    const body = node.childForFieldName('body');
    const docstring = this.extractDocstring(body, code);

    // Extract call sites from method body
    const callSites = body ? this.extractCallSites(body, code, methodName) : undefined;

    return {
      name: methodName,
      parameters,
      returnType,
      decorators: [],
      isClassMethod: false,
      isStaticMethod: false,
      isProperty: false,
      isAsync,
      isPrivate,
      docstring,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      callSites: callSites && callSites.length > 0 ? callSites : undefined,
    };
  }

  /**
   * Extract call sites from a method body.
   * Only captures self.field.method() patterns (one-level field access via self).
   * Skips standalone function calls and same-class self.method() calls.
   */
  private extractCallSites(
    bodyNode: Parser.SyntaxNode,
    code: string,
    callerMethodName: string
  ): PythonRawCallSite[] {
    const sites: PythonRawCallSite[] = [];

    const calls = bodyNode.descendantsOfType('call');
    for (const call of calls) {
      const funcNode = call.childForFieldName('function');
      if (!funcNode) continue;

      // Must be an attribute access (e.g. self.payment_service.charge)
      if (funcNode.type !== 'attribute') continue;

      const objectNode = funcNode.childForFieldName('object');
      const attrNode = funcNode.childForFieldName('attribute');
      if (!objectNode || !attrNode) continue;

      const methodName = code.substring(attrNode.startIndex, attrNode.endIndex);

      // Must be self.field pattern (receiver is an attribute node whose object is 'self')
      // e.g. self.payment_service → objectNode.type === 'attribute', object='self', attribute='payment_service'
      // If objectNode is not 'attribute', it's a direct self call or standalone → skip
      if (objectNode.type !== 'attribute') {
        continue;
      }

      // Check the inner object is 'self'
      const innerObject = objectNode.childForFieldName('object');
      const innerAttr = objectNode.childForFieldName('attribute');
      if (!innerObject || !innerAttr) continue;

      const innerObjectText = code.substring(innerObject.startIndex, innerObject.endIndex);
      if (innerObjectText !== 'self') continue;

      const fieldName = code.substring(innerAttr.startIndex, innerAttr.endIndex);

      sites.push({
        receiverField: fieldName,
        methodName,
        callerMethod: callerMethodName,
      });
    }

    return sites;
  }

  /**
   * Extract a class-level annotated assignment as a PythonRawAttribute.
   *
   * In tree-sitter-python, `field: Type [= default]` inside a class body appears as:
   *   expression_statement
   *     assignment (with a 'type' field present)
   *       left: identifier       → 'field'
   *       type: type node        → 'Optional[int]'
   *       right: ...             → default value (optional)
   *
   * This method receives the inner `assignment` node.
   * Returns null when the node has no type annotation (plain assignment, not typed)
   * or when the left-hand side is not a simple identifier (e.g. self.x).
   */
  private extractAnnotatedAssignment(
    node: Parser.SyntaxNode,
    code: string
  ): PythonRawAttribute | null {
    try {
      // Only handle annotated assignments (those with a 'type' field)
      const typeNode = node.childForFieldName('type');
      if (!typeNode) return null;

      // Extract field name from 'left' field
      const leftNode = node.childForFieldName('left');
      if (!leftNode) return null;

      const name = code.substring(leftNode.startIndex, leftNode.endIndex).trim();
      // Skip names that are not simple identifiers (e.g., 'self.x' — these are instance attrs)
      if (name.includes('.')) return null;

      // Extract type annotation text
      const fieldType = code.substring(typeNode.startIndex, typeNode.endIndex).trim();

      return {
        name,
        type: fieldType,
        isPrivate: name.startsWith('_'),
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract function definition
   */
  private extractFunction(
    node: Parser.SyntaxNode,
    moduleName: string,
    code: string,
    filePath: string
  ): PythonRawFunction | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const funcName = code.substring(nameNode.startIndex, nameNode.endIndex);

    // Extract parameters
    const parameters = this.extractParameters(node, code);

    // Extract return type
    const returnType = this.extractReturnType(node, code);

    // Check if async
    const isAsync = node.children.some((c) => c.type === 'async');

    // Extract docstring
    const body = node.childForFieldName('body');
    const docstring = this.extractDocstring(body, code);

    return {
      name: funcName,
      moduleName,
      parameters,
      returnType,
      decorators: [],
      isAsync,
      docstring,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Extract function/method parameters
   */
  private extractParameters(node: Parser.SyntaxNode, code: string): PythonRawParameter[] {
    const parameters: PythonRawParameter[] = [];
    const paramsNode = node.childForFieldName('parameters');

    if (!paramsNode) return parameters;

    for (const child of paramsNode.namedChildren) {
      try {
        if (child.type === 'identifier') {
          // Simple parameter (e.g., self, x, y)
          parameters.push({
            name: code.substring(child.startIndex, child.endIndex),
            isVarArgs: false,
            isKwArgs: false,
          });
        } else if (child.type === 'typed_parameter') {
          // Parameter with type hint (e.g., name: str)
          const identifiers = child.descendantsOfType('identifier');
          const typeNode = child.childForFieldName('type');

          if (identifiers.length > 0) {
            parameters.push({
              name: code.substring(identifiers[0].startIndex, identifiers[0].endIndex),
              type: typeNode ? code.substring(typeNode.startIndex, typeNode.endIndex) : undefined,
              isVarArgs: false,
              isKwArgs: false,
            });
          }
        } else if (child.type === 'typed_default_parameter') {
          // Typed parameter with default value (e.g., name: str = "World")
          const identifiers = child.descendantsOfType('identifier');
          const typeNode = child.childForFieldName('type');
          const valueNode = child.childForFieldName('value');

          if (identifiers.length > 0) {
            parameters.push({
              name: code.substring(identifiers[0].startIndex, identifiers[0].endIndex),
              type: typeNode ? code.substring(typeNode.startIndex, typeNode.endIndex) : undefined,
              defaultValue: valueNode
                ? code.substring(valueNode.startIndex, valueNode.endIndex)
                : undefined,
              isVarArgs: false,
              isKwArgs: false,
            });
          }
        } else if (child.type === 'default_parameter') {
          // Parameter with default value (e.g., name="World")
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');

          if (nameNode) {
            parameters.push({
              name: code.substring(nameNode.startIndex, nameNode.endIndex),
              defaultValue: valueNode
                ? code.substring(valueNode.startIndex, valueNode.endIndex)
                : undefined,
              isVarArgs: false,
              isKwArgs: false,
            });
          }
        } else if (child.type === 'list_splat_pattern') {
          // *args
          const nameNode = child.children.find((c) => c.type === 'identifier');
          if (nameNode) {
            parameters.push({
              name: code.substring(nameNode.startIndex, nameNode.endIndex),
              isVarArgs: true,
              isKwArgs: false,
            });
          }
        } else if (child.type === 'dictionary_splat_pattern') {
          // **kwargs
          const nameNode = child.children.find((c) => c.type === 'identifier');
          if (nameNode) {
            parameters.push({
              name: code.substring(nameNode.startIndex, nameNode.endIndex),
              isVarArgs: false,
              isKwArgs: true,
            });
          }
        }
      } catch (error) {
        // Skip errors in individual parameters
        console.warn(`Error parsing parameter:`, error);
      }
    }

    return parameters;
  }

  /**
   * Extract return type annotation
   */
  private extractReturnType(node: Parser.SyntaxNode, code: string): string | undefined {
    const returnTypeNode = node.childForFieldName('return_type');
    if (!returnTypeNode) return undefined;

    return code.substring(returnTypeNode.startIndex, returnTypeNode.endIndex);
  }

  /**
   * Extract decorators from decorated_definition
   */
  private extractDecorators(node: Parser.SyntaxNode, code: string): PythonRawDecorator[] {
    const decorators: PythonRawDecorator[] = [];

    for (const child of node.children) {
      if (child.type === 'decorator') {
        try {
          // Extract decorator name
          let decoratorName = '';
          const nameNodes = child.descendantsOfType('identifier');

          if (nameNodes.length > 0) {
            // Use first identifier or join with dots for chained decorators
            decoratorName = nameNodes
              .map((n) => code.substring(n.startIndex, n.endIndex))
              .join('.');
          }

          // For simple decorators like @property
          if (!decoratorName) {
            const text = code.substring(child.startIndex, child.endIndex).trim();
            decoratorName = text.replace(/^@/, '');
          }

          if (decoratorName) {
            decorators.push({
              name: decoratorName,
            });
          }
        } catch (error) {
          console.warn(`Error parsing decorator:`, error);
        }
      }
    }

    return decorators;
  }

  /**
   * Extract docstring from body
   */
  private extractDocstring(bodyNode: Parser.SyntaxNode | null, code: string): string | undefined {
    if (!bodyNode) return undefined;

    // Look for first expression_statement containing a string
    for (const child of bodyNode.namedChildren) {
      if (child.type === 'expression_statement') {
        const stringNode = child.descendantsOfType('string')[0];
        if (stringNode) {
          const docstring = code.substring(stringNode.startIndex, stringNode.endIndex);
          // Remove quotes and clean up - handle both single and triple quotes
          let cleaned = docstring.trim();

          // Remove triple quotes first (""" or ''')
          if (cleaned.startsWith('"""') && cleaned.endsWith('"""')) {
            cleaned = cleaned.slice(3, -3);
          } else if (cleaned.startsWith("'''") && cleaned.endsWith("'''")) {
            cleaned = cleaned.slice(3, -3);
          } else if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
          } else if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
            cleaned = cleaned.slice(1, -1);
          }

          return cleaned.trim();
        }
      }
    }

    return undefined;
  }

  /**
   * Extract import statement
   */
  private extractImport(node: Parser.SyntaxNode, code: string): PythonRawImport | null {
    try {
      if (node.type === 'import_statement') {
        // import module [as alias]
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          return {
            module: code.substring(nameNode.startIndex, nameNode.endIndex),
          };
        }
      } else if (node.type === 'import_from_statement') {
        // from module import ...
        const moduleNode = node.childForFieldName('module_name');
        if (moduleNode) {
          return {
            module: code.substring(moduleNode.startIndex, moduleNode.endIndex),
          };
        }
      }
    } catch (error) {
      console.warn(`Error parsing import:`, error);
    }

    return null;
  }
}

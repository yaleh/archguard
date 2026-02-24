/**
 * Python language plugin types
 *
 * Internal type definitions for Python AST representation
 * before mapping to ArchJSON
 */

/**
 * Source location in a Python file
 */
export interface PythonSourceLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * Python decorator (e.g., @property, @classmethod, custom decorators)
 */
export interface PythonRawDecorator {
  name: string;
  arguments?: string[];
}

/**
 * Python function/method parameter
 */
export interface PythonRawParameter {
  name: string;
  type?: string;
  defaultValue?: string;
  isVarArgs: boolean; // *args
  isKwArgs: boolean; // **kwargs
}

/**
 * Python method
 */
export interface PythonRawMethod {
  name: string;
  parameters: PythonRawParameter[];
  returnType?: string;
  decorators: PythonRawDecorator[];
  isClassMethod: boolean;
  isStaticMethod: boolean;
  isProperty: boolean;
  isAsync: boolean;
  isPrivate: boolean; // __ prefix
  docstring?: string;
  startLine: number;
  endLine: number;
}

/**
 * Python property (via @property decorator)
 */
export interface PythonRawProperty {
  name: string;
  type?: string;
  decorators: PythonRawDecorator[];
}

/**
 * Python class attribute
 */
export interface PythonRawAttribute {
  name: string;
  type?: string;
  isPrivate: boolean;
}

/**
 * Python class definition
 */
export interface PythonRawClass {
  name: string;
  moduleName: string;
  baseClasses: string[];
  methods: PythonRawMethod[];
  properties: PythonRawProperty[];
  classAttributes: PythonRawAttribute[];
  decorators: PythonRawDecorator[];
  docstring?: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Python module-level function
 */
export interface PythonRawFunction {
  name: string;
  moduleName: string;
  parameters: PythonRawParameter[];
  returnType?: string;
  decorators: PythonRawDecorator[];
  isAsync: boolean;
  docstring?: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Python import statement
 */
export interface PythonRawImport {
  module: string;
  alias?: string;
  items?: Array<{ name: string; alias?: string }>;
}

/**
 * Python module (file)
 */
export interface PythonRawModule {
  name: string;
  filePath: string;
  classes: PythonRawClass[];
  functions: PythonRawFunction[];
  imports: PythonRawImport[];
}

/**
 * Complete Python project raw data
 */
export interface PythonRawData {
  modules: PythonRawModule[];
}

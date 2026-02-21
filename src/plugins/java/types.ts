/**
 * Java language plugin types
 *
 * Internal type definitions for Java AST representation
 * before mapping to ArchJSON
 */

/**
 * Source location in a Java file
 */
export interface JavaSourceLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * Java annotation
 */
export interface JavaRawAnnotation {
  name: string;
  arguments?: Record<string, any>;
}

/**
 * Java method/constructor parameter
 */
export interface JavaRawParameter {
  name: string;
  type: string;
  annotations?: JavaRawAnnotation[];
}

/**
 * Java field (class member variable)
 */
export interface JavaRawField {
  name: string;
  type: string;
  modifiers: string[];
  annotations: JavaRawAnnotation[];
  defaultValue?: string;
}

/**
 * Java method
 */
export interface JavaRawMethod {
  name: string;
  returnType: string;
  parameters: JavaRawParameter[];
  modifiers: string[];
  annotations: JavaRawAnnotation[];
  isAbstract: boolean;
}

/**
 * Java constructor
 */
export interface JavaRawConstructor {
  parameters: JavaRawParameter[];
  modifiers: string[];
  annotations: JavaRawAnnotation[];
}

/**
 * Java class definition
 */
export interface JavaRawClass {
  name: string;
  packageName: string;
  modifiers: string[];
  superClass?: string;
  interfaces: string[];
  fields: JavaRawField[];
  methods: JavaRawMethod[];
  constructors: JavaRawConstructor[];
  annotations: JavaRawAnnotation[];
  isAbstract: boolean;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Java interface definition
 */
export interface JavaRawInterface {
  name: string;
  packageName: string;
  modifiers: string[];
  extends: string[];
  methods: JavaRawMethod[];
  annotations: JavaRawAnnotation[];
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Java enum definition
 */
export interface JavaRawEnum {
  name: string;
  packageName: string;
  modifiers: string[];
  values: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Java package (aggregation of classes/interfaces/enums)
 */
export interface JavaRawPackage {
  name: string;
  classes: JavaRawClass[];
  interfaces: JavaRawInterface[];
  enums: JavaRawEnum[];
}

/**
 * Complete Java project raw data
 */
export interface JavaRawData {
  packages: JavaRawPackage[];
}

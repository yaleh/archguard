/**
 * Go language plugin types
 *
 * Internal type definitions for Go AST representation
 * before mapping to ArchJSON
 */

/**
 * Source location in a Go file
 */
export interface GoSourceLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * Go field (struct field or interface method parameter)
 */
export interface GoField {
  name: string;
  type: string;
  tag?: string;
  exported: boolean;
  location: GoSourceLocation;
}

/**
 * Go method signature
 */
export interface GoMethod {
  name: string;
  receiver?: string;
  receiverType?: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
}

/**
 * Go struct definition
 */
export interface GoRawStruct {
  name: string;
  packageName: string;
  fields: GoField[];
  methods: GoMethod[];
  embeddedTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
}

/**
 * Go interface definition
 */
export interface GoRawInterface {
  name: string;
  packageName: string;
  methods: GoMethod[];
  embeddedInterfaces: string[];
  exported: boolean;
  location: GoSourceLocation;
}

/**
 * Go function (standalone, not a method)
 */
export interface GoFunction {
  name: string;
  packageName: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
}

/**
 * Go import statement
 */
export interface GoImport {
  path: string;
  alias?: string;
  location: GoSourceLocation;
}

/**
 * Go package (aggregation of files in same directory)
 */
export interface GoRawPackage {
  id: string;
  name: string;
  dirPath: string;
  imports: GoImport[];
  structs: GoRawStruct[];
  interfaces: GoRawInterface[];
  functions: GoFunction[];
}

/**
 * Complete Go project raw data
 */
export interface GoRawData {
  packages: GoRawPackage[];
  moduleRoot: string;
  moduleName: string;
}

/**
 * Inferred interface implementation
 */
export interface InferredImplementation {
  structName: string;
  structPackageId: string;
  interfaceName: string;
  interfacePackageId: string;
  confidence: number;
  matchedMethods: string[];
  source: 'explicit' | 'inferred';
}

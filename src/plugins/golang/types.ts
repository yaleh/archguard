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
  body?: GoFunctionBody; // Optional: filled in Atlas mode
}

/**
 * Normalized method signature for interface matching
 */
export interface MethodSignature {
  name: string;
  normalizedSignature: string;
}

/**
 * Method set for a Go type (value vs pointer methods)
 */
export interface MethodSet {
  valueMethodSet: Map<string, MethodSignature>;
  pointerMethodSet: Map<string, MethodSignature>;
}

/**
 * Embedded type reference (for method promotion)
 */
export interface EmbeddedTypeRef {
  name: string;
  isPointer: boolean;
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
  embeddedTypeRefs?: EmbeddedTypeRef[]; // Detailed embedded type info for method promotion
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
 * Function body behavior data (for Atlas mode)
 */
export interface GoFunctionBody {
  calls: GoCallExpr[];
  goSpawns: GoSpawnStmt[];
  channelOps: GoChannelOp[];
}

export interface GoCallExpr {
  functionName: string;
  packageName?: string;
  receiverType?: string;
  /** Raw argument strings extracted from the AST (e.g. ["/path", "handlerFn"]) */
  args?: string[];
  location: GoSourceLocation;
}

export interface GoSpawnStmt {
  call: GoCallExpr;
  location: GoSourceLocation;
}

export interface GoChannelOp {
  channelName: string;
  operation: 'send' | 'receive' | 'close' | 'make';
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
  body?: GoFunctionBody; // Optional: filled in Atlas mode
}

/**
 * Go import statement
 */
export interface GoImport {
  path: string;
  alias?: string;
  location: GoSourceLocation;
  type?: 'std' | 'internal' | 'external' | 'vendor'; // Filled by GoModResolver
}

/**
 * Go package (aggregation of files in same directory)
 *
 * CRITICAL: Use fullName (not name) as Map key when merging packages.
 * This prevents data loss when different directories have same package name.
 */
export interface GoRawPackage {
  id: string;
  name: string; // Package name: "hub"
  fullName: string; // Module-relative path: "pkg/hub" (disambiguation key)
  dirPath: string;
  imports: GoImport[];
  structs: GoRawStruct[];
  interfaces: GoRawInterface[];
  functions: GoFunction[];
  sourceFiles: string[]; // Source file paths in this package
  orphanedMethods?: GoMethod[]; // Methods whose receiver struct is defined in another file
}

/**
 * Complete Go project raw data
 */
export interface GoRawData {
  packages: GoRawPackage[];
  moduleRoot: string;
  moduleName: string;
  implementations?: InferredImplementation[];
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
  source: 'explicit' | 'inferred' | 'gopls';
}

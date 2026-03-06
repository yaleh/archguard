/**
 * C++ plugin intermediate types
 *
 * Raw AST data structures produced by TreeSitterBridge,
 * consumed by HeaderMerger and ArchJsonMapper.
 */

export interface RawField {
  name: string;
  fieldType: string;
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
}

export interface RawMethod {
  name: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  visibility: 'public' | 'private' | 'protected';
  isVirtual: boolean;
  isStatic: boolean;
  isPure: boolean;
  isConst: boolean;
  sourceFile: string;
  startLine: number;
}

export interface RawClass {
  name: string;
  qualifiedName: string;
  kind: 'class' | 'struct';
  bases: Array<{ name: string; access: 'public' | 'private' | 'protected' }>;
  fields: RawField[];
  methods: RawMethod[];
  templateParams?: string[];
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawEnum {
  name: string;
  qualifiedName: string;
  isScoped: boolean;
  members: string[];
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawFunction {
  name: string;
  qualifiedName: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  isStatic: boolean;
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawCppFile {
  filePath: string;
  namespace: string;
  classes: RawClass[];
  enums: RawEnum[];
  functions: RawFunction[];
  includes: string[];
}

/** After HeaderMerger — one logical entity per .h/.cpp pair */
export interface MergedCppEntity extends RawClass {
  declarationFile: string;
  implementationFile?: string;
}

export interface CppRawData {
  files: RawCppFile[];
  moduleRoot: string;
}

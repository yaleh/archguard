/**
 * Kotlin plugin raw type definitions.
 * Pure type-definition file — no imports required.
 */

export type KotlinClassKind =
  | 'class'
  | 'abstract_class'
  | 'interface'
  | 'data_class'
  | 'sealed_class'
  | 'sealed_interface'
  | 'object'
  | 'companion_object'
  | 'enum_class';

export type KotlinVisibility = 'public' | 'private' | 'protected' | 'internal';

export interface RawKotlinMember {
  name: string;
  kind: 'field' | 'method';
  visibility: KotlinVisibility;
  type?: string;
  isStatic: boolean;
  decorators: string[];
  startLine: number;
  endLine: number;
}

export interface RawKotlinClass {
  name: string;
  kind: KotlinClassKind;
  visibility: KotlinVisibility;
  packageName: string;
  superTypes: string[];
  members: RawKotlinMember[];
  decorators: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface RawKotlinFunction {
  name: string;
  visibility: KotlinVisibility;
  packageName: string;
  isComposable: boolean;
  returnType?: string;
  paramTypes: string[];
  decorators: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface RawKotlinImport {
  path: string;
  alias?: string;
}

export interface RawKotlinFile {
  filePath: string;
  packageName: string;
  imports: RawKotlinImport[];
  classes: RawKotlinClass[];
  functions: RawKotlinFunction[];
}

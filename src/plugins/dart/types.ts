/**
 * Dart plugin raw type definitions.
 * Pure type-definition file — no runtime imports required.
 */

export type DartClassKind = 'class' | 'abstract_class' | 'enum' | 'extension' | 'mixin';

export type DartVisibility = 'public' | 'private';

export type RawDartMemberKind = 'field' | 'method' | 'constructor' | 'getter' | 'setter';

export interface RawDartParameter {
  name: string;
  type: string;
  /** True for `required this.foo` named parameters. */
  isRequired?: boolean;
  /** Literal default value text (`= 5`), when present. */
  defaultValue?: string;
}

export interface RawDartMember {
  name: string;
  kind: RawDartMemberKind;
  visibility: DartVisibility;
  /** Field type, method/getter return type, or constructor name. */
  type?: string;
  parameters: RawDartParameter[];
  isStatic: boolean;
  isFinal: boolean;
  startLine: number;
}

export interface RawDartClass {
  name: string;
  kind: DartClassKind;
  visibility: DartVisibility;
  /** Simple name of the extended superclass (class → superclass `extends`). */
  superClass?: string;
  /** Simple names of applied mixins (class → superclass `with`). */
  mixins: string[];
  /** Simple names of implemented interfaces (class → interfaces) or the extended type (extension → on). */
  interfaces: string[];
  members: RawDartMember[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface RawDartImport {
  path: string;
  alias?: string;
}

export interface RawDartFile {
  filePath: string;
  /** Library directive name (rare); empty when absent — package ID is then derived from the file path. */
  packageName: string;
  imports: RawDartImport[];
  classes: RawDartClass[];
  /** Per-file parse degradation, when the tree has ERROR nodes or extraction threw. */
  diagnostics?: DartFileDiagnostic[];
}

export interface DartFileDiagnostic {
  filePath: string;
  /** `syntax_error` = tree-sitter ERROR node (partial parse); `extract_error` = extractor threw. */
  kind: 'syntax_error' | 'extract_error';
  message: string;
}

/**
 * Types for function-body duplicate detection (v1: exact structural clones, Type-1/2).
 */

import type { FunctionFingerprintKind } from '@/parser/function-fingerprint.js';

export interface DuplicateMember {
  file: string;
  startLine: number;
  endLine: number;
  name: string;
  kind: FunctionFingerprintKind;
}

export interface DuplicateGroup {
  /** Structural hash shared by every member. */
  hash: string;
  /** Normalized token count of one member. */
  tokenCount: number;
  statementCount: number;
  /** Line count of one member (the longest, when members differ in formatting). */
  lineCount: number;
  /** Lines that could be removed by keeping one copy: (members - 1) × lineCount. */
  savableLines: number;
  members: DuplicateMember[];
}

export interface DuplicateOptions {
  /** Functions with fewer statements are not reported. Default 6. */
  minStatements: number;
  /** Functions with fewer normalized tokens are not reported. Default 50. */
  minTokens: number;
  /** Keep only the N groups with the most savable lines. Omit for all. */
  topN?: number;
  /** Include test files (*.test.*, *.spec.*, tests/, __tests__/). Default false. */
  includeTests: boolean;
  /**
   * Restrict the scan to files git knows about — the `git ls-files --cached --others
   * --exclude-standard` set — instead of every file the directory glob finds. Untracked
   * leftover scaffolding named `__*` is dropped in this mode. Default false.
   */
  trackedOnly: boolean;
}

/**
 * Identity of the query scope a scan belongs to.
 *
 * `key` is the same 8-hex `hashSources` value as `QueryScopeEntry.key`, so the
 * duplicate results can be filed next to the query artifacts they describe.
 */
export interface DuplicateScopeRef {
  /** Normalized-sources hash, 8 hex chars (same formula as `QueryScopeEntry.key`). */
  key: string;
  /** Human-readable scope label, e.g. "src (typescript)". */
  label: string;
}

export interface DuplicateManifest {
  version: '1';
  generatedAt: string;
  /**
   * Query scope identity. Present whenever the scan went through a scope-aware
   * caller (`archguard_detect_duplicates`, `query --duplicates`); absent only for
   * direct `detectDuplicates` calls that scan a path without a query scope.
   */
  scopeKey?: string;
  /** Human-readable scope label matching `scopeKey`. */
  label?: string;
  sources: string[];
  scannedFiles: number;
  scannedFunctions: number;
  /** Number of groups before `topN` truncation. */
  totalGroups: number;
  options: DuplicateOptions;
}

export interface DuplicateAnalysis {
  manifest: DuplicateManifest;
  groups: DuplicateGroup[];
}

export const DEFAULT_DUPLICATE_OPTIONS: DuplicateOptions = {
  minStatements: 6,
  minTokens: 50,
  includeTests: false,
  trackedOnly: false,
};

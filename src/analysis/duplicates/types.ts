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
}

export interface DuplicateManifest {
  version: '1';
  generatedAt: string;
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
};

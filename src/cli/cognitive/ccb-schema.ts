/**
 * Cognitive Context Bundle (CCB) schema.
 *
 * A CCB captures the full cognitive context for a single source file,
 * combining structural, behavioral, and git signals with LLM guidance.
 * Bundles are persisted as SHA-256-keyed JSON files in .archguard/cognitive/
 * and are invalidated when the source file changes.
 */

import type { CognitiveSummaryEntry } from '@/types/cognitive-summary.js';

export interface CognitiveBehavioralSignals {
  /** Number of times this file was read by the agent in recent sessions. */
  readCount: number;
  /** Number of times this file was edited by the agent in recent sessions. */
  editCount: number;
  /** Read-to-edit ratio (readCount / editCount); higher = more exploratory. */
  reRatio: number;
}

export interface CognitiveGitSignals {
  /** Overall risk level from git history analysis ('low' | 'medium' | 'high' | 'critical'). */
  riskLevel: string;
  /** Composite hotspot score combining churn + complexity. */
  hotspotScore: number;
  /** Files that frequently change together with this file. */
  cochangeNeighbors: string[];
}

export interface CognitiveGuidance {
  /** Cognitive load pattern: A = low (routine), B = medium (attention needed), C = high (expert only). */
  pattern: 'A' | 'B' | 'C';
  /** Normalized cognitive load score from 0.0 (trivial) to 1.0 (maximum). */
  cognitiveLoad: number;
  /** Structural invariants that must remain true after any edit. */
  keyInvariants: string[];
  /** Specific precautions to observe when editing this file. */
  editPrecautions: string[];
}

export interface CognitiveDocumentationSignals {
  /**
   * Fraction of co-change neighbors that are documentation files (.md .rst .txt .adoc).
   * A low value (< 0.3) suggests code changes rarely touch docs — possible doc freshness gap.
   * null when cochangeNeighbors is empty (no co-change data available).
   */
  docFreshnessGap: number | null;
  /**
   * True when meta-cc session history shows the file was edited without any associated
   * documentation reads/edits in the same session (doc void pattern).
   * Defaults to false when meta-cc is unavailable.
   */
  docVoid: boolean;
  /**
   * True when meta-cc signals suggest spec documents were not consulted before editing
   * (spec precision gap pattern).
   * Defaults to false when meta-cc is unavailable.
   */
  specPrecisionGap: boolean;
  /**
   * Always null in stored CCBs.
   * LLM agent calling archguard_get_ccb should generate this field on the fly
   * when docVoid=true or docFreshnessGap < 0.3, by reading co-changed doc files.
   */
  deFactoSpec: string | null;
  /**
   * Always null in stored CCBs.
   * LLM agent calling archguard_get_ccb should generate a human-readable warning
   * on the fly when docFreshnessGap is low or docVoid is true.
   */
  freshnessWarning: string | null;
}

export interface CognitiveContextBundle {
  /** Stable file identifier (dotted path or slug, no extension). */
  fileId: string;
  /** Relative or absolute path to the source file. */
  filePath: string;
  /** SHA-256 hash of the source file at assembly time (used for freshness checks). */
  fileHash: string;
  /** ISO 8601 timestamp of when this bundle was assembled. */
  assembledAt: string;
  /** Structural summary from ArchJSON analysis; null when ArchJSON artifacts absent. */
  structural: CognitiveSummaryEntry | null;
  /** Behavioral signals from agent session history; null when meta-cc unavailable. */
  behavioral: CognitiveBehavioralSignals | null;
  /** Git history signals; null when git artifacts absent. */
  git: CognitiveGitSignals | null;
  /** LLM-derived cognitive guidance; null when not yet computed. */
  guidance: CognitiveGuidance | null;
  /**
   * Documentation freshness signals combining git co-change analysis and meta-cc
   * session history. Null when not yet computed (legacy bundles).
   */
  documentation?: CognitiveDocumentationSignals | null;
}

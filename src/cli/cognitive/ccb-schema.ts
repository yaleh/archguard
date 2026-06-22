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
}

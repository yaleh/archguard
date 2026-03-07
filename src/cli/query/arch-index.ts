/**
 * ArchIndex — reverse index for fast structural queries over ArchJSON.
 *
 * Built by ArchIndexBuilder from a rawArchJSON; persisted as arch-index.json.
 */

import type { RelationType, CycleInfo } from '@/types/index.js';

export interface ArchIndex {
  /** Schema version for forward-compatibility checks. */
  version: string; // "1.0"

  /** ISO 8601 build time. */
  generatedAt: string;

  /**
   * SHA-256 of the arch.json file content at the time this index was built.
   * QueryEngine compares this against the live arch.json to detect staleness.
   */
  archJsonHash: string;

  /** Language reported by arch.json. */
  language: string;

  /** entity.name (case-sensitive) → entity ID list (handles cross-module duplicates). */
  nameToIds: Record<string, string[]>;

  /** entity ID → source file relative path (C++ absolute paths normalised). */
  idToFile: Record<string, string>;

  /** entity ID → entity name (for display without loading full arch.json). */
  idToName: Record<string, string>;

  /** entity ID → list of entity IDs that depend on it (reverse edges). */
  dependents: Record<string, string[]>;

  /** entity ID → list of entity IDs it depends on (forward edges). */
  dependencies: Record<string, string[]>;

  /** Relation type → [source ID, target ID][] (only internal relations). */
  relationsByType: Partial<Record<RelationType, [string, string][]>>;

  /** Source file relative path → entity ID list. */
  fileToIds: Record<string, string[]>;

  /** Non-trivial SCCs (size > 1), sorted by size DESC. Aligns with CycleInfo. */
  cycles: CycleInfo[];
}

export const ARCH_INDEX_VERSION = '1.0';

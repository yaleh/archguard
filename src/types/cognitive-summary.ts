/**
 * Types for the archguard_get_cognitive_summary MCP tool.
 *
 * A CognitiveSummaryEntry is a compact structural digest for a single named
 * entity, suitable for LLM context windows. All counts come from static
 * ArchJSON analysis; test coverage and git risk are optional overlays that
 * are null when the corresponding artifacts are absent.
 */

export interface CognitiveSummaryEntry {
  /** The entity name that was requested. */
  name: string;

  /** True when the entity was found in the ArchJSON index. */
  found: boolean;

  /** Fully-qualified entity ID (dotted path) when found. */
  entityId?: string;

  /** Number of method/constructor members. */
  methodCount?: number;

  /** Number of property/field members. */
  fieldCount?: number;

  /** Count of internal relations whose target is this entity (fan-in). */
  inDegree?: number;

  /** Count of internal relations whose source is this entity (fan-out). */
  outDegree?: number;

  /** Up to 5 entities that depend on this entity (i.e. this entity's callers / users). */
  topDependents?: Array<{ name: string; type: string }>;

  /** Up to 5 entities this entity depends on. */
  topDependencies?: Array<{ name: string; type: string }>;

  /**
   * Static test coverage ratio from archguard test analysis artifacts.
   * null when test analysis artifacts are absent or entity is not tracked.
   */
  testCoverageRatio?: number | null;

  /**
   * Git risk level ('low' | 'medium' | 'high' | 'critical') from git history artifacts.
   * null when git history artifacts are absent or the entity's file is not tracked.
   */
  gitRiskLevel?: string | null;
}

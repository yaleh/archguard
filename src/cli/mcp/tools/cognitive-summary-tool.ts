/**
 * MCP tool: archguard_get_cognitive_summary
 *
 * Returns a compact structural digest for each requested entity name, read
 * from existing .archguard/ artifacts.  No LLM calls are made — this is a
 * pure mechanical aggregator.
 *
 * Payload design:
 *   - methodCount / fieldCount / inDegree / outDegree — from ArchJSON + ArchIndex
 *   - topDependents / topDependencies — top 5 by name, {name, type} only
 *   - testCoverageRatio — from test-analysis extension; null when absent
 *   - gitRiskLevel — from git history artifacts; null when absent
 *
 * Graceful-degradation rules:
 *   - Entity not found in index → { name, found: false, reason } where reason
 *     distinguishes not-in-graph / in-graph-no-artifact / id-format-mismatch
 *   - Test analysis artifacts absent or entity not tracked → testCoverageRatio: null
 *     plus testCoverageReason
 *   - Git history artifacts absent or file not tracked → gitRiskLevel: null
 *     plus gitRiskReason
 *   - Every entry carries projectSemantics: 'loaded' | 'missing' | 'invalid' so a
 *     missing project-semantics sidecar is explicit rather than a bare null ratio
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { promises as fs } from 'node:fs';
import path from 'path';
import type { Entity } from '@/types/index.js';
import { loadEngine, readManifest } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { loadHistoryData } from '../../git-history/history-loader.js';
import { HistoryQuery } from '../../git-history/history-query.js';
import type { CognitiveSummaryEntry } from '@/types/cognitive-summary.js';
import {
  preflightProjectSemantics,
  type ProjectSemanticsStatus,
} from '@/analysis/project-semantics-loader.js';

/** Why a requested entity could not be summarized. */
type MissingEntityReason = 'not-in-graph' | 'in-graph-no-artifact' | 'id-format-mismatch';

/** Why a static coverage ratio is null. */
type CoverageReason =
  | 'no-test-analysis-artifacts'
  | 'entity-not-tracked'
  | 'coverage-lookup-failed';

/** Why a git risk level is null. */
type GitRiskReason =
  | 'no-git-history-artifacts'
  | 'no-source-location'
  | 'risk-level-unavailable'
  | 'git-history-query-failed';

interface CognitiveSummaryEntryWithReasons extends CognitiveSummaryEntry {
  /** Present when found === false. */
  reason?: MissingEntityReason;
  /** Human-readable explanation of `reason`. */
  reasonDetail?: string;
  /** Entity name to query instead when reason === 'id-format-mismatch'. */
  resolvedName?: string;
  /** Present when testCoverageRatio === null. */
  testCoverageReason?: CoverageReason;
  /** Present when gitRiskLevel === null. */
  gitRiskReason?: GitRiskReason;
  /** Explicit project-semantics sidecar status for this summary. */
  projectSemantics?: ProjectSemanticsStatus;
}

/** An input that names an entity by its (dotted / slashed) ID rather than by name. */
const ID_LIKE_RE =
  /[/\\]|::|\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|go|java|py|kt|kts|cpp|cc|cxx|h|hpp)\.[A-Za-z_$][\w$]*$/;

/** Extract the trailing entity-name segment from an ID-like input. */
function lastEntitySegment(value: string): string {
  const afterSeparator = value.includes('::') ? value.slice(value.lastIndexOf('::') + 2) : value;
  return afterSeparator.slice(afterSeparator.lastIndexOf('.') + 1);
}

interface MissingClassification {
  reason: MissingEntityReason;
  reasonDetail: string;
  resolvedName?: string;
}

/**
 * Classify a failed name lookup three ways instead of collapsing every miss
 * into `found: false`:
 *   - id-format-mismatch — the input is an entity ID; the lookup is name-keyed
 *   - in-graph-no-artifact — an entity with that id is in ArchJSON, but the
 *     derived name index does not resolve it (stale/incomplete index artifact)
 *   - not-in-graph — no entity with that name/id in the loaded scope
 */
function classifyMissingEntity(
  name: string,
  findByName: (candidate: string) => Entity[],
  entityIds: readonly string[]
): MissingClassification {
  if (entityIds.includes(name)) {
    const resolvedName = lastEntitySegment(name);
    return {
      reason: 'id-format-mismatch',
      reasonDetail: `'${name}' is an entity id, not an entity name; this lookup is name-keyed`,
      ...(resolvedName !== name ? { resolvedName } : {}),
    };
  }

  if (ID_LIKE_RE.test(name)) {
    const candidate = lastEntitySegment(name);
    if (candidate !== name && findByName(candidate).length > 0) {
      return {
        reason: 'id-format-mismatch',
        reasonDetail: `'${name}' looks like an entity id; query the name '${candidate}' instead`,
        resolvedName: candidate,
      };
    }
  }

  const staleId = entityIds.find((id) => id.endsWith(`.${name}`) || id.endsWith(`::${name}`));
  if (staleId !== undefined) {
    return {
      reason: 'in-graph-no-artifact',
      reasonDetail:
        `entity '${name}' is present in ArchJSON (id '${staleId}') but the name index ` +
        `artifact does not resolve it — run \`archguard analyze\` to rebuild arch-index.json`,
    };
  }

  return {
    reason: 'not-in-graph',
    reasonDetail: `entity '${name}' is not present in the loaded ArchJSON scope`,
  };
}

interface OtherScopeHit {
  scopeKey: string;
  /** `id` = the exact input is an entity id in that scope; `format` = the derived name matched; `name` = the input is a name there. */
  matchedBy: 'id' | 'format' | 'name';
  resolvedName: string;
}

/**
 * Look for the requested entity (as an id, an id-derived name, or a plain
 * name) in the OTHER query scopes of the same manifest. A hit means the entity
 * IS in the project graph, just not in the scope this summary loaded — which is
 * materially different from "not in the graph at all".
 *
 * Best-effort: unreadable manifest/scope artifacts simply leave the caller's
 * not-in-graph classification intact.
 */
async function probeEntityInOtherScopes(
  archDir: string,
  loadedScopeKey: string,
  name: string,
  idDerivedName?: string
): Promise<OtherScopeHit | undefined> {
  try {
    const manifest = await readManifest(archDir);
    for (const scope of manifest.scopes) {
      if (scope.key === loadedScopeKey) continue;
      const archPath = path.join(archDir, 'query', scope.key, 'arch.json');
      const raw = await fs.readFile(archPath, 'utf8');
      const parsed = JSON.parse(raw) as { entities?: Array<{ id?: string; name?: string }> };
      const entities = parsed.entities ?? [];

      const byId = entities.find((entity) => entity.id === name);
      if (byId !== undefined) {
        return {
          scopeKey: scope.key,
          matchedBy: 'id',
          resolvedName: byId.name ?? idDerivedName ?? name,
        };
      }

      if (idDerivedName !== undefined && idDerivedName !== name) {
        const byDerivedName = entities.find((entity) => entity.name === idDerivedName);
        if (byDerivedName !== undefined) {
          return { scopeKey: scope.key, matchedBy: 'format', resolvedName: idDerivedName };
        }
      }

      const byName = entities.find((entity) => entity.name === name);
      if (byName !== undefined) {
        return { scopeKey: scope.key, matchedBy: 'name', resolvedName: name };
      }
    }
  } catch {
    // Manifest or scope artifacts unavailable — keep the caller's classification.
  }
  return undefined;
}

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerCognitiveSummaryTool(server: McpServer, defaultRoot: string): void {
  // adr-ok: ADR-007 — cognitive summary is an agent-only tool; CLI interface out of scope for v1 (no terminal use case)
  server.tool(
    'archguard_get_cognitive_summary',
    'Return a compact structural digest for each requested entity name from .archguard/ artifacts. ' +
      'For each entity: method/field counts, in/out degree, top-5 dependents and dependencies, ' +
      'static test coverage ratio (null with a testCoverageReason when test artifacts are absent), ' +
      'and git risk level (null with a gitRiskReason when git artifacts are absent). ' +
      'Missing entities return { name, found: false, reason } where reason is one of ' +
      'not-in-graph / in-graph-no-artifact / id-format-mismatch; id-format-mismatch also ' +
      'returns resolvedName, the name to query instead. ' +
      'Each entry carries projectSemantics: loaded | missing | invalid, so a missing ' +
      'project-semantics sidecar is explicit rather than a silent null. ' +
      'Payload is < 2 KB per entity. No LLM calls are made — pure mechanical aggregation.',
    {
      entities: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe('Entity names to summarize (1–20 names, exact match).'),
      archDir: z
        .string()
        .optional()
        .describe('Path to .archguard directory (default: <projectRoot>/.archguard).'),
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
    },
    async ({ entities, archDir, projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const resolvedArchDir = archDir
          ? path.isAbsolute(archDir)
            ? archDir
            : path.resolve(root, archDir)
          : path.join(root, '.archguard');

        // Load primary engine (throws if no analysis artifacts found)
        const { engine, extensionAccessor, scopeEntry } = await loadEngine(resolvedArchDir);
        const loadedScopeKey = scopeEntry?.key ?? '';

        // Load git history data (optional — null when absent)
        let historyQuery: HistoryQuery | null = null;
        try {
          const historyData = await loadHistoryData(resolvedArchDir);
          historyQuery = new HistoryQuery(historyData);
        } catch {
          // git artifacts absent — graceful null
        }

        const results: CognitiveSummaryEntryWithReasons[] = [];
        const entityIds = extensionAccessor.getEntityIds();

        // Explicit project-semantics preflight (missing is a first-class outcome).
        let projectSemantics: ProjectSemanticsStatus;
        try {
          projectSemantics = (await preflightProjectSemantics(resolvedArchDir)).projectSemantics;
        } catch {
          projectSemantics = 'invalid';
        }

        for (const entityName of entities) {
          // Find entity by name (structured lookup, no output narrowing)
          const found = engine.findEntity(entityName) as Entity[];

          if (!found || found.length === 0) {
            let classification = classifyMissingEntity(
              entityName,
              (candidate) => engine.findEntity(candidate) as Entity[],
              entityIds
            );
            // The entity may live in another query scope of the same graph, or
            // the input may be an entity id — report which, instead of claiming
            // it is absent entirely.
            if (classification.reason === 'not-in-graph' && loadedScopeKey) {
              const idDerivedName = ID_LIKE_RE.test(entityName)
                ? lastEntitySegment(entityName)
                : undefined;
              const hit = await probeEntityInOtherScopes(
                resolvedArchDir,
                loadedScopeKey,
                entityName,
                idDerivedName
              );
              if (hit !== undefined) {
                classification =
                  hit.matchedBy === 'name'
                    ? {
                        reason: 'in-graph-no-artifact',
                        reasonDetail:
                          `entity '${entityName}' exists in query scope '${hit.scopeKey}' but not ` +
                          `in the loaded scope '${loadedScopeKey}' — this summary has no artifact for it`,
                      }
                    : {
                        reason: 'id-format-mismatch',
                        reasonDetail:
                          `'${entityName}' is an entity id in query scope '${hit.scopeKey}'; ` +
                          `query the entity name '${hit.resolvedName}' instead`,
                        resolvedName: hit.resolvedName,
                      };
              }
            }
            results.push({
              name: entityName,
              found: false,
              ...classification,
              projectSemantics,
            });
            continue;
          }

          // Use the first match (by ArchJSON order)
          const entity = found[0];
          const members = entity.members ?? [];

          const methodCount = members.filter(
            (m) => m.type === 'method' || m.type === 'constructor'
          ).length;
          const fieldCount = members.filter(
            (m) => m.type === 'property' || m.type === 'field'
          ).length;

          // In/out degree from ArchIndex via RelationQueryService (public property on engine)
          const dependentEntities = engine.applyOutputOptions(
            engine.relationQueryService.getDependents(entityName, 1),
            { outputScope: 'class', queryFormat: 'structured' }
          ) as Entity[];

          const dependencyEntities = engine.applyOutputOptions(
            engine.relationQueryService.getDependencies(entityName, 1),
            { outputScope: 'class', queryFormat: 'structured' }
          ) as Entity[];

          const inDegree = dependentEntities.length;
          const outDegree = dependencyEntities.length;

          const topDependents = dependentEntities.slice(0, 5).map((e) => ({
            name: e.name,
            type: e.type,
          }));

          const topDependencies = dependencyEntities.slice(0, 5).map((e) => ({
            name: e.name,
            type: e.type,
          }));

          // Test coverage ratio (null when absent, with an explicit reason)
          let testCoverageRatio: number | null = null;
          let testCoverageReason: CoverageReason | undefined;
          try {
            if (extensionAccessor.hasTestAnalysis()) {
              const coverage = engine.getEntityCoverage(entity.id);
              if (coverage.found) {
                testCoverageRatio = coverage.coverageScore;
              } else {
                testCoverageRatio = null;
                testCoverageReason = 'entity-not-tracked';
              }
            } else {
              testCoverageReason = 'no-test-analysis-artifacts';
            }
          } catch {
            testCoverageRatio = null;
            testCoverageReason = 'coverage-lookup-failed';
          }

          // Git risk level (null when absent, with an explicit reason)
          let gitRiskLevel: string | null = null;
          let gitRiskReason: GitRiskReason | undefined;
          if (historyQuery !== null) {
            try {
              const filePath = entity.sourceLocation?.file ?? '';
              if (filePath) {
                const risk = historyQuery.getChangeRisk('file', filePath);
                gitRiskLevel = risk.riskLevel ?? null;
                if (gitRiskLevel === null) {
                  gitRiskReason = 'risk-level-unavailable';
                }
              } else {
                gitRiskReason = 'no-source-location';
              }
            } catch {
              gitRiskLevel = null;
              gitRiskReason = 'git-history-query-failed';
            }
          } else {
            gitRiskReason = 'no-git-history-artifacts';
          }

          results.push({
            name: entityName,
            found: true,
            entityId: entity.id,
            methodCount,
            fieldCount,
            inDegree,
            outDegree,
            topDependents,
            topDependencies,
            testCoverageRatio,
            ...(testCoverageReason !== undefined ? { testCoverageReason } : {}),
            gitRiskLevel,
            ...(gitRiskReason !== undefined ? { gitRiskReason } : {}),
            projectSemantics,
          });
        }

        return textResponse(JSON.stringify(results, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}

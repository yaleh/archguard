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
 *   - Entity not found in index → { name, found: false }
 *   - Test analysis artifacts absent or entity not tracked → testCoverageRatio: null
 *   - Git history artifacts absent or file not tracked → gitRiskLevel: null
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import type { Entity } from '@/types/index.js';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { loadHistoryData } from '../../git-history/history-loader.js';
import { HistoryQuery } from '../../git-history/history-query.js';
import type { CognitiveSummaryEntry } from '@/types/cognitive-summary.js';
import { mcpParamDescription, mcpToolDescription } from '../metadata.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerCognitiveSummaryTool(server: McpServer, defaultRoot: string): void {
  // adr-ok: ADR-007 — cognitive summary is an agent-only tool; CLI interface out of scope for v1 (no terminal use case)
  server.tool(
    'archguard_get_cognitive_summary',
    mcpToolDescription('archguard_get_cognitive_summary'),
    {
      entities: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe(mcpParamDescription('archguard_get_cognitive_summary', 'entities')),
      archDir: z
        .string()
        .optional()
        .describe(mcpParamDescription('archguard_get_cognitive_summary', 'archDir')),
      projectRoot: z
        .string()
        .optional()
        .describe(mcpParamDescription('archguard_get_cognitive_summary', 'projectRoot')),
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
        const { engine, extensionAccessor } = await loadEngine(resolvedArchDir);

        // Load git history data (optional — null when absent)
        let historyQuery: HistoryQuery | null = null;
        try {
          const historyData = await loadHistoryData(resolvedArchDir);
          historyQuery = new HistoryQuery(historyData);
        } catch {
          // git artifacts absent — graceful null
        }

        const results: CognitiveSummaryEntry[] = [];

        for (const entityName of entities) {
          // Find entity by name (structured lookup, no output narrowing)
          const found = engine.findEntity(entityName) as Entity[];

          if (!found || found.length === 0) {
            results.push({ name: entityName, found: false });
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

          // Test coverage ratio (null when absent)
          let testCoverageRatio: number | null = null;
          try {
            if (extensionAccessor.hasTestAnalysis()) {
              const coverage = engine.getEntityCoverage(entity.id);
              if (coverage.found) {
                testCoverageRatio = coverage.coverageScore;
              } else {
                testCoverageRatio = null;
              }
            }
          } catch {
            testCoverageRatio = null;
          }

          // Git risk level (null when absent)
          let gitRiskLevel: string | null = null;
          if (historyQuery !== null) {
            try {
              const filePath = entity.sourceLocation?.file ?? '';
              if (filePath) {
                const risk = historyQuery.getChangeRisk('file', filePath);
                gitRiskLevel = risk.riskLevel ?? null;
              }
            } catch {
              gitRiskLevel = null;
            }
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
            gitRiskLevel,
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

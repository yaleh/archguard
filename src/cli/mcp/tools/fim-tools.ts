/**
 * @experimental
 * MCP tool registration for FIM (Fisher Information Matrix) read-only access.
 * FIM computation is no longer part of the `archguard analyze` pipeline;
 * this tool reads pre-computed artifacts produced by historical `--fim` runs.
 * See src/analysis/fim/README.md for context and validated findings.
 */

import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRoot } from '../mcp-server.js';
import { readFIMCurrentArtifact } from '@/analysis/fim/fim-artifacts.js';
import { readFIMHistory } from '@/analysis/fim/fim-snapshot.js';
import { validateFIMAgainstGit } from '@/analysis/fim/fim-analysis.js';
import { isGitRepo, readGitLog } from '../../git-history/git-log-reader.js';
import type { FisherInformationResult } from '@/analysis/fim/types.js';

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonWithFiniteFallback(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => {
      if (typeof entry === 'number' && !Number.isFinite(entry)) {
        if (entry === Number.POSITIVE_INFINITY) return 'Infinity';
        if (entry === Number.NEGATIVE_INFINITY) return '-Infinity';
      }
      return entry;
    },
    2
  );
}

function topEigenvalueShares(result: FisherInformationResult, limit: number = 5): number[] {
  const total = result.eigenvalues.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return result.eigenvalues.slice(0, limit).map((value) => value / total);
}

export function registerFIMTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_fim',
    'Return the current Fisher Information Matrix metrics from import-approximation coverage. Use level=package for the reliable Phase 1 view. includeMantel optionally adds git co-change validation when git history is available.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      level: z.enum(['file', 'package']).default('package'),
      includeMantel: z.boolean().default(false),
      snapshotCount: z.coerce.number().min(1).max(20).default(5),
    },
    async ({ projectRoot, level, includeMantel, snapshotCount }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');
      const current = await readFIMCurrentArtifact(archguardDir);
      if (!current) {
        return textResponse(
          'No FIM data found. Run `archguard analyze --fim` (or `archguard_analyze` with `fim: true`) first.'
        );
      }

      const history = await readFIMHistory(archguardDir);
      const selected = level === 'file' ? current.fileResult : current.packageResult;
      let mantel = includeMantel ? current.mantel : undefined;

      if (includeMantel && !mantel && isGitRepo(root)) {
        const commits = readGitLog(root, { sinceDays: 90, maxCommits: 500, includeMerges: false });
        if (commits.length > 0) {
          mantel = validateFIMAgainstGit({
            coverage: { matrix: current.fileMatrix, testIds: [], fileIds: current.fileIds },
            packageNames: current.packageNames,
            packageMatrix: current.packageMatrix,
            commits,
            permutations: 999,
            seed: 42,
          }).mantel;
        }
      }

      const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
      const payload = {
        current: {
          conditionNumber: selected.conditionNumber,
          effectiveDimension: selected.effectiveDimension,
          fileCount: selected.fileCount,
          testCount: selected.testCount,
          topEigenvalues: topEigenvalueShares(selected),
          uncoveredFiles: selected.uncoveredFiles,
          fragilityHotspots: selected.fragilityHotspots,
        },
        ...(includeMantel && mantel ? { mantel } : {}),
        history: history.slice(-snapshotCount),
        gitPredictions: {
          P1_descriptionLength: {
            current: current.descriptionLength,
            previous: previousSnapshot?.descriptionLength ?? null,
          },
          P2_conditionNumber: {
            current: current.packageResult.conditionNumber,
            previous: previousSnapshot?.conditionNumber ?? null,
            improved:
              previousSnapshot?.conditionNumber !== undefined
                ? current.packageResult.conditionNumber < previousSnapshot.conditionNumber
                : null,
          },
          P5_cochangeValidity: {
            correlation: mantel?.observedCorrelation ?? null,
            significant: mantel?.isValidProxy ?? null,
          },
        },
      };

      return textResponse(jsonWithFiniteFallback(payload));
    }
  );
}

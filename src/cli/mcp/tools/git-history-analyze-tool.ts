/**
 * MCP tool: archguard_analyze_git
 *
 * Analyzes git history for a project and writes artifacts to
 * <projectRoot>/.archguard/query/git-history/.
 *
 * Artifacts produced:
 *   - manifest.json
 *   - package-metrics.json
 *   - file-metrics.json
 */

import { z } from 'zod';
import path from 'path';
import fs from 'fs-extra';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRoot } from '../mcp-server.js';
import { readGitLog, getHeadRef, getCurrentBranch, isGitRepo } from '../../git-history/git-log-reader.js';
import {
  aggregateFileMetrics,
  aggregatePackageMetrics,
} from '../../git-history/history-aggregator.js';
import { writeHistoryArtifacts } from '../../git-history/history-writer.js';
import type { GitHistoryManifest, GitHistoryArtifacts } from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerGitHistoryAnalyzeTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_analyze_git',
    'Analyze git commit history for a project and generate file/package churn metrics, co-change coupling, and risk scores. Results are written to .archguard/query/git-history/ and can be queried with archguard_get_git_history.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe(
          'Root directory of the git repository to analyze. Defaults to the MCP server startup cwd.'
        ),
      sinceDays: z
        .number()
        .int()
        .positive()
        .optional()
        .default(90)
        .describe('How many days of git history to include (default: 90).'),
      maxCommits: z
        .number()
        .int()
        .positive()
        .optional()
        .default(500)
        .describe('Maximum number of commits to process (default: 500).'),
      includeMerges: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether to include merge commits (default: false).'),
      granularities: z
        .array(z.enum(['package', 'file']))
        .optional()
        .default(['package', 'file'])
        .describe("Which granularities to include in the output (default: ['package', 'file'])."),
      packageDepth: z
        .coerce.number().int().min(1).max(5)
        .optional()
        .default(1)
        .describe('Number of path segments to use for package grouping (default: 1). Use 2 for sub-package depth (e.g. src/mermaid instead of src).'),
    },
    async (params) => {
      const projectRoot = resolveRoot(params.projectRoot, defaultRoot);
      const sinceDays = params.sinceDays ?? 90;
      const maxCommits = params.maxCommits ?? 500;
      const includeMerges = params.includeMerges ?? false;
      const granularities = (params.granularities ?? ['package', 'file']) as ('package' | 'file')[];
      const packageDepth = params.packageDepth ?? 1;

      // Validate git repository
      if (!isGitRepo(projectRoot)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${projectRoot} is not a git repository.\nPlease provide a valid git repository path via the projectRoot parameter.`,
            },
          ],
        };
      }

      // Read git log
      let commits;
      try {
        commits = readGitLog(projectRoot, { sinceDays, maxCommits, includeMerges });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading git log: ${message}\nMake sure git is installed and accessible in your PATH.`,
            },
          ],
        };
      }

      if (commits.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No commits found in the last ${sinceDays} days at ${projectRoot}.\nTry increasing sinceDays or check the repository has commits.`,
            },
          ],
        };
      }

      // Aggregate metrics
      const fileMetrics = aggregateFileMetrics(commits, packageDepth);

      // Annotate stale paths (file existence check in working tree)
      await Promise.all(fileMetrics.map(async (fm) => {
        fm.currentlyExists = await fs.pathExists(path.join(projectRoot, fm.path));
      }));

      const packageMetrics = aggregatePackageMetrics(fileMetrics, packageDepth);

      // Build manifest
      const headRef = getHeadRef(projectRoot);
      const analyzedBranch = getCurrentBranch(projectRoot);
      const manifest: GitHistoryManifest = {
        version: '2',
        generatedAt: new Date().toISOString(),
        headRef,
        analyzedBranch,
        sinceDays,
        maxCommits,
        totalCommits: commits.length,
        includeMerges,
        granularities,
        packageDepth,
      };

      const artifacts: GitHistoryArtifacts = {
        manifest,
        packageMetrics: granularities.includes('package') ? packageMetrics : [],
        fileMetrics: granularities.includes('file') ? fileMetrics : [],
      };

      // Write artifacts
      const archguardDir = path.join(projectRoot, '.archguard');
      try {
        await writeHistoryArtifacts(archguardDir, artifacts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error writing artifacts: ${message}`,
            },
          ],
        };
      }

      // Build summary response
      const topChurnFiles = [...fileMetrics]
        .sort((a, b) => b.commitCount - a.commitCount)
        .slice(0, 5)
        .map((f) => `  ${f.path} (${f.commitCount} commits, ${f.authorCount} authors)`)
        .join('\n');

      const topChurnPackages = [...packageMetrics]
        .sort((a, b) => b.commitCount - a.commitCount)
        .slice(0, 5)
        .map((p) => `  ${p.path}/ (${p.commitCount} commits)`)
        .join('\n');

      const summary = [
        `Git history analysis complete for ${projectRoot}`,
        `  Branch:    ${analyzedBranch} @ ${headRef}`,
        `  Period:    last ${sinceDays} days`,
        `  Commits:   ${commits.length} processed`,
        `  Files:     ${fileMetrics.length} changed`,
        `  Packages:  ${packageMetrics.length} packages`,
        '',
        'Top churned files:',
        topChurnFiles || '  (none)',
        '',
        'Top churned packages:',
        topChurnPackages || '  (none)',
        '',
        `Artifacts written to: ${archguardDir}/query/git-history/`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: summary }],
      };
    }
  );
}

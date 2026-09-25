/**
 * MCP tool for function-body duplicate detection.
 *
 * ADR-006 compliant: business logic lives in src/analysis/duplicates/; this tool is a thin adapter.
 * CLI parity: `archguard query --duplicates` (ADR-007).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs-extra';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { resolveScope } from '../../query/engine-loader.js';
import { detectDuplicates } from '@/analysis/duplicates/group.js';
import { persistDuplicates } from '@/analysis/duplicates/persistence.js';
import type { DuplicateAnalysis, DuplicateOptions } from '@/analysis/duplicates/types.js';
import { errorMessage } from '@/utils/error-message.js';

const DEFAULT_TOP_N = 20;

/**
 * Resolve the source directories to scan.
 *
 * - With a query manifest: the `sources` of the requested scope (or the default scope). An
 *   unknown scope throws a descriptive error listing the available scopes.
 * - Without a manifest: an explicit `scope` cannot be resolved (throws); otherwise `src/` is used.
 */
export async function resolveDuplicateSources(root: string, scope?: string): Promise<string[]> {
  const archDir = path.join(root, '.archguard');
  if (await fs.pathExists(path.join(archDir, 'query', 'manifest.json'))) {
    const entry = await resolveScope(archDir, scope);
    return entry.sources;
  }
  if (scope) {
    throw new Error(
      `Scope "${scope}" cannot be resolved: no query data found in ${archDir}. Run \`archguard analyze\` first.`
    );
  }
  const srcDir = path.join(root, 'src');
  if (!(await fs.pathExists(srcDir))) {
    throw new Error(
      `No query data and no src/ directory found in ${root}. Run \`archguard analyze\` first or pass scope.`
    );
  }
  return ['src'];
}

/**
 * Run duplicate detection for `root` and persist the result (persist failure is non-fatal).
 */
export async function runDuplicateDetection(
  root: string,
  scope: string | undefined,
  options: Partial<DuplicateOptions>
): Promise<DuplicateAnalysis> {
  const sources = await resolveDuplicateSources(root, scope);
  const analysis = await detectDuplicates(root, sources, options);
  try {
    await persistDuplicates(path.join(root, '.archguard'), analysis);
  } catch {
    // Non-fatal: persistence failure must not fail the query.
  }
  return analysis;
}

export function registerDuplicateTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_detect_duplicates',
    'Detect duplicated function bodies (exact structural clones, identifiers and literals ' +
      'normalized) across a scope. Covers function declarations, arrow functions, function ' +
      'expressions, methods and nested functions — exported or not. Returns duplicate groups ' +
      '(hash, token count, members with file/startLine/endLine/name/kind) ranked by savable ' +
      'lines. Test files, .d.ts and dist/ are excluded by default.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe(
          'Query scope key or label whose sources are scanned. Defaults to the global scope.'
        ),
      minStatements: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(6)
        .describe('Minimum statements in a function body to be considered. Default 6.'),
      minTokens: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(50)
        .describe('Minimum normalized tokens in a function body to be considered. Default 50.'),
      topN: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(DEFAULT_TOP_N)
        .describe(
          `Return only the N groups with the most savable lines. Default ${DEFAULT_TOP_N}.`
        ),
      includeTests: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include test files (*.test.*, *.spec.*, tests/). Default false.'),
    },
    async ({ projectRoot, scope, minStatements, minTokens, topN, includeTests }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const analysis = await runDuplicateDetection(root, scope, {
          minStatements,
          minTokens,
          topN,
          includeTests,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(analysis, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${errorMessage(err)}` }],
        };
      }
    }
  );
}

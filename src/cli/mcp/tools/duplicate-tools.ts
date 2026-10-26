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
import { generateScopeLabel } from '../../query/query-artifacts.js';
import { hashSources } from '../../processors/arch-json-utils.js';
import { detectDuplicates } from '@/analysis/duplicates/group.js';
import { persistDuplicates } from '@/analysis/duplicates/persistence.js';
import type {
  DuplicateAnalysis,
  DuplicateOptions,
  DuplicateScopeRef,
} from '@/analysis/duplicates/types.js';
import { errorMessage } from '@/utils/error-message.js';

const DEFAULT_TOP_N = 20;
const DEFAULT_LANGUAGE = 'typescript';

/** Resolved scope for a duplicate scan: what to scan plus the identity to file it under. */
export interface DuplicateScopeResolution extends DuplicateScopeRef {
  language: string;
  sources: string[];
}

/**
 * Resolve the scope a duplicate scan runs over.
 *
 * - With a query manifest: the requested scope (or the default scope). `key` and
 *   `label` are the manifest entry's own values, so results file under exactly
 *   the same `QueryScopeEntry.key` as the query artifacts.
 * - Without a manifest: an explicit `scope` cannot be resolved (throws);
 *   otherwise `src/` is used with its `hashSources` key.
 */
export async function resolveDuplicateScope(
  root: string,
  scope?: string
): Promise<DuplicateScopeResolution> {
  const archDir = path.join(root, '.archguard');
  if (await fs.pathExists(path.join(archDir, 'query', 'manifest.json'))) {
    const entry = await resolveScope(archDir, scope);
    return { key: entry.key, label: entry.label, language: entry.language, sources: entry.sources };
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
  const absoluteSources = [srcDir];
  return {
    key: hashSources(absoluteSources, DEFAULT_LANGUAGE),
    label: generateScopeLabel(absoluteSources, DEFAULT_LANGUAGE),
    language: DEFAULT_LANGUAGE,
    sources: [path.relative(root, srcDir).split(path.sep).join('/')],
  };
}

/**
 * Resolve the source directories to scan.
 *
 * Kept as the narrow accessor; scope identity comes from {@link resolveDuplicateScope}.
 */
export async function resolveDuplicateSources(root: string, scope?: string): Promise<string[]> {
  return (await resolveDuplicateScope(root, scope)).sources;
}

/**
 * Run duplicate detection for `root` and persist the result (persist failure is non-fatal).
 */
export async function runDuplicateDetection(
  root: string,
  scope: string | undefined,
  options: Partial<DuplicateOptions>
): Promise<DuplicateAnalysis> {
  const scopeInfo = await resolveDuplicateScope(root, scope);
  const analysis = await detectDuplicates(root, scopeInfo.sources, options, {
    key: scopeInfo.key,
    label: scopeInfo.label,
  });
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
      'lines. Test files, .d.ts and dist/ are excluded by default. ' +
      'Blind spot: only exact structural clones (Type-1/2) are detected; single-statement ' +
      'and very small functions below the minStatements/minTokens floor are not covered.',
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
      trackedOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Restrict the scan to files git knows about (git ls-files --cached --others ' +
            '--exclude-standard), dropping __* residual scaffolding files. Default false.'
        ),
    },
    async ({ projectRoot, scope, minStatements, minTokens, topN, includeTests, trackedOnly }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const analysis = await runDuplicateDetection(root, scope, {
          minStatements,
          minTokens,
          topN,
          includeTests,
          trackedOnly,
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

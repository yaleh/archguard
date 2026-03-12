import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runAnalysis } from '../analyze/run-analysis.js';
import { StderrReporter } from '../progress.js';

export interface AnalyzeToolContext {
  defaultRoot: string;
}

export const PARADIGM_BLOCK_GO = `Paradigm: package (Go Atlas)
  Applicable:  archguard_summary, archguard_find_entity, archguard_get_file_entities,
               archguard_find_implementers, archguard_get_atlas_layer
  Limited:     archguard_get_dependencies / get_dependents (entity-level only;
               use get_atlas_layer for package deps)
  Not useful:  archguard_find_subclasses (no inheritance), archguard_detect_cycles
               (compiler-enforced; always empty)
  Package graph: .archguard/output/architecture-package.mmd

Next step: call archguard_summary or archguard_get_atlas_layer.`;

const supportedAnalyzeLanguages = ['typescript', 'go', 'java', 'python', 'cpp'] as const;
const analyzeLocks = new Set<string>();

const analyzeSchema = {
  projectRoot: z
    .string()
    .optional()
    .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
  sources: z
    .array(z.string())
    .optional()
    .describe(
      'Source paths relative to the target project root. Omit to analyze the project root.'
    ),
  lang: z
    .enum(supportedAnalyzeLanguages)
    .optional()
    .describe(
      'Source code language plugin to use. Supported values: typescript, go, java, python, cpp. This is not a natural-language locale.'
    ),
  diagrams: z
    .array(z.enum(['package', 'class', 'method']))
    .optional()
    .describe(
      'Diagram levels to generate. Omit to use the detected/default set for the target sources.'
    ),
  format: z
    .enum(['mermaid', 'json'])
    .optional()
    .describe(
      'Output artifact format. Use json for query/index refresh without Mermaid rendering.'
    ),
  noCache: z.boolean().default(false).describe('Disable analysis caches for this run.'),
  includeTests: z
    .boolean()
    .optional()
    .describe(
      'Run test analysis after parsing. Required before calling test analysis tools (get_test_metrics, get_test_coverage, get_test_issues).'
    ),
  testsOnly: z
    .boolean()
    .optional()
    .describe('Run test analysis only, without generating architecture diagrams.'),
};

export function registerAnalyzeTool(server: McpServer, ctx: AnalyzeToolContext): void {
  server.tool(
    'archguard_analyze',
    'Analyze project sources with an optional code-language plugin override and refresh query artifacts for the target project.',
    analyzeSchema,
    async ({ projectRoot, sources, lang, diagrams, format, noCache, includeTests, testsOnly }) => {
      const root = resolveRoot(projectRoot, ctx.defaultRoot);
      const startedAt = Date.now();

      try {
        return await withPerProjectLock(root, async () => {
          const normalizedSources = sources?.map((source) => path.resolve(root, source));
          const result = await runAnalysis({
            sessionRoot: root,
            workDir: path.join(root, '.archguard'),
            cliOptions: {
              sources: normalizedSources,
              lang,
              diagrams,
              format,
              cache: noCache ? false : undefined,
              includeTests,
              testsOnly,
            },
            reporter: new StderrReporter(),
          });

          if (result.queryScopesPersisted === 0) {
            return textResponse(
              'Analysis failed: No query scopes were persisted.\nPrevious query state is unchanged.'
            );
          }

          return textResponse(
            formatAnalyzeResponse(result, {
              elapsedMs: Date.now() - startedAt,
              projectRoot: root,
            })
          );
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResponse(`Analysis failed: ${message}\nPrevious query state is unchanged.`);
      }
    }
  );
}

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function resolveRoot(projectRoot: string | undefined, defaultRoot: string): string {
  if (!projectRoot) return defaultRoot;
  return path.isAbsolute(projectRoot) ? projectRoot : path.resolve(defaultRoot, projectRoot);
}

async function withPerProjectLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(root);
  if (analyzeLocks.has(key)) {
    throw new Error(
      `An analysis is already running for ${key}. Wait for it to complete or analyze a different project.`
    );
  }
  analyzeLocks.add(key);
  try {
    return await fn();
  } finally {
    analyzeLocks.delete(key);
  }
}

function formatAnalyzeResponse(
  result: Awaited<ReturnType<typeof runAnalysis>>,
  meta: { elapsedMs: number; projectRoot: string }
): string {
  const lines = [`Analysis completed in ${(meta.elapsedMs / 1000).toFixed(1)}s`, ''];
  lines.push(`Project root: ${meta.projectRoot}`);
  lines.push(`Work dir:     ${result.config.workDir}`);
  lines.push(`Output:       ${result.config.outputDir}`);
  lines.push(`Query:        ${result.queryScopesPersisted} scopes written`);
  if (result.results.length > 0) {
    lines.push('', 'Diagrams:');
    for (const diagram of result.results) {
      if (diagram.success) {
        lines.push(
          `  - ${diagram.name}  ok  ${diagram.stats?.entities ?? 0} entities  ${diagram.stats?.relations ?? 0} relations  ${((diagram.stats?.parseTime ?? 0) / 1000).toFixed(1)}s`
        );
      } else {
        lines.push(`  - ${diagram.name}  failed  ${diagram.error ?? 'unknown error'}`);
      }
    }
  }
  if (result.hasDiagramFailures) {
    lines.push('', 'Warnings:');
    lines.push('  - One or more diagrams failed, but query data was refreshed.');
  }
  const language = result.diagrams.find((d) => d.language)?.language;
  if (language === 'go') {
    lines.push('', PARADIGM_BLOCK_GO);
  } else {
    lines.push('', 'Next step: call archguard_summary or another query tool.');
  }
  return lines.join('\n');
}

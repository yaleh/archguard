import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runAnalysis } from '../analyze/run-analysis.js';
import { StderrReporter } from '../progress.js';
import { hashSources } from '../processors/arch-json-provider.js';

export interface AnalyzeToolContext {
  sessionRoot: string;
  archDir: string;
  getActiveScope(): string | undefined;
  setActiveScope(scopeKey?: string): void;
  invalidateEngine(): void;
}

const supportedAnalyzeLanguages = ['typescript', 'go', 'java', 'python', 'cpp'] as const;

const analyzeSchema = {
  sources: z
    .array(z.string())
    .optional()
    .describe('Source paths relative to the MCP session root. Omit to analyze the session root.'),
  lang: z
    .enum(supportedAnalyzeLanguages)
    .optional()
    .describe(
      'Source code language plugin to use. Supported values: typescript, go, java, python, cpp. This is not a natural-language locale.',
    ),
  diagrams: z
    .array(z.enum(['package', 'class', 'method']))
    .optional()
    .describe('Diagram levels to generate. Omit to use the detected/default set for the target sources.'),
  format: z
    .enum(['mermaid', 'json'])
    .optional()
    .describe('Output artifact format. Use json for query/index refresh without Mermaid rendering.'),
  noCache: z
    .boolean()
    .default(false)
    .describe('Disable analysis caches for this run.'),
};

export function registerAnalyzeTool(server: McpServer, ctx: AnalyzeToolContext): void {
  let analyzeInProgress = false;

  server.tool(
    'archguard_analyze',
    'Analyze project sources with an optional code-language plugin override and refresh query artifacts for the current MCP session.',
    analyzeSchema,
    async ({ sources, lang, diagrams, format, noCache }) => {
      if (analyzeInProgress) {
        return textResponse('An analysis is already running in this MCP session.');
      }

      analyzeInProgress = true;
      const startedAt = Date.now();

      try {
        const normalizedSources = sources?.map((source) => path.resolve(ctx.sessionRoot, source));
        const result = await runAnalysis({
          sessionRoot: ctx.sessionRoot,
          workDir: ctx.archDir,
          cliOptions: {
            sources: normalizedSources,
            lang,
            diagrams,
            format,
            cache: noCache ? false : undefined,
          },
          reporter: new StderrReporter(),
        });

        if (result.queryScopesPersisted === 0) {
          return textResponse(
            'Analysis failed: No query scopes were persisted.\nPrevious query state is unchanged.',
          );
        }

        const currentScope = ctx.getActiveScope();
        if (!currentScope) {
          ctx.invalidateEngine();
        } else if (normalizedSources && normalizedSources.length > 0) {
          const nextScope = hashSources(normalizedSources);
          if (result.persistedScopeKeys.includes(nextScope)) {
            ctx.setActiveScope(nextScope);
          }
        }

        return textResponse(
          formatAnalyzeResponse(result, {
            elapsedMs: Date.now() - startedAt,
            sessionRoot: ctx.sessionRoot,
            currentScope,
            nextScope: ctx.getActiveScope(),
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResponse(`Analysis failed: ${message}\nPrevious query state is unchanged.`);
      } finally {
        analyzeInProgress = false;
      }
    },
  );
}

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function formatAnalyzeResponse(
  result: Awaited<ReturnType<typeof runAnalysis>>,
  meta: { elapsedMs: number; sessionRoot: string; currentScope?: string; nextScope?: string },
): string {
  const lines = [`Analysis completed in ${(meta.elapsedMs / 1000).toFixed(1)}s`, ''];
  lines.push(`Session root: ${meta.sessionRoot}`);
  lines.push(`Work dir:     ${result.config.workDir}`);
  lines.push(`Output:       ${result.config.outputDir}`);
  lines.push(`Query:        ${result.queryScopesPersisted} scopes written`);
  if (!meta.currentScope) {
    lines.push('Scope:        auto-select on next query');
  } else if (meta.nextScope && meta.nextScope !== meta.currentScope) {
    lines.push(`Scope:        ${meta.currentScope} -> ${meta.nextScope}`);
  } else {
    lines.push(`Scope:        ${meta.currentScope} (unchanged)`);
  }
  if (result.results.length > 0) {
    lines.push('', 'Diagrams:');
    for (const diagram of result.results) {
      if (diagram.success) {
        lines.push(
          `  - ${diagram.name}  ok  ${diagram.stats?.entities ?? 0} entities  ${diagram.stats?.relations ?? 0} relations  ${((diagram.stats?.parseTime ?? 0) / 1000).toFixed(1)}s`,
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
  lines.push('', 'Next step: call archguard_summary or another query tool.');
  return lines.join('\n');
}

/**
 * MCP tools for test system analysis.
 *
 * Four tools following the Pattern-First workflow:
 * 1. archguard_detect_test_patterns  — MUST be called first
 * 2. archguard_get_test_coverage
 * 3. archguard_get_test_issues
 * 4. archguard_get_test_metrics
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

const NOT_ANALYZED_MSG =
  'No test analysis data found. Run `archguard_analyze` with `includeTests: true` first.';

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const patternConfigSchema = z
  .object({
    assertionPatterns: z.array(z.string()).optional(),
    testCasePatterns: z.array(z.string()).optional(),
    skipPatterns: z.array(z.string()).optional(),
    testFileGlobs: z.array(z.string()).optional(),
    typeClassificationRules: z
      .array(
        z.object({
          pathPattern: z.string(),
          type: z.enum(['unit', 'integration', 'e2e', 'performance']),
        })
      )
      .optional(),
  })
  .optional();

export function registerTestAnalysisTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_detect_test_patterns',
    'Pattern-First tool: call this FIRST before any other test analysis tool. Detects test frameworks and conventions in the project. Returns suggestedPatternConfig and notes. Review the notes and correct the config if needed before passing to other tools.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Project root (default: server startup cwd)'),
    },
    async ({ projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        let engine: Awaited<ReturnType<typeof loadEngine>> | null = null;
        try {
          engine = await loadEngine(archDir);
        } catch {
          // No prior analysis — fall back to package.json detection
        }

        if (!engine || !engine.hasTestAnalysis()) {
          // Try to detect frameworks from package.json
          const frameworks: string[] = [];
          try {
            const fs = await import('fs-extra');
            const pkgPath = path.join(root, 'package.json');
            const pkg = JSON.parse(await fs.default.readFile(pkgPath, 'utf-8'));
            const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
            if (deps.vitest) frameworks.push('vitest');
            if (deps.jest) frameworks.push('jest');
            if (deps.mocha) frameworks.push('mocha');
            if (deps.playwright) frameworks.push('playwright');
            if (deps.cypress) frameworks.push('cypress');
          } catch {
            // ignore
          }
          return textResponse(
            JSON.stringify(
              {
                detectedFrameworks: frameworks.map((f) => ({
                  name: f,
                  confidence: 'high',
                  evidenceFiles: ['package.json'],
                })),
                suggestedPatternConfig: {},
                notes: [
                  'No prior test analysis found. Run archguard_analyze with --include-tests first for full pattern detection. Showing package.json-based detection only.',
                ],
              },
              null,
              2
            )
          );
        }

        const analysis = engine.getTestAnalysis()!;
        const frameworks = [...new Set(analysis.testFiles.flatMap((f) => f.frameworks))];
        return textResponse(
          JSON.stringify(
            {
              detectedFrameworks: frameworks.map((f) => ({
                name: f,
                confidence: 'high',
                evidenceFiles: [],
              })),
              suggestedPatternConfig: {},
              notes: [
                `Detected ${analysis.metrics.totalTestFiles} test files. Pattern config source: ${analysis.patternConfigSource}.`,
              ],
            },
            null,
            2
          )
        );
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );

  server.tool(
    'archguard_get_test_coverage',
    'Get test coverage map for the analyzed project. IMPORTANT: Call archguard_detect_test_patterns first to get the correct patternConfig for this project.',
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      patternConfig: patternConfigSchema,
    },
    async ({ projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const engine = await loadEngine(path.join(root, '.archguard'));
        if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = engine.getTestAnalysis()!;
        return textResponse(JSON.stringify(analysis.coverageMap, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );

  server.tool(
    'archguard_get_test_issues',
    'Get test quality issues for the analyzed project. IMPORTANT: Call archguard_detect_test_patterns first to get the correct patternConfig for this project.',
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      patternConfig: patternConfigSchema,
      severity: z
        .enum(['warning', 'info'])
        .optional()
        .describe('Filter by severity'),
    },
    async ({ projectRoot, severity }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const engine = await loadEngine(path.join(root, '.archguard'));
        if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = engine.getTestAnalysis()!;
        const issues = severity
          ? analysis.issues.filter((i) => i.severity === severity)
          : analysis.issues;
        return textResponse(JSON.stringify(issues, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );

  server.tool(
    'archguard_get_test_metrics',
    'Get test metrics summary for the analyzed project. IMPORTANT: Call archguard_detect_test_patterns first to get the correct patternConfig for this project.',
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      patternConfig: patternConfigSchema,
    },
    async ({ projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const engine = await loadEngine(path.join(root, '.archguard'));
        if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = engine.getTestAnalysis()!;
        return textResponse(JSON.stringify(analysis.metrics, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );
}

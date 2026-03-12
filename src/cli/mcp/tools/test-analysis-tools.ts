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

/**
 * Build a suggested TestPatternConfig based on detected framework names.
 * Maps well-known frameworks to their canonical assertion patterns.
 */
function buildSuggestedPatternConfig(frameworks: string[]): Record<string, string[]> {
  const assertionPatterns: string[] = [];

  for (const fw of frameworks) {
    switch (fw) {
      case 'vitest':
      case 'jest':
      case 'mocha':
      case 'jasmine':
        if (!assertionPatterns.includes('\\bexpect\\s*\\('))
          assertionPatterns.push('\\bexpect\\s*\\(');
        break;
      case 'junit4':
      case 'junit5':
        assertionPatterns.push('\\bAssert\\.assert\\w+\\s*\\(', '\\bAssertions\\.assert\\w+\\s*\\(', '\\bassertEquals\\s*\\(', '\\bassertTrue\\s*\\(', '\\bassertFalse\\s*\\(', '\\bassertNotNull\\s*\\(', '\\bassertThat\\s*\\(');
        break;
      case 'testng':
        if (!assertionPatterns.includes('\\bassertEquals\\s*\\('))
          assertionPatterns.push('\\bassertEquals\\s*\\(', '\\bassertTrue\\s*\\(', '\\bassertNotNull\\s*\\(');
        break;
      case 'jmh':
        // JMH benchmarks don't use assertions — no patterns needed
        break;
      case 'assertj':
        if (!assertionPatterns.includes('\\bassertThat\\s*\\('))
          assertionPatterns.push('\\bassertThat\\s*\\(');
        break;
      case 'testify':
        assertionPatterns.push('\\b(?:assert|require)\\.\\w+\\s*\\(');
        break;
      case 'testing': // Go stdlib
        assertionPatterns.push('\\bt\\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\\s*\\(');
        break;
      case 'gtest':
        assertionPatterns.push('\\bEXPECT_\\w+\\s*\\(', '\\bASSERT_\\w+\\s*\\(');
        break;
      case 'catch2':
      case 'doctest':
        assertionPatterns.push('\\bREQUIRE\\s*\\(', '\\bCHECK\\s*\\(');
        break;
      case 'assert': // C++ custom / Node assert
        assertionPatterns.push(
          '\\bassert\\s*\\(',
          '\\bassert_\\w+\\s*\\(',        // assert_equal(), assert_true(), assert_equals()
          '\\bt\\.assert_\\w+\\s*\\(',   // t.assert_equal(), t.assert_true()
          '\\bGGML_ASSERT\\s*\\(',
        );
        break;
      case 'pytest':
        assertionPatterns.push(
          '\\bassert\\b',
          '.assert'   // torch.testing.assert_close, np.testing.assert_allclose, self.assertX
        );
        break;
      case 'unittest':
        assertionPatterns.push('\\bself\\.assert\\w+\\s*\\(');
        break;
      case 'playwright':
      case 'cypress':
        if (!assertionPatterns.includes('\\bexpect\\s*\\('))
          assertionPatterns.push('\\bexpect\\s*\\(');
        break;
    }
  }

  if (assertionPatterns.length === 0) return {};
  return { assertionPatterns: [...new Set(assertionPatterns)] };
}

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
    'Detect test frameworks and assertion conventions in the project; call this before any other test analysis tool and pass the returned suggestedPatternConfig to subsequent calls.',
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
        const suggestedPatternConfig = buildSuggestedPatternConfig(frameworks);
        return textResponse(
          JSON.stringify(
            {
              detectedFrameworks: frameworks.map((f) => ({
                name: f,
                confidence: 'high',
                evidenceFiles: [],
              })),
              suggestedPatternConfig,
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
    'Return per-entity coverage links inferred by static import-path matching and filename conventions, not runtime tracing; scores are an approximation and may miss coverage via path aliases or indirect imports. Call archguard_detect_test_patterns first.',
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
    'Return static-analysis test quality issues (orphan tests, zero-assertion files, skip accumulation); orphan_test and zero_assertion may produce false positives when tests use import aliases, custom assertion helpers, or long setup blocks. Call archguard_detect_test_patterns first.',
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
    'Return test quality metrics: file counts by type, entity coverage ratio, assertion density, and issue counts. All metrics are static approximations — entityCoverageRatio measures structural link detection, not runtime execution coverage. Call archguard_detect_test_patterns first.',
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

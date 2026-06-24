/**
 * MCP tools for test system analysis.
 *
 * Four tools following the Pattern-First workflow:
 * 1. archguard_detect_test_patterns  — MUST be called first
 * 2. archguard_get_entity_coverage
 * 3. archguard_get_test_issues
 * 4. archguard_get_test_metrics
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine, readManifest } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { mcpToolDescription } from '../metadata.js';

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
        assertionPatterns.push(
          '\\bAssert\\.assert\\w+\\s*\\(',
          '\\bAssertions\\.assert\\w+\\s*\\(',
          '\\bassertEquals\\s*\\(',
          '\\bassertTrue\\s*\\(',
          '\\bassertFalse\\s*\\(',
          '\\bassertNotNull\\s*\\(',
          '\\bassertThat\\s*\\('
        );
        break;
      case 'testng':
        if (!assertionPatterns.includes('\\bassertEquals\\s*\\('))
          assertionPatterns.push(
            '\\bassertEquals\\s*\\(',
            '\\bassertTrue\\s*\\(',
            '\\bassertNotNull\\s*\\('
          );
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
          '\\bassert_\\w+\\s*\\(', // assert_equal(), assert_true(), assert_equals()
          '\\bt\\.assert_\\w+\\s*\\(', // t.assert_equal(), t.assert_true()
          '\\bGGML_ASSERT\\s*\\('
        );
        break;
      case 'pytest':
        assertionPatterns.push(
          '\\bassert\\b',
          '.assert' // torch.testing.assert_close, np.testing.assert_allclose, self.assertX
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

/**
 * Build an actionable diagnostic response when no test files are found in the
 * current scope. This typically happens when the default scope covers only
 * source files (e.g. src/) and excludes tests/.
 */
async function buildZeroTestsDiagnosticResponse(
  archDir: string
): Promise<ReturnType<typeof textResponse>> {
  let availableScopes = '';
  try {
    const manifest = await readManifest(archDir);
    availableScopes = manifest.scopes?.map((s: any) => `${s.key} (${s.label})`).join(', ') ?? '';
  } catch {
    // ignore — manifest may not exist yet
  }

  return textResponse(
    JSON.stringify(
      {
        error: 'No test files found in the analyzed scope.',
        diagnosis: [
          'The current ArchJSON scope covers only source files (e.g. src/) and excludes tests/.',
          'Fix: Re-run archguard_analyze with --include-tests flag.',
          availableScopes
            ? `Available scopes: ${availableScopes}`
            : 'Run archguard_analyze first to generate analysis data.',
        ],
      },
      null,
      2
    )
  );
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
    mcpToolDescription('archguard_detect_test_patterns'),
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      scope: z
        .string()
        .optional()
        .describe(
          'Analysis scope key. Omit to use the widest available scope containing test data.'
        ),
    },
    async ({ projectRoot, scope }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        let engine: Awaited<ReturnType<typeof loadEngine>>['engine'] | null = null;
        let extensionAccessor: Awaited<ReturnType<typeof loadEngine>>['extensionAccessor'] | null = null;
        try {
          ({ engine, extensionAccessor } = await loadEngine(archDir, scope));
        } catch {
          // No prior analysis — fall back to package.json detection
        }

        if (!extensionAccessor || !extensionAccessor.hasTestAnalysis()) {
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

        const analysis = extensionAccessor!.getTestAnalysis();

        // Scope mismatch guard: engine loaded but no test files found
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir);
        }

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
    'archguard_get_test_issues',
    mcpToolDescription('archguard_get_test_issues'),
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      scope: z
        .string()
        .optional()
        .describe(
          'Analysis scope key. Omit to use the widest available scope containing test data.'
        ),
      patternConfig: patternConfigSchema.describe(
        'Pattern config for detection (informational only — analysis data was produced at ' +
          'archguard_analyze time; changing this field at query time does not re-analyze or ' +
          'alter the stored results).'
      ),
      severity: z.enum(['warning', 'info']).optional().describe('Filter by severity'),
    },
    async ({ projectRoot, scope, severity }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const { engine, extensionAccessor } = await loadEngine(archDir, scope);
        if (!extensionAccessor.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = extensionAccessor.getTestAnalysis();
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir);
        }
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
    mcpToolDescription('archguard_get_test_metrics'),
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      scope: z
        .string()
        .optional()
        .describe(
          'Analysis scope key. Omit to use the widest available scope containing test data.'
        ),
      patternConfig: patternConfigSchema.describe(
        'Pattern config for detection (informational only — analysis data was produced at ' +
          'archguard_analyze time; changing this field at query time does not re-analyze or ' +
          'alter the stored results).'
      ),
      includePackageBreakdown: z
        .boolean()
        .optional()
        .describe(
          'When true, includes per-package coverage breakdown sorted ascending by coverageRatio.'
        ),
    },
    async ({ projectRoot, scope, includePackageBreakdown }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const { engine, extensionAccessor } = await loadEngine(archDir, scope);
        if (!extensionAccessor.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = extensionAccessor.getTestAnalysis();
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir);
        }
        const result: Record<string, unknown> = { ...analysis.metrics };
        if (includePackageBreakdown) {
          result.packageCoverage = engine.getPackageCoverage();
        }
        return textResponse(JSON.stringify(result, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );

  server.tool(
    'archguard_get_entity_coverage',
    mcpToolDescription('archguard_get_entity_coverage'),
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      entityId: z
        .string()
        .describe(
          'Dotted-path entity ID as reported by archguard_find_entity or archguard_get_test_coverage ' +
            '(e.g. "lmdeploy.pytorch.models.LlamaModel").'
        ),
    },
    async ({ projectRoot, entityId }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const { engine, extensionAccessor } = await loadEngine(path.join(root, '.archguard'));
        if (!extensionAccessor.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const result = engine.getEntityCoverage(entityId);
        return textResponse(JSON.stringify(result, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );
}

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
import { loadEngine, readManifest, type ResolvedScopeInfo } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { buildSuggestedPatternConfig } from '@/analysis/test-pattern-advisor.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';

const NOT_ANALYZED_MSG =
  'No test analysis data found. Run `archguard_analyze` with `includeTests: true` first.';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

/**
 * Build an actionable diagnostic response when a test analysis ran but found no
 * test files. The caller only reaches this after `hasTestAnalysis()`, so
 * `includeTests` was already applied — the usual cause is that tests live
 * outside the analyzed source root and `testSources` was not given.
 */
async function buildZeroTestsDiagnosticResponse(
  archDir: string,
  analysis: TestAnalysis,
  scope?: Partial<ResolvedScopeInfo>
): Promise<ReturnType<typeof textResponse>> {
  let availableScopes = '';
  let manifestGeneratedAt: string | undefined;
  try {
    const manifest = await readManifest(archDir);
    availableScopes = manifest.scopes?.map((s) => `${s.key} (${s.label})`).join(', ') ?? '';
    manifestGeneratedAt = manifest.generatedAt;
  } catch {
    // ignore — manifest may not exist yet
  }

  const generatedAt = scope?.generatedAt ?? manifestGeneratedAt;
  const discovery = analysis.discovery;
  const diagnosis: string[] = [
    'Test analysis has already run (includeTests was applied) but discovered 0 test files.',
  ];
  if (discovery) {
    diagnosis.push(
      `Test discovery workspaceRoot: ${discovery.workspaceRoot}`,
      `Test discovery scanned: ${discovery.roots.length > 0 ? discovery.roots.join(', ') : '(no directories)'}`
    );
    if (discovery.globs?.length) {
      diagnosis.push(
        `Extra testFileGlobs (relative to workspaceRoot): ${discovery.globs.join(', ')}`
      );
    }
    if (discovery.testSources?.length) {
      diagnosis.push(
        `testSources was given (${discovery.testSources.join(', ')}) but no test files matched there. ` +
          'Check the directories exist and contain test files for the analyzed language.'
      );
    } else {
      diagnosis.push(
        'No testSources was given, so tests are probably not under the analyzed source root. ' +
          'Fix: re-run archguard_analyze with includeTests: true and testSources set to the test ' +
          'directories relative to projectRoot (e.g. testSources: ["plugin/test"]).'
      );
    }
  } else {
    diagnosis.push(
      'The scanned directories were not recorded (analysis produced by an older version). ' +
        'Re-run archguard_analyze with includeTests: true, adding testSources (test directories ' +
        'relative to projectRoot, e.g. ["tests"]) if tests are outside the analyzed sources.'
    );
  }
  diagnosis.push(
    `Scope read: ${scope?.key ? `${scope.key} (${scope.label ?? 'unlabeled'})` : 'unknown'}; ` +
      `generatedAt: ${generatedAt ?? 'unknown'}`,
    availableScopes
      ? `Available scopes: ${availableScopes}`
      : 'Run archguard_analyze first to generate analysis data.'
  );

  return textResponse(
    JSON.stringify(
      {
        error: 'No test files found in the analyzed scope.',
        scope: { key: scope?.key, generatedAt },
        ...(discovery ? { discovery } : {}),
        diagnosis,
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
    'Pattern-First tool: call this FIRST before any other test analysis tool. Detects test frameworks and conventions in the project. Returns suggestedPatternConfig and notes. Review the notes and correct the config if needed before passing to other tools.',
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
        let _engine: Awaited<ReturnType<typeof loadEngine>>['engine'] | null = null;
        let extensionAccessor: Awaited<ReturnType<typeof loadEngine>>['extensionAccessor'] | null =
          null;
        let scopeEntry: Awaited<ReturnType<typeof loadEngine>>['scopeEntry'] | undefined;
        let scopeInfo: ResolvedScopeInfo | undefined;
        try {
          ({
            engine: _engine,
            extensionAccessor,
            scopeEntry,
            scopeInfo,
          } = await loadEngine(archDir, scope));
        } catch {
          // No prior analysis — fall back to package.json detection
        }

        if (!extensionAccessor || !extensionAccessor.hasTestAnalysis()) {
          // Try to detect frameworks from package.json
          const frameworks: string[] = [];
          try {
            const fs = await import('fs-extra');
            const pkgPath = path.join(root, 'package.json');
            const pkg = JSON.parse(await fs.default.readFile(pkgPath, 'utf-8')) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
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

        const analysis = extensionAccessor.getTestAnalysis();

        // Scope mismatch guard: engine loaded but no test files found
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir, analysis, scopeInfo ?? scopeEntry);
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
      } catch (e) {
        return textResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'archguard_get_test_issues',
    'Return static-analysis test quality issues (orphan_test, zero_assertion, skip_accumulation); ' +
      'orphan_test and zero_assertion results may include false positives when tests use import ' +
      'aliases, custom assertion helpers, or long setup blocks. Call archguard_detect_test_patterns first.',
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
        const {
          engine: _engine,
          extensionAccessor,
          scopeEntry,
          scopeInfo,
        } = await loadEngine(archDir, scope);
        if (!extensionAccessor.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = extensionAccessor.getTestAnalysis();
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir, analysis, scopeInfo ?? scopeEntry);
        }
        const issues = severity
          ? analysis.issues.filter((i) => i.severity === severity)
          : analysis.issues;
        return textResponse(JSON.stringify(issues, null, 2));
      } catch (e) {
        return textResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'archguard_get_test_metrics',
    'Return test metrics summary (coverage ratios, assertion density, test file counts); ' +
      'coverage is inferred from static import-path and filename matching, not runtime tracing — ' +
      'scores are an approximation. Call archguard_detect_test_patterns first.',
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
        const { engine, extensionAccessor, scopeEntry, scopeInfo } = await loadEngine(
          archDir,
          scope
        );
        if (!extensionAccessor.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = extensionAccessor.getTestAnalysis();
        if (analysis.metrics.totalTestFiles === 0) {
          return buildZeroTestsDiagnosticResponse(archDir, analysis, scopeInfo ?? scopeEntry);
        }
        const result: Record<string, unknown> = { ...analysis.metrics };
        if (includePackageBreakdown) {
          result.packageCoverage = engine.getPackageCoverage();
        }
        return textResponse(JSON.stringify(result, null, 2));
      } catch (e) {
        return textResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'archguard_get_entity_coverage',
    'Return coverage details for a single source entity by its dotted-path ID. ' +
      'Call archguard_detect_test_patterns first. Returns found:false when the entity ID ' +
      'is unknown (not in analysis data) — this may mean a typo or entity added after last analysis.',
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
      } catch (e) {
        return textResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}

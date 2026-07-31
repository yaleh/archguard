/**
 * MCP tools for shape-smell analysis (literal dispersion).
 *
 * ADR-006 compliant: business logic lives in src/analysis/shape-smells/;
 * these tools are thin adapters that invoke the domain layer.
 *
 * Layer 2 (hidden-coupling) and Layer 3 (enum-extension-impact) return
 * empty results with diagnostics — they never throw.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import {
  extractDiscriminatorTypes,
  detectDispersion,
  type DetectDispersionOptions,
} from '@/analysis/shape-smells/literal-dispersion.js';
import { persistResults, loadLiteralDispersion } from '@/analysis/shape-smells/persistence.js';
import type {
  ShapeSmellLayer,
  ShapeSmellResult,
  ShapeSmellManifest,
  ShapeSmellAnalysis,
} from '@/analysis/shape-smells/types.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

const LAYER_2_3_NOTE =
  'Layers 2 (hidden-coupling) and 3 (enum-extension-impact) are deferred. ' +
  'Only "literal-dispersion" is currently implemented via static regex-based analysis.';

/**
 * Build a diagnostic result for an unimplemented layer.
 */
function unimplementedLayer(layer: ShapeSmellLayer): ShapeSmellResult {
  return {
    layer,
    smells: [],
    diagnostic:
      layer === 'hidden-coupling'
        ? 'Layer 2 (hidden-coupling via co-change) not yet implemented. ' + LAYER_2_3_NOTE
        : layer === 'enum-extension-impact'
          ? 'Layer 3 (enum-extension impact analysis) not yet implemented. ' + LAYER_2_3_NOTE
          : undefined,
  };
}

export function registerShapeSmellTools(server: McpServer, defaultRoot: string): void {
  // Tool: detect shape smells
  server.tool(
    'archguard_detect_shape_smells',
    'Detect shape smells (currently: literal dispersion) in a TypeScript project.' +
      'Literal dispersion identifies enum/string-union values compared across multiple ' +
      'modules, indicating a missing structured abstraction and Shotgun Surgery risk.' +
      'Layers 2 (hidden-coupling) and 3 (enum-extension-impact) are deferred.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      layers: z
        .array(z.enum(['literal-dispersion', 'hidden-coupling', 'enum-extension-impact']))
        .optional()
        .default(['literal-dispersion'])
        .describe(
          'Shape smell layers to detect. Defaults to ["literal-dispersion"]. ' +
            'Layers "hidden-coupling" and "enum-extension-impact" are deferred (return empty + diagnostic).'
        ),
      sources: z
        .array(z.string())
        .optional()
        .describe(
          'Source files or directories to analyze. Omit to auto-detect from the project structure.'
        ),
      dispersionThreshold: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(2)
        .describe(
          'Minimum number of files a literal value must appear in to be flagged. Default 2.'
        ),
      srcRoot: z
        .string()
        .optional()
        .describe(
          'Source root directory (e.g. "src"). When provided, applies cross-module scope ' +
            'filtering: smells confined to a single module are dropped.'
        ),
    },
    async ({ projectRoot, layers, sources, dispersionThreshold, srcRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');

        const results: ShapeSmellResult[] = [];
        let totalSmells = 0;
        let infoCount = 0;
        let warningCount = 0;

        for (const layer of layers ?? ['literal-dispersion']) {
          if (layer !== 'literal-dispersion') {
            results.push(unimplementedLayer(layer));
            continue;
          }

          // Run literal-dispersion detection
          const options: DetectDispersionOptions = {
            threshold: dispersionThreshold ?? 2,
            srcRoot,
          };

          // Discover source files
          const sourceFiles = sources ?? (await discoverSources(root));
          if (!sourceFiles || sourceFiles.length === 0) {
            results.push({ layer: 'literal-dispersion', smells: [] });
            continue;
          }

          // Read file contents and extract types
          const fs = await import('fs-extra');
          const fileContents = new Map<string, string>();
          const allTypes: import('@/analysis/shape-smells/types.js').DiscriminatorType[] = [];

          for (const file of sourceFiles) {
            try {
              const content = await fs.readFile(file, 'utf-8');
              fileContents.set(file, content);
              const types = extractDiscriminatorTypes(content, file);
              allTypes.push(...types);
            } catch {
              // Skip unreadable files
            }
          }

          // Detect dispersion
          const smells = detectDispersion(allTypes, fileContents, options);

          for (const s of smells) {
            if (s.severity === 'info') infoCount++;
            else warningCount++;
          }
          totalSmells += smells.length;

          results.push({ layer: 'literal-dispersion', smells });
        }

        const manifest: ShapeSmellManifest = {
          version: '1',
          generatedAt: new Date().toISOString(),
          totalSmells,
          bySeverity: { info: infoCount, warning: warningCount },
        };

        const analysis: ShapeSmellAnalysis = { manifest, results };

        // Persist results
        try {
          await persistResults(archDir, analysis);
        } catch {
          // Non-fatal: persist failure shouldn't fail the tool
        }

        return textResponse(JSON.stringify({ manifest, results }, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );

  // Tool: get literal dispersion results
  server.tool(
    'archguard_get_literal_dispersion',
    'Query persisted literal-dispersion results. Returns smells from a prior ' +
      'archguard_detect_shape_smells run. Supports filtering by typeName, value, ' +
      'and minimum dispersion.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      typeName: z
        .string()
        .optional()
        .describe('Filter results to a specific discriminator type name (e.g. "AppKind").'),
      value: z
        .string()
        .optional()
        .describe('Filter results to a specific literal value (e.g. "web").'),
      minDispersion: z
        .number()
        .min(1)
        .optional()
        .describe('Filter to only smells with dispersion >= this value.'),
    },
    async ({ projectRoot, typeName, value, minDispersion }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');

        let smells = await loadLiteralDispersion(archDir);

        if (!smells) {
          return textResponse(
            JSON.stringify(
              {
                smells: [],
                note: 'No persisted literal-dispersion results. Run archguard_detect_shape_smells first.',
              },
              null,
              2
            )
          );
        }

        // Apply filters
        if (typeName !== undefined) {
          smells = smells.filter((s) => s.typeName === typeName);
        }
        if (value !== undefined) {
          smells = smells.filter((s) => s.value === value);
        }
        if (minDispersion !== undefined) {
          smells = smells.filter((s) => s.dispersion >= minDispersion);
        }

        return textResponse(JSON.stringify({ smells }, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}

/**
 * Auto-discover TypeScript source files in the project.
 * Uses a simple glob for .ts/.tsx files under src/ by default.
 */
async function discoverSources(root: string): Promise<string[]> {
  const glob = await import('glob');
  const srcDir = path.join(root, 'src');
  const fs = await import('fs-extra');

  if (!(await fs.pathExists(srcDir))) {
    return [];
  }

  try {
    // Use glob.sync for simplicity, or glob.glob
    const pattern = path.join(srcDir, '**', '*.ts').replace(/\\/g, '/');
    const files = glob.globSync(pattern, {
      ignore: ['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts'],
    });
    // Also include .tsx
    const tsxPattern = path.join(srcDir, '**', '*.tsx').replace(/\\/g, '/');
    const tsxFiles = glob.globSync(tsxPattern, {
      ignore: ['**/node_modules/**', '**/*.test.tsx', '**/*.spec.tsx'],
    });
    return [...files, ...tsxFiles];
  } catch {
    return [];
  }
}

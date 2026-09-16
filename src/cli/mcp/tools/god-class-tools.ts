/**
 * MCP tool: archguard_detect_god_classes
 *
 * Thin adapter (ADR-007 §1): resolves the query scope, guards on the Dart
 * language, loads entities/relations, then delegates the actual god-class
 * computation to the shared core query layer
 * (`@/core/query/god-class-detector`). No business logic lives here.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { DEFAULT_GOD_CLASS_THRESHOLDS } from '@/core/query/god-class-detector.js';
import { errorMessage } from '@/utils/error-message.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerGodClassTool(server: McpServer, defaultRoot: string): void {
  // ADR-007 §4: mirrors `query --god-classes` (shared core query computation).
  server.tool(
    'archguard_detect_god_classes',
    'Detect "god classes" in a Dart project — classes that violate single-responsibility ' +
      'by exceeding size or coupling thresholds; Dart-only, and each flagged class lists the ' +
      'thresholds it violated (reasons).',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe('Query scope key. Omit to use manifest.globalScopeKey.'),
      minMethods: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          `Method count threshold (default: ${DEFAULT_GOD_CLASS_THRESHOLDS.minMethods}). 0 disables this dimension.`
        ),
      minFields: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          `Field count threshold (default: ${DEFAULT_GOD_CLASS_THRESHOLDS.minFields}). 0 disables this dimension.`
        ),
      minLoc: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          `Class body LOC threshold (default: ${DEFAULT_GOD_CLASS_THRESHOLDS.minLoc}). Exact line span from the class declaration to its closing brace. 0 disables this dimension.`
        ),
      minFanIn: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          `Fan-in threshold — distinct classes that depend on the target (default: ${DEFAULT_GOD_CLASS_THRESHOLDS.minFanIn}). 0 disables this dimension.`
        ),
    },
    async ({ projectRoot, scope, minMethods, minFields, minLoc, minFanIn }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const { engine, extensionAccessor, scopeEntry } = await loadEngine(archDir, scope);

        if (scopeEntry.language !== 'dart') {
          return textResponse(
            'This tool is Dart-only. The analyzed scope is ' +
              `"${scopeEntry.language}", not "dart".\n` +
              `Run: archguard_analyze({ projectRoot: "${root}", lang: "dart" })`
          );
        }

        const godClasses = engine.detectGodClasses({ minMethods, minFields, minLoc, minFanIn });

        return textResponse(
          JSON.stringify(
            {
              language: 'dart',
              totalEntities: extensionAccessor.getEntities().length,
              godClasses,
            },
            null,
            2
          )
        );
      } catch (e: unknown) {
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}

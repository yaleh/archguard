/**
 * CCB Assembler — orchestrates reader → fetch → writer for CognitiveContextBundles.
 *
 * When a bundle is fresh (hash matches), returns it from cache immediately.
 * When stale or missing, fetches all signals in parallel, builds a new bundle,
 * persists it atomically, and returns it.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { readCcb } from './ccb-reader.js';
import { writeCcb } from './ccb-writer.js';
import type {
  CognitiveContextBundle,
  CognitiveBehavioralSignals,
  CognitiveGitSignals,
  CognitiveDocumentationSignals,
} from './ccb-schema.js';
import type { CognitiveSummaryEntry } from '@/types/cognitive-summary.js';
import { loadEngine } from '../query/engine-loader.js';
import { loadHistoryData } from '../git-history/history-loader.js';
import { HistoryQuery } from '../git-history/history-query.js';

/**
 * Why a CCB field is null. A bare null is indistinguishable from "not computed
 * yet" / "artifact absent" / "not collected"; every null field carries one of
 * these so the caller can say WHY instead of guessing.
 */
export type CcbFieldReason =
  | 'not-collected'
  | 'no-archjson-artifacts'
  | 'no-git-history-artifacts'
  | 'git-history-unavailable'
  | 'not-in-graph'
  | 'in-graph-no-artifact';

export interface CcbFieldReasons {
  structural?: CcbFieldReason;
  behavioral?: CcbFieldReason;
  git?: CcbFieldReason;
  guidance?: CcbFieldReason;
  coverage?: CcbFieldReason;
}

/** CCB plus the per-field reason markers for its null fields. */
export type CognitiveContextBundleWithReasons = CognitiveContextBundle & {
  reasons?: CcbFieldReasons;
};

type StructuralSummary = CognitiveSummaryEntry & {
  reason?: 'not-in-graph' | 'in-graph-no-artifact';
};

export interface AssembleOptions {
  /** When true, bypass cache and always reassemble even if bundle is fresh. */
  forceRefresh?: boolean;
}

/**
 * Derive a stable fileId from a file path.
 * Replaces path separators and dots with dashes, strips extension.
 */
export function filePathToId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExt = normalized.replace(/\.[^/.]+$/, '');
  return withoutExt.replace(/[/.:]/g, '-');
}

/**
 * Compute SHA-256 of source file content.
 */
async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

interface FileEntity {
  id: string;
  name: string;
  type: string;
  members?: Array<{ type: string }>;
}

/**
 * Fetch structural summary for the file by looking up entities in ArchJSON.
 * Returns null when ArchJSON artifacts are absent or unreadable.
 */
async function fetchStructural(
  filePath: string,
  archDir: string
): Promise<{ entry: StructuralSummary | null; reason?: CcbFieldReason }> {
  try {
    const { engine } = await loadEngine(archDir);
    const fileEntities = (
      engine as unknown as { getFileEntities?: (p: string) => FileEntity[] }
    ).getFileEntities?.(filePath);

    if (fileEntities && fileEntities.length > 0) {
      const firstEntityName = fileEntities[0].name;
      const found = engine.findEntity(firstEntityName) as FileEntity[];
      if (found && found.length > 0) {
        const entity = found[0];
        const members = entity.members ?? [];
        return {
          entry: {
            name: entity.name,
            found: true,
            entityId: entity.id,
            methodCount: members.filter((m) => m.type === 'method' || m.type === 'constructor')
              .length,
            fieldCount: members.filter((m) => m.type === 'property' || m.type === 'field').length,
            inDegree: 0,
            outDegree: 0,
            topDependents: [],
            topDependencies: [],
          },
        };
      }
      // The file's entities are in the graph, but the name index cannot resolve
      // them — an in-graph / artifact mismatch rather than an absent entity.
      return {
        entry: { name: firstEntityName, found: false, reason: 'in-graph-no-artifact' },
      };
    }
    return {
      entry: { name: path.basename(filePath), found: false, reason: 'not-in-graph' },
    };
  } catch {
    return { entry: null, reason: 'no-archjson-artifacts' };
  }
}

/**
 * Fetch git signals from history artifacts.
 * Returns { signals: null, reason } when git history artifacts are absent or unreadable.
 */
async function fetchGit(
  filePath: string,
  archDir: string
): Promise<{ signals: CognitiveGitSignals | null; reason?: CcbFieldReason }> {
  try {
    const historyData = await loadHistoryData(archDir);
    const historyQuery = new HistoryQuery(historyData);
    const risk = historyQuery.getChangeRisk('file', filePath);
    return {
      signals: {
        riskLevel: risk.riskLevel ?? 'low',
        hotspotScore: 0,
        cochangeNeighbors: [],
      },
    };
  } catch (error) {
    // Match by `name` rather than `instanceof GitHistoryNotFoundError`: unit
    // tests fully mock the history-loader module (exporting only
    // loadHistoryData), so touching the class binding would throw there. The
    // real class sets `name` to exactly this string.
    return {
      signals: null,
      reason:
        (error as Error | undefined)?.name === 'GitHistoryNotFoundError'
          ? 'no-git-history-artifacts'
          : 'git-history-unavailable',
    };
  }
}

/**
 * Fetch behavioral signals from meta-cc session history.
 * Returns null when meta-cc is unavailable.
 */
function fetchBehavioral(): Promise<CognitiveBehavioralSignals | null> {
  // meta-cc integration is a future enhancement; returns null safely
  return Promise.resolve(null);
}

/** Documentation file extensions considered for docFreshnessGap calculation. */
const DOC_EXTENSIONS = new Set(['.md', '.rst', '.txt', '.adoc']);

/**
 * Compute the documentation freshness gap from co-change neighbors.
 *
 * Returns the fraction of co-change neighbors that are documentation files.
 * A low value (< 0.3) suggests code changes rarely co-occur with doc updates.
 * Returns null when cochangeNeighbors is empty (no co-change data available).
 */
export function computeDocFreshnessGap(cochangeNeighbors: string[]): number | null {
  if (cochangeNeighbors.length === 0) {
    return null;
  }
  const docCount = cochangeNeighbors.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return DOC_EXTENSIONS.has(ext);
  }).length;
  return docCount / cochangeNeighbors.length;
}

/** Path to the meta-cc MCP binary. Configurable via META_CC_BIN env var. */
const META_CC_BIN =
  process.env['META_CC_BIN'] ?? '/home/yale/work/meta-cc/plugin-src/bin/meta-cc-mcp';

interface MetaCcDocSignals {
  docVoid: boolean;
  specPrecisionGap: boolean;
}

interface MetaCcFileEntry {
  docVoid?: boolean;
  specPrecisionGap?: boolean;
}

interface MetaCcResponse {
  files?: Record<string, MetaCcFileEntry>;
}

/**
 * Spawn meta-cc-mcp as a subprocess and call query_edit_sequences for one file.
 * Returns null when meta-cc is unavailable, times out, or the file has no session data.
 * Safe to call from unit tests — falls back to null on any error.
 */
async function queryMetaCcDocSignals(
  filePath: string,
  workingDir: string
): Promise<MetaCcDocSignals | null> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: MetaCcDocSignals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // no-op
      }
      resolve(result);
    };

    const child = spawn(META_CC_BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => settle(null), 10000);

    child.on('error', () => settle(null));
    child.on('close', () => settle(null));

    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: { content?: Array<{ type: string; text: string }> };
          };
          if (msg.id !== 2 || !msg.result?.content) continue;
          for (const c of msg.result.content) {
            if (c.type !== 'text') continue;
            try {
              const data = JSON.parse(c.text) as MetaCcResponse;
              const entry = data.files?.[absPath];
              settle({
                docVoid: entry?.docVoid ?? false,
                specPrecisionGap: entry?.specPrecisionGap ?? false,
              });
              return;
            } catch {
              settle(null);
              return;
            }
          }
          settle(null);
        } catch {
          // no-op
        }
      }
    });

    try {
      const init = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ccb-assembler', version: '1.0' },
        },
      });
      const call = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'query_edit_sequences',
          arguments: { files: [absPath], stats_only: false, working_dir: workingDir },
        },
      });
      child.stdin.write(init + '\n');
      child.stdin.write(call + '\n');
      child.stdin.end();
    } catch {
      settle(null);
    }
  });
}

/**
 * Fetch documentation signals, combining git co-change analysis and meta-cc session history.
 * docVoid and specPrecisionGap default to false when meta-cc is unavailable.
 * deFactoSpec and freshnessWarning are always null in stored CCBs (LLM layer responsibility).
 */
async function fetchDocumentationSignals(
  filePath: string,
  archDir: string,
  cochangeNeighbors: string[]
): Promise<CognitiveDocumentationSignals> {
  const docFreshnessGap = computeDocFreshnessGap(cochangeNeighbors);

  // Derive project root from archDir so meta-cc finds the right session data.
  const workingDir = path.resolve(
    path.isAbsolute(archDir) ? path.dirname(archDir) : path.dirname(path.resolve(archDir))
  );

  let docVoid = false;
  let specPrecisionGap = false;
  try {
    const result = await queryMetaCcDocSignals(filePath, workingDir);
    if (result) {
      docVoid = result.docVoid;
      specPrecisionGap = result.specPrecisionGap;
    }
  } catch {
    // meta-cc unavailable or fields not present — keep defaults (false)
  }

  return {
    docFreshnessGap,
    docVoid,
    specPrecisionGap,
    deFactoSpec: null,
    freshnessWarning: null,
  };
}

/**
 * Assemble a CognitiveContextBundle for a source file.
 *
 * @param fileId - Stable identifier for the file (use filePathToId if unknown)
 * @param filePath - Path to the source file
 * @param archDir - Path to the .archguard directory
 * @param options - Assembly options (forceRefresh bypasses cache)
 */
export async function assembleCcb(
  fileId: string,
  filePath: string,
  archDir: string,
  options?: AssembleOptions
): Promise<CognitiveContextBundleWithReasons> {
  // Return cached bundle if fresh and not forced
  if (!options?.forceRefresh) {
    const { bundle, stale } = await readCcb(fileId, filePath, archDir);
    if (!stale && bundle !== null) {
      return bundle;
    }
  }

  // Fetch all signals in parallel (null-safe on failure)
  const [fileHash, structuralResult, gitResult, behavioral] = await Promise.all([
    hashFile(filePath).catch(() => ''),
    fetchStructural(filePath, archDir),
    fetchGit(filePath, archDir),
    fetchBehavioral(),
  ]);
  const structural = structuralResult.entry;
  const git = gitResult.signals;
  const guidance = null;

  // Fetch documentation signals after git (needs cochangeNeighbors + filePath + archDir for meta-cc)
  const documentation = await fetchDocumentationSignals(
    filePath,
    archDir,
    git?.cochangeNeighbors ?? []
  );

  // Every null field carries a reason so consumers never see a bare null.
  const reasons: CcbFieldReasons = {};
  if (structural === null) {
    reasons.structural = structuralResult.reason ?? 'no-archjson-artifacts';
  }
  if (behavioral === null) {
    reasons.behavioral = 'not-collected';
  }
  if (git === null) {
    reasons.git = gitResult.reason ?? 'not-collected';
  }
  if (guidance === null) {
    reasons.guidance = 'not-collected';
  }
  if (structural?.testCoverageRatio == null) {
    reasons.coverage = 'not-collected';
  }

  const bundle: CognitiveContextBundleWithReasons = {
    fileId,
    filePath,
    fileHash,
    assembledAt: new Date().toISOString(),
    structural,
    behavioral,
    git,
    guidance,
    documentation,
    reasons,
  };

  await writeCcb(bundle, archDir);
  return bundle;
}

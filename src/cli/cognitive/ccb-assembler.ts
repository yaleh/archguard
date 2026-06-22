/**
 * CCB Assembler — orchestrates reader → fetch → writer for CognitiveContextBundles.
 *
 * When a bundle is fresh (hash matches), returns it from cache immediately.
 * When stale or missing, fetches all signals in parallel, builds a new bundle,
 * persists it atomically, and returns it.
 */

import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { readCcb } from './ccb-reader.js';
import { writeCcb } from './ccb-writer.js';
import type {
  CognitiveContextBundle,
  CognitiveBehavioralSignals,
  CognitiveGitSignals,
} from './ccb-schema.js';
import type { CognitiveSummaryEntry } from '@/types/cognitive-summary.js';
import { loadEngine } from '../query/engine-loader.js';
import { loadHistoryData } from '../git-history/history-loader.js';
import { HistoryQuery } from '../git-history/history-query.js';

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
 * Returns null when ArchJSON artifacts are absent or entity not found.
 */
async function fetchStructural(
  filePath: string,
  archDir: string
): Promise<CognitiveSummaryEntry | null> {
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
        };
      }
    }
    return { name: path.basename(filePath), found: false };
  } catch {
    return null;
  }
}

/**
 * Fetch git signals from history artifacts.
 * Returns null when git history artifacts are absent.
 */
async function fetchGit(filePath: string, archDir: string): Promise<CognitiveGitSignals | null> {
  try {
    const historyData = await loadHistoryData(archDir);
    const historyQuery = new HistoryQuery(historyData);
    const risk = historyQuery.getChangeRisk('file', filePath);
    return {
      riskLevel: risk.riskLevel ?? 'low',
      hotspotScore: 0,
      cochangeNeighbors: [],
    };
  } catch {
    return null;
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
): Promise<CognitiveContextBundle> {
  // Return cached bundle if fresh and not forced
  if (!options?.forceRefresh) {
    const { bundle, stale } = await readCcb(fileId, filePath, archDir);
    if (!stale && bundle !== null) {
      return bundle;
    }
  }

  // Fetch all signals in parallel (null-safe on failure)
  const [fileHash, structural, git, behavioral] = await Promise.all([
    hashFile(filePath).catch(() => ''),
    fetchStructural(filePath, archDir),
    fetchGit(filePath, archDir),
    fetchBehavioral(),
  ]);

  const bundle: CognitiveContextBundle = {
    fileId,
    filePath,
    fileHash,
    assembledAt: new Date().toISOString(),
    structural,
    behavioral,
    git,
    guidance: null,
  };

  await writeCcb(bundle, archDir);
  return bundle;
}

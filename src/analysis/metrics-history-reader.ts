/**
 * Reads the per-analyze metrics history from .archguard/metrics-history.jsonl.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

import path from 'path';
import fs from 'fs-extra';
import { MetricsHistoryWriter } from '@/cli/metrics-history-writer.js';
import type { MetricsHistoryEntry } from '@/cli/metrics-history-writer.js';

export type { MetricsHistoryEntry };

/**
 * Read all JSONL lines from the metrics-history file.
 * Returns an empty array if the file does not exist.
 */
export async function readHistoryEntries(outputDir: string): Promise<MetricsHistoryEntry[]> {
  const filePath = path.join(outputDir, MetricsHistoryWriter.FILENAME);
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const entries: MetricsHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as MetricsHistoryEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

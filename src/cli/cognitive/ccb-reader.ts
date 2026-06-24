/**
 * CCB Reader — reads and validates freshness of a stored CognitiveContextBundle.
 *
 * Freshness is determined by comparing the SHA-256 hash of the current source
 * file against the hash stored in the bundle at assembly time. If hashes match,
 * the bundle is still valid. If the file has changed or the bundle does not exist,
 * returns stale:true so the assembler can rebuild it.
 */

import fs from 'fs-extra';
import crypto from 'crypto';
import path from 'path';
import type { CognitiveContextBundle } from './ccb-schema.js';

export interface CcbReadResult {
  bundle: CognitiveContextBundle | null;
  stale: boolean;
}

/**
 * Read a stored CCB and check if it is still fresh.
 *
 * @param fileId - Stable file identifier (same as used when writing)
 * @param filePath - Current path of the source file (for hash comparison)
 * @param archDir - Path to the .archguard directory
 * @returns { bundle, stale } — stale:false means the bundle is current and can be used as-is
 */
export async function readCcb(
  fileId: string,
  filePath: string,
  archDir: string
): Promise<CcbReadResult> {
  const ccbPath = path.join(archDir, 'cognitive', fileId + '.ccb.json');

  let stored: CognitiveContextBundle;
  try {
    const raw = await fs.readFile(ccbPath, 'utf-8');
    stored = JSON.parse(raw) as CognitiveContextBundle;
  } catch {
    // File not found or unreadable — treat as stale
    return { bundle: null, stale: true };
  }

  // Compute SHA-256 of the current source file
  let currentHash: string;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    currentHash = crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    // Source file unreadable — treat as stale
    return { bundle: null, stale: true };
  }

  if (currentHash === stored.fileHash) {
    return { bundle: stored, stale: false };
  }

  return { bundle: null, stale: true };
}

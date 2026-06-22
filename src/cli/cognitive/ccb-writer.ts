/**
 * CCB Writer — atomically writes a CognitiveContextBundle to disk.
 *
 * Uses write-to-tmp-then-rename for crash safety. The bundle is keyed by
 * fileId and stored at <archDir>/cognitive/<fileId>.ccb.json.
 */

import fs from 'fs-extra';
import path from 'path';
import type { CognitiveContextBundle } from './ccb-schema.js';

/**
 * Write a CognitiveContextBundle atomically to <archDir>/cognitive/<fileId>.ccb.json.
 *
 * The write is crash-safe: the bundle is first written to a .tmp file,
 * then moved (renamed) to the final path. This prevents partial writes from
 * corrupting the stored bundle.
 */
export async function writeCcb(bundle: CognitiveContextBundle, archDir: string): Promise<void> {
  const cognitiveDir = path.join(archDir, 'cognitive');
  await fs.ensureDir(cognitiveDir);

  const finalPath = path.join(cognitiveDir, bundle.fileId + '.ccb.json');
  const tmpPath = finalPath + '.tmp';

  const content = JSON.stringify(bundle, null, 2);
  await fs.outputFile(tmpPath, content, 'utf-8');
  await fs.move(tmpPath, finalPath, { overwrite: true });
}

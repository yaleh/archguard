import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

export const MANIFEST_VERSION = '1.0';
export const MANIFEST_FILENAME = 'diagram-manifest.json';

export interface DiagramManifest {
  version: string;
  lastRun: string;
  outputDir: string;
  diagrams: string[]; // diagram names, e.g. ["overview/package", "class/all-classes"]
}

/**
 * Read manifest from <cacheDir>/diagram-manifest.json.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readManifest(cacheDir: string): Promise<DiagramManifest | null> {
  const filePath = path.join(cacheDir, MANIFEST_FILENAME);
  try {
    if (!(await fs.pathExists(filePath))) return null;
    const data = (await fs.readJson(filePath)) as DiagramManifest;
    if (!data || typeof data !== 'object' || data.version !== MANIFEST_VERSION) return null;
    if (!Array.isArray(data.diagrams)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Write manifest to <cacheDir>/diagram-manifest.json.
 */
export async function writeManifest(
  cacheDir: string,
  diagrams: string[],
  outputDir: string
): Promise<void> {
  const filePath = path.join(cacheDir, MANIFEST_FILENAME);
  await fs.ensureDir(cacheDir);
  const manifest: DiagramManifest = {
    version: MANIFEST_VERSION,
    lastRun: new Date().toISOString(),
    outputDir: path.resolve(outputDir),
    diagrams: [...diagrams],
  };
  await fs.writeJson(filePath, manifest, { spaces: 2 });
}

/**
 * Remove output files for diagrams that were in the previous manifest
 * but are NOT in the current diagram list.
 *
 * For each stale diagram name, removes:
 *   <outputDir>/<name>.mmd
 *   <outputDir>/<name>.mmd.render-hash
 *   <outputDir>/<name>.svg
 *   <outputDir>/<name>.png
 *
 * Also handles Atlas layers: if <outputDir>/<name>-*.mmd files exist, remove them too.
 * Use fs.remove() (from fs-extra) which is safe if file doesn't exist.
 *
 * Returns the list of stale diagram names that were cleaned.
 */
export async function cleanStaleDiagrams(
  currentDiagrams: string[],
  manifest: DiagramManifest,
  outputDir: string
): Promise<string[]> {
  const currentSet = new Set(currentDiagrams);
  const stale = manifest.diagrams.filter((name) => !currentSet.has(name));

  await Promise.all(
    stale.map(async (name) => {
      const base = path.join(outputDir, name);
      // Remove standard output files
      await Promise.all([
        fs.remove(`${base}.mmd`),
        fs.remove(`${base}.mmd.render-hash`),
        fs.remove(`${base}.svg`),
        fs.remove(`${base}.png`),
        fs.remove(`${base}.json`),
      ]);

      // Also handle Atlas layers: <outputDir>/<name>-*.mmd
      const dir = path.dirname(base);
      const nameBase = path.basename(name);
      if (await fs.pathExists(dir)) {
        const atlasFiles = await glob(`${nameBase}-*.mmd`, { cwd: dir, absolute: true });
        await Promise.all(
          atlasFiles.flatMap((f) => [fs.remove(f), fs.remove(`${f}.render-hash`)])
        );
        const atlasJsonFiles = await glob(`${nameBase}-atlas.json`, { cwd: dir, absolute: true });
        await Promise.all(atlasJsonFiles.map((f) => fs.remove(f)));
      }
    })
  );

  return stale;
}

/**
 * Delete all .mmd.render-hash sidecar files under outputDir recursively.
 * Used by the `cache clear` command to force full re-render next time.
 * Returns count of deleted files.
 */
export async function clearRenderHashes(outputDir: string): Promise<number> {
  if (!(await fs.pathExists(outputDir))) return 0;
  const files = await glob('**/*.mmd.render-hash', { cwd: outputDir, absolute: true });
  await Promise.all(files.map((f) => fs.remove(f)));
  return files.length;
}

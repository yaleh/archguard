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
  /**
   * Optional per-diagram artifact list: diagram name → source artifact paths
   * (`.mmd` / `.puml` / `.json`) actually written by the run that produced it.
   *
   * A class diagram may be split into several files (one per layer/namespace),
   * so `diagrams` alone cannot enumerate what is on disk. Older manifests have
   * no `outputs` field — consumers must fall back to `diagrams`.
   */
  outputs?: Record<string, string[]>;
}

/**
 * Keep only well-formed, non-empty artifact lists. Returns undefined when the
 * input is absent or carries no usable entry (so the field is omitted entirely
 * rather than written as `{}`).
 */
function normalizeOutputs(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const normalized: Record<string, string[]> = {};
  for (const [name, files] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    const cleaned = [
      ...new Set(
        files.filter((file): file is string => typeof file === 'string' && file.length > 0)
      ),
    ];
    if (cleaned.length > 0) normalized[name] = cleaned;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Restrict an outputs map to the given diagram names, preserving their order.
 */
function outputsForDiagrams(
  diagrams: string[],
  outputs: Record<string, string[]> | undefined
): Record<string, string[]> | undefined {
  if (!outputs) return undefined;
  const filtered: Record<string, string[]> = {};
  for (const name of diagrams) {
    if (outputs[name]) filtered[name] = outputs[name];
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

async function writeManifestRecord(cacheDir: string, manifest: DiagramManifest): Promise<void> {
  const filePath = path.join(cacheDir, MANIFEST_FILENAME);
  await fs.ensureDir(cacheDir);
  await fs.writeJson(filePath, manifest, { spaces: 2 });
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
    // `outputs` is optional (backward compatibility). A malformed value is
    // treated as absent instead of invalidating the whole manifest.
    const outputs = normalizeOutputs((data as { outputs?: unknown }).outputs);
    return outputs ? { ...data, outputs } : { ...data, outputs: undefined };
  } catch {
    return null;
  }
}

/**
 * Write manifest to <cacheDir>/diagram-manifest.json.
 *
 * Full-run semantics: the given diagram list and outputs are authoritative —
 * entries from a previous manifest are dropped (stale cleanup is the caller's
 * job via `cleanStaleDiagrams`). Use `mergeManifest` for partial runs.
 */
export async function writeManifest(
  cacheDir: string,
  diagrams: string[],
  outputDir: string,
  outputs?: Record<string, string[]>
): Promise<void> {
  const manifest: DiagramManifest = {
    version: MANIFEST_VERSION,
    lastRun: new Date().toISOString(),
    outputDir: path.resolve(outputDir),
    diagrams: [...diagrams],
  };
  const filteredOutputs = outputsForDiagrams(diagrams, normalizeOutputs(outputs));
  if (filteredOutputs) manifest.outputs = filteredOutputs;
  await writeManifestRecord(cacheDir, manifest);
}

/**
 * Merge a partial run's results into the existing manifest.
 *
 * Partial runs (filtered by `--sources` or `--diagrams`) only know about the
 * diagrams they processed. They must refresh `lastRun` and record their own
 * successes, but they have no authority to decide that diagrams produced by
 * earlier runs are stale: those entries (and their `outputs`) are preserved.
 * A diagram that participates in this run has its entry and outputs replaced.
 *
 * A missing/invalid previous manifest is not an error — the merged manifest is
 * simply created from this run's results.
 */
export async function mergeManifest(
  cacheDir: string,
  diagrams: string[],
  outputDir: string,
  outputs?: Record<string, string[]>
): Promise<void> {
  const existing = await readManifest(cacheDir);
  const mergedNames = existing ? [...existing.diagrams] : [];
  const known = new Set(mergedNames);
  for (const name of diagrams) {
    if (!known.has(name)) {
      mergedNames.push(name);
      known.add(name);
    }
  }

  const runOutputs = normalizeOutputs(outputs) ?? {};
  const mergedOutputs: Record<string, string[]> = { ...(existing?.outputs ?? {}) };
  for (const name of diagrams) {
    if (runOutputs[name]) {
      mergedOutputs[name] = runOutputs[name];
    } else {
      // The diagram ran successfully but produced no source artifact (e.g. an
      // empty ArchJSON). Its previous artifact list no longer describes disk.
      delete mergedOutputs[name];
    }
  }
  for (const name of Object.keys(mergedOutputs)) {
    if (!known.has(name)) delete mergedOutputs[name];
  }

  const manifest: DiagramManifest = {
    version: MANIFEST_VERSION,
    lastRun: new Date().toISOString(),
    outputDir: path.resolve(outputDir),
    diagrams: mergedNames,
  };
  const filteredOutputs = outputsForDiagrams(mergedNames, mergedOutputs);
  if (filteredOutputs) manifest.outputs = filteredOutputs;
  await writeManifestRecord(cacheDir, manifest);
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
 * When the previous manifest recorded explicit `outputs` for a stale diagram
 * (e.g. class diagrams split into per-layer files), those artifacts are removed
 * as well, together with their render-hash sidecar and rendered siblings.
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
      // Remove artifacts recorded by the previous run (covers split outputs
      // whose filenames are not derived from the diagram name).
      const recordedOutputs = manifest.outputs?.[name] ?? [];
      await Promise.all(
        recordedOutputs.flatMap((file) => {
          const ext = path.extname(file);
          const stem = ext ? file.slice(0, -ext.length) : file;
          return [
            fs.remove(file),
            fs.remove(`${file}.render-hash`),
            fs.remove(`${stem}.svg`),
            fs.remove(`${stem}.png`),
          ];
        })
      );

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
        await Promise.all(atlasFiles.flatMap((f) => [fs.remove(f), fs.remove(`${f}.render-hash`)]));
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

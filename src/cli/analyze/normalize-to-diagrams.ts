import path from 'path';
import fs from 'fs-extra';
import { detectProjectStructure } from '../utils/project-structure-detector.js';
import { detectCppProjectStructure } from '../utils/cpp-project-structure-detector.js';
import { detectJavaProjectStructure } from '../utils/java-project-structure-detector.js';
import { detectKotlinProjectStructure } from '../utils/kotlin-project-structure-detector.js';
import {
  createProjectRootLanguageDiagrams,
  planDefaultDiagrams,
} from '../utils/default-scope-planner.js';
import { detectProjectLanguages } from '../utils/project-language-detector.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';

/** Common options passed to every structure detector. */
interface DetectorOptions {
  label?: string;
  format?: DiagramConfig['format'];
  exclude?: string[];
  /** Used only by cpp when --sources is provided (basename of sourcePath). */
  moduleName?: string;
}

/**
 * A structure detector function: given a project root and common options,
 * it returns the list of DiagramConfig entries for that language.
 */
type StructureDetector = (
  root: string,
  options?: DetectorOptions
) => Promise<DiagramConfig[]> | DiagramConfig[];

/**
 * Registry of structure detectors keyed by language name.
 *
 * Languages whose project structure can be discovered via a single
 * `detectXxxProjectStructure(root, options)` call live here.
 *
 * Intentionally excluded:
 *  - `go`        — architecturally different (Atlas vs. standard diagram)
 *  - `typescript`/`python` — use the generic `createProjectRootLanguageDiagrams` fallback
 *
 * Export is intentional: consumers and tests can inspect or extend the map
 * without touching dispatch logic.
 */
export const LANGUAGE_STRUCTURE_DETECTORS: Record<string, StructureDetector> = {
  kotlin: (root, opts) =>
    detectKotlinProjectStructure(root, {
      label: opts?.label,
      format: opts?.format,
      exclude: opts?.exclude,
    }),
  cpp: (root, opts) =>
    detectCppProjectStructure(root, opts?.moduleName ?? path.basename(root), {
      format: opts?.format as string | undefined,
      exclude: opts?.exclude,
    }),
  java: (root, opts) =>
    detectJavaProjectStructure(root, {
      label: opts?.label,
      format: opts?.format,
      exclude: opts?.exclude,
    }),
};

/**
 * Languages that use `createProjectRootLanguageDiagrams` in the no-sources
 * path (instead of a dedicated structure detector).
 * cpp is also in this set because its no-sources path uses the generic fallback.
 */
const GENERIC_FALLBACK_LANGS = new Set(['typescript', 'python', 'cpp']);

/**
 * Normalize CLI options to DiagramConfig[]
 */
export async function normalizeToDiagrams(
  config: Config,
  cliOptions: CLIOptions,
  rootDir?: string,
  onWarning?: (message: string) => void
): Promise<DiagramConfig[]> {
  const resolvedRoot = rootDir ?? process.cwd();

  if (config.diagrams && config.diagrams.length > 0) {
    if (cliOptions.sources && cliOptions.sources.length > 0) {
      onWarning?.(
        `config.diagrams is defined, so the requested sources (${cliOptions.sources.join(', ')}) are ignored; ` +
          'remove config.diagrams or edit its sources to change what is analyzed.'
      );
    }
    return filterByLevels(config.diagrams as DiagramConfig[], cliOptions.diagrams);
  }

  if (cliOptions.sources && cliOptions.sources.length > 0) {
    const language = cliOptions.lang;

    // Go: special Atlas diagram — not a structure-detector language
    if (language === 'go') {
      const goplsTimeoutMs = readGoplsTimeoutFromConfig(cliOptions.config, resolvedRoot);
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
        languageSpecific: {
          atlas: {
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
            entryPointPattern: cliOptions.atlasEntryPattern,
            capabilityMode: cliOptions.atlasCapabilityMode as 'interface' | 'full' | undefined,
            goplsTimeoutMs,
          },
        },
      };
      return [diagram];
    }

    // Non-Go: run the single-source logic once per (deduplicated) source and
    // merge the resulting diagrams. Sources are never silently dropped.
    const uniqueSources = dedupeSources(cliOptions.sources);
    const perSource: Array<{ source: string; diagrams: DiagramConfig[] }> = [];
    for (const source of uniqueSources) {
      perSource.push({
        source,
        diagrams: await normalizeSingleSource(source, language, cliOptions, resolvedRoot),
      });
    }
    return filterByLevels(mergeSourceDiagrams(perSource), cliOptions.diagrams);
  }

  // ── No --sources path ─────────────────────────────────────────────────────

  // Go: special Atlas diagram
  if (cliOptions.lang === 'go') {
    const goplsTimeoutMs = readGoplsTimeoutFromConfig(cliOptions.config, resolvedRoot);
    return [
      {
        name: 'architecture',
        sources: ['.'],
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language: 'go',
        languageSpecific: {
          atlas: {
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
            entryPointPattern: cliOptions.atlasEntryPattern,
            capabilityMode: cliOptions.atlasCapabilityMode as 'interface' | 'full' | undefined,
            goplsTimeoutMs,
          },
        },
      },
    ];
  }

  // Languages that have a dedicated structure detector and aren't in the
  // generic-fallback set (kotlin / java)
  const lang = cliOptions.lang ?? '';
  if (LANGUAGE_STRUCTURE_DETECTORS[lang] && !GENERIC_FALLBACK_LANGS.has(lang)) {
    return filterByLevels(
      await LANGUAGE_STRUCTURE_DETECTORS[lang](resolvedRoot, {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      }),
      cliOptions.diagrams
    );
  }

  // TypeScript / Python / cpp (no-sources): generic fallback
  if (GENERIC_FALLBACK_LANGS.has(lang)) {
    return filterByLevels(
      createProjectRootLanguageDiagrams(resolvedRoot, lang as 'typescript' | 'python' | 'cpp', {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      }),
      cliOptions.diagrams
    );
  }

  // Auto-detect language then plan diagrams
  const candidates = await detectProjectLanguages(resolvedRoot);
  if (
    candidates.length === 1 &&
    candidates[0].language === 'typescript' &&
    candidates[0].score === 0
  ) {
    const fallbackDiagrams = await detectProjectStructure(resolvedRoot);
    return filterByLevels(fallbackDiagrams, cliOptions.diagrams);
  }

  const diagrams = await planDefaultDiagrams(resolvedRoot, {
    format: cliOptions.format,
    exclude: cliOptions.exclude,
  });
  return filterByLevels(diagrams, cliOptions.diagrams);
}

/** Drop repeated sources (compared by resolved path), keeping first-seen order. */
function dedupeSources(sources: string[]): string[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = path.resolve(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Existing single-source dispatch for non-Go languages (TS/Python, detector registry, auto-detect). */
async function normalizeSingleSource(
  source: string,
  language: string | undefined,
  cliOptions: CLIOptions,
  resolvedRoot: string
): Promise<DiagramConfig[]> {
  const sourcePath = path.resolve(source);

  // TypeScript / Python: generic fallback (label comes from the source path)
  if (language === 'python' || language === 'typescript') {
    return createProjectRootLanguageDiagrams(resolvedRoot, language, {
      label: path.basename(sourcePath),
      source,
      format: cliOptions.format,
      exclude: cliOptions.exclude,
    });
  }

  // Registry lookup (kotlin / cpp / java + future languages)
  const detector = LANGUAGE_STRUCTURE_DETECTORS[language ?? ''];
  if (detector) {
    return detector(sourcePath, {
      label: path.basename(sourcePath),
      moduleName: path.basename(sourcePath),
      format: cliOptions.format,
      exclude: cliOptions.exclude,
    });
  }

  // Unknown language: auto-detect project structure
  return detectProjectStructure(resolvedRoot, sourcePath);
}

/**
 * Merge per-source diagram lists. When two sources yield the same diagram
 * name (same basename label, or detectors that emit un-namespaced names like
 * `overview/package`) later ones are renamed so outputs never overwrite each other.
 */
function mergeSourceDiagrams(
  perSource: Array<{ source: string; diagrams: DiagramConfig[] }>
): DiagramConfig[] {
  const used = new Set<string>();
  const merged: DiagramConfig[] = [];
  for (const { source, diagrams } of perSource) {
    const label = path.basename(path.resolve(source));
    for (const diagram of diagrams) {
      let name = diagram.name;
      if (used.has(name) && !name.startsWith(`${label}/`)) {
        name = `${label}/${name}`;
      }
      for (let n = 2; used.has(name); n++) {
        const [head, ...rest] = diagram.name.split('/');
        name = [`${head}-${n}`, ...rest].join('/');
      }
      used.add(name);
      merged.push(name === diagram.name ? diagram : { ...diagram, name });
    }
  }
  return merged;
}

export function filterByLevels(diagrams: DiagramConfig[], levels?: string[]): DiagramConfig[] {
  if (!levels || levels.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => levels.includes(d.level ?? 'class'));
}

/**
 * Read `atlas.goplsTimeoutMs` from the raw config file (before Zod validation
 * strips unknown keys). Tries `explicitConfigPath` (--config) first, then
 * falls back to `fallbackDir/archguard.config.json`. Returns undefined when
 * the value is absent, non-numeric, or non-positive.
 */
function readGoplsTimeoutFromConfig(
  explicitConfigPath?: string,
  fallbackDir?: string
): number | undefined {
  let raw: unknown;
  try {
    if (explicitConfigPath) {
      const resolved = path.resolve(explicitConfigPath);
      if (fs.existsSync(resolved)) {
        raw = fs.readJsonSync(resolved);
      }
    } else if (fallbackDir) {
      const fallback = path.join(fallbackDir, 'archguard.config.json');
      if (fs.existsSync(fallback)) {
        raw = fs.readJsonSync(fallback);
      }
    }
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const atlas = (raw as Record<string, unknown>).atlas;
  if (!atlas || typeof atlas !== 'object') return undefined;
  const value = (atlas as Record<string, unknown>).goplsTimeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

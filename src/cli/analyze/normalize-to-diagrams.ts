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
import {
  detectPrimaryLanguage,
  detectProjectLanguages,
} from '../utils/project-language-detector.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';
import type { DetectedLanguage } from '../utils/project-language-detector.js';

/** Single-file extension → language, for sources that are files (not dirs). */
const FILE_EXTENSION_LANGUAGE: Record<string, DetectedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.go': 'go',
  '.java': 'java',
  '.py': 'python',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.h': 'cpp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
};

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
const GENERIC_FALLBACK_LANGS = new Set(['typescript', 'python', 'cpp', 'dart']);

/**
 * Normalize CLI options to DiagramConfig[]
 */
export async function normalizeToDiagrams(
  config: Config,
  cliOptions: CLIOptions,
  rootDir?: string
): Promise<DiagramConfig[]> {
  const resolvedRoot = rootDir ?? process.cwd();

  if (config.diagrams && config.diagrams.length > 0) {
    return filterByLevels(config.diagrams as DiagramConfig[], cliOptions.diagrams);
  }

  if (cliOptions.sources && cliOptions.sources.length > 0) {
    const sourcePath = path.resolve(cliOptions.sources[0]);

    // Resolve the effective language. An explicit --lang always wins. When it
    // is absent, auto-detect from the source root so non-TypeScript projects
    // (go/java/python/cpp/kotlin/dart) are routed correctly instead of being
    // silently treated as TypeScript. TypeScript — or an undetectable project —
    // keeps the legacy structure detector, which emits richer per-module method
    // diagrams for TS.
    let language = cliOptions.lang;
    if (!language) {
      const detected = await detectSourceLanguage(cliOptions.sources, resolvedRoot);
      if (!detected || detected === 'typescript') {
        const diagrams = await detectProjectStructure(resolvedRoot, sourcePath);
        return filterByLevels(diagrams, cliOptions.diagrams);
      }
      language = detected;
    }

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

    // TypeScript / Python / Dart: generic fallback (label comes from the source path)
    if (language === 'python' || language === 'typescript' || language === 'dart') {
      return filterByLevels(
        createProjectRootLanguageDiagrams(resolvedRoot, language, {
          label: path.basename(sourcePath),
          sources: cliOptions.sources,
          format: cliOptions.format,
          exclude: cliOptions.exclude,
        }),
        cliOptions.diagrams
      );
    }

    // Registry lookup (kotlin / cpp / java + future languages)
    const detector = LANGUAGE_STRUCTURE_DETECTORS[language ?? ''];
    if (detector) {
      return filterByLevels(
        await detector(sourcePath, {
          label: path.basename(sourcePath),
          moduleName: path.basename(sourcePath),
          format: cliOptions.format,
          exclude: cliOptions.exclude,
        }),
        cliOptions.diagrams
      );
    }

    // Unknown language: fall back to the TypeScript structure detector.
    const diagrams = await detectProjectStructure(resolvedRoot, sourcePath);
    return filterByLevels(diagrams, cliOptions.diagrams);
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
      createProjectRootLanguageDiagrams(
        resolvedRoot,
        lang as 'typescript' | 'python' | 'cpp' | 'dart',
        {
          format: cliOptions.format,
          exclude: cliOptions.exclude,
        }
      ),
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

export function filterByLevels(diagrams: DiagramConfig[], levels?: string[]): DiagramConfig[] {
  if (!levels || levels.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => levels.includes(d.level ?? 'class'));
}

/**
 * Detect the single language for a list of `--sources` (no `--lang`).
 *
 * Each source is detected independently: directories via `detectPrimaryLanguage`,
 * individual files via their extension. Returns the common language, or throws
 * when sources span multiple distinct languages (so the caller can't silently
 * parse every source with the first source's plugin — this would misparse the
 * others and drop them from the scope). Returns `undefined` when nothing is
 * detectable — the caller falls back to the legacy TypeScript structure
 * detector.
 */
async function detectSourceLanguage(
  sources: string[],
  resolvedRoot: string
): Promise<DetectedLanguage | undefined> {
  const resolvedSources = sources.map((s) => path.resolve(resolvedRoot, s));
  const detected = new Set<DetectedLanguage>();

  for (const source of resolvedSources) {
    const ext = path.extname(source).toLowerCase();
    if (ext && FILE_EXTENSION_LANGUAGE[ext]) {
      detected.add(FILE_EXTENSION_LANGUAGE[ext]);
      continue;
    }
    // Directory (or extension-less path): full directory scan. Only a *real*
    // detection (score > 0) pins a language — the `score: 0` fallback candidate
    // signals "undetectable" and must not force a parser choice.
    const primary = await detectPrimaryLanguage(source);
    if (primary && primary.score > 0) {
      detected.add(primary.language);
    }
  }

  // A single language (including TypeScript) is the only valid routing result.
  // Two distinct languages (e.g. TS + Dart, or Dart + Python) mean the caller
  // would parse every source with one plugin, so reject and require --lang.
  if (detected.size === 0) return undefined;
  if (detected.size === 1) return [...detected][0];
  throw new Error(
    `Mixed source languages detected (${[...detected].sort().join(', ')}). ` +
      'Pass --lang to select the parser explicitly.'
  );
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
